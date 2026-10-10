import { type GameType, ratingKey, type RatingOption } from '@sudoku-fight/engine';
import { RATED_PLAYER_COUNTS } from '@sudoku-fight/protocol';

/**
 * Which rating a ranked game moves (spec §11.1) [D7], by the server's RATING_OPTION:
 * - B (default): one per game type, whatever the number of players: 'fast', 'normal', 'hard';
 * - A: one per game type and player count: 'fast-2p' … 'hard-4p'.
 * The engine's ratingKey() makes the string; this one also refuses a player count no ranked game has.
 */
export function ratingKeyFor(gameType: GameType, players: number, option: RatingOption): string {
  if (!(RATED_PLAYER_COUNTS as readonly number[]).includes(players))
    throw new RangeError(`A ranked game has 2–4 players, not ${players}`);
  return ratingKey(gameType, players, option);
}
