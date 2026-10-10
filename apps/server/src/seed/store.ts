import { readFileSync } from 'node:fs';
import path from 'node:path';

import { like, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { type Db, queryRows } from '../db';
import {
  appEvents,
  gameEvents,
  gamePlayers,
  games,
  installs,
  opponentHistory,
  puzzleHistory,
  puzzles,
  ratings,
  users,
} from '../db/schema';
import { SAMPLE_UID_PREFIX, type SampleData, type SamplePuzzle } from './sampleData';

/** Rows per INSERT: well under Postgres's 65,535 parameters for the widest table. */
const CHUNK = 500;

/** Writes the sample data in one transaction, parents before children. */
export async function writeSampleData(db: Db, data: SampleData): Promise<void> {
  await db.transaction(async (tx) => {
    const insert = async <T extends PgTable>(table: T, rows: T['$inferInsert'][]) => {
      for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(table).values(rows.slice(i, i + CHUNK));
    };
    await insert(users, data.users);
    // The ranked pool may be loaded already (npm run db:seed-puzzles): those puzzles stay as they are.
    for (let i = 0; i < data.puzzles.length; i += CHUNK)
      await tx
        .insert(puzzles)
        .values(data.puzzles.slice(i, i + CHUNK))
        .onConflictDoNothing();
    await insert(installs, data.installs);
    await insert(appEvents, data.appEvents);
    await insert(games, data.games);
    await insert(gamePlayers, data.gamePlayers);
    await insert(gameEvents, data.gameEvents);
    await insert(ratings, data.ratings);
    await insert(puzzleHistory, data.puzzleHistory);
    await insert(opponentHistory, data.opponentHistory);
  });
}

/** Whether sample users are already there (their Firebase uids start with SAMPLE_UID_PREFIX). */
export async function hasSampleData(db: Db): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.firebaseUid, `${SAMPLE_UID_PREFIX}%`))
    .limit(1);
  return rows.length > 0;
}

/** Row counts of the tables the admin site shows. */
export async function countRows(db: Db): Promise<Record<string, number>> {
  const [row] = await queryRows<Record<string, number>>(
    db,
    sql`select
      (select count(*)::int from installs) as installs,
      (select count(*)::int from app_events) as "appEvents",
      (select count(*)::int from users) as users,
      (select count(*)::int from games) as games,
      (select count(*)::int from game_events) as "gameEvents",
      (select count(*)::int from ratings) as ratings`,
  );
  return row ?? {};
}

const bankSchema = z.object({
  puzzles: z.array(
    z.object({
      id: z.string().min(1),
      givens: z.string().length(81),
      solution: z.string().length(81),
      gameType: z.string(),
      techniques: z.array(z.string()),
      givensCount: z.number().int(),
      source: z.string(),
      pool: z.enum(['offline', 'ranked']),
    }),
  ),
});

/** packages/engine/data/puzzles.json, the puzzle bank (spec §20). */
export function defaultBankPath(): string {
  return path.join(
    path.dirname(require.resolve('@sudoku-fight/engine/package.json')),
    'data',
    'puzzles.json',
  );
}

export function loadPuzzleBank(file = defaultBankPath()): SamplePuzzle[] {
  return bankSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).puzzles;
}
