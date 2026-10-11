import { GAME_TYPES, type GameType, isGameType } from '@sudoku-fight/engine';
import { eq, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { puzzles } from '../db/schema';
import type { BankPuzzle } from './bank';

/**
 * The ranked pool in the database (spec §20, §21; `npm run db:seed-puzzles`): the bank's puzzles with
 * pool 'ranked', and only those, go into `puzzles`. The 'offline' pool ships in the app and never serves a
 * ranked game. An upsert by id (a stable hash of the givens), so running it again only brings rows up to date
 * with the file. It never deletes: a puzzle that left the bank may still be the puzzle of stored games.
 */

/** Rows per INSERT: well under Postgres's 65,535 parameters. */
const CHUNK = 500;

export interface SeedPuzzlesResult {
  /** Ranked puzzles written (new or brought up to date). */
  ranked: number;
  byType: Record<GameType, number>;
  /** Puzzles of other pools in the bank, left out. */
  skipped: number;
}

const byTypeZero = (): Record<GameType, number> =>
  Object.fromEntries(GAME_TYPES.map((t) => [t, 0])) as Record<GameType, number>;

export async function seedRankedPuzzles(db: Db, bank: readonly BankPuzzle[]): Promise<SeedPuzzlesResult> {
  const ranked = bank.filter((p) => p.pool === 'ranked');
  const byType = byTypeZero();
  for (const p of ranked) byType[p.gameType]++;
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
          },
        });
    }
  });
  return { ranked: ranked.length, byType, skipped: bank.length - ranked.length };
}

/** How many ranked puzzles the database has per game type: a type with none can't have ranked games. */
export async function rankedPoolSizes(db: Db): Promise<Record<GameType, number>> {
  const rows = await db
    .select({ gameType: puzzles.gameType, n: sql<number>`count(*)::int`.mapWith(Number) })
    .from(puzzles)
    .where(eq(puzzles.pool, 'ranked'))
    .groupBy(puzzles.gameType);
  const sizes = byTypeZero();
  for (const r of rows) if (isGameType(r.gameType)) sizes[r.gameType] = r.n;
  return sizes;
}

/**
 * Whether every game type has ranked puzzles (rankedPoolSizes): `npm run db:seed-puzzles -- --if-empty` (and
 * `npm run dev:lan`, before it starts the server) loads the pool only when this is false.
 */
export const isRankedPoolReady = (sizes: Record<GameType, number>): boolean =>
  GAME_TYPES.every((type) => sizes[type] > 0);
