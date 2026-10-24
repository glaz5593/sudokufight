import { existsSync } from 'node:fs';
import path from 'node:path';

import { cellName, ENGINE_VERSION } from '@sudoku-fight/engine';

import { createAppServer } from './app';
import { describeAdmin, describeQa, loadConfig } from './config';
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
  // Which sign-in methods are on; never the allowed addresses or the key.
  const admin = describeAdmin(config.admin);
  const sentry = config.sentry
    ? `Sentry on (${config.sentry.environment}, ${config.sentry.release}, traces ${config.sentry.tracesSampleRate})`
    : 'Sentry off (no SENTRY_DSN)';
  // A function from the shared engine, to show the server runs the same code as the app.
  console.log(`[server] engine ${ENGINE_VERSION}: cell 31 is ${cellName(31)}`);
  console.log(`[server] ${config.nodeEnv}, database ${db}, admin site ${admin}, ${sentry}`);
  // The stealth bot [D90]: built off everywhere. Never its secret.
  const stealth = config.stealth;
  console.log(
    stealth?.enabled
      ? `[server] stealth bot available: the admin switch decides (${stealth.queues.join(', ')}; ` +
          `after ${stealth.afterMs.min}-${stealth.afterMs.max} ms)`
      : '[server] stealth bot off (STEALTH_BOT_ENABLED=false)',
  );
  // The QA module: whether Claude's key is set, never the key.
  console.log(`[server] ${describeQa(config.qa)}`);
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
