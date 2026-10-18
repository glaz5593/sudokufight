#!/usr/bin/env node
/**
 * The dev server for phones on the same Wi-Fi (device checks: docs/STAGE7-DEVICE-CHECKS.md,
 * docs/STAGE9-10-DEVICE-CHECKS.md):
 *
 *   npm run dev:lan                        # the address, the ranked pool, the server, and what to do next
 *   npm run dev:lan -- --write-env         # also point apps/mobile/.env.local at this PC
 *   npm run dev:lan -- --seed              # also sample data for the admin site (npm run seed)
 *   npm run dev:lan -- --ip 192.168.1.20   # another address than the one it picks
 *   npm run dev:lan -- --no-server         # the details only (the server runs in another window)
 *
 * 1. Picks the PC's LAN IPv4: the Wi-Fi or Ethernet adapter's, never WSL's, a VM's or a VPN's (lib/lan.mjs).
 * 2. With the local PGlite: loads the ranked pool if a game type has none or it differs from the bank file
 *    (db:seed-puzzles --if-empty), after the sample data with --seed. Both before the server starts: a PGlite
 *    folder opens in one process only.
 * 3. Starts `npm run server` (it listens on every interface, the LAN's too) with PORT, waits for /health, and
 *    checks the server answers on the LAN address as well.
 * 4. Prints, in Hebrew: the URLs, the .env.local lines, the admin site and its password, the Windows Firewall
 *    commands (printed for Moshe to run as administrator; never run here), and the fake opponents.
 *
 * Ctrl+C stops the server, then this script. No dependencies beyond Node.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import {
  bannerLines,
  DEFAULT_PORT,
  lanCandidates,
  parseDevLanArgs,
  serverEnv,
  updateEnvText,
  USAGE,
} from './lib/lan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENV = join(ROOT, 'apps', 'server', '.env');
const MOBILE_ENV = join(ROOT, 'apps', 'mobile', '.env.local');
const MOBILE_ENV_EXAMPLE = join(ROOT, 'apps', 'mobile', '.env.example');
const ADMIN_INDEX = join(ROOT, 'apps', 'admin', 'dist', 'index.html');
/** tsx watch, then PGlite's migrations: seconds, more on a first run. */
const START_TIMEOUT_MS = 120_000;

const say = (line) => console.log(`[dev:lan] ${line}`);

function fail(message, code = 1) {
  console.error(`[dev:lan] ${message}`);
  process.exit(code);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * `npm <args>` from the root, in this terminal. Under `npm run`, npm's own CLI through this Node (no shell);
 * run directly (`node scripts/dev-lan.mjs`), the npm on the PATH, through the shell (npm.cmd on Windows).
 */
function npm(args, env = process.env) {
  const cli = process.env.npm_execpath;
  const options = { cwd: ROOT, stdio: 'inherit', env };
  if (cli && /\.[cm]?js$/.test(cli) && existsSync(cli))
    return spawn(process.execPath, [cli, ...args], options);
  return spawn(['npm', ...args].join(' '), { ...options, shell: true });
}

const exitCodeOf = (child) =>
  new Promise((done) => {
    child.once('error', (error) => {
      console.error(`[dev:lan] ${error.message}`);
      done(1);
    });
    child.once('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });

/** The server's settings that matter here: the environment first, then apps/server/.env (as the server does). */
function serverSettings() {
  let file = {};
  try {
    if (existsSync(SERVER_ENV)) file = parseEnv(readFileSync(SERVER_ENV, 'utf8'));
  } catch (error) {
    say(`apps/server/.env could not be read (${error.message}): going on without it`);
  }
  const get = (key) => {
    const value = process.env[key] ?? file[key];
    return value === undefined || value.trim() === '' ? undefined : value.trim();
  };
  return {
    port: get('PORT'),
    databaseUrl: get('DATABASE_URL'),
    pgliteDir: get('PGLITE_DIR'),
    adminPassword: get('ADMIN_PASSWORD'),
  };
}

/** Whether something already listens on the port (a dev server in another window?). */
function isListening(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

/** GET <base>/health answers {"ok":true,…}. */
async function healthy(base, timeoutMs = 2000) {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json();
    return body !== null && typeof body === 'object' && body.ok === true;
  } catch {
    return false;
  }
}

async function main() {
  const parsed = parseDevLanArgs(process.argv.slice(2));
  if (parsed.kind === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (parsed.kind === 'error') fail(`${parsed.error}\n\n${USAGE}`, 2);
  const { options } = parsed;

  const settings = serverSettings();
  const port = options.port ?? (settings.port === undefined ? DEFAULT_PORT : Number(settings.port));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    fail(`PORT in apps/server/.env is "${settings.port}": not a port (or pass --port)`);

  // ---- 1. the address the phones use
  const candidates = lanCandidates(networkInterfaces());
  let picked;
  if (options.ip !== null) {
    picked = candidates.find((c) => c.address === options.ip) ?? { name: null, address: options.ip };
    if (picked.name === null)
      say(`!! ${options.ip} אינה כתובת של אף מתאם רשת במחשב כרגע. ממשיכים איתה, כי ביקשת.`);
  } else {
    picked = candidates.find((c) => !c.virtual);
    if (picked === undefined) {
      const seen = candidates.map((c) => `  ${c.address}   (${c.name})`);
      fail(
        [
          'לא נמצאה כתובת IPv4 של Wi-Fi או של Ethernet. מתחברים לרשת ה־Wi-Fi של הטלפונים, או בוחרים כתובת:',
          '  npm run dev:lan -- --ip 192.168.1.20',
          ...(seen.length > 0 ? ['הכתובות שנמצאו (של מתאמים וירטואליים או VPN):', ...seen] : []),
        ].join('\n'),
      );
    }
  }
  const host = picked.address;
  const others = candidates.filter((c) => c.address !== host);
  say(`הכתובת לטלפונים: ${host}${picked.name ? ` (${picked.name})` : ''}`);

  // ---- apps/mobile/.env.local (gitignored: .env*.local)
  let envFile = null;
  if (options.writeEnv) {
    const current = existsSync(MOBILE_ENV) ? readFileSync(MOBILE_ENV, 'utf8') : null;
    const template = existsSync(MOBILE_ENV_EXAMPLE) ? readFileSync(MOBILE_ENV_EXAMPLE, 'utf8') : null;
    const { text, changed } = updateEnvText(current, serverEnv(host, port), template);
    if (changed) writeFileSync(MOBILE_ENV, text);
    envFile = { changed };
    say(changed ? 'apps/mobile/.env.local עודכן' : 'apps/mobile/.env.local כבר מעודכן');
  }

  const database = settings.databaseUrl
    ? 'postgres'
    : /^memory(:\/\/)?$/.test(settings.pgliteDir ?? '')
      ? 'memory'
      : 'pglite';
  const banner = (lanCheck, serverStarted) =>
    console.log(
      bannerLines({
        host,
        port,
        adapter: picked.name,
        others,
        admin: settings.adminPassword
          ? { kind: 'env' }
          : database === 'postgres'
            ? { kind: 'off' }
            : { kind: 'dev' },
        adminBuilt: existsSync(ADMIN_INDEX),
        envFile,
        lanCheck,
        platform: process.platform,
        serverStarted,
      }).join('\n'),
    );

  // ---- a server already running (another window): details only
  const running = await isListening(port);
  if (running || !options.server) {
    if (running && !(await healthy(`http://127.0.0.1:${port}`)))
      fail(
        `פורט ${port} תפוס, ולא על ידי שרת המשחק. סוגרים את התוכנה שמחזיקה אותו, או בוחרים פורט אחר עם --port.`,
      );
    if (running && options.seed)
      fail(
        `שרת כבר רץ בפורט ${port}. --seed צריך אותו עצור (תיקיית PGlite פתוחה לתהליך אחד): עוצרים אותו ומריצים שוב.`,
      );
    if (running) say(`שרת פיתוח כבר רץ בפורט ${port}, ולא מפעילים עוד אחד. אלה הפרטים:`);
    else say(`--no-server: השרת לא רץ כרגע. מפעילים אותו עם npm run server, או עם npm run dev:lan.`);
    banner(running ? ((await healthy(`http://${host}:${port}`)) ? 'ok' : 'failed') : 'skipped', false);
    return 0;
  }

  // ---- 2. the database: sample data (--seed) and the ranked pool
  if (database === 'postgres') {
    say('DATABASE_URL מוגדר: לא נוגעים במסד. את המאגר המדורג טוענים בעצמכם (npm run db:seed-puzzles).');
  } else if (database === 'memory') {
    say('PGLITE_DIR=memory: המסד מתחיל ריק בכל הפעלה, ומשחק מדורג לא יתחיל (אין מאגר לוחות).');
  } else {
    if (options.seed) {
      say('נתוני דוגמה לאתר הניהול (npm run seed)…');
      if ((await exitCodeOf(npm(['run', 'seed']))) !== 0) fail('npm run seed נכשל: הפירוט למעלה.');
    }
    say('המאגר המדורג: נטען רק אם חסר או השתנה (npm run db:seed-puzzles -- --if-empty)…');
    if ((await exitCodeOf(npm(['run', 'db:seed-puzzles', '--', '--if-empty']))) !== 0)
      fail('טעינת המאגר המדורג נכשלה: הפירוט למעלה.');
  }

  // ---- 3. the server
  say(`מפעיל את השרת (npm run server) בפורט ${port}…`);
  const server = npm(['run', 'server'], { ...process.env, PORT: String(port) });
  // Ctrl+C reaches the server as well (one terminal): it shuts down and closes PGlite, then this script ends.
  process.on('SIGINT', () => {});
  let exited = null;
  const exit = exitCodeOf(server).then((code) => (exited = code));

  const started = Date.now();
  while (!(await healthy(`http://127.0.0.1:${port}`, 1000))) {
    if (exited !== null) {
      say('השרת נעצר לפני שעלה: הסיבה למעלה.');
      return exited;
    }
    if (Date.now() - started > START_TIMEOUT_MS) {
      say(`השרת לא ענה ל־/health תוך ${START_TIMEOUT_MS / 1000} שניות. ממשיכים לחכות לו; הפרטים כבר כאן:`);
      banner('skipped', true);
      return exit;
    }
    await sleep(500);
  }

  // ---- 4. what to do next
  banner((await healthy(`http://${host}:${port}`)) ? 'ok' : 'failed', true);
  return exit;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('[dev:lan] failed', error);
    process.exit(1);
  },
);
