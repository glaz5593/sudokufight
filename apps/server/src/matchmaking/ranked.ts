import type { GameType } from '@sudoku-fight/engine';
import type { QueueKey } from '@sudoku-fight/protocol';

/**
 * The contract between matchmaking and the ranked game room (stage 9, spec §10, D37).
 *
 * Matchmaking creates the room on the server (matchMaker.createRoom('game', { match: <id> })), never a
 * client: the room's onCreate claims the match by its id, which is single use and known only to the server.
 * The room then holds the match's players (and nobody else), and reports to matchmaking:
 * - join / leave: a player connected or left before the countdown (D37: connected = ready);
 * - closed: the room was disposed.
 * Matchmaking answers through the hooks:
 * - onCountdown: everyone is in. From now the seats are fixed: leaving is abandonment [D32].
 * - onGo: the countdown is over; start the game (the board appears to everyone at once).
 * - onCancel: the match fell through before the countdown (a no-show); close the room.
 */

/** The create option that names the match: `{ match: <match id> }`. */
export const RANKED_MATCH_OPTION = 'match';

/** The match id of a create's options, or null when they are not a ranked room's. */
export function rankedMatchIdOf(options: unknown): string | null {
  if (typeof options !== 'object' || options === null) return null;
  const id = (options as Record<string, unknown>)[RANKED_MATCH_OPTION];
  return typeof id === 'string' && id !== '' ? id : null;
}

export interface RankedMatchPlayer {
  userId: string;
  name: string;
  /** In the match's rating key, when matched. */
  rating: number;
  /** Games already played in that key (the first 10 are provisional, spec §11.2). */
  games: number;
}

export interface RankedMatchSetup {
  matchId: string;
  queueKey: QueueKey;
  gameType: GameType;
  playerCount: number;
  /** The rating key this game updates (RATING_OPTION B: `fast`; A: `fast-2p`). */
  ratingKey: string;
  /** In seat order. */
  players: RankedMatchPlayer[];
  /** Every player must connect within this; the room holds the seats a little longer. */
  readyTimeoutMs: number;
  countdownMs: number;
}

export interface RankedRoomHooks {
  onCountdown(startsAt: number): void;
  onGo(): void;
  onCancel(): void;
}

/** What the room holds for its match. */
export interface RankedMatchLink {
  readonly setup: RankedMatchSetup;
  /** The player is one of the match's. */
  has(userId: string): boolean;
  /** The player connected to the room (D37: ready). */
  join(userId: string): void;
  /** The player left before the countdown. */
  leave(userId: string): void;
  /** The room is gone. */
  closed(): void;
}

export interface RankedRooms {
  /** The match a room is created for, once; undefined for an unknown, finished or claimed id. */
  claim(matchId: string, hooks: RankedRoomHooks): RankedMatchLink | undefined;
}
