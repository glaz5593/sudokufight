import {
  defaultRules,
  type GameView,
  type HostAction,
  INTERFERENCE_KINDS,
  type InterferenceKind,
  type InterferenceTarget,
  type PlayerId,
} from '@sudoku-fight/engine';

import { metrics as playerMetrics } from '../../../components/player/metrics';
import type { Rect } from '../geometry';
import { ARSENAL_CONFIG } from './config';
import { type ArsenalMetrics, arsenalMetrics } from './metrics';

/**
 * The interference picker as a pure view model (spec §7.2, §7.3; components.md §13), read from the engine's
 * GameView. The engine already decided everything that is a rule: the cost of my next interference (2^n, D10),
 * how many points I miss, whether the target can take one now (busy or in its second of immunity, D11; out;
 * disconnected; the game not running), and which kinds this game allows (a room of mixed app versions allows
 * only the kinds every app can draw, D47). This only lays that out per kind, and adds which kinds are open at my
 * level (D17). No game logic: what may be launched is the view's answer.
 */

/** Why a kind can't be launched now. */
export type TokenBlock = 'locked' | NonNullable<InterferenceTarget['blockedBy']>;

export interface ArsenalToken {
  kind: InterferenceKind;
  /** What launching it costs now: my next interference [D10]. */
  cost: number;
  /** My score covers the cost (spec §7.2: score ≥ cost). */
  affordable: boolean;
  /** Points short ("חסרות 3 נק׳"); 0 when affordable. */
  missing: number;
  /** Open to me at my level [D17]. */
  unlocked: boolean;
  /** The level that opens it ("רמה 3"), while it is locked; null when open [D17, D47]. */
  unlockLevel: number | null;
  /** Why it can't be launched now; null when it can. */
  blockedReason: TokenBlock | null;
}

export interface ArsenalModel {
  /** The opponent whose "הפרעה" button opened the picker: the one target (original §17) [D45]. */
  targetId: PlayerId;
  /** The next interference's cost [D10]. */
  cost: number;
  /** The one after it ("הבאה: 4"). */
  nextCost: number;
  /** The two after it. */
  laterCosts: number[];
  /** My score now, and after paying the cost. */
  score: number;
  scoreAfter: number;
  /** Points short of the cost; 0 when I can pay. */
  missing: number;
  /** Why the target can't take an interference now (the view's answer), or null. */
  targetBlocked: InterferenceTarget['blockedBy'];
  /**
   * There is nothing to aim at any more: the target left or disconnected (its button is hidden then), or the
   * game is over (its last flash and then the results come next). The screen closes the picker.
   */
  gone: boolean;
  /** How long an interference lasts, in whole seconds (spec §7.2: 5). */
  seconds: number;
  /**
   * The kinds this game allows, in the engine's order (fireworks, cats, warp, scramble, ink, keypad). A kind the
   * game does not allow is not shown at all; one above my level is shown locked.
   */
  tokens: ArsenalToken[];
}

/** How many later costs the model names. */
const LATER_COSTS = 2;

/**
 * The picker opened from `targetId`'s card, or null when I can't send interferences at all (solo practice, a
 * practice against a bot [D44], a spectator, out of the game, disconnected) or `targetId` is not an opponent.
 *
 * The later costs multiply by the cost base of the rules for this game's mode (2, D10); the cost charged is
 * always the view's `nextCost`, never this hint.
 */
export function arsenalModel(
  view: GameView,
  targetId: PlayerId,
  unlocked: readonly InterferenceKind[] = ARSENAL_CONFIG.unlocked,
  levels: Readonly<Partial<Record<InterferenceKind, number>>> = ARSENAL_CONFIG.unlockLevels,
): ArsenalModel | null {
  const info = view.interference;
  const target = info?.targets.find((x) => x.playerId === targetId);
  if (!info || !target) return null;
  const me = view.players.find((p) => p.id === view.me);
  const score = me?.score ?? 0;
  const cost = info.nextCost;
  const missing = info.missingPoints;
  const base = defaultRules(view.mode, view.gameType).interferenceCostBase;
  const laterCosts = Array.from({ length: LATER_COSTS }, (_, i) => cost * base ** (i + 1));
  const blocked = target.blockedBy;
  const open = new Set(unlocked);
  // Only the kinds this game allows; a kind this app does not know (a newer peer's) is never drawn.
  const allowed = new Set<string>(view.rules.interferenceKinds);

  const tokens = INTERFERENCE_KINDS.filter((kind) => allowed.has(kind)).map((kind): ArsenalToken => {
    const isOpen = open.has(kind);
    const level = levels[kind] ?? 0;
    return {
      kind,
      cost,
      affordable: missing === 0,
      missing,
      unlocked: isOpen,
      // "רמה 3" only for a kind a level opens (locked another way, it just says locked).
      unlockLevel: isOpen || level <= 0 ? null : level,
      blockedReason: isOpen ? blocked : 'locked',
    };
  });

  return {
    targetId,
    cost,
    nextCost: laterCosts[0]!,
    laterCosts,
    score,
    scoreAfter: score - cost,
    missing,
    targetBlocked: blocked,
    gone: blocked === 'out' || blocked === 'disconnected' || view.status === 'over',
    seconds: Math.round(view.rules.interferenceMs / 1000),
    tokens,
  };
}

/** A kind can be launched when nothing blocks it. */
export const launchable = (token: ArsenalToken): boolean => token.blockedReason === null;

/**
 * The host refused an interference after the picker had already closed, and with it the launch cue and the
 * "launched" announcement had already played: the screen says that nothing was sent and nothing charged [D45].
 * Whatever the reason: the target turned busy, my score dropped, the room does not allow that kind, or the game
 * froze, ended or lost me before my tap arrived ('paused', 'gameOver', 'notActive', 'disconnected'). Told by the
 * refused action, never by the reason, which a select or a digit can share ('paused', 'disconnected').
 */
export const isInterferenceRefusal = (action: HostAction['type']): boolean => action === 'interfere';

// ---------------------------------------------------------------------------------------------------------
// Where the target is. Rects are in window coordinates (measureInWindow).

/** The target frame grows this far outside the card (components.md §3.4: padding 6 + outline 2). */
const FRAME_OUTSET = playerMetrics.targetFrame.padding + playerMetrics.targetFrame.outline;

/**
 * The target frame of a card measured in the window, as drawn around it (the frame grows outwards, so the card
 * itself does not move): the scrim's hole and the launch ripple.
 */
export function targetFrameOf(card: Rect): Rect {
  return {
    x: card.x - FRAME_OUTSET,
    y: card.y - FRAME_OUTSET,
    width: card.width + 2 * FRAME_OUTSET,
    height: card.height + 2 * FRAME_OUTSET,
  };
}

/** A rect moved into another origin (window → the overlay's own coordinates). */
export const relativeTo = (r: Rect, origin: { x: number; y: number }): Rect => ({
  x: r.x - origin.x,
  y: r.y - origin.y,
  width: r.width,
  height: r.height,
});

/**
 * The scrim around a hole (components.md §13: the target card stays above the scrim): four rects that cover
 * the area outside `hole` (clipped to it), top and bottom full width, left and right between them. Empty
 * pieces are left out.
 */
export function scrimPieces(hole: Rect, area: { width: number; height: number }): Rect[] {
  const left = Math.max(0, Math.min(area.width, hole.x));
  const right = Math.max(left, Math.min(area.width, hole.x + hole.width));
  const top = Math.max(0, Math.min(area.height, hole.y));
  const bottom = Math.max(top, Math.min(area.height, hole.y + hole.height));
  const pieces: Rect[] = [
    { x: 0, y: 0, width: area.width, height: top },
    { x: 0, y: bottom, width: area.width, height: area.height - bottom },
    { x: 0, y: top, width: left, height: bottom - top },
    { x: right, y: top, width: area.width - right, height: bottom - top },
  ];
  return pieces.filter((p) => p.width > 0 && p.height > 0);
}

// ---------------------------------------------------------------------------------------------------------
// The picker's layout [D45]: every kind visible at once, never a scroll.

export interface PickerLayout {
  columns: number;
  /** The width of one kind button. */
  columnWidth: number;
  rows: number;
  /** The sheet's height with every part in it (the bottom inset included). */
  sheetHeight: number;
  /** The most the sheet may take: 85 % of the window. */
  maxHeight: number;
  /** All of it fits, so nothing scrolls. */
  fits: boolean;
}

/**
 * The picker's size for a window (pure, so it is tested for the small phones): the sheet's padding, handle,
 * header, price row, a grid of `count` buttons in `columns` columns, and the info line. `metrics`: the app's
 * language's dimensions, or another language's (arsenalMetricsFor) for its layout test.
 */
export function pickerLayout({
  width,
  height,
  bottomInset = 0,
  count,
  columns = ARSENAL_CONFIG.columns,
  metrics: m = arsenalMetrics,
}: {
  width: number;
  height: number;
  bottomInset?: number;
  count: number;
  columns?: number;
  metrics?: ArsenalMetrics;
}): PickerLayout {
  const rows = Math.ceil(count / columns);
  const inner = width - 2 * m.sheet.paddingX;
  const columnWidth = (inner - (columns - 1) * m.grid.gap) / columns;
  const grid = rows === 0 ? 0 : rows * m.button.height + (rows - 1) * m.grid.gap;
  const sheetHeight =
    m.sheet.paddingTop +
    m.sheet.handle +
    m.header.top +
    m.header.height +
    m.price.top +
    m.price.height +
    m.grid.top +
    grid +
    m.info.top +
    m.info.height +
    m.sheet.paddingBottom +
    bottomInset;
  const maxHeight = height * m.sheet.maxShare;
  return { columns, columnWidth, rows, sheetHeight, maxHeight, fits: sheetHeight <= maxHeight };
}
