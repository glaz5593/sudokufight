import {
  type GameType,
  isGameType,
  type PaceGame,
  type PaceHistory,
  STEALTH_BOT_CONFIG,
  type StealthBotConfig,
} from '@sudoku-fight/engine';
import { sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';

/**
 * A person's pace history as the stealth bot is built from it (stealth-bot.md §5.1, §5.2) [D96, D97a]: the
 * engine's paceFromHistory() input, from what the end of each ranked game stored (game_players.pace_ms,
 * pace_moves, pace_digits and mistakes; persistence/records.ts).
 *
 * - `games`: his newest ranked games that have a pace (a finished, rated-mode game: never a friends game, never
 *   practice, which the server can't check), newest first, `config.games` (10) of them: paceFromHistory picks
 *   the same-type ones among them itself.
 * - `stealthWins`: his newest finished games against a stealth bot (games.stealth), newest first,
 *   `config.guard.history` (40) of them: whether he won each (placed ahead of the persona), for the guard
 *   against farming.
 *
 * Matchmaking reads it once when it seats a stealth bot (two small queries through game_players_user_idx).
 */
export async function paceHistoryOf(
  db: Db,
  userId: string,
  gameType: GameType,
  config: StealthBotConfig = STEALTH_BOT_CONFIG,
): Promise<PaceHistory> {
  const [games, stealth] = await Promise.all([
    queryRows<{
      gameType: string;
      paceMs: number;
      paceMoves: number;
      digits: number | null;
      mistakes: number | null;
    }>(
      db,
      sql`select g.game_type as "gameType", gp.pace_ms as "paceMs", gp.pace_moves as "paceMoves",
            gp.pace_digits as digits, gp.mistakes
          from game_players gp join games g on g.id = gp.game_id
          where gp.user_id = ${userId} and g.mode = 'ranked' and g.ended_at is not null
            and gp.pace_ms is not null and gp.pace_moves > 0
          order by g.ended_at desc, g.id desc
          limit ${config.games}`,
    ),
    queryRows<{ won: boolean }>(
      db,
      sql`select coalesce(gp.place < (select min(o.place) from game_players o
                                      where o.game_id = gp.game_id and o.seat <> gp.seat), false) as won
          from game_players gp join games g on g.id = gp.game_id
          where gp.user_id = ${userId} and g.stealth and g.mode = 'ranked' and g.ended_at is not null
            and gp.place is not null
          order by g.ended_at desc, g.id desc
          limit ${config.guard.history}`,
    ),
  ]);
  return {
    gameType,
    games: games.flatMap((g): PaceGame[] =>
      isGameType(g.gameType)
        ? [
            {
              gameType: g.gameType,
              paceMs: Number(g.paceMs),
              paceMoves: Number(g.paceMoves),
              ...(g.digits === null || g.mistakes === null
                ? null
                : { digits: Number(g.digits), mistakes: Number(g.mistakes) }),
            },
          ]
        : [],
    ),
    stealthWins: stealth.map((r) => r.won === true),
  };
}
