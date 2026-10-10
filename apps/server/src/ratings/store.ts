import type { RatingChange } from '@sudoku-fight/engine';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { ratings, users } from '../db/schema';

/**
 * Ratings in the database (spec §11, §19): read when a ranked game starts, written when it ends.
 *
 * The numbers come from the engine (ratingChangesFor → eloChanges: pairwise Elo [D31], K doubled while
 * provisional [D23], places by §6.7 so a surrender or an abandonment is a normal loss [D32, D8]). Here they
 * are only stored.
 */

/** A player's rating in the game's key before the game: the engine's PlayerInfo.rating and ratedGames. */
export interface StartRating {
  rating: number;
  /** Games already played in this key. */
  games: number;
}

/** A ranked game is between live accounts; these players are not (unknown, or deleted). */
export class NotRatedError extends Error {
  constructor(readonly userIds: string[]) {
    super(`No live account for ${userIds.join(', ')}: ranked games are between accounts`);
    this.name = 'NotRatedError';
  }
}

/**
 * Each player's rating in `key` at the start of a game. A key the account has no row in yet (RATING_OPTION
 * changed after it registered) starts at `initialRating` with no games [D23]; the row is made when the game
 * ends. Throws NotRatedError when a player is not a live account.
 */
export async function ratingsAtStart(
  db: Db,
  userIds: readonly string[],
  key: string,
  initialRating: number,
): Promise<Map<string, StartRating>> {
  const found = new Map<string, StartRating>();
  if (userIds.length === 0) return found;
  const rows = await db
    .select({ id: users.id, rating: ratings.rating, games: ratings.games })
    .from(users)
    .leftJoin(ratings, and(eq(ratings.userId, users.id), eq(ratings.ratingKey, key)))
    .where(and(inArray(users.id, [...userIds]), isNull(users.deletedAt)));
  for (const r of rows) found.set(r.id, { rating: r.rating ?? initialRating, games: r.games ?? 0 });
  const missing = userIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new NotRatedError(missing);
  return found;
}

export interface RatingWrite {
  userId: string;
  change: RatingChange;
}

export interface RatingWriteOptions {
  /** A key's first this many games are provisional [D23]: the flag is games < provisionalGames afterwards. */
  provisionalGames: number;
  at: Date;
}

/**
 * Stores the engine's rating changes of one game in `key`: rating moved by the change's delta, games + 1,
 * provisional while games < provisionalGames [D23], the peak, updated_at. A missing row is made (starting
 * from the change's `before`).
 *
 * The delta is added to the stored rating rather than `after` written over it, so two games of one player
 * that overlap (matchmaking should never allow it) both count. Call it once per game, inside the
 * transaction that marks the game recorded (persistence/records.ts): that is what keeps a retry from
 * counting a game twice.
 */
export async function applyRatingChanges(
  db: Db,
  key: string,
  writes: readonly RatingWrite[],
  { provisionalGames, at }: RatingWriteOptions,
): Promise<void> {
  for (const { userId, change } of writes) {
    await db
      .insert(ratings)
      .values({
        userId,
        ratingKey: key,
        rating: change.after,
        games: 1,
        provisional: 1 < provisionalGames,
        peak: Math.max(change.before, change.after),
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.ratingKey],
        set: {
          rating: sql`${ratings.rating} + ${change.delta}`,
          games: sql`${ratings.games} + 1`,
          provisional: sql`${ratings.games} + 1 < ${provisionalGames}`,
          peak: sql`greatest(${ratings.peak}, ${ratings.rating} + ${change.delta})`,
          updatedAt: at,
        },
      });
  }
}
