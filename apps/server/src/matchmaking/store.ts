import { type GameType, INITIAL_RATING } from '@sudoku-fight/engine';
import { isCountryCode, normalizeAvatarId } from '@sudoku-fight/protocol';
import { and, eq, isNull } from 'drizzle-orm';

import type { Db } from '../db';
import { opponentHistory, ratings, users } from '../db/schema';
import type { OpponentRecord } from './matcher';
import type { MatchmakingStore, StoredPlayer } from './service';

/**
 * What matchmaking reads from the database (spec §19): the player's profile and rating in the queue's rating
 * key, and their opponent_history (one row per player, opponent and game type, played_at the latest game;
 * written by the rated game room when a game starts, persistence/records.ts).
 */
export function dbMatchmakingStore(db: Db | (() => Db)): MatchmakingStore {
  const database = typeof db === 'function' ? db : () => db;
  return {
    async player(userId, ratingKey): Promise<StoredPlayer | undefined> {
      const [row] = await database()
        .select({
          name: users.displayName,
          avatarId: users.avatarId,
          country: users.country,
          rating: ratings.rating,
          games: ratings.games,
          provisional: ratings.provisional,
        })
        .from(users)
        .leftJoin(ratings, and(eq(ratings.userId, users.id), eq(ratings.ratingKey, ratingKey)))
        .where(and(eq(users.id, userId), isNull(users.deletedAt)));
      if (row === undefined) return undefined;
      return {
        name: row.name,
        avatarId: normalizeAvatarId(row.avatarId),
        country: isCountryCode(row.country) ? row.country : null,
        // A key without a row yet (e.g. RATING_OPTION changed from B to A) starts where everyone does [D23].
        rating: row.rating ?? INITIAL_RATING,
        games: row.games ?? 0,
        provisional: row.provisional ?? true,
      };
    },

    async opponents(userId, gameType: GameType): Promise<OpponentRecord[]> {
      const rows = await database()
        .select({ opponentId: opponentHistory.opponentId, playedAt: opponentHistory.playedAt })
        .from(opponentHistory)
        .where(and(eq(opponentHistory.userId, userId), eq(opponentHistory.gameType, gameType)));
      return rows.map((r) => ({ opponentId: r.opponentId, playedAt: r.playedAt.getTime() }));
    },
  };
}
