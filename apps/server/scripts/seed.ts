/**
 * Sample data for the admin site in development (stage 7א):
 *
 *   npm run seed                      # at the root, or: npm run seed -w @sudoku-fight/server
 *   npm run seed -- --reset           # empty every table first, then fill
 *   npm run seed -- --seed=42         # another story (the default seed always tells the same one)
 *
 * Fills the development database (PGlite in apps/server/.data/pglite, or PGLITE_DIR) with ~300 installs over
 * the last 45 days, ~80 users and ~150 ranked games played by the engine, and loads the ranked puzzle pool
 * (as `npm run db:seed-puzzles` does). Stop the dev server first: one PGlite folder can be open in one
 * process only.
 *
 * It refuses production, and a Postgres DATABASE_URL unless --allow-postgres is given.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ConfigError, DEV_ADMIN_PASSWORD, loadConfig } from '../src/config';
import { createDb, DataDirLockedError, truncateAll } from '../src/db';
import { readPuzzleBank, seedRankedPuzzles } from '../src/puzzles';
import { generateSampleData, SAMPLE_DEFAULTS } from '../src/seed/sampleData';
import { countRows, hasSampleData, loadPuzzleBank, writeSampleData } from '../src/seed/store';

function fail(message: string): never {
  console.error(`[seed] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = /^--(reset|allow-postgres|seed=\d+)$/;
  const unknown = args.filter((a) => !known.test(a));
  if (unknown.length > 0)
    fail(`unknown option ${unknown.join(' ')} (use --reset, --seed=N, --allow-postgres)`);
  const reset = args.includes('--reset');
  const seedArg = args.find((a) => a.startsWith('--seed='));
  const seed = seedArg === undefined ? SAMPLE_DEFAULTS.seed : Number(seedArg.slice('--seed='.length));

  const envFile = path.resolve(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  process.env.NODE_ENV ??= 'development';
  const config = loadConfig(process.env, { warn: () => {} });

  if (config.nodeEnv === 'production') fail('refusing to write sample data with NODE_ENV=production');
  if (config.database.kind === 'postgres' && !args.includes('--allow-postgres')) {
    fail(
      'DATABASE_URL points at Postgres; sample data belongs in the local PGlite (pass --allow-postgres to insist)',
    );
  }
  if (config.database.kind === 'pglite' && config.database.dataDir === null) {
    fail('PGLITE_DIR is "memory": the data would be gone when this script ends');
  }
  const where = config.database.kind === 'pglite' ? config.database.dataDir : 'Postgres (DATABASE_URL)';

  const database = await createDb(config);
  try {
    if (reset) {
      await truncateAll(database.db);
      console.log(`[seed] emptied every table in ${where}`);
    } else if (await hasSampleData(database.db)) {
      console.log(`[seed] ${where} already has sample data. Run with --reset to make it again.`);
      return;
    }
    const started = Date.now();
    const data = generateSampleData({ now: Date.now(), puzzles: loadPuzzleBank(), seed });
    await writeSampleData(database.db, data);
    // The ranked pool too (what `npm run db:seed-puzzles` does), so ranked games can start on this database.
    const pool = await seedRankedPuzzles(database.db, readPuzzleBank());
    console.log(`[seed] ranked puzzle pool: ${pool.ranked} puzzles`);
    const counts = await countRows(database.db);
    console.log(`[seed] wrote sample data (seed ${seed}) to ${where} in ${Date.now() - started} ms:`);
    for (const [table, n] of Object.entries(counts)) console.log(`         ${table.padEnd(12)} ${n}`);
    const password =
      config.admin.enabled && config.admin.devPassword ? ` (password "${DEV_ADMIN_PASSWORD}")` : '';
    console.log(`[seed] now: npm run server, and open http://localhost:${config.port}/admin${password}`);
  } finally {
    await database.close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof DataDirLockedError) fail(err.message);
  console.error('[seed] failed', err);
  process.exit(1);
});
