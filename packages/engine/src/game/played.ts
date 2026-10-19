import type { GameState } from './types';

/**
 * The game's clock: the time played, without the phone's own freezes [D65] (the app out of the foreground in a
 * stage, a solo practice or a practice against a bot). A disconnect's freeze counts, as it always did: ranked
 * and online games never freeze the phone's way, so their clock is plain `at − startedAt`.
 */

/** What the clock is read from: a state, or a view of it (GameView carries the same fields). */
export type PlayedClock = Pick<GameState, 'startedAt' | 'pausedAt' | 'pausedBy' | 'frozenMs'>;

/**
 * The time played at `at`: since the start, less every freeze of the phone's own that ended (`frozenMs`) and
 * the one going on (the clock stands still at `pausedAt`). 0 before the start.
 */
export function playedMs(s: PlayedClock, at: number): number {
  if (s.startedAt === null) return 0;
  const t = s.pausedBy === 'background' && s.pausedAt !== null ? s.pausedAt : at;
  return Math.max(0, t - s.startedAt - (s.frozenMs ?? 0));
}

/**
 * How long a saved log's game went on, to its last event (an interrupted game's duration): its clock, or the
 * time since it was created when it never started.
 */
export function loggedMs(s: GameState): number {
  return s.startedAt === null ? Math.max(0, s.lastEventAt - s.createdAt) : playedMs(s, s.lastEventAt);
}
