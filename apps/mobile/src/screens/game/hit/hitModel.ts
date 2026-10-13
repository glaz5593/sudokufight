import type { GameView, InterferenceKind, PlayerId } from '@sudoku-fight/engine';

import type { AvatarIdOrNone } from '../../../avatars';
// The pure models only: these never load Skia (a screen's tests can use them without its mock).
import { catsRumble } from '../../../components/interference/catsModel';
import { fireworksPlan, fireworksRumble } from '../../../components/interference/fireworksModel';
import { type HitTime, remainingOf } from '../../../components/interference/hitClock';
import { warpRumble } from '../../../components/interference/warpModel';
import { colorIndexFor, secondsOf } from '../../../components/player';
import type { FeedbackCue } from '../../../services/feedback';

/**
 * The interference on me as the hit layer shows it (spec §7.4: "באנר 'NinaVolt שלחה לך זיקוקים!' עם טבעת
 * שסופרת 5 שניות לאחור, והאפקט עצמו"). Everything comes from the engine's GameView: the kind, the sender and
 * the deadline (`hitBy`), and the length from the rules. Nothing here decides anything about the game.
 */
export interface HitInfo extends HitTime {
  kind: InterferenceKind;
  fromId?: PlayerId;
  /** The sender's name as the screen says it. */
  fromName: string;
  fromAvatar?: AvatarIdOrNone | null;
  /** The sender's seat colour as this phone shows it (1–3; 0 is me, P1). Default 1. */
  fromColorIndex?: number;
  /** What it cost the sender (the `interference` event's cost), for the banner's second line. */
  cost?: number | null;
  /**
   * Which hit this is, when the screen heard it start (the `interference` event's seq). Two hits of the same
   * kind from the same sender can follow each other with no frame between them (the app was in the
   * background through the end of one and the start of the next); this tells them apart.
   */
  id?: number | null;
}

export interface HitNames {
  nameOf: (id: PlayerId) => string;
  avatarOf?: (id: PlayerId) => AvatarIdOrNone | null | undefined;
}

/** The interference on me in a view, or null. Its deadline is the view's `expiresAt` (null while frozen). */
export function hitOf(
  view: Pick<GameView, 'players' | 'me' | 'rules'>,
  { nameOf, avatarOf }: HitNames,
): HitInfo | null {
  const me = view.players.find((p) => p.id === view.me);
  const hitBy = me?.hitBy;
  if (!me || !hitBy) return null;
  const from = view.players.find((p) => p.id === hitBy.fromId);
  const seats = view.players.map((p) => p.seat);
  return {
    kind: hitBy.kind,
    fromId: hitBy.fromId,
    fromName: nameOf(hitBy.fromId),
    fromAvatar: avatarOf?.(hitBy.fromId) ?? null,
    fromColorIndex: from ? colorIndexFor(from.seat, me.seat, seats) : 1,
    endsAt: hitBy.expiresAt,
    remainingMs: hitBy.remainingMs,
    totalMs: view.rules.interferenceMs,
  };
}

/** The hit is on at `now`: not over by its deadline. */
export const isHitOn = (hit: HitInfo | null, now: number): hit is HitInfo =>
  hit !== null && remainingOf(hit, now) > 0;

/** The seconds in the banner's ring: rounded up, like every timer (5 … 1). */
export const hitSeconds = (hit: HitInfo, now: number): number => secondsOf(remainingOf(hit, now));

/**
 * One hit, for telling a new one from the same one re-rendered: its id when known, its kind and its sender
 * (not its deadline, which moves when the game freezes).
 */
export const hitKeyOf = (hit: HitInfo): string =>
  `${hit.id ?? ''}|${hit.kind}|${hit.fromId ?? hit.fromName}|${hit.totalMs}`;

/**
 * A name as part of a sentence: a first-strong isolate, so a Latin name in Hebrew text (or a Hebrew one in
 * English) keeps its order and doesn't pull the "!" to its side (components.md §0.6).
 */
export const isolateName = (name: string): string => `⁨${name}⁩`;

/**
 * The rumble while a hit lasts (motion.md §7): when it knocks (ms from the hit's start) and with which cue.
 * Fireworks: a medium knock per burst, 700 ms apart at least. Cats: a light one as each cat comes in. Warp:
 * a light one every 1100 ms. The times follow the effects' own plans.
 */
export function rumbleOf(kind: InterferenceKind, totalMs: number): { times: number[]; cue: FeedbackCue } {
  switch (kind) {
    case 'fireworks':
      // The burst times don't depend on the region's size, only on the plan's seed.
      return { times: fireworksRumble(fireworksPlan(totalMs, 1, 1), totalMs), cue: 'hitBurst' };
    case 'cats':
      return { times: catsRumble(totalMs), cue: 'hitPulse' };
    case 'warp':
      return { times: warpRumble(totalMs), cue: 'hitPulse' };
  }
}
