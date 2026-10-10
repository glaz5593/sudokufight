import { ADMIN_API_PREFIX } from '@sudoku-fight/protocol';

import type { ServerConfig } from '../config';
import {
  adminLogin,
  createTestDb,
  fakeClock,
  type FakeClock,
  getUrl,
  signedInAdmin,
  startHttp,
  type TestDb,
  type TestHttp,
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
  testConfig,
} from '../testing';
import { ADMIN_COOKIE_NAME, ADMIN_SESSION_TTL_MS } from './constants';
import { ADMIN_CSP } from './router';
import { SessionKeeper } from './session';

const NOW = Date.UTC(2026, 9, 9, 12);
const API = ADMIN_API_PREFIX;
const DATA_ROUTES = [
  '/overview',
  '/screens',
  '/installs',
  '/installs/x',
  '/users',
  '/users/x',
  '/games',
  '/games/x',
];

let t: TestDb;
let clock: FakeClock;
let http: TestHttp | undefined;

beforeAll(async () => {
  t = await createTestDb();
}, 30_000); // a cold PGlite takes seconds when many suites start at once
afterAll(() => t.close());
afterEach(async () => {
  await http?.close();
  http = undefined;
});

async function start(config: ServerConfig = testConfig()) {
  clock = fakeClock(NOW);
  http = await startHttp({ config, db: t.db, now: clock.now, adminSiteDir: null });
  return http.url;
}

const getWith = (url: string, path: string, cookie?: string) =>
  getUrl(`${url}${API}${path}`, cookie === undefined ? {} : { cookie });

describe('admin sign-in', () => {
  it('without a session every route answers 401 unauthorized', async () => {
    const url = await start();
    for (const path of ['/session', ...DATA_ROUTES, '/nope']) {
      const res = await getWith(url, path);
      expect({ path, status: res.status, body: res.body }).toEqual({
        path,
        status: 401,
        body: { error: 'unauthorized' },
      });
    }
  });

  it('the right password → 204 and an HttpOnly, SameSite=Strict cookie for /admin, 12 h', async () => {
    const url = await start();
    const login = await adminLogin(url);
    expect(login.status).toBe(204);
    const cookie = login.setCookie ?? '';
    expect(cookie).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=\\d+\\.[\\w-]{22}\\.[\\w-]{43};`));
    expect(cookie).toContain('Path=/admin');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Max-Age=${ADMIN_SESSION_TTL_MS / 1000}`);
    expect(cookie).not.toContain('Secure');

    const session = await getWith(url, '/session', login.cookie);
    expect(session).toMatchObject({ status: 200, body: { ok: true, expiresAt: NOW + ADMIN_SESSION_TTL_MS } });
    for (const path of ['/overview', '/screens', '/installs', '/users', '/games']) {
      expect({ path, status: (await getWith(url, path, login.cookie)).status }).toEqual({
        path,
        status: 200,
      });
    }
  });

  it('the cookie is Secure in production', async () => {
    const url = await start(testConfig({ nodeEnv: 'production' }));
    const login = await adminLogin(url);
    expect(login.status).toBe(204);
    expect(login.setCookie).toContain('Secure');
  });

  it('a wrong password → 401; a body that is not {password: string} → 400', async () => {
    const url = await start();
    expect(await adminLogin(url, { password: 'wrong' })).toMatchObject({
      status: 401,
      body: { error: 'unauthorized' },
      cookie: '',
    });
    expect(await adminLogin(url, { password: `${TEST_ADMIN_PASSWORD} ` })).toMatchObject({ status: 401 });
    expect(await adminLogin(url, { password: 123 })).toMatchObject({
      status: 400,
      body: { error: 'badRequest' },
    });
    expect(await adminLogin(url, {})).toMatchObject({ status: 400 });
  });

  it('the login body must be JSON: a form post or broken JSON is refused, a huge one too', async () => {
    const url = await start();
    const post = (body: string, contentType: string) =>
      fetch(`${url}${API}/login`, { method: 'POST', headers: { 'content-type': contentType }, body });
    const form = await post(`password=${TEST_ADMIN_PASSWORD}`, 'application/x-www-form-urlencoded');
    expect(form.status).toBe(400);
    expect(form.headers.get('set-cookie')).toBeNull();
    const broken = await post('{"password":', 'application/json');
    expect([broken.status, await broken.json()]).toEqual([
      400,
      { error: 'badRequest', message: 'invalid JSON' },
    ]);
    const huge = await post(JSON.stringify({ password: 'x'.repeat(5000) }), 'application/json');
    expect([huge.status, await huge.json()]).toEqual([413, { error: 'tooLarge' }]);
  });

  it('more than 5 tries a minute from one IP → 429 with Retry-After, even with the right password', async () => {
    const url = await start();
    for (let i = 0; i < 5; i++) expect((await adminLogin(url, { password: `wrong${i}` })).status).toBe(401);
    const blocked = await adminLogin(url);
    expect(blocked).toMatchObject({ status: 429, body: { error: 'tooManyRequests' }, cookie: '' });
    expect(blocked.headers.get('retry-after')).toBe('12');
    clock.advance(12_000);
    expect((await adminLogin(url)).status).toBe(204);
    expect((await adminLogin(url)).status).toBe(429);
  });

  it('the limit counts an IPv6 /64 as one address, so rotating addresses does not help', async () => {
    const url = await start(testConfig({ trustProxy: true })); // req.ip from X-Forwarded-For
    const loginFrom = async (ip: string) => {
      const res = await fetch(`${url}${API}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ password: 'wrong' }),
      });
      return res.status;
    };
    for (let i = 1; i <= 5; i++) expect(await loginFrom(`2001:db8:1:2::${i}`)).toBe(401);
    expect(await loginFrom('2001:db8:1:2:abcd::99')).toBe(429);
    expect(await loginFrom('2001:db8:1:3::1')).toBe(401); // the next /64 is someone else
  });

  it('a session runs out after 12 hours', async () => {
    const url = await start();
    const { cookie } = await adminLogin(url);
    clock.advance(ADMIN_SESSION_TTL_MS - 1);
    expect((await getWith(url, '/overview', cookie)).status).toBe(200);
    clock.advance(1);
    expect((await getWith(url, '/session', cookie)).status).toBe(401);
    expect((await getWith(url, '/overview', cookie)).status).toBe(401);
  });

  it('a tampered, foreign or garbled cookie → 401', async () => {
    const url = await start();
    const { cookie } = await adminLogin(url);
    const value = cookie.slice(ADMIN_COOKIE_NAME.length + 1);
    const [exp, nonce, mac] = value.split('.') as [string, string, string];
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const later = String(Number(exp) + 365 * 24 * 3_600_000);
    const otherSecret = new SessionKeeper({
      secret: 'another-secret-0123456789abcdef-xyz',
      password: TEST_ADMIN_PASSWORD,
      ttlMs: ADMIN_SESSION_TTL_MS,
      now: clock.now,
    }).issue().token;
    const otherPassword = new SessionKeeper({
      secret: TEST_SESSION_SECRET,
      password: 'an-older-password',
      ttlMs: ADMIN_SESSION_TTL_MS,
      now: clock.now,
    }).issue().token;
    for (const bad of [
      `${exp}.${nonce}.${flip(mac)}`,
      `${later}.${nonce}.${mac}`,
      `${exp}.${flip(nonce)}.${mac}`,
      otherSecret,
      otherPassword,
      `${exp}.${nonce}`,
      'garbage',
      '',
    ]) {
      const res = await getWith(url, '/session', `${ADMIN_COOKIE_NAME}=${bad}`);
      expect({ bad, status: res.status }).toEqual({ bad, status: 401 });
    }
    // The right token under another cookie name is not a session either.
    expect((await getWith(url, '/session', `other=${value}`)).status).toBe(401);
    expect((await getWith(url, '/session', `a=1; ${cookie}; b=2`)).status).toBe(200);
  });

  it('logout clears the cookie, and the old token is refused from then on', async () => {
    const url = await start();
    const { cookie } = await adminLogin(url);
    const res = await fetch(`${url}${API}/logout`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(204);
    const cleared = res.headers.get('set-cookie') ?? '';
    expect(cleared).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=;`));
    expect(cleared).toContain('Path=/admin');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    expect((await getWith(url, '/session', cookie)).status).toBe(401);
    expect((await getWith(url, '/users', cookie)).status).toBe(401);
    // Logging out again, or without a session, is harmless.
    expect((await fetch(`${url}${API}/logout`, { method: 'POST' })).status).toBe(204);
  });

  it('read-only: only GET (and login/logout); anything else is 404', async () => {
    const url = await start();
    const admin = await signedInAdmin(url);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${url}${API}/users`, { method, headers: { cookie: admin.cookie } });
      expect({ method, status: res.status }).toEqual({ method, status: 404 });
    }
    expect(await admin.get('/nope')).toMatchObject({ status: 404, body: { error: 'notFound' } });
  });

  it('answers are never cached and carry the hardening headers', async () => {
    const url = await start();
    const admin = await signedInAdmin(url);
    for (const res of [await admin.get('/overview'), await getWith(url, '/overview')]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toBe(ADMIN_CSP);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});

describe('admin turned off in the settings', () => {
  it('every route answers 503 disabled, login included', async () => {
    const url = await start(
      testConfig({ admin: { enabled: false, reason: 'ADMIN_PASSWORD is not set', sessionSecret: 'x' } }),
    );
    for (const path of ['/session', ...DATA_ROUTES]) {
      expect({ path, ...(await getWith(url, path)) }).toMatchObject({
        path,
        status: 503,
        body: { error: 'disabled' },
      });
    }
    expect(await adminLogin(url)).toMatchObject({ status: 503, body: { error: 'disabled' }, cookie: '' });
  });
});
