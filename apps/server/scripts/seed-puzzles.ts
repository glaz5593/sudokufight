/**
 * Loads the ranked puzzle pool into the database (spec §20, work plan stage 9):
 *
 *   npm run db:seed-puzzles                         # at the root, or: npm run db:seed-puzzles -w @sudoku-fight/server
 *   npm run db:seed-puzzles -- --file=other.json    # another bank file (default packages/engine/data/puzzles.json)
 *   npm run db:seed-puzzles -- --if-empty           # only if a game type has no ranked puzzle (npm run dev:lan)
 *
 * Only the puzzles with pool 'ranked' go into the `puzzles` table: the 'offline' pool ships in the app, and a
 * ranked game is never played on a puzzle whose solution is on the phone (spec §21). An upsert by id: run it
 * again after the bank changes. Nothing is deleted.
 *
 * Where: the server's settings (apps/server/.env, or the environment). Without DATABASE_URL, the development
 * PGlite folder: stop the dev server first (one process per folder). With DATABASE_URL, that Postgres, for
 * production too (e.g. `fly proxy 5432` to the database, then DATABASE_URL=postgres://…@localhost:5432/…).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ConfigError, loadConfig } from '../src/config';
import { createDb, DataDirLockedError } from '../src/db';
import { isRankedPoolReady, readPuzzleBank, rankedPoolSizes, seedRankedPuzzles } from '../src/puzzles';
import { puzzleBankPath } from '../src/game/puzzles';

function fail(message: string): never {
  console.error(`[db:seed-puzzles] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !/^--file=.+$/.test(a) && a !== '--if-empty');
  if (unknown.length > 0) fail(`unknown option ${unknown.join(' ')} (use --file=<bank.json>, --if-empty)`);
  const ifEmpty = args.includes('--if-empty');
  const fileArg = args.find((a) => a.startsWith('--file='));
  const file = fileArg === undefined ? puzzleBankPath() : path.resolve(fileArg.slice('--file='.length));
  if (!existsSync(file)) fail(`no such file: ${file}`);

  const envFile = path.resolve(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  process.env.NODE_ENV ??= 'development';
  const config = loadConfig(process.env, { warn: () => {} });
  if (config.database.kind === 'pglite' && config.database.dataDir === null)
    fail('PGLITE_DIR is "memory": the puzzles would be gone when this script ends');
  const where = config.database.kind === 'pglite' ? config.database.dataDir : 'Postgres (DATABASE_URL)';

  const database = await createDb(config);
  try {
    if (ifEmpty) {
      const before = await rankedPoolSizes(database.db);
      if (isRankedPoolReady(before)) {
        const counts = Object.entries(before).map(([type, n]) => `${type} ${n}`);
        console.log(
          `[db:seed-puzzles] the ranked pool in ${where} is ready (${counts.join(', ')}): nothing to do`,
        );
        return;
      }
    }
    const bank = readPuzzleBank(file);
    const started = Date.now();
    const result = await seedRankedPuzzles(database.db, bank);
    const sizes = await rankedPoolSizes(database.db);
    console.log(
      `[db:seed-puzzles] ${result.ranked} ranked puzzles from ${file} written to ${where} in ` +
        `${Date.now() - started} ms (${result.skipped} of other pools left out).`,
    );
    for (const [type, n] of Object.entries(sizes)) console.log(`         ${type.padEnd(8)} ${n} in the pool`);
    if (result.ranked === 0) console.warn('[db:seed-puzzles] the bank has no ranked puzzles');
  } finally {
    await database.close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof DataDirLockedError) fail(err.message);
  console.error('[db:seed-puzzles] failed', err);
  process.exit(1);
});
