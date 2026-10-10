/**
 * Stage 7א end to end, on the real server (Colyseus + Express + an in-memory PGlite, one port): the app
 * reports a batch, the admin signs in and sees it in the overview, the installs and the screens; the built
 * site (apps/admin/dist, `npm run admin:build`) is served at /admin. Then a few attempts to break it.
 *
 * The clock is fixed (2026-10-09 12:00 UTC, 15:00 in Jerusalem) so the day buckets are the same on any run.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type AddressInfo, connect } from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  ADMIN_API_PREFIX,
  type AdminInstallDetail,
  type AdminInstallRow,
  type AdminOverview,
  type AdminPage,
  type AdminScreens,
  MAX_BATCH_BYTES,
  TELEMETRY_PATH,
  type TelemetryBatch,
  type TelemetryEvent,
} from '@sudoku-fight/protocol';

import { findAdminSiteDir } from '../src/admin';
import { ADMIN_CSP } from '../src/admin/router';
import { createAppServer } from '../src/app';
import {
  adminLogin,
  type AdminClient,
  fakeClock,
  getUrl,
  signedInAdmin,
  TEST_ADMIN_PASSWORD,
  testConfig,
} from '../src/testing';

const T = Date.UTC(2026, 9, 9, 12);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const API = ADMIN_API_PREFIX;
const CRLF = '\r\n';

const clock = fakeClock(T);
const server = createAppServer({ gracefullyShutdown: false, config: testConfig(), now: clock.now });
let url = '';
let port = 0;

beforeAll(async () => {
  await server.listen(0);
  port = (server.transport.server!.address() as AddressInfo).port;
  url = `http://127.0.0.1:${port}`;
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

/**
 * One admin session for the whole file: sign-in is limited to 5 tries a minute per address, and this clock
 * stands still. (The session lasts 12 hours of this clock.)
 */
let session: Promise<AdminClient> | undefined;
const admin = () => (session ??= signedInAdmin(url));

/**
 * One raw HTTP request on a fresh socket, so nothing in between normalizes it (fetch would turn /a/%2e%2e/b
 * into /b). Resolves with the whole answer as text ('' if the socket just closed).
 */
function rawRequest(lines: string[], body = ''): Promise<string> {
  const text = [...lines, 'Connection: close', '', body].join(CRLF);
  return new Promise((resolve) => {
    let data = '';
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('data', (d: Buffer) => (data += d.toString('latin1')));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => resolve(data));
  });
}
const statusLine = (answer: string) => answer.split(CRLF)[0];

// ---- the app's batch ---------------------------------------------------------------------------------------

const event = (name: TelemetryEvent['name'], props: TelemetryEvent['props'], minutesAgo: number) => ({
  id: randomUUID(),
  name,
  props,
  t: T - minutesAgo * MINUTE,
});

const installId = randomUUID();
const batch: TelemetryBatch = {
  // The app may send any spelling of its UUID; the server keeps it in lower case.
  installId: installId.toUpperCase(),
  platform: 'android',
  appVersion: '0.1.0',
  events: [
    event('app_open', {}, 10),
    event('screen_view', { screen: 'Home' }, 9),
    event('screen_view', { screen: 'Match-Search' }, 8),
    event('game_start', { mode: 'bot', gameType: 'fast' }, 7),
    event('screen_view', { screen: 'Game' }, 6.5), // distinct times: ties would order by random id
    event('game_end', { mode: 'bot', place: 1 }, 3),
    event('screen_view', { screen: 'Results' }, 2),
  ],
};

const postBatch = (body: string) =>
  fetch(`${url}${TELEMETRY_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('the app reports, the admin reads', () => {
  it('POST /v1/events stores a TelemetryBatch once', async () => {
    const res = await postBatch(JSON.stringify(batch));
    expect([res.status, await res.json()]).toEqual([202, { accepted: 7, duplicates: 0 }]);
    const again = await postBatch(JSON.stringify(batch));
    expect([again.status, await again.json()]).toEqual([202, { accepted: 0, duplicates: 7 }]);
  });

  it('the admin API answers only after signing in with the password', async () => {
    for (const p of ['/session', '/overview', '/installs', '/screens', '/nope']) {
      const res = await getUrl(`${url}${API}${p}`);
      expect([p, res.status, res.body]).toEqual([p, 401, { error: 'unauthorized' }]);
    }
    expect((await adminLogin(url, { password: 'not it' })).status).toBe(401);
    const login = await adminLogin(url, { password: TEST_ADMIN_PASSWORD });
    expect(login.status).toBe(204);
    expect(login.setCookie).toMatch(/HttpOnly/);
    expect(login.setCookie).toMatch(/SameSite=Strict/);
    expect(login.setCookie).toMatch(/Path=\/admin/);
  });

  it('the overview counts the install, its activity and the practice game, today in Jerusalem', async () => {
    const { status, body } = await (await admin()).get<AdminOverview>('/overview', { days: 7 });
    expect(status).toBe(200);
    const days = ['03', '04', '05', '06', '07', '08', '09'].map((d) => `2026-10-${d}`);
    const onlyToday = days.map((day) => ({ day, count: day === '2026-10-09' ? 1 : 0 }));
    expect(body).toEqual({
      days: 7,
      totals: { installs: 1, users: 0, games: 0, practiceGames: 1, events: 7 },
      installsPerDay: onlyToday,
      activePerDay: onlyToday,
      activeToday: 1,
      activeThisWeek: 1,
      gamesPerDay: days.map((day) => ({ day, count: 0 })),
      practicePerDay: onlyToday,
    });
  });

  it('the installs list shows it with "last seen", and the detail its session screen by screen', async () => {
    const row: AdminInstallRow = {
      id: installId,
      platform: 'android',
      appVersion: '0.1.0',
      firstSeen: T - 10 * MINUTE,
      lastSeen: T - 2 * MINUTE,
      userId: null,
      userName: null,
      events: 7,
    };
    const list = await (await admin()).get<AdminPage<AdminInstallRow>>('/installs');
    expect(list.body).toEqual({ items: [row], page: 1, pageSize: 50, total: 1 });

    const detail = await (await admin()).get<AdminInstallDetail>(`/installs/${installId.toUpperCase()}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject(row);
    expect(detail.body.sessions).toEqual([
      {
        startedAt: T - 10 * MINUTE,
        endedAt: T - 2 * MINUTE,
        screens: ['Home', 'Match-Search', 'Game', 'Results'],
      },
    ]);
    expect(detail.body.recentEvents.map((e) => e.name)).toEqual([
      'screen_view',
      'game_end',
      'screen_view',
      'game_start',
      'screen_view',
      'screen_view',
      'app_open',
    ]);
    expect(detail.body.recentEvents[0]).toMatchObject({ tClient: T - 2 * MINUTE, tServer: T });
  });

  it('the screens show the views, and where the session ended', async () => {
    const { body } = await (await admin()).get<AdminScreens>('/screens', { days: 7 });
    const stat = (screen: string, exits: number) => ({
      screen,
      views: 1,
      installs: 1,
      exits,
      exitRate: exits,
      lastScreenOfGone: 0,
    });
    expect(body).toEqual({
      days: 7,
      sessionGapMinutes: 30,
      goneAfterDays: 7,
      sessions: 1,
      screens: [stat('Game', 0), stat('Home', 0), stat('Match-Search', 0), stat('Results', 1)],
    });
  });

  it('a week and a day later the install counts as gone, last seen on Results', async () => {
    clock.set(T + 8 * DAY);
    try {
      const later = await signedInAdmin(url); // the shared session ran out after 12 hours
      const { body } = await later.get<AdminScreens>('/screens', { days: 30 });
      expect(body.screens.find((s) => s.screen === 'Results')?.lastScreenOfGone).toBe(1);
      expect(body.screens.filter((s) => s.lastScreenOfGone > 0)).toHaveLength(1);
      const overview = await later.get<AdminOverview>('/overview', { days: 30 });
      expect([overview.body.activeToday, overview.body.activeThisWeek]).toEqual([0, 0]);
    } finally {
      clock.set(T);
    }
  });
});

// ---- the built site ----------------------------------------------------------------------------------------

const siteDir = findAdminSiteDir();
const describeSite = siteDir === null ? describe.skip : describe;
if (siteDir === null) {
  console.warn('[e2e] apps/admin/dist is not built (npm run admin:build): skipping the site checks');
}

describeSite('the built admin site at /admin', () => {
  const indexHtml = siteDir === null ? '' : readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  const fetchText = async (p: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${url}${p}`, { headers });
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text(), res };
  };

  it('GET /admin/ is the page, with the hardening headers and without the open CORS headers', async () => {
    const page = await fetchText('/admin/', { origin: 'https://elsewhere.example' });
    expect(page.status).toBe(200);
    expect(page.type).toMatch(/^text\/html/);
    expect(page.body).toBe(indexHtml);
    expect(page.res.headers.get('x-frame-options')).toBe('DENY');
    expect(page.res.headers.get('content-security-policy')).toBe(ADMIN_CSP);
    expect(page.res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('the built page fits its CSP: no inline script, its own scripts, styles from here or Google Fonts', () => {
    expect(ADMIN_CSP).toMatch(/^default-src 'none'; script-src 'self';/);
    expect(ADMIN_CSP).not.toMatch(/unsafe-|\*/);
    const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, inline] of scripts) {
      expect(inline?.trim()).toBe('');
      expect(attrs).toMatch(/\bsrc="\/admin\/[^"]+"/);
    }
    const sheets = [...indexHtml.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    for (const href of sheets) expect(href).toMatch(/^(\/admin\/|https:\/\/fonts\.googleapis\.com\/)/);
    expect(indexHtml).not.toMatch(/<style\b|\son[a-z]+=/i);
  });

  it("the site's own routes fall back to the page, so a reload works", async () => {
    for (const p of ['/admin', '/admin/installs', `/admin/installs/${installId}`, '/admin/users/x']) {
      const page = await fetchText(p);
      expect([p, page.status, page.body === indexHtml]).toEqual([p, 200, true]);
    }
  });

  it('serves its hashed script for a year; a missing file is a 404, not the page', async () => {
    const script = /src="(\/admin\/assets\/[^"]+\.js)"/.exec(indexHtml)?.[1];
    expect(script).toBeDefined();
    const js = await fetchText(script!);
    expect(js.status).toBe(200);
    expect(js.type).toMatch(/javascript/);
    expect(js.res.headers.get('cache-control')).toContain('immutable');
    const missing = await fetchText('/admin/assets/gone-123.js');
    expect([missing.status, missing.body === indexHtml]).toEqual([404, false]);
  });

  it('under /admin/api the API answers, never the page: an unknown route is a JSON 404', async () => {
    const nope = await (await admin()).get('/nope');
    expect([nope.status, nope.body]).toEqual([404, { error: 'notFound' }]);
    expect(nope.headers.get('content-type')).toMatch(/^application\/json/);
    const deep = await (await admin()).get('/nope/deeper?x=1');
    expect([deep.status, deep.body]).toEqual([404, { error: 'notFound' }]);
  });

  it('no path climbs out of the site folder', async () => {
    for (const p of [
      '/admin/..%2f..%2f..%2fpackage.json',
      '/admin/%2e%2e/%2e%2e/%2e%2e/package.json',
      '/admin/assets/..%5c..%5c..%5c..%5cpackage.json',
      '/admin/../../../package.json',
      '/admin/..%2f..%2fsrc%2fapp.ts',
    ]) {
      const answer = await rawRequest([`GET ${p} HTTP/1.1`, 'Host: localhost']);
      const leaked = answer.includes('"workspaces"') || answer.includes('import ');
      expect([p, statusLine(answer), leaked]).toEqual([p, 'HTTP/1.1 404 Not Found', false]);
    }
  });
});

// ---- trying to break it --------------------------------------------------------------------------------------

describe('trying to break it', () => {
  it('one malformed request cannot bring the server down (Host, X-Forwarded-Proto: http/guard)', async () => {
    const answers = await Promise.all([
      rawRequest(['GET /health HTTP/1.1', 'Host: localhost', 'X-Forwarded-Proto: a b']),
      rawRequest(['GET /health HTTP/1.1', 'Host: localhost', 'X-Forwarded-Proto: https, http']),
      rawRequest(['GET /health HTTP/1.1', 'Host: a b']),
      rawRequest(['GET /health HTTP/1.1', 'Host: a@b']),
      rawRequest(['GET /health HTTP/1.1', 'Host: localhost:99999']),
      rawRequest(['POST /matchmake/joinOrCreate/echo HTTP/1.1', 'Host: [', 'Content-Length: 2'], '{}'),
    ]);
    expect(answers.map(statusLine)).toEqual([
      'HTTP/1.1 200 OK',
      'HTTP/1.1 200 OK',
      'HTTP/1.1 400 Bad Request',
      'HTTP/1.1 400 Bad Request',
      'HTTP/1.1 400 Bad Request',
      'HTTP/1.1 400 Bad Request',
    ]);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it('a gzip bomb is measured after inflating: 413, nothing stored', async () => {
    const json = JSON.stringify({ ...batch, installId: randomUUID() });
    const body = gzipSync(`{${' '.repeat(MAX_BATCH_BYTES * 32)}${json.slice(1)}`);
    expect(body.length).toBeLessThan(MAX_BATCH_BYTES / 8);
    const res = await fetch(`${url}${TELEMETRY_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body,
    });
    expect([res.status, await res.json()]).toEqual([413, { error: 'tooLarge' }]);
    expect((await (await admin()).get<AdminPage<AdminInstallRow>>('/installs')).body.total).toBe(1);
  });

  it('a body cannot pick the user, and a malformed path is a 400, not a crash', async () => {
    const other = {
      ...batch,
      installId: randomUUID(),
      userId: 'someone-else',
      events: [event('app_open', {}, 1)],
    };
    expect((await postBatch(JSON.stringify(other))).status).toBe(202);
    const list = await (await admin()).get<AdminPage<AdminInstallRow>>('/installs');
    expect(list.body.items.map((i) => i.userId)).toEqual([null, null]);
    const bad = await (await admin()).get('/installs/%E0%A4%A');
    expect([bad.status, bad.body]).toEqual([400, { error: 'badRequest' }]);
  });

  // Last: it uses up this address's sign-in tries.
  it('a made-up X-Forwarded-For does not reset the sign-in limit (no proxy is trusted here)', async () => {
    clock.set(T + 30 * DAY); // well after every earlier sign-in: a full bucket
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${url}${API}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${i}` },
        body: JSON.stringify({ password: 'guess' }),
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });
});
