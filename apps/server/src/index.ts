import { existsSync } from 'node:fs';
import path from 'node:path';

import { cellName, ENGINE_VERSION } from '@sudoku-fight/engine';

import { createAppServer } from './app';
import { loadConfig } from './config';
import { DataDirLockedError } from './db';
import { flushReports, installProcessHandlers, reportError, setMonitor, startSentry } from './monitoring';

async function main(): Promise<void> {
  // apps/server/.env (gitignored), if there is one: local settings for development (see .env.example).
  const envFile = path.resolve(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const config = loadConfig();
  // Stage 14: error reports (Sentry, only with SENTRY_DSN), and the process' last-resort handlers.
  setMonitor(startSentry(config.sentry));
  installProcessHandlers();
  const server = createAppServer({ config });
  await server.listen(config.port);

  const db =
    config.database.kind === 'postgres' ? 'Postgres' : `PGlite (${config.database.dataDir ?? 'memory'})`;
  const admin = config.admin.enabled ? 'on' : `off: ${config.admin.reason}`;
  const sentry = config.sentry
    ? `Sentry on (${config.sentry.environment}, ${config.sentry.release}, traces ${config.sentry.tracesSampleRate})`
    : 'Sentry off (no SENTRY_DSN)';
  // A function from the shared engine, to show the server runs the same code as the app.
  console.log(`[server] engine ${ENGINE_VERSION}: cell 31 is ${cellName(31)}`);
  console.log(`[server] ${config.nodeEnv}, database ${db}, admin site ${admin}, ${sentry}`);
  console.log(`[server] listening on http://localhost:${config.port} (WebSocket on the same port)`);
}

main().catch(async (err: unknown) => {
  // Another process has the PGlite folder: the message says what to do, a stack trace would only hide it.
  if (err instanceof DataDirLockedError) console.error(`[server] failed to start: ${err.message}`);
  else {
    console.error('[server] failed to start', err);
    // Reported when Sentry was up by then (a bad setting stops the server before it is).
    reportError(err, { area: 'startup' });
    await flushReports(2000);
  }
  process.exit(1);
});
