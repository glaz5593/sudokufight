import { existsSync } from 'node:fs';
import path from 'node:path';

import { cellName, ENGINE_VERSION } from '@sudoku-fight/engine';

import { createAppServer } from './app';
import { loadConfig } from './config';
import { DataDirLockedError } from './db';

async function main(): Promise<void> {
  // apps/server/.env (gitignored), if there is one: local settings for development (see .env.example).
  const envFile = path.resolve(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const config = loadConfig();
  const server = createAppServer({ config });
  await server.listen(config.port);

  const db =
    config.database.kind === 'postgres' ? 'Postgres' : `PGlite (${config.database.dataDir ?? 'memory'})`;
  const admin = config.admin.enabled ? 'on' : `off: ${config.admin.reason}`;
  // A function from the shared engine, to show the server runs the same code as the app.
  console.log(`[server] engine ${ENGINE_VERSION}: cell 31 is ${cellName(31)}`);
  console.log(`[server] ${config.nodeEnv}, database ${db}, admin site ${admin}`);
  console.log(`[server] listening on http://localhost:${config.port} (WebSocket on the same port)`);
}

main().catch((err: unknown) => {
  // Another process has the PGlite folder: the message says what to do, a stack trace would only hide it.
  if (err instanceof DataDirLockedError) console.error(`[server] failed to start: ${err.message}`);
  else console.error('[server] failed to start', err);
  process.exit(1);
});
