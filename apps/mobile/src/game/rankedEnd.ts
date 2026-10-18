import { type GameState, type PlayerId, type RatingChange, ratingKey } from '@sudoku-fight/engine';
import type { Me } from '@sudoku-fight/protocol';

/**
 * The end of a rated ranked game, as the account's numbers will show it (Moshe's device test of 1.0.0: the
 * rating did not follow a ranked game until the app was restarted). The server stores the result, the ratings
 * and the XP in the background after the end; the phone shows the server's own rating change at once and reads
 * GET /v1/me until the game counts there (progress/rankedRefresh.ts). Pure: the game's state in, a plan out.
 *
 * It follows the server's rule (apps/server ratings/store.ts applyRatingChanges): a player's games count in the
 * game's rating key goes up by one exactly when the game's result has a RatingChange for them. A change of the
 * rules of who gets one (surrender, abandonment) changes the result, and this follows it.
 */
export interface RankedEnd {
  gameId: string;
  /** My id in the game: the account's id (Me.id) in a ranked game. */
  playerId: PlayerId;
  /** The game's rating key ('fast', or 'fast-2p' under option A [D7]), as GET /v1/me lists it. */
  key: string;
  /** My games in `key` when the game began (the config's ratedGames, the server's count then). */
  gamesBefore: number;
  /** The game's rules.rating.provisionalGames: an entry is provisional below this many games. */
  provisionalGames: number;
  /** My rating change in the game's result (the server's, mirrored); null when there is none for me. */
  change: RatingChange | null;
  /** The server will count the game in `key` for me (its games count goes up by one). */
  expectsStored: boolean;
  /** I left the game while it ran: the server ends it for me when the grace runs out. */
  left: boolean;
  /** How long to wait before the first read, on top of the first delay (ms). */
  waitMs: number;
}

type RankedBase = Pick<RankedEnd, 'gameId' | 'playerId' | 'key' | 'gamesBefore' | 'provisionalGames'>;

/** A rated ranked game of 2–4 players that `me` plays in (a dev room's players have no rating: nothing is stored). */
function ratedGameOf(state: GameState, me: PlayerId): RankedBase | null {
  const { config } = state;
  if (config.mode !== 'ranked' || config.players.length < 2) return null;
  if (config.players.some((p) => p.rating === undefined)) return null;
  const mine = config.players.find((p) => p.id === me);
  if (!mine) return null;
  return {
    gameId: config.id,
    playerId: me,
    key: ratingKey(config.gameType, config.players.length, config.rules.rating.option),
    gamesBefore: mine.ratedGames ?? 0,
    provisionalGames: config.rules.rating.provisionalGames,
  };
}

/** A rated ranked game that is over, seen from `me`'s seat; null for any other game. */
export function rankedEndOf(state: GameState, me: PlayerId): RankedEnd | null {
  if (state.status !== 'over' || !state.result) return null;
  const base = ratedGameOf(state, me);
  if (!base) return null;
  const change = state.result.ratingChanges.find((c) => c.playerId === me) ?? null;
  return { ...base, change, expectsStored: change !== null, left: false, waitMs: 0 };
}

/**
 * `me` left a rated 2-player ranked game that is not over (D32: leaving is abandonment once the grace runs out,
 * and the server stores the loss then). The first read waits the game's grace plus `marginMs`. Null for 3–4
 * players: their game goes on, and is stored only when it ends (Home and the foreground read it then).
 */
export function rankedLeftOf(state: GameState, me: PlayerId, marginMs: number): RankedEnd | null {
  if (state.status === 'over' || state.config.players.length !== 2) return null;
  const base = ratedGameOf(state, me);
  if (!base) return null;
  return {
    ...base,
    change: null,
    expectsStored: true,
    left: true,
    waitMs: state.config.rules.graceMs + marginMs,
  };
}

/** The server's Me counts the game: its entry of the game's key has more games than when the game began. */
export function storedIn(server: Me, end: RankedEnd): boolean {
  if (!end.expectsStored) return false;
  const entry = server.ratings.find((r) => r.key === end.key);
  return entry !== undefined && entry.games > end.gamesBefore;
}
