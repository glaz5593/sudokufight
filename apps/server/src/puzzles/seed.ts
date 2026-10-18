import { GAME_TYPES, type GameType, isGameType } from '@sudoku-fight/engine';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { puzzles } from '../db/schema';
import type { BankPuzzle } from './bank';

/**
 * The ranked pool in the database (spec §20, §21; `npm run db:seed-puzzles`): the bank's puzzles with
 * pool 'ranked', and only those, go into `puzzles`. The 'offline' pool ships in the app and never serves a
 * ranked game. An upsert by id (a stable hash of the givens), so running it again only brings rows up to date
 * with the file. It never deletes: a puzzle that left the bank may still be the puzzle of stored games and
 * play histories. Such a puzzle is retired instead (retired_at) [D43]: kept, never picked again. A puzzle
 * that comes back to the file is in the pool again. A game type the file has no ranked puzzle of is left
 * alone, so a partial file can't empty a pool.
 */

/** Rows per INSERT: well under Postgres's 65,535 parameters. */
const CHUNK = 500;

export interface SeedPuzzlesResult {
  /** Ranked puzzles written (new or brought up to date). */
  ranked: number;
  byType: Record<GameType, number>;
  /** Puzzles of other pools in the bank, left out. */
  skipped: number;
  /** Ranked puzzles of the pool that are no longer in the file, retired by this run, per game type. */
  retired: Record<GameType, number>;
}

const byTypeZero = (): Record<GameType, number> =>
  Object.fromEntries(GAME_TYPES.map((t) => [t, 0])) as Record<GameType, number>;

export async function seedRankedPuzzles(
  db: Db,
  bank: readonly BankPuzzle[],
  { now = new Date() }: { now?: Date } = {},
): Promise<SeedPuzzlesResult> {
  const ranked = bank.filter((p) => p.pool === 'ranked');
  const byType = byTypeZero();
  for (const p of ranked) byType[p.gameType]++;
  const retired = byTypeZero();
  await db.transaction(async (tx) => {
    for (let i = 0; i < ranked.length; i += CHUNK) {
      await tx
        .insert(puzzles)
        .values(
          ranked.slice(i, i + CHUNK).map((p) => ({
            id: p.id,
            givens: p.givens,
            solution: p.solution,
            gameType: p.gameType,
            techniques: p.techniques,
            givensCount: p.givensCount,
            source: p.source,
            pool: p.pool,
            retiredAt: null,
          })),
        )
        .onConflictDoUpdate({
          target: puzzles.id,
          set: {
            givens: sql`excluded.givens`,
            solution: sql`excluded.solution`,
            gameType: sql`excluded.game_type`,
            techniques: sql`excluded.techniques`,
            givensCount: sql`excluded.givens_count`,
            source: sql`excluded.source`,
            pool: sql`excluded.pool`,
            retiredAt: sql`null`,
          },
        });
    }
    // Retire, per game type the file covers, the pool's puzzles that are no longer in it.
    for (const type of GAME_TYPES) {
      if (byType[type] === 0) continue;
      const keep = ranked.filter((p) => p.gameType === type).map((p) => p.id);
      const rows = await tx
        .update(puzzles)
        .set({ retiredAt: now })
        .where(
          and(
            eq(puzzles.pool, 'ranked'),
            eq(puzzles.gameType, type),
            isNull(puzzles.retiredAt),
            notInArray(puzzles.id, keep),
          ),
        )
        .returning({ id: puzzles.id });
      retired[type] = rows.length;
    }
  });
  return { ranked: ranked.length, byType, skipped: bank.length - ranked.length, retired };
}

/**
 * How many ranked puzzles the database has in the pool per game type (retired ones not counted): a type with
 * none can't have ranked games.
 */
export async function rankedPoolSizes(db: Db): Promise<Record<GameType, number>> {
  const rows = await db
    .select({ gameType: puzzles.gameType, n: sql<number>`count(*)::int`.mapWith(Number) })
    .from(puzzles)
    .where(and(eq(puzzles.pool, 'ranked'), isNull(puzzles.retiredAt)))
    .groupBy(puzzles.gameType);
  const sizes = byTypeZero();
  for (const r of rows) if (isGameType(r.gameType)) sizes[r.gameType] = r.n;
  return sizes;
}

/**
 * Whether every game type has ranked puzzles (rankedPoolSizes): `npm run db:seed-puzzles -- --if-empty` (and
 * `npm run dev:lan`, before it starts the server) loads the pool when this is false, or when the pool differs
 * from the bank file (rankedPoolMatches).
 */
export const isRankedPoolReady = (sizes: Record<GameType, number>): boolean =>
  GAME_TYPES.every((type) => sizes[type] > 0);

/**
 * Whether the ranked pool in the database is the bank file's: for every game type the file has ranked puzzles
 * of, the puzzles in the pool (not retired) are exactly the file's. `npm run db:seed-puzzles -- --if-empty`
 * (and `npm run dev:lan`) skips loading only when the pool is ready and this holds, so a changed bank reaches a
 * development database on the next start.
 */
export async function rankedPoolMatches(db: Db, bank: readonly BankPuzzle[]): Promise<boolean> {
  const rows = await db
    .select({ id: puzzles.id, gameType: puzzles.gameType })
    .from(puzzles)
    .where(and(eq(puzzles.pool, 'ranked'), isNull(puzzles.retiredAt)));
  const ranked = bank.filter((p) => p.pool === 'ranked');
  return GAME_TYPES.every((type) => {
    const file = new Set(ranked.filter((p) => p.gameType === type).map((p) => p.id));
    if (file.size === 0) return true; // the seed leaves such a type alone
    const pool = rows.filter((r) => r.gameType === type);
    return pool.length === file.size && pool.every((r) => file.has(r.id));
  });
}
