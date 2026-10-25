import { ENGINE_VERSION } from '@sudoku-fight/engine';
import {
  ADMIN_API_PREFIX,
  type AdminPage,
  type AdminQaBug,
  type AdminQaItem,
  type AdminQaRun,
  type AdminQaRunDetail,
  type QaCatalog,
} from '@sudoku-fight/protocol';

import type { AdminConfig, AdminGoogleSignIn, QaSettings } from '../config';
import type { RateLimitRule } from '../http/rateLimiter';
import type { QaCatalogSource } from '../qa';
import {
  adminLogin,
  createTestDb,
  fakeClock,
  type FakeClock,
  startHttp,
  type TestDb,
  type TestHttp,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
  testConfig,
  testGoogleAdmin,
} from '../testing';
import { testQaCatalog, TEST_QA_TASKS } from '../testing/qa';
import { testTokens, type TestTokens } from '../testing/tokens';

/**
 * The QA module on the admin API (docs/handoff/2026-10-23/qa-module/plan.md; ./qa.ts, src/qa): the switch, who
 * may call (the session cookie, or Claude's key on these routes only), the catalog read on first use, opening a
 * run (a copy of the catalog's tasks), marks, bugs and their fixes, closing a run, and the lists. Over HTTP,
 * through the server's own routes (configureHttp), on a fixture catalog (testing/qa.ts).
 */

const NOW = Date.UTC(2026, 9, 23, 9);
/** The agent's key in these tests: 40 characters. */
const KEY = 'qa-agent-key-for-tests-0123456789abcdefg';
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
/** The fixture's tasks (testing/qa.ts), by letter. */
const [A, B, C, D, E, F] = TEST_QA_TASKS;

let t: TestDb;
let tokens: TestTokens;
let clock: FakeClock;
let http: TestHttp | undefined;
/** What the admin router logged. */
let logged: string[] = [];

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
}, 30_000);
beforeEach(() => t.reset());
afterEach(async () => {
  await http?.close();
  http = undefined;
});
afterAll(() => t.close());

/** The admin settings with the test password and this Google sign-in (secret kept: sessions survive a restart). */
const adminWith = (google: AdminGoogleSignIn | null): AdminConfig => ({
  enabled: true,
  password: TEST_ADMIN_PASSWORD,
  devPassword: false,
  google,
  sessionSecret: TEST_SESSION_SECRET,
});
/** Google sign-in for TEST_ADMIN_EMAIL, and the test password. */
const GOOGLE_ADMIN = adminWith(testGoogleAdmin());

interface StartOptions {
  /** Default: on, with KEY. null: no QA settings at all. */
  qa?: QaSettings | null;
  /** Google sign-in offered (password sessions may then read only). */
  google?: boolean;
  /** Admin settings of their own (over `google`). */
  admin?: AdminConfig;
  catalog?: QaCatalogSource;
  agentLimit?: RateLimitRule;
  /** Keep the clock (a second server on the same data). */
  keepClock?: boolean;
}

async function start({
  qa,
  google = false,
  admin,
  catalog,
  agentLimit,
  keepClock = false,
}: StartOptions = {}) {
  await http?.close();
  if (!keepClock) clock = fakeClock(NOW);
  logged = [];
  const settings = qa === undefined ? { enabled: true, agentToken: KEY } : qa;
  const adminConfig = admin ?? (google ? GOOGLE_ADMIN : undefined);
  http = await startHttp({
    config: testConfig({
      ...(adminConfig === undefined ? {} : { admin: adminConfig }),
      ...(settings === null ? {} : { qa: settings }),
    }),
    db: t.db,
    now: clock.now,
    adminSiteDir: null,
    tokens: tokens.verifier(clock.now),
    adminLog: (message) => logged.push(message),
    qaCatalog: catalog ?? (() => testQaCatalog()),
    qaAgentLimit: agentLimit,
  });
  return http.url;
}

/** Who calls: a session cookie, Claude's key, or any Authorization header. */
interface Who {
  cookie?: string;
  bearer?: string;
  authorization?: string;
}
const AGENT: Who = { bearer: KEY };

interface Answer<T> {
  status: number;
  body: T & { error?: string; message?: string };
  headers: Headers;
}

async function call<T = unknown>(
  url: string,
  method: 'GET' | 'POST',
  path: string,
  { who = AGENT, body, type = 'application/json' }: { who?: Who; body?: unknown; type?: string } = {},
): Promise<Answer<T>> {
  const headers: Record<string, string> = {};
  if (who.cookie !== undefined) headers.cookie = who.cookie;
  if (who.bearer !== undefined) headers.authorization = `Bearer ${who.bearer}`;
  if (who.authorization !== undefined) headers.authorization = who.authorization;
  let payload: string | undefined;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    headers['content-type'] = type;
  }
  const res = await fetch(`${url}${ADMIN_API_PREFIX}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === '' ? null : JSON.parse(text)) as Answer<T>['body'],
    headers: res.headers,
  };
}

const get = <T = unknown>(url: string, path: string, who: Who = AGENT) => call<T>(url, 'GET', path, { who });
const post = <T = unknown>(url: string, path: string, body: unknown, who: Who = AGENT) =>
  call<T>(url, 'POST', path, { who, body });

const OPEN = { title: 'בדיקת גרסה 1.0.5', appVersion: '1.0.5', device: 'Pixel 7', platform: 'android' };

/** Opens a run (default: every task, by the agent) and answers its id. */
async function openRun(url: string, body: object = OPEN, who: Who = AGENT): Promise<number> {
  const res = await post<AdminQaRun>(url, '/qa/runs', body, who);
  if (res.status !== 201) throw new Error(`open run: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

const mark = (url: string, runId: number, taskId: string, body: object, who: Who = AGENT) =>
  post<AdminQaItem>(url, `/qa/runs/${runId}/items/${encodeURIComponent(taskId)}/result`, body, who);
const fix = (url: string, runId: number, taskId: string, body: object, who: Who = AGENT) =>
  post<AdminQaItem>(url, `/qa/runs/${runId}/items/${encodeURIComponent(taskId)}/fix`, body, who);
const runOf = (url: string, runId: number, query = '') =>
  get<AdminQaRunDetail>(url, `/qa/runs/${runId}${query}`);
const taskIds = (run: AdminQaRunDetail) => run.items.map((i) => i.taskId);

const FAIL = { result: 'fail', actual: 'הכפתור לא הגיב' };
const PARTIAL = { result: 'partial', actual: 'החדר נפתח, אבל בלי קוד' };
const FIXED = { fixNote: 'תוקן הטיפול בלחיצה כפולה', fixedIn: '1.0.5 (abc1234)' };

/** A Google session of TEST_ADMIN_EMAIL (a server with GOOGLE_ADMIN). */
async function googleCookie(url: string): Promise<string> {
  const idToken = await tokens.sign(
    { uid: 'google-uid-1', email: TEST_ADMIN_EMAIL, provider: 'google.com' },
    clock.now(),
  );
  const res = await fetch(`${url}${ADMIN_API_PREFIX}/login/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (res.status !== 204) throw new Error(`Google sign-in: ${res.status}`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function passwordCookie(url: string): Promise<string> {
  const login = await adminLogin(url);
  if (login.status !== 204) throw new Error(`password sign-in: ${login.status}`);
  return login.cookie;
}

const ROUTES: ['GET' | 'POST', string][] = [
  ['GET', '/qa/catalog'],
  ['GET', '/qa/runs'],
  ['POST', '/qa/runs'],
  ['GET', '/qa/runs/1'],
  ['POST', '/qa/runs/1/close'],
  ['POST', '/qa/runs/1/items/friends-room-create/result'],
  ['POST', '/qa/runs/1/items/friends-room-create/fix'],
  ['GET', '/qa/bugs'],
  ['GET', '/qa/elsewhere'],
];

// ---- the switch, and who may call ---------------------------------------------------------------------------

describe('QA routes: off and on', () => {
  it('QA_ENABLED off, or no QA settings: every /qa route answers 503 qaDisabled, whoever asks', async () => {
    for (const qa of [null, { enabled: false, agentToken: KEY }]) {
      const url = await start({ qa });
      const cookie = await passwordCookie(url);
      for (const [method, path] of ROUTES) {
        for (const who of [{}, { cookie }, AGENT]) {
          const res = await call(url, method, path, { who, body: method === 'POST' ? {} : undefined });
          expect([method, path, res.status, res.body?.error]).toEqual([method, path, 503, 'qaDisabled']);
        }
      }
      // The rest of the admin API as before.
      expect((await get(url, '/session', { cookie })).status).toBe(200);
    }
  });

  it('on: anything else under /qa is 404, with the cookie or the key', async () => {
    const url = await start();
    const cookie = await passwordCookie(url);
    for (const who of [{ cookie }, AGENT]) {
      expect((await get(url, '/qa/elsewhere', who)).status).toBe(404);
      expect((await get(url, '/qa', who)).status).toBe(404);
    }
    expect((await get(url, '/qa/elsewhere', {})).status).toBe(401);
  });
});

describe('who may use the /qa routes', () => {
  it('without a session or a key: 401; with the session cookie, or with the key: in', async () => {
    const url = await start();
    for (const [method, path] of ROUTES) {
      const res = await call(url, method, path, { who: {}, body: method === 'POST' ? {} : undefined });
      expect([method, path, res.status, res.body?.error]).toEqual([method, path, 401, 'unauthorized']);
    }
    const cookie = await passwordCookie(url);
    expect((await get(url, '/qa/runs', { cookie })).status).toBe(200);
    expect((await get(url, '/qa/runs', AGENT)).status).toBe(200);
    expect((await get(url, '/qa/runs', { authorization: `bearer ${KEY}` })).status).toBe(200);
  });

  it('the key must be exact; a wrong one, another scheme, or a server without a key → 401, cookie or not', async () => {
    const url = await start();
    const cookie = await passwordCookie(url);
    for (const who of [
      { bearer: `${KEY}x` },
      { bearer: KEY.slice(0, -1) },
      { bearer: KEY.toUpperCase() },
      { authorization: `Basic ${KEY}` },
      { authorization: KEY },
      { authorization: 'Bearer' },
      { bearer: KEY.slice(0, -1), cookie },
    ]) {
      const res = await get(url, '/qa/runs', who);
      expect([who, res.status, res.body.error]).toEqual([who, 401, 'unauthorized']);
    }

    // No key on the server: the cookie only.
    const noKey = await start({ qa: { enabled: true, agentToken: null } });
    expect((await get(noKey, '/qa/runs', AGENT)).status).toBe(401);
    expect((await get(noKey, '/qa/runs', { cookie: await passwordCookie(noKey) })).status).toBe(200);
  });

  it('QA_OPEN (staging): no sign-in and no key; such a caller is Claude, on the rate limit; /qa only', async () => {
    const url = await start({
      google: true,
      qa: { enabled: true, agentToken: null, open: true },
      agentLimit: { limit: 4, windowMs: 60_000 },
    });
    const opened = await post<AdminQaRun>(url, '/qa/runs', { title: 'פתוח', appVersion: '1.0.5' }, {});
    expect([opened.status, opened.body.createdBy]).toEqual([201, 'claude']);
    // A key sent to an open server without one is not asked for.
    expect((await get(url, '/qa/runs', AGENT)).status).toBe(200);
    // A signed-in admin is still named, and is not on the limit.
    const cookie = await googleCookie(url);
    const closed = await post<AdminQaRun>(url, `/qa/runs/${opened.body.id}/close`, {}, { cookie });
    expect(closed.body.closedBy).toBe(TEST_ADMIN_EMAIL);
    // Everything else under /admin/api still wants the cookie.
    expect((await get(url, '/session', {})).status).toBe(401);
    expect((await post(url, '/stealth/switch', { on: true }, {})).status).toBe(401);
    // The limit: 4 a minute without sign-in (the POST and the keyed GET took 2).
    expect((await get(url, '/qa/runs', {})).status).toBe(200);
    expect((await get(url, '/qa/runs', {})).status).toBe(200);
    expect((await get(url, '/qa/runs', {})).status).toBe(429);
    expect((await get(url, '/qa/runs', { cookie })).status).toBe(200);

    // Open, with a key set: a wrong key is still refused.
    const keyed = await start({ qa: { enabled: true, agentToken: KEY, open: true } });
    expect((await get(keyed, '/qa/runs', { bearer: `${KEY}x` })).status).toBe(401);
    expect((await get(keyed, '/qa/runs', {})).status).toBe(200);
  });

  it('the key opens /qa only: /session, /users, /stealth, /audit and the moderation POSTs answer 401', async () => {
    const url = await start();
    for (const path of ['/session', '/overview', '/users', '/games', '/stealth', '/audit', '/reports']) {
      const res = await get(url, path, AGENT);
      expect([path, res.status]).toEqual([path, 401]);
    }
    for (const [path, body] of [
      ['/users/u-1/suspend', {}],
      ['/reports/r-1/resolve', {}],
      ['/stealth/switch', { on: true }],
    ] as const) {
      const res = await post(url, path, body, AGENT);
      expect([path, res.status]).toEqual([path, 401]);
    }
  });

  it('calls with a key have their own rate limit (429), which never blocks a sign-in or the cookie', async () => {
    const url = await start({ google: true, agentLimit: { limit: 8, windowMs: 60_000 } });
    // More wrong keys than the sign-ins' 5 tries a minute.
    for (let i = 0; i < 8; i++)
      expect((await get(url, '/qa/runs', { bearer: `wrong-${i}` })).status).toBe(401);
    const limited = await get(url, '/qa/runs', AGENT);
    expect([limited.status, limited.body.error, limited.headers.get('retry-after')]).toEqual([
      429,
      'tooManyRequests',
      '8',
    ]);
    // Moshe signs in as before, both ways, and his session works on /qa.
    const cookie = await googleCookie(url);
    expect((await adminLogin(url)).status).toBe(204);
    expect((await get(url, '/qa/runs', { cookie })).status).toBe(200);
    // The key works again once its budget refills.
    clock.advance(8000);
    expect((await get(url, '/qa/runs', AGENT)).status).toBe(200);
  });

  it('a password session reads but does not write where Google sign-in is offered (403); Google writes', async () => {
    const url = await start({ google: true });
    const password = { cookie: await passwordCookie(url) };
    const runId = await openRun(url);
    await mark(url, runId, A, FAIL);
    expect((await get(url, '/qa/catalog', password)).status).toBe(200);
    expect((await get(url, '/qa/runs', password)).status).toBe(200);
    expect((await get(url, `/qa/runs/${runId}`, password)).status).toBe(200);
    expect((await get(url, '/qa/bugs', password)).status).toBe(200);
    for (const res of [
      await post(url, '/qa/runs', OPEN, password),
      await mark(url, runId, B, { result: 'pass' }, password),
      await fix(url, runId, A, FIXED, password),
      await post(url, `/qa/runs/${runId}/close`, {}, password),
    ]) {
      expect([res.status, res.body.error]).toEqual([403, 'googleRequired']);
    }
    const google = { cookie: await googleCookie(url) };
    const opened = await post<AdminQaRun>(url, '/qa/runs', OPEN, google);
    expect([opened.status, opened.body.createdBy]).toEqual([201, TEST_ADMIN_EMAIL]);
  });

  it('a session ends on /qa as everywhere: its address off the list, or Google sign-in off → 401', async () => {
    let url = await start({ google: true });
    const google = { cookie: await googleCookie(url) };
    const password = { cookie: await passwordCookie(url) };
    expect((await get(url, '/qa/runs', google)).status).toBe(200);
    const refused = async () => {
      for (const res of [await get(url, '/qa/runs', google), await post(url, '/qa/runs', OPEN, google)]) {
        expect([res.status, res.body.error]).toEqual([401, 'unauthorized']);
      }
    };

    // Same secret and password, the address taken off the list: the Google session is over, the password's not.
    url = await start({ admin: adminWith(testGoogleAdmin(['someone.else@example.com'])), keepClock: true });
    await refused();
    expect((await get(url, '/qa/runs', password)).status).toBe(200);

    // Google sign-in off: its sessions end too; the password, the only way in now, writes.
    url = await start({ admin: adminWith(null), keepClock: true });
    await refused();
    expect((await get(url, '/qa/runs', password)).status).toBe(200);
    expect((await post(url, '/qa/runs', OPEN, password)).status).toBe(201);
    expect((await get<AdminPage<AdminQaRun>>(url, '/qa/runs')).body.total).toBe(1);
  });

  it('POST bodies: a JSON object of the contract’s fields only, at most 16 kB', async () => {
    const url = await start();
    for (const [body, type] of [
      ['title=x&appVersion=1', 'application/x-www-form-urlencoded'],
      [JSON.stringify(OPEN), 'text/plain'],
      ['{"title": ', 'application/json'],
      ['[]', 'application/json'],
      ['"text"', 'application/json'],
      [JSON.stringify({ ...OPEN, extra: 1 }), 'application/json'],
    ]) {
      const res = await call(url, 'POST', '/qa/runs', { body, type });
      expect([body, res.status, res.body.error]).toEqual([body, 400, 'badRequest']);
    }
    const huge = await post(url, '/qa/runs', { ...OPEN, device: 'x'.repeat(17_000) });
    expect([huge.status, huge.body.error]).toEqual([413, 'tooLarge']);
    expect((await get<AdminPage<AdminQaRun>>(url, '/qa/runs')).body.total).toBe(0);
  });

  it('logs neither the key nor the Authorization header', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const url = await start({ catalog: () => ({ broken: true }) });
      await get(url, '/qa/catalog');
      await get(url, '/qa/runs', { bearer: `${KEY}-wrong` });
      await post(url, '/qa/runs', OPEN);
      const said = [...logged, ...spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' ')))];
      expect(said.some((line) => line.includes('[qa]'))).toBe(true);
      for (const line of said) {
        expect(line).not.toContain(KEY);
        expect(line.toLowerCase()).not.toContain('bearer');
      }
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

// ---- the catalog --------------------------------------------------------------------------------------------

describe('the catalog', () => {
  it('GET /qa/catalog answers it, checked', async () => {
    const url = await start();
    const res = await get<QaCatalog>(url, '/qa/catalog');
    expect([res.status, res.body]).toEqual([200, testQaCatalog()]);
  });

  it('is read on first use, once: the server starts and answers without it', async () => {
    const source = jest.fn(() => testQaCatalog());
    const url = await start({ catalog: source });
    expect((await get(url, '/session', { cookie: await passwordCookie(url) })).status).toBe(200);
    expect((await get(url, '/qa/runs')).status).toBe(200);
    expect(source).not.toHaveBeenCalled();
    await get(url, '/qa/catalog');
    await openRun(url);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('broken, it never stops the server: the catalog and new runs answer 500, the open runs keep working', async () => {
    let url = await start();
    const runId = await openRun(url);

    url = await start({ catalog: () => ({ catalogVersion: 1, categories: [] }), keepClock: true });
    const cookie = await passwordCookie(url);
    expect((await get(url, '/session', { cookie })).status).toBe(200);
    const catalog = await get(url, '/qa/catalog');
    expect([catalog.status, catalog.body]).toEqual([
      500,
      { error: 'qaCatalogInvalid', message: 'categories: the catalog needs at least one category' },
    ]);
    const opened = await post(url, '/qa/runs', OPEN);
    expect([opened.status, opened.body.error]).toEqual([500, 'qaCatalogInvalid']);
    expect((await get<AdminPage<AdminQaRun>>(url, '/qa/runs')).body.total).toBe(1);
    expect((await mark(url, runId, A, FAIL)).status).toBe(200);
    expect((await fix(url, runId, A, FIXED)).status).toBe(200);
    expect((await get<AdminPage<AdminQaBug>>(url, '/qa/bugs?status=all')).body.total).toBe(1);
    // Told once, with its problems.
    expect(logged.filter((l) => l.startsWith('[qa] the catalog is not valid'))).toEqual([
      '[qa] the catalog is not valid: categories: the catalog needs at least one category',
    ]);

    // A file that won't load: the same.
    url = await start({
      catalog: () => {
        throw new SyntaxError('Unexpected token } in JSON at position 41');
      },
    });
    const unreadable = await get(url, '/qa/catalog');
    expect([unreadable.status, unreadable.body.error]).toEqual([500, 'qaCatalogInvalid']);
    expect(unreadable.body.message).toMatch(/^the catalog could not be read: Unexpected token/);
  });
});

// ---- runs ---------------------------------------------------------------------------------------------------

describe('opening a run', () => {
  it('copies every task by default, in catalog order, stamped with the versions and who opened it', async () => {
    const url = await start();
    const res = await post<AdminQaRun>(url, '/qa/runs', OPEN);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 1,
      title: 'בדיקת גרסה 1.0.5',
      appVersion: '1.0.5',
      device: 'Pixel 7',
      platform: 'android',
      engineVersion: ENGINE_VERSION,
      catalogVersion: 3,
      filter: { who: 'all', categories: null },
      status: 'open',
      createdBy: 'claude',
      createdAt: NOW,
      closedBy: null,
      closedAt: null,
      counts: { total: 6, untested: 6, pass: 0, partial: 0, fail: 0, openBugs: 0, handled: 0 },
    });
    const run = (await runOf(url, 1)).body;
    expect(taskIds(run)).toEqual(TEST_QA_TASKS);
    expect(run.items[0]).toEqual({
      taskId: 'friends-room-create',
      position: 0,
      categoryId: 'friends',
      categoryTitle: 'חברים',
      subcategoryId: 'friends-room',
      subcategoryTitle: 'חדר עם חברים',
      title: 'פתיחת חדר',
      subtitle: 'בדוק פתיחת חדר חדש מלשונית החברים',
      steps: ['פותחים את לשונית "חברים"', 'לוחצים על "פתח חדר"'],
      expected: ['נפתח חדר עם קוד בן 6 תווים', 'הקוד מוצג משמאל לימין'],
      who: 'both',
      source: 'FRIENDS-DEVICE-CHECKS בדיקה 7',
      result: 'untested',
      actual: null,
      note: null,
      testedBy: null,
      testedAt: null,
      bugStatus: null,
      fixNote: null,
      fixedIn: null,
      handledBy: null,
      handledAt: null,
    });
    expect(run.items.map((i) => i.position)).toEqual([0, 1, 2, 3, 4, 5]);
    // Device and platform may be left out (or blank): none.
    const bare = await post<AdminQaRun>(url, '/qa/runs', {
      title: 'בדיקה',
      appVersion: '1.0.5',
      device: ' ',
    });
    expect([bare.status, bare.body.id, bare.body.device, bare.body.platform]).toEqual([201, 2, null, null]);
  });

  it("who=claude takes claude's tasks and both's, who=moshe moshe's and both's; categories only those", async () => {
    const url = await start();
    const claude = await openRun(url, { ...OPEN, who: 'claude' });
    const moshe = await openRun(url, { ...OPEN, who: 'moshe' });
    const practice = await openRun(url, { ...OPEN, categories: ['sound', 'practice', 'sound'] });
    expect(taskIds((await runOf(url, claude)).body)).toEqual([A, B, D]);
    expect(taskIds((await runOf(url, moshe)).body)).toEqual([A, C, E, F]);
    const p = (await runOf(url, practice)).body;
    expect(taskIds(p)).toEqual([D, E, F]);
    expect(p.filter).toEqual({ who: 'all', categories: ['practice', 'sound'] });
    expect((await runOf(url, claude)).body.filter).toEqual({ who: 'claude', categories: null });
  });

  it('refuses an unknown category, a choice without tasks, and bad fields (400), and opens nothing', async () => {
    const url = await start();
    const unknown = await post(url, '/qa/runs', { ...OPEN, categories: ['practice', 'nope'] });
    expect([unknown.status, unknown.body]).toEqual([
      400,
      { error: 'badRequest', message: 'categories: unknown "nope"' },
    ]);
    const none = await post(url, '/qa/runs', { ...OPEN, categories: ['sound'], who: 'claude' });
    expect([none.status, none.body.message]).toEqual([400, 'no task matches these categories and testers']);
    for (const body of [
      { ...OPEN, title: '' },
      { ...OPEN, title: '   ' },
      { ...OPEN, title: 'א'.repeat(81) },
      { ...OPEN, title: 'שורה\nשנייה' },
      { title: 'בדיקה' },
      { ...OPEN, appVersion: '1'.repeat(41) },
      { ...OPEN, device: 'x'.repeat(81) },
      { ...OPEN, platform: 'web' },
      { ...OPEN, who: 'everyone' },
      { ...OPEN, who: 'both' },
      { ...OPEN, categories: [] },
      { ...OPEN, categories: 'friends' },
    ]) {
      const res = await post(url, '/qa/runs', body);
      expect([body, res.status, res.body.error]).toEqual([body, 400, 'badRequest']);
    }
    expect((await get<AdminPage<AdminQaRun>>(url, '/qa/runs')).body.total).toBe(0);
    // At the limits, and trimmed.
    const edge = await post<AdminQaRun>(url, '/qa/runs', {
      title: ` ${'א'.repeat(80)} `,
      appVersion: '1'.repeat(40),
      device: 'x'.repeat(80),
      platform: 'ios',
    });
    expect([edge.status, edge.body.title]).toEqual([201, 'א'.repeat(80)]);
  });

  it('a snapshot: a later catalog changes neither the run nor its tasks', async () => {
    let url = await start();
    const runId = await openRun(url);
    const before = (await runOf(url, runId)).body;

    const next = testQaCatalog();
    next.catalogVersion = 4;
    next.categories[0]!.title = 'חברים (חדש)';
    next.categories[0]!.subcategories[0]!.tasks[0]!.steps = ['צעד אחר'];
    next.categories[0]!.subcategories[0]!.tasks[0]!.subtitle = 'בדוק משהו אחר';
    next.categories[0]!.subcategories[0]!.tasks.splice(1, 1); // friends-room-join is gone
    url = await start({ catalog: () => next, keepClock: true });
    expect((await runOf(url, runId)).body).toEqual(before);
    // Its tasks are still there to mark, the one the catalog dropped too.
    expect((await mark(url, runId, B, { result: 'pass' })).status).toBe(200);
    // A new run takes the new catalog.
    const fresh = (await runOf(url, await openRun(url))).body;
    expect([fresh.catalogVersion, fresh.items.length, fresh.items[0]?.categoryTitle]).toEqual([
      4,
      5,
      'חברים (חדש)',
    ]);
    expect([fresh.items[0]?.steps, fresh.items[0]?.subtitle]).toEqual([['צעד אחר'], 'בדוק משהו אחר']);
  });
});

// ---- marks --------------------------------------------------------------------------------------------------

describe('marking a task', () => {
  it('pass (the "V") needs nothing else; partial and fail need what happened (400 without)', async () => {
    const url = await start();
    const runId = await openRun(url);
    const v = await mark(url, runId, A, { result: 'pass' });
    expect([v.status, v.body.result, v.body.actual, v.body.bugStatus]).toEqual([200, 'pass', null, null]);
    for (const body of [
      { result: 'fail' },
      { result: 'partial' },
      { result: 'fail', actual: '   ' },
      { result: 'partial', actual: null },
    ]) {
      const res = await mark(url, runId, B, body);
      expect([body, res.status, res.body.error]).toEqual([body, 400, 'badRequest']);
      expect(res.body.message).toMatch(/^actual: required with partial and fail/);
    }
    const failed = await mark(url, runId, B, FAIL);
    expect([failed.status, failed.body.result, failed.body.actual, failed.body.bugStatus]).toEqual([
      200,
      'fail',
      'הכפתור לא הגיב',
      'open',
    ]);
    // A pass may say what happened too.
    expect((await mark(url, runId, C, { result: 'pass', actual: 'עבר מהר' })).body.actual).toBe('עבר מהר');
  });

  it('only the four results, nothing but result, actual and note, and no NUL (400, never a 500)', async () => {
    const url = await start();
    const runId = await openRun(url);
    for (const body of [
      { result: 'passed' },
      { result: 'V' },
      { result: '' },
      { result: null },
      { result: 1 },
      {},
      { result: 'pass', by: 'moshe' },
      { result: 'pass', note: 5 },
      // Postgres keeps no NUL in a text column (trim leaves it in).
      { result: 'fail', actual: 'הכפתור\u0000לא הגיב' },
      { result: 'pass', note: '\u0000' },
    ]) {
      const res = await mark(url, runId, A, body);
      expect([body, res.status, res.body.error]).toEqual([body, 400, 'badRequest']);
    }
    expect((await runOf(url, runId)).body.items[0]?.result).toBe('untested');
    for (const result of ['untested', 'pass', 'partial', 'fail'])
      expect((await mark(url, runId, A, { result, actual: 'קרה משהו' })).body.result).toBe(result);
  });

  it('keeps Hebrew, isolated signed numbers and D5 exactly as sent, trimmed, up to 2000 characters', async () => {
    const url = await start();
    const runId = await openRun(url);
    const actual = `במשבצת D5 הופיע ${LRI}+3${PDI} במקום ${LRI}−8${PDI}\nושורה שנייה: ${LRI}▲12${PDI}`;
    const note = `נבדק ב־Pixel 7, גרסה ${LRI}1.0.5${PDI}`;
    const res = await mark(url, runId, A, { result: 'partial', actual: `  ${actual}\n `, note: ` ${note} ` });
    expect([res.status, res.body.actual, res.body.note]).toEqual([200, actual, note]);
    const item = (await runOf(url, runId)).body.items[0];
    expect([item?.actual, item?.note]).toEqual([actual, note]);

    expect((await mark(url, runId, B, { result: 'fail', actual: 'א'.repeat(2000) })).status).toBe(200);
    for (const body of [
      { result: 'fail', actual: 'א'.repeat(2001) },
      { result: 'pass', note: 'א'.repeat(2001) },
    ]) {
      const tooLong = await mark(url, runId, C, body);
      expect([tooLong.status, tooLong.body.message]).toEqual([400, expect.stringMatching(/at most 2000/)]);
    }
  });

  it('a new mark replaces the last one; untested takes it back: no actual, the note sent kept', async () => {
    const url = await start();
    const runId = await openRun(url);
    await mark(url, runId, A, { ...FAIL, note: 'פעמיים מתוך שלוש' });
    const passed = await mark(url, runId, A, { result: 'pass' });
    expect([passed.body.actual, passed.body.note]).toEqual([null, null]);

    await mark(url, runId, B, { ...FAIL, note: 'הערה' });
    const back = await mark(url, runId, B, { result: 'untested', actual: 'נשאר', note: 'נשאר למשה' });
    expect([back.body.result, back.body.actual, back.body.note, back.body.bugStatus]).toEqual([
      'untested',
      null,
      'נשאר למשה',
      null,
    ]);
  });

  it('records who did it and when: claude for the key, the address for Google, password for the password', async () => {
    let url = await start({ google: true });
    let runId = await openRun(url);
    const byAgent = await mark(url, runId, A, { result: 'pass' });
    expect([byAgent.body.testedBy, byAgent.body.testedAt]).toEqual(['claude', NOW]);
    clock.advance(5000);
    const google = { cookie: await googleCookie(url) };
    const byGoogle = await mark(url, runId, B, { result: 'pass' }, google);
    expect([byGoogle.body.testedBy, byGoogle.body.testedAt]).toEqual([TEST_ADMIN_EMAIL, NOW + 5000]);
    clock.advance(5000);
    const closedByGoogle = await post<AdminQaRun>(url, `/qa/runs/${runId}/close`, {}, google);
    expect([closedByGoogle.status, closedByGoogle.body.closedBy, closedByGoogle.body.closedAt]).toEqual([
      200,
      TEST_ADMIN_EMAIL,
      NOW + 10_000,
    ]);

    // Password sign-in only (a development server): the password writes, as `password`.
    url = await start();
    const password = { cookie: await passwordCookie(url) };
    runId = await openRun(url, OPEN, password);
    const byPassword = await mark(url, runId, A, FAIL, password);
    expect([byPassword.status, byPassword.body.testedBy]).toEqual([200, 'password']);
    clock.advance(1000);
    const fixedByPassword = await fix(url, runId, A, FIXED, password);
    expect([fixedByPassword.status, fixedByPassword.body.handledBy, fixedByPassword.body.handledAt]).toEqual([
      200,
      'password',
      NOW + 1000,
    ]);
    const closedByPassword = await post<AdminQaRun>(url, `/qa/runs/${runId}/close`, {}, password);
    expect([closedByPassword.status, closedByPassword.body.closedBy]).toEqual([200, 'password']);
    expect((await runOf(url, runId)).body.createdBy).toBe('password');
  });

  it('an unknown run or task, a run id that is no number, or a task id that is no id (over 200 characters, a NUL…) → 404', async () => {
    const url = await start();
    const runId = await openRun(url);
    for (const path of [
      `/qa/runs/99/items/${A}/result`,
      `/qa/runs/0/items/${A}/result`,
      `/qa/runs/abc/items/${A}/result`,
      `/qa/runs/1.5/items/${A}/result`,
      `/qa/runs/${runId}/items/nope/result`,
      `/qa/runs/${runId}/items/${'a'.repeat(201)}/result`,
      `/qa/runs/${runId}/items/%00/result`,
      `/qa/runs/${runId}/items/${encodeURIComponent(A.toUpperCase())}/result`,
      `/qa/runs/99/items/${A}/fix`,
      `/qa/runs/${runId}/items/nope/fix`,
      `/qa/runs/${runId}/items/${A}%00/fix`,
      '/qa/runs/99/close',
      '/qa/runs/x/close',
    ]) {
      const body = path.endsWith('/fix') ? FIXED : path.endsWith('/close') ? {} : { result: 'pass' };
      const res = await post(url, path, body);
      expect([path, res.status, res.body.error]).toEqual([path, 404, 'notFound']);
    }
    for (const path of ['/qa/runs/99', '/qa/runs/abc', '/qa/runs/-1', `/qa/runs/${'9'.repeat(12)}`]) {
      expect([path, (await get(url, path)).status]).toEqual([path, 404]);
    }
  });
});

// ---- bugs ---------------------------------------------------------------------------------------------------

describe('bugs', () => {
  it('fail and partial open a bug; pass or untested on a bug never fixed drops it', async () => {
    const url = await start();
    const runId = await openRun(url);
    expect((await mark(url, runId, A, FAIL)).body.bugStatus).toBe('open');
    expect((await mark(url, runId, A, PARTIAL)).body.bugStatus).toBe('open');
    expect((await mark(url, runId, A, { result: 'pass' })).body.bugStatus).toBeNull();
    expect((await mark(url, runId, B, PARTIAL)).body.bugStatus).toBe('open');
    expect((await mark(url, runId, B, { result: 'untested' })).body.bugStatus).toBeNull();
  });

  it('a fix ("טופל"): handled, with what was done, the version and who; again, it replaces the fix', async () => {
    const url = await start({ google: true });
    const runId = await openRun(url);
    await mark(url, runId, A, FAIL);
    clock.advance(60_000);
    const fixed = await fix(url, runId, A, FIXED);
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({
      result: 'fail',
      actual: 'הכפתור לא הגיב',
      bugStatus: 'handled',
      fixNote: 'תוקן הטיפול בלחיצה כפולה',
      fixedIn: '1.0.5 (abc1234)',
      handledBy: 'claude',
      handledAt: NOW + 60_000,
      testedAt: NOW,
    });
    const again = await fix(
      url,
      runId,
      A,
      { fixNote: 'תיקון נוסף בשרת', fixedIn: 'שרת abc1234' },
      { cookie: await googleCookie(url) },
    );
    expect(again.body).toMatchObject({
      bugStatus: 'handled',
      fixNote: 'תיקון נוסף בשרת',
      fixedIn: 'שרת abc1234',
      handledBy: TEST_ADMIN_EMAIL,
    });
  });

  it('a fix only on fail or partial (409 qaNotBug); fixNote and fixedIn required, fixedIn one line of 40', async () => {
    const url = await start();
    const runId = await openRun(url);
    await mark(url, runId, B, { result: 'pass' });
    for (const taskId of [A, B]) {
      const res = await fix(url, runId, taskId, FIXED);
      expect([taskId, res.status, res.body.error]).toEqual([taskId, 409, 'qaNotBug']);
    }
    await mark(url, runId, C, PARTIAL);
    for (const body of [
      { fixNote: 'תוקן' },
      { fixedIn: '1.0.5' },
      { fixNote: '  ', fixedIn: '1.0.5' },
      { fixNote: 'תוקן', fixedIn: '' },
      { fixNote: 'תוקן', fixedIn: '1'.repeat(41) },
      { fixNote: 'תוקן', fixedIn: '1.0.5\nשרת' },
      { fixNote: 'א'.repeat(4001), fixedIn: '1.0.5' },
      { fixNote: 'תוקן\u0000', fixedIn: '1.0.5' },
      { fixNote: 'תוקן', fixedIn: '1.0.5\u0000' },
      { ...FIXED, by: 'claude' },
    ]) {
      const res = await fix(url, runId, C, body);
      expect([body, res.status, res.body.error]).toEqual([body, 400, 'badRequest']);
    }
    const ok = await fix(url, runId, C, { fixNote: ` ${'א'.repeat(4000)} `, fixedIn: ` ${'1'.repeat(40)} ` });
    expect([ok.status, ok.body.fixNote, ok.body.fixedIn]).toEqual([200, 'א'.repeat(4000), '1'.repeat(40)]);
  });

  it('after a fix: pass verifies it, fail or partial reopens it; the fix stays through every mark', async () => {
    const url = await start();
    const runId = await openRun(url);
    await mark(url, runId, A, FAIL);
    await fix(url, runId, A, FIXED);
    const verified = await mark(url, runId, A, { result: 'pass' });
    expect(verified.body).toMatchObject({ result: 'pass', actual: null, bugStatus: 'verified', ...FIXED });

    await mark(url, runId, B, PARTIAL);
    await fix(url, runId, B, FIXED);
    const reopened = await mark(url, runId, B, { result: 'fail', actual: 'עדיין לא עובד' });
    expect(reopened.body).toMatchObject({ actual: 'עדיין לא עובד', bugStatus: 'reopened', ...FIXED });
    expect((await mark(url, runId, B, PARTIAL)).body.bugStatus).toBe('reopened');
    expect((await fix(url, runId, B, { fixNote: 'תיקון שני', fixedIn: '1.0.6' })).body.bugStatus).toBe(
      'handled',
    );
    expect((await mark(url, runId, B, { result: 'pass' })).body).toMatchObject({
      bugStatus: 'verified',
      fixNote: 'תיקון שני',
      fixedIn: '1.0.6',
    });
    // A verified bug that fails again is a new bug.
    expect((await mark(url, runId, A, FAIL)).body).toMatchObject({ bugStatus: 'open', ...FIXED });

    // Untested takes the mark back, never the fix: still handled, with what was done, by whom and when.
    await mark(url, runId, E, PARTIAL);
    await fix(url, runId, E, FIXED);
    clock.advance(1000);
    const back = await mark(url, runId, E, { result: 'untested' });
    expect(back.body).toMatchObject({
      result: 'untested',
      actual: null,
      testedAt: NOW + 1000,
      bugStatus: 'handled',
      ...FIXED,
      handledBy: 'claude',
      handledAt: NOW,
    });
  });

  /**
   * Run 1, every task: A fail (open, at +0), B partial and fixed (handled, +1 s), C failed, fixed and passed
   * (verified, +2 s), D partial, fixed and failed (reopened, +3 s), E pass, F untested.
   */
  async function bugsRun(url: string): Promise<number> {
    const runId = await openRun(url);
    await mark(url, runId, A, { ...FAIL, note: 'רק באנדרואיד' });
    clock.advance(1000);
    await mark(url, runId, B, PARTIAL);
    await fix(url, runId, B, FIXED);
    clock.advance(1000);
    await mark(url, runId, C, FAIL);
    await fix(url, runId, C, FIXED);
    await mark(url, runId, C, { result: 'pass' });
    clock.advance(1000);
    await mark(url, runId, D, PARTIAL);
    await fix(url, runId, D, FIXED);
    await mark(url, runId, D, FAIL);
    await mark(url, runId, E, { result: 'pass' });
    return runId;
  }

  it('GET /qa/bugs: each bug whole, the latest marked first, by status (active by default)', async () => {
    const url = await start();
    await bugsRun(url);
    const bugs = async (query = '') => {
      const res = await get<AdminPage<AdminQaBug>>(url, `/qa/bugs${query}`);
      expect(res.status).toBe(200);
      return res.body;
    };
    const active = await bugs();
    expect([active.items.map((b) => b.taskId), active.total]).toEqual([[D, A], 2]);
    expect(active.items[1]).toEqual({
      run: {
        id: 1,
        title: 'בדיקת גרסה 1.0.5',
        appVersion: '1.0.5',
        device: 'Pixel 7',
        platform: 'android',
        status: 'open',
      },
      taskId: 'friends-room-create',
      categoryTitle: 'חברים',
      subcategoryTitle: 'חדר עם חברים',
      title: 'פתיחת חדר',
      subtitle: 'בדוק פתיחת חדר חדש מלשונית החברים',
      steps: ['פותחים את לשונית "חברים"', 'לוחצים על "פתח חדר"'],
      expected: ['נפתח חדר עם קוד בן 6 תווים', 'הקוד מוצג משמאל לימין'],
      result: 'fail',
      actual: 'הכפתור לא הגיב',
      note: 'רק באנדרואיד',
      testedBy: 'claude',
      testedAt: NOW,
      bugStatus: 'open',
      fixNote: null,
      fixedIn: null,
      handledBy: null,
      handledAt: null,
    });
    expect((await bugs('?status=active')).items.map((b) => b.taskId)).toEqual([D, A]);
    expect((await bugs('?status=open')).items.map((b) => b.taskId)).toEqual([A]);
    expect((await bugs('?status=handled')).items.map((b) => b.taskId)).toEqual([B]);
    expect((await bugs('?status=verified')).items.map((b) => b.taskId)).toEqual([C]);
    expect((await bugs('?status=reopened')).items.map((b) => b.taskId)).toEqual([D]);
    expect((await bugs('?status=all')).items.map((b) => b.taskId)).toEqual([D, C, B, A]);
    expect((await bugs('?status=handled')).items[0]).toMatchObject({ ...FIXED, handledBy: 'claude' });
    const page = await bugs('?status=all&page=2&pageSize=3');
    expect([page.items.map((b) => b.taskId), page.page, page.pageSize, page.total]).toEqual([[A], 2, 3, 4]);
    for (const query of ['?status=closed', '?status=open&status=all', '?pageSize=0']) {
      expect([query, (await get(url, `/qa/bugs${query}`)).status]).toEqual([query, 400]);
    }
  });

  it('GET /qa/bugs gathers the bugs of every run, a closed one’s too, newest first, each with its own run', async () => {
    const url = await start();
    const first = await openRun(url);
    await mark(url, first, A, FAIL);
    clock.advance(1000);
    const second = await openRun(url, {
      title: 'בדיקת גרסה 1.0.6',
      appVersion: '1.0.6',
      device: 'iPhone 13',
      platform: 'ios',
      who: 'moshe',
    });
    await mark(url, second, A, PARTIAL);
    clock.advance(1000);
    await mark(url, first, D, FAIL);
    await post(url, `/qa/runs/${first}/close`, {});

    const run1 = {
      id: first,
      title: 'בדיקת גרסה 1.0.5',
      appVersion: '1.0.5',
      device: 'Pixel 7',
      platform: 'android',
      status: 'closed',
    };
    const run2 = {
      id: second,
      title: 'בדיקת גרסה 1.0.6',
      appVersion: '1.0.6',
      device: 'iPhone 13',
      platform: 'ios',
      status: 'open',
    };
    for (const query of ['', '?status=open', '?status=all']) {
      const bugs = (await get<AdminPage<AdminQaBug>>(url, `/qa/bugs${query}`)).body;
      expect([query, bugs.total]).toEqual([query, 3]);
      expect(bugs.items.map((b) => [b.run, b.taskId, b.result, b.actual, b.testedAt])).toEqual([
        [run1, D, 'fail', FAIL.actual, NOW + 2000],
        [run2, A, 'partial', PARTIAL.actual, NOW + 1000],
        [run1, A, 'fail', FAIL.actual, NOW],
      ]);
    }
  });

  it("a run's counts: by result, open bugs (open and reopened) and handled ones", async () => {
    const url = await start();
    const runId = await bugsRun(url);
    expect((await runOf(url, runId)).body.counts).toEqual({
      total: 6,
      untested: 1,
      pass: 2,
      partial: 1,
      fail: 2,
      openBugs: 2,
      handled: 1,
    });
  });
});

// ---- closing, listing, reading ------------------------------------------------------------------------------

describe('closing a run', () => {
  it('closes it once, by whom and when; closing it again changes nothing (200)', async () => {
    const url = await start({ google: true });
    const runId = await openRun(url);
    clock.advance(3_600_000);
    const closed = await post<AdminQaRun>(url, `/qa/runs/${runId}/close`, {});
    expect([closed.status, closed.body.status, closed.body.closedBy, closed.body.closedAt]).toEqual([
      200,
      'closed',
      'claude',
      NOW + 3_600_000,
    ]);
    // A JSON `{}` only (as application/json; no form, nothing in it).
    for (const [body, type] of [
      ['{}', 'text/plain'],
      ['close=1', 'application/x-www-form-urlencoded'],
      ['{"now": true}', 'application/json'],
    ]) {
      const res = await call(url, 'POST', `/qa/runs/${runId}/close`, { body, type });
      expect([body, res.status, res.body.error]).toEqual([body, 400, 'badRequest']);
    }
    clock.advance(1000);
    const again = await post<AdminQaRun>(
      url,
      `/qa/runs/${runId}/close`,
      {},
      { cookie: await googleCookie(url) },
    );
    expect(again.status).toBe(200);
    expect(again.body).toEqual(closed.body);
  });

  it('a closed run takes no new marks (409 qaRunClosed), but its bugs may be tested again and fixed', async () => {
    const url = await start();
    const runId = await openRun(url);
    await mark(url, runId, A, FAIL); // open
    await mark(url, runId, B, FAIL);
    await fix(url, runId, B, FIXED); // handled
    await mark(url, runId, C, FAIL);
    await fix(url, runId, C, FIXED);
    await mark(url, runId, C, { result: 'pass' }); // verified
    await mark(url, runId, D, PARTIAL);
    await fix(url, runId, D, FIXED);
    await mark(url, runId, D, FAIL); // reopened
    await mark(url, runId, E, { result: 'pass' });
    await post(url, `/qa/runs/${runId}/close`, {});

    for (const [taskId, body] of [
      [F, { result: 'pass' }],
      [E, FAIL],
      [C, FAIL],
    ] as const) {
      const res = await mark(url, runId, taskId, body);
      expect([taskId, res.status, res.body.error]).toEqual([taskId, 409, 'qaRunClosed']);
    }
    expect((await mark(url, runId, B, { result: 'pass' })).body.bugStatus).toBe('verified');
    expect((await mark(url, runId, D, FAIL)).body.bugStatus).toBe('reopened');
    expect((await fix(url, runId, D, FIXED)).body.bugStatus).toBe('handled');
    expect((await mark(url, runId, A, FAIL)).body.bugStatus).toBe('open');
    // A bug dropped (passed before any fix) is no bug any more: closed to marks, and nothing to fix.
    expect((await mark(url, runId, A, { result: 'pass' })).body.bugStatus).toBeNull();
    expect((await mark(url, runId, A, FAIL)).status).toBe(409);
    expect((await fix(url, runId, A, FIXED)).body.error).toBe('qaNotBug');
    expect((await runOf(url, runId)).body.status).toBe('closed');
  });
});

describe('listing and reading runs', () => {
  it('GET /qa/runs: newest first, paged, each with its counts', async () => {
    const url = await start();
    for (const who of ['all', 'claude', 'moshe']) await openRun(url, { ...OPEN, who });
    await mark(url, 2, A, FAIL);
    const all = (await get<AdminPage<AdminQaRun>>(url, '/qa/runs')).body;
    expect([all.items.map((r) => r.id), all.page, all.pageSize, all.total]).toEqual([[3, 2, 1], 1, 50, 3]);
    expect(all.items.map((r) => [r.counts.total, r.counts.fail, r.counts.openBugs])).toEqual([
      [4, 0, 0],
      [3, 1, 1],
      [6, 0, 0],
    ]);
    const second = (await get<AdminPage<AdminQaRun>>(url, '/qa/runs?page=2&pageSize=2')).body;
    expect([second.items.map((r) => r.id), second.total]).toEqual([[1], 3]);
    expect((await get(url, '/qa/runs?page=0')).status).toBe(400);
  });

  it("GET /qa/runs/:runId keeps the tasks asked for (result, who, category, bugs); the counts stay the run's", async () => {
    const url = await start();
    const runId = await openRun(url);
    await mark(url, runId, A, FAIL);
    await mark(url, runId, B, { result: 'pass' });
    await mark(url, runId, D, PARTIAL);
    await fix(url, runId, D, FIXED);
    const whole = (await runOf(url, runId)).body.counts;
    const kept = async (query: string) => {
      const res = await runOf(url, runId, query);
      expect([query, res.status, res.body.counts]).toEqual([query, 200, whole]);
      return taskIds(res.body);
    };
    expect(await kept('?result=fail')).toEqual([A]);
    expect(await kept('?result=untested')).toEqual([C, E, F]);
    expect(await kept('?who=claude')).toEqual([A, B, D]);
    expect(await kept('?who=moshe')).toEqual([A, C, E, F]);
    expect(await kept('?who=all')).toEqual(TEST_QA_TASKS);
    expect(await kept('?category=practice')).toEqual([D, E]);
    expect(await kept('?bugs=1')).toEqual([A, D]);
    expect(await kept('?category=friends&bugs=1')).toEqual([A]);
    expect(await kept('?category=nope')).toEqual([]);
    for (const query of [
      '?result=bad',
      '?who=both',
      '?bugs=yes',
      '?result=pass&result=fail',
      '?category=%00',
      '?category=Friends',
      `?category=${'a'.repeat(81)}`,
    ]) {
      expect([query, (await runOf(url, runId, query)).status]).toEqual([query, 400]);
    }
  });
});
