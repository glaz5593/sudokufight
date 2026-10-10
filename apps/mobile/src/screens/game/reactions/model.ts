import type { GameView, PlayerId } from '@sudoku-fight/engine';

import type { FeedbackCue } from '../../../services/feedback';
import { size, space, tokens } from '../../../theme';
import type { Rect } from '../geometry';
import { reactionCue } from '../model';

/**
 * Pure models of sending and muting reactions (spec §8, D19; components.md §8.2; motion.md §4.5). They only
 * read the engine's GameView: which reactions exist (`rules.reactions`), and when I may react again
 * (`reactionReadyAt`, the 2 s rate limit). Nothing here decides a rule; the host still refuses what it must.
 */

// ---------------------------------------------------------------------------------------------------------
// The picker

/** The `game:reactions.name.*` key of each base reaction (components.md §8.2: "תגובה: צחוק / בהלה / …"). */
export const REACTION_NAMES: Readonly<Record<string, string>> = {
  '😂': 'laugh',
  '😱': 'scream',
  '😎': 'cool',
  '🤦': 'facepalm',
  '🔥': 'fire',
  '👀': 'eyes',
};

/** The name key of a reaction, or null for one without a name yet (a future emoji: "תגובה 🎉"). */
export const reactionNameKey = (emoji: string): string | null => REACTION_NAMES[emoji] ?? null;

export interface PickerItem {
  emoji: string;
  /** The `game:reactions.name.*` key, or null (the label then quotes the emoji). */
  nameKey: string | null;
  /** During the cooldown, or when I can't react at all. */
  disabled: boolean;
}

export interface PickerModel {
  /** I can react in this game at all: a player in it, the game on, reactions in its rules. */
  available: boolean;
  /** Within the rate limit after my last reaction [D19]: the button rests and the items are off. */
  coolingDown: boolean;
  /** How long the cooldown still runs (0 when ready). */
  readyInMs: number;
  /** The reactions of this game's rules, in their order (😂 😱 😎 🤦 🔥 👀). */
  items: PickerItem[];
}

type PickerView = Pick<GameView, 'status' | 'me' | 'players' | 'rules' | 'reactionReadyAt'>;

/** What my reactions button and its picker can do at `now` (in the clock the view was made in). */
export function pickerModel(view: PickerView, now: number): PickerModel {
  const me = view.players.find((p) => p.id === view.me) ?? null;
  const on = view.status !== 'waiting' && view.status !== 'over';
  const available =
    me !== null && me.status === 'active' && me.connected && on && view.rules.reactions.length > 0;
  const readyInMs = Math.max(0, view.reactionReadyAt - now);
  const coolingDown = readyInMs > 0;
  return {
    available,
    coolingDown,
    readyInMs,
    items: view.rules.reactions.map((emoji) => ({
      emoji,
      nameKey: reactionNameKey(emoji),
      disabled: !available || coolingDown,
    })),
  };
}

/** What happens to the picker: my card's button toggles it; a pick, an outside tap or back closes it. */
export type PickerAction = 'toggle' | 'close' | 'pick';

/**
 * Whether the picker is open after `action`. It opens only when a reaction can be sent now (the button is
 * disabled during the cooldown anyway), and anything else closes it.
 */
export function pickerReducer(open: boolean, action: PickerAction, model: PickerModel): boolean {
  if (action !== 'toggle') return false;
  return !open && model.available && !model.coolingDown;
}

/** The picker as the screen shows it: an open picker closes by itself once I can't react (the game ended). */
export const pickerShown = (open: boolean, model: PickerModel): boolean => open && model.available;

// ---------------------------------------------------------------------------------------------------------
// Muting (spec §8: "אפשר להשתיק יריב דרך התפריט של הכרטיס שלו")

/** What a reaction that arrives does on this phone (motion.md §4.5, §7, §8). */
export interface ReactionPlan {
  /** Rise from the sender's card (mine too: every device shows it). */
  float: boolean;
  /** The sound and haptic of an opponent's reaction; none for my own (I already felt `reactSend`). */
  cue: FeedbackCue | null;
  /** The live region says it (an opponent's only). */
  announce: boolean;
}

/**
 * A reaction from `playerId`: shown, played and said, unless I muted its sender, then nothing at all (motion.md
 * §4.5 "Muted players: not shown", §8 "Sounds from muted players' reactions never play"). Null: drop it.
 */
export function reactionPlan(
  e: { playerId: PlayerId; emoji: string; byMe: boolean },
  muted: readonly PlayerId[],
): ReactionPlan | null {
  if (!e.byMe && muted.includes(e.playerId)) return null;
  return { float: true, cue: e.byMe ? null : reactionCue(e.emoji), announce: !e.byMe };
}

/** The floats still worth showing once some senders are muted (a float in the air disappears with them). */
export function unmutedFloats<F extends { playerId?: PlayerId }>(
  floats: readonly F[],
  muted: readonly PlayerId[],
): readonly F[] {
  if (muted.length === 0) return floats;
  return floats.filter((f) => f.playerId === undefined || !muted.includes(f.playerId));
}

// ---------------------------------------------------------------------------------------------------------
// Where the popovers sit (components.md §8.2): under a card, never over the board

const card = tokens.layout.game.playerCard;

/** The picker: six 44 dp buttons, gap 2, padding 4, a 1 dp border; radius 16 and a 14 dp arrow. */
export const POPOVER = {
  button: size.touch,
  gap: space[1],
  padding: space[2],
  border: tokens.border.hairline,
  radius: space[8],
  arrow: space[7],
  /** Under the card (4 dp), measured to the popover's top edge, where the arrow sits. */
  below: space[2],
  /** The screen's side margin, which the popover never crosses. */
  gutter: tokens.layout.gutterGame,
} as const;

/** The picker's outer width for `count` emoji. */
export const pickerWidth = (count: number): number =>
  count * POPOVER.button + Math.max(0, count - 1) * POPOVER.gap + 2 * (POPOVER.padding + POPOVER.border);

/** The popover hangs from the screen edge on its card's outer side, so it grows towards the middle. */
export interface Placement {
  /** The physical screen edge it is measured from (the overlay is LTR). */
  side: 'left' | 'right';
  /** Distance from that edge. */
  inset: number;
  /** Its top edge, in the overlay's coordinates. */
  top: number;
  /** The arrow's centre, from the popover's edge on `side`. */
  arrow: number;
}

/**
 * A popover under `cardRect` (in the overlay's coordinates), its arrow pointing up at `targetX`. Its outer edge
 * lines up with the card's (the side of the screen the card is on); with a known `width` it also stays inside
 * the 16 dp gutters. The arrow stays clear of the rounded corners.
 */
export function placeUnder(cardRect: Rect, screenWidth: number, targetX: number, width?: number): Placement {
  const onLeft = cardRect.x + cardRect.width / 2 < screenWidth / 2;
  const side = onLeft ? 'left' : 'right';
  const outer = onLeft ? cardRect.x : screenWidth - (cardRect.x + cardRect.width);
  const room = width === undefined ? Infinity : screenWidth - POPOVER.gutter - width;
  const inset = Math.max(0, Math.min(outer, room));
  const fromEdge = onLeft ? targetX - inset : screenWidth - inset - targetX;
  const least = POPOVER.radius + POPOVER.arrow / 2;
  const most = width === undefined ? Infinity : width - least;
  return {
    side,
    inset,
    top: cardRect.y + cardRect.height + POPOVER.below + POPOVER.arrow / 2,
    arrow: Math.max(least, Math.min(fromEdge, most)),
  };
}

/**
 * The centre x of my card's reactions button (components.md §3.2, Dir-C-Game): the last action of the status
 * row, so at the card's inner edge, the one facing the middle of the screen, in Hebrew and in English.
 */
export function reactionsButtonX(cardRect: Rect, screenWidth: number): number {
  const onLeft = cardRect.x + cardRect.width / 2 < screenWidth / 2;
  const half = size.iconButton / 2;
  return onLeft ? cardRect.x + cardRect.width - half : cardRect.x + half;
}

/** The centre x of a card's avatar: at its outer edge (geometry.avatarCenterOf). The card menu points here. */
export function avatarX(cardRect: Rect, screenWidth: number): number {
  const onLeft = cardRect.x + cardRect.width / 2 < screenWidth / 2;
  const half = size.avatar.card.frame / 2;
  return onLeft ? cardRect.x + half : cardRect.x + cardRect.width - half;
}

/**
 * Where a 2-player card is before it was measured: the design's spot (Dir-C-Game: top 48, 159 × 160, at a
 * 16 dp gutter). Mine is on the right in Hebrew, the opponent's on the left (and the other way in English).
 * Only for a first frame; the screen passes the measured rect.
 */
export function defaultCardRect(screenWidth: number, onRight: boolean, top: number = card.top): Rect {
  const width = size.playerCard.width;
  const x = onRight ? screenWidth - tokens.layout.gutterGame - width : tokens.layout.gutterGame;
  return { x, y: top, width, height: size.playerCard.height };
}
