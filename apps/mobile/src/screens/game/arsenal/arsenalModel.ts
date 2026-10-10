import {
  defaultRules,
  type GameView,
  INTERFERENCE_KINDS,
  type InterferenceKind,
  type InterferenceTarget,
  type PlayerId,
} from '@sudoku-fight/engine';

import { metrics as playerMetrics } from '../../../components/player/metrics';
import type { Rect } from '../geometry';
import { ARSENAL_CONFIG } from './config';

/**
 * The arsenal as a pure view model (spec §7.2, §7.3; components.md §13), read from the engine's GameView. The
 * engine already decided everything that is a rule: the cost of my next interference (2^n, D10), how many
 * points I miss, and whether the target can take one now (busy or in its second of immunity, D11; out;
 * disconnected; the game not running). This only lays that out per token, and adds which tokens are open
 * (D17). No game logic: what may be launched is the view's answer.
 */

/** Why a token can't be dragged now. */
export type TokenBlock = 'locked' | NonNullable<InterferenceTarget['blockedBy']>;

export interface ArsenalToken {
  kind: InterferenceKind;
  /** What launching it costs now: my next interference [D10]. */
  cost: number;
  /** My score covers the cost (spec §7.2: score ≥ cost). */
  affordable: boolean;
  /** Points short ("חסרות 3 נק׳"); 0 when affordable. */
  missing: number;
  /** Open to me [D17]: in this game's kinds and in the app's unlocked list. */
  unlocked: boolean;
  /** Why it can't be dragged now; null when it can. */
  blockedReason: TokenBlock | null;
}

export interface ArsenalModel {
  /** The opponent whose ⚡ opened the arsenal: the one drop zone (spec §7.3.3). */
  targetId: PlayerId;
  /** The next interference's cost [D10]. */
  cost: number;
  /** The two after it, for "אחריה 4, 8…". */
  laterCosts: number[];
  /** My score now, and after paying the cost. */
  score: number;
  scoreAfter: number;
  /** Points short of the cost; 0 when I can pay. */
  missing: number;
  /** Why the target can't take an interference now (the view's answer), or null. */
  targetBlocked: InterferenceTarget['blockedBy'];
  /**
   * There is nothing to aim at any more: the target left or disconnected (its ⚡ is hidden then), or the game
   * is over (its last flash and then the results come next). The screen closes the arsenal.
   */
  gone: boolean;
  /** How long an interference lasts, in whole seconds (spec §7.2: 5). */
  seconds: number;
  tokens: ArsenalToken[];
}

/** How many later costs the cost row names ("אחריה 4, 8…"). */
const LATER_COSTS = 2;

/**
 * The arsenal opened from `targetId`'s card, or null when I can't send interferences at all (solo practice, a
 * spectator, out of the game, disconnected) or `targetId` is not an opponent.
 *
 * The later costs multiply by the cost base of the rules for this game's mode (2, D10); the cost charged is
 * always the view's `nextCost`, never this hint.
 */
export function arsenalModel(
  view: GameView,
  targetId: PlayerId,
  unlocked: readonly InterferenceKind[] = ARSENAL_CONFIG.unlocked,
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
  const open = new Set(unlocked.filter((k) => view.rules.interferenceKinds.includes(k)));

  const tokens = INTERFERENCE_KINDS.map((kind): ArsenalToken => {
    const isOpen = open.has(kind);
    return {
      kind,
      cost,
      affordable: missing === 0,
      missing,
      unlocked: isOpen,
      blockedReason: isOpen ? blocked : 'locked',
    };
  });

  return {
    targetId,
    cost,
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

/** A token can be dragged when nothing blocks it. */
export const launchable = (token: ArsenalToken): boolean => token.blockedReason === null;

// ---------------------------------------------------------------------------------------------------------
// Where the drop zone is. Rects are in window coordinates (measureInWindow), as the gesture's absoluteX/Y are.

/** The DropZone frame grows this far outside the card (components.md §3.4: padding 6 + outline 2). */
const ZONE_OUTSET = playerMetrics.dropTarget.padding + playerMetrics.dropTarget.outline;
/** The "גרור לכאן" chip hangs half its height below the frame. */
const CHIP_HANG = playerMetrics.dropTarget.chipHeight / 2;

/**
 * The drop zone of a card measured in the window: the card's drop-target frame as drawn around it (the frame
 * grows outwards, so the card itself does not move), and the chip under it. Only this rect launches.
 */
export function dropZoneOf(card: Rect): Rect {
  return {
    x: card.x - ZONE_OUTSET,
    y: card.y - ZONE_OUTSET,
    width: card.width + 2 * ZONE_OUTSET,
    height: card.height + 2 * ZONE_OUTSET + CHIP_HANG,
  };
}

/** Whether a point is inside the zone (edges included). Runs on the UI thread, in the drag gesture. */
export function inZone(zone: Rect | null, x: number, y: number): boolean {
  'worklet';
  if (zone === null) return false;
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}

/** A rect moved into another origin (window → the overlay's own coordinates). */
export const relativeTo = (r: Rect, origin: { x: number; y: number }): Rect => ({
  x: r.x - origin.x,
  y: r.y - origin.y,
  width: r.width,
  height: r.height,
});

/**
 * The scrim around a hole (components.md §13: the source card stays above the scrim): four rects that cover
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
