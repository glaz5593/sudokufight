import {
  DEFAULT_RESET_SHARE,
  type GameType,
  type PlayRecord,
  type Rng,
  selectPuzzle,
} from '@sudoku-fight/engine';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Db } from '../db';
import { puzzleHistory, puzzles } from '../db/schema';
import type { GamePuzzle } from '../game/puzzles';

/**
 * The puzzle of a ranked game (spec §20, original §32), from the `puzzles` table's ranked pool only: never
 * the 'offline' pool, which ships in the app with its solutions (spec §21).
 *
 * No repeats, by the engine's selectPuzzle over the participants' puzzle_history in this game type:
 * - a puzzle none of them has played in their current cycle;
 * - if every puzzle was played by someone, the one whose latest play is the oldest;
 * - a player who has played more than 80% of the type's pool starts a new cycle (the engine walks the plays
 *   in time order, so no flag is stored: puzzle_history keeps every play).
 */

export interface RankedPuzzleSource {
  /** A puzzle for a ranked game of `gameType` between these accounts (users.id). */
  pickFor(gameType: GameType, userIds: readonly string[]): Promise<GamePuzzle>;
}

/** The ranked pool of a game type is empty: `npm run db:seed-puzzles` loads it. */
export class EmptyPoolError extends Error {
  constructor(readonly gameType: GameType) {
    super(`No ranked ${gameType} puzzles in the database: run npm run db:seed-puzzles`);
    this.name = 'EmptyPoolError';
  }
}

export interface DbPuzzleSourceOptions {
  /** The database, or how to get it once it is open. */
  db: Db | (() => Db);
  rng: Rng;
  /** The share of the pool after which a player's history starts over (default 0.8). */
  resetShare?: number;
}

/** The ids of a type's ranked pool, in a fixed order (so a seeded Rng picks the same one). */
export async function rankedPool(db: Db, gameType: GameType): Promise<string[]> {
  const rows = await db
    .select({ id: puzzles.id })
    .from(puzzles)
    .where(and(eq(puzzles.pool, 'ranked'), eq(puzzles.gameType, gameType)))
    .orderBy(asc(puzzles.id));
  return rows.map((r) => r.id);
}

/** Every play of these players on a type's ranked puzzles, per player in the order of `userIds`. */
export async function rankedHistories(
  db: Db,
  gameType: GameType,
  userIds: readonly string[],
): Promise<PlayRecord[][]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      userId: puzzleHistory.userId,
      puzzleId: puzzleHistory.puzzleId,
      playedAt: puzzleHistory.playedAt,
    })
    .from(puzzleHistory)
    .innerJoin(puzzles, eq(puzzles.id, puzzleHistory.puzzleId))
    .where(
      and(
        inArray(puzzleHistory.userId, [...userIds]),
        eq(puzzles.pool, 'ranked'),
        eq(puzzles.gameType, gameType),
      ),
    );
  return userIds.map((id) =>
    rows
      .filter((r) => r.userId === id)
      .map((r) => ({ puzzleId: r.puzzleId, playedAt: r.playedAt.getTime() })),
  );
}

export function dbPuzzleSource({
  db,
  rng,
  resetShare = DEFAULT_RESET_SHARE,
}: DbPuzzleSourceOptions): RankedPuzzleSource {
  const database = typeof db === 'function' ? db : () => db;
  return {
    async pickFor(gameType, userIds) {
      const d = database();
      const [pool, histories] = await Promise.all([
        rankedPool(d, gameType),
        rankedHistories(d, gameType, userIds),
      ]);
      if (pool.length === 0) throw new EmptyPoolError(gameType);
      const id = selectPuzzle(pool, histories, { rng, resetShare });
      const [row] = await d
        .select({ id: puzzles.id, givens: puzzles.givens, solution: puzzles.solution })
        .from(puzzles)
        .where(eq(puzzles.id, id));
      if (row === undefined) throw new Error(`Puzzle ${id} vanished while it was being picked`);
      return row;
    },
  };
}
