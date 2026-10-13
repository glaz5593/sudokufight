import {
  ADMIN_API_PREFIX,
  type AdminAuthMethods,
  type AdminGoogleLoginRequest,
  type AdminSession,
} from '@sudoku-fight/protocol';

import type { AdminConfig, ServerConfig } from '../config';
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
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
  TEST_WEB_API_KEY,
  testConfig,
  testGoogleAdmin,
} from '../testing';
import { TEST_FIREBASE_PROJECT_ID } from '../testing/config';
import { testTokens, type TestTokens, type TokenClaims } from '../testing/tokens';
import { ADMIN_COOKIE_NAME, ADMIN_GOOGLE_MAX_AUTH_AGE_MS, ADMIN_SESSION_TTL_MS } from './constants';
import { ADMIN_CSP, adminCsp } from './router';
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
let tokens: TestTokens;
let clock: FakeClock;
let http: TestHttp | undefined;
/** What the admin router logged (sign-ins). */
let logged: string[] = [];

beforeAll(async () => {
  t = await createTestDb();
  tokens = await testTokens();
}, 30_000); // a cold PGlite takes seconds when many suites start at once
afterAll(() => t.close());
afterEach(async () => {
  await http?.close();
  http = undefined;
});

async function start(config: ServerConfig = testConfig()) {
  clock = fakeClock(NOW);
  logged = [];
  http = await startHttp({
    config,
    db: t.db,
    now: clock.now,
    adminSiteDir: null,
    // The test project's tokens, signed with this file's keys; development tokens too (outside production).
    tokens: tokens.verifier(clock.now),
    adminLog: (message) => logged.push(message),
  });
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
    expect(cookie).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=\\d+\\.[\\w-]{22}\\.[\\w-]+\\.[\\w-]{43};`));
    expect(cookie).toContain('Path=/admin');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Max-Age=${ADMIN_SESSION_TTL_MS / 1000}`);
    expect(cookie).not.toContain('Secure');
    expect(logged).toEqual(['[admin] admin sign-in: password']);

    const session = await getWith(url, '/session', login.cookie);
    expect(session).toEqual({
      status: 200,
      body: { ok: true, expiresAt: NOW + ADMIN_SESSION_TTL_MS, method: 'password', email: null },
      headers: expect.anything(),
    });
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
    const [exp, nonce, who, mac] = value.split('.') as [string, string, string, string];
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const later = String(Number(exp) + 365 * 24 * 3_600_000);
    const otherSecret = new SessionKeeper({
      secret: 'another-secret-0123456789abcdef-xyz',
      password: TEST_ADMIN_PASSWORD,
      ttlMs: ADMIN_SESSION_TTL_MS,
      now: clock.now,
    }).issue({ method: 'password' }).token;
    const otherPassword = new SessionKeeper({
      secret: TEST_SESSION_SECRET,
      password: 'an-older-password',
      ttlMs: ADMIN_SESSION_TTL_MS,
      now: clock.now,
    }).issue({ method: 'password' }).token;
    const googleWho = Buffer.from(`google:${TEST_ADMIN_EMAIL}`).toString('base64url');
    for (const bad of [
      `${exp}.${nonce}.${who}.${flip(mac)}`,
      `${later}.${nonce}.${who}.${mac}`,
      `${exp}.${flip(nonce)}.${who}.${mac}`,
      `${exp}.${nonce}.${googleWho}.${mac}`,
      `${exp}.${nonce}.${mac}`,
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
    for (const path of ['/session', '/auth/methods', ...DATA_ROUTES]) {
      expect({ path, ...(await getWith(url, path)) }).toMatchObject({
        path,
        status: 503,
        body: { error: 'disabled' },
      });
    }
    expect(await adminLogin(url)).toMatchObject({ status: 503, body: { error: 'disabled' }, cookie: '' });
    expect(await googleLogin(url, { idToken: 'x' })).toMatchObject({
      status: 503,
      body: { error: 'disabled' },
    });
  });
});

// ---- Google sign-in -----------------------------------------------------------------------------------------

/** The admin settings with Google sign-in for these addresses, and the test password unless `password: null`. */
function googleAdmin(
  allowed: readonly string[] = [TEST_ADMIN_EMAIL],
  password: string | null = TEST_ADMIN_PASSWORD,
): AdminConfig {
  return {
    enabled: true,
    password,
    devPassword: false,
    google: testGoogleAdmin(allowed),
    sessionSecret: TEST_SESSION_SECRET,
  };
}

/** POST /admin/api/login/google with this body (anything, as JSON). */
async function googleLogin(url: string, body: AdminGoogleLoginRequest | Record<string, unknown>) {
  const res = await fetch(`${url}${API}/login/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text === '' ? null : (JSON.parse(text) as unknown),
    headers: res.headers,
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
  };
}

/** A Firebase ID token of a Google sign-in (verified address) unless the claims say otherwise. */
const googleToken = (claims: TokenClaims = {}) =>
  tokens.sign(
    { uid: 'google-uid-1', email: TEST_ADMIN_EMAIL, provider: 'google.com', ...claims },
    clock.now(),
  );

describe('admin Google sign-in', () => {
  it('GET /auth/methods: public; the web config for the page, and never the allowed addresses', async () => {
    const allowed = [TEST_ADMIN_EMAIL, 'second.admin@example.org', 'third@example.net'];
    const url = await start(testConfig({ admin: googleAdmin(allowed) }));
    const res = await getWith(url, '/auth/methods');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toEqual({
      password: true,
      google: {
        apiKey: TEST_WEB_API_KEY,
        authDomain: `${TEST_FIREBASE_PROJECT_ID}.firebaseapp.com`,
        projectId: TEST_FIREBASE_PROJECT_ID,
        appId: '1:123456789012:web:0123456789abcdef',
      },
    } satisfies AdminAuthMethods);
    const text = JSON.stringify(res.body);
    for (const address of allowed) {
      expect(text).not.toContain(address);
      expect(text).not.toContain(address.split('@')[0]!);
    }
    expect(text).not.toMatch(/@/);

    // Google only, password only.
    await http?.close();
    const googleOnly = await start(testConfig({ admin: googleAdmin(allowed, null) }));
    expect((await getWith(googleOnly, '/auth/methods')).body).toMatchObject({ password: false, google: {} });
    await http?.close();
    const passwordOnly = await start();
    expect((await getWith(passwordOnly, '/auth/methods')).body).toEqual({ password: true, google: null });
  });

  it('an allowed, verified Google token → 204 and the session cookie, with the address in the session', async () => {
    const url = await start(testConfig({ admin: googleAdmin() }));
    const login = await googleLogin(url, { idToken: await googleToken() });
    expect([login.status, login.body]).toEqual([204, null]);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=\\d+\\.[\\w-]{22}\\.[\\w-]+\\.[\\w-]{43};`));
    for (const part of [
      'Path=/admin',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${ADMIN_SESSION_TTL_MS / 1000}`,
    ])
      expect(setCookie).toContain(part);
    expect(logged).toEqual([`[admin] admin sign-in: ${TEST_ADMIN_EMAIL}`]);

    const session = await getWith(url, '/session', login.cookie);
    expect(session.body).toEqual({
      ok: true,
      expiresAt: NOW + ADMIN_SESSION_TTL_MS,
      method: 'google',
      email: TEST_ADMIN_EMAIL,
    } satisfies AdminSession);
    for (const path of ['/overview', '/users', '/games'])
      expect({ path, status: (await getWith(url, path, login.cookie)).status }).toEqual({
        path,
        status: 200,
      });

    // Logout as with the password.
    await fetch(`${url}${API}/logout`, { method: 'POST', headers: { cookie: login.cookie } });
    expect((await getWith(url, '/session', login.cookie)).status).toBe(401);
  });

  it('the address is compared without case', async () => {
    const url = await start(testConfig({ admin: googleAdmin(['dana.admin@example.com']) }));
    const login = await googleLogin(url, { idToken: await googleToken({ email: 'Dana.Admin@Example.COM' }) });
    expect(login.status).toBe(204);
    expect((await getWith(url, '/session', login.cookie)).body).toMatchObject({
      method: 'google',
      email: 'dana.admin@example.com',
    });
    expect(logged).toEqual(['[admin] admin sign-in: dana.admin@example.com']);
  });

  it('works with Google sign-in only (no password on the server); the password route says it is off', async () => {
    const url = await start(testConfig({ admin: googleAdmin(undefined, null) }));
    expect((await googleLogin(url, { idToken: await googleToken() })).status).toBe(204);
    expect(await adminLogin(url)).toMatchObject({
      status: 403,
      body: { error: 'disabled', message: expect.stringMatching(/password sign-in is off/) },
      cookie: '',
    });
  });

  it('an address not on the list → 403 notAllowed, no cookie, and the log does not name it', async () => {
    const url = await start(testConfig({ admin: googleAdmin() }));
    const login = await googleLogin(url, { idToken: await googleToken({ email: 'intruder@example.com' }) });
    expect(login).toMatchObject({ status: 403, body: { error: 'notAllowed' }, cookie: '' });
    expect(logged.join('\n')).not.toContain('intruder');
    // Close is not equal: a longer or shorter address, or the list's domain alone.
    for (const email of [`x${TEST_ADMIN_EMAIL}`, `${TEST_ADMIN_EMAIL}.evil.example`, 'admin@example.co']) {
      const r = await googleLogin(url, { idToken: await googleToken({ email }) });
      expect({ email, status: r.status, body: r.body }).toMatchObject({
        email,
        status: 403,
        body: { error: 'notAllowed' },
      });
      clock.advance(12_000); // stay under the sign-in limit
    }
  });

  it('an address Google does not vouch for (email_verified false or missing) → 403 unverifiedEmail', async () => {
    const url = await start(testConfig({ admin: googleAdmin() }));
    const unverified = await googleLogin(url, { idToken: await googleToken({ emailVerified: false }) });
    expect(unverified).toMatchObject({ status: 403, body: { error: 'unverifiedEmail' }, cookie: '' });
    const missing = await googleLogin(url, {
      idToken: await googleToken({ extra: { email_verified: undefined } }),
    });
    expect(missing).toMatchObject({ status: 403, body: { error: 'unverifiedEmail' } });
    const text = await googleLogin(url, {
      idToken: await googleToken({ extra: { email_verified: 'true' } }),
    });
    expect(text).toMatchObject({ status: 403, body: { error: 'unverifiedEmail' } });
    const noEmail = await googleLogin(url, { idToken: await googleToken({ email: null }) });
    expect(noEmail).toMatchObject({ status: 403, body: { error: 'unverifiedEmail' } });
  });

  it('a token from another sign-in (email and password, anonymous…) → 403 wrongProvider, even for an allowed address', async () => {
    const url = await start(testConfig({ admin: googleAdmin() }));
    for (const provider of ['password', 'anonymous', 'apple.com']) {
      const r = await googleLogin(url, { idToken: await googleToken({ provider }) });
      expect({ provider, status: r.status, body: r.body }).toMatchObject({
        provider,
        status: 403,
        body: { error: 'wrongProvider' },
      });
    }
    const none = await googleLogin(url, { idToken: await googleToken({ extra: { firebase: undefined } }) });
    expect(none).toMatchObject({ status: 403, body: { error: 'wrongProvider' } });
    clock.advance(60_000);
    // A development token never signs an admin in, even where the app takes them.
    const dev = await googleLogin(url, { idToken: `dev:ana:${TEST_ADMIN_EMAIL}` });
    expect(dev).toMatchObject({ status: 401, body: { error: 'invalidToken' }, cookie: '' });
  });

  it('a bad, forged, expired or foreign token → 401 invalidToken', async () => {
    const url = await start(testConfig({ admin: googleAdmin() }));
    const expired = await googleToken();
    const cases: [string, string][] = [
      ['garbage', 'not-a-token'],
      ['wrong audience', await googleToken({ extra: { aud: 'someone-else' } })],
      ['wrong issuer', await googleToken({ extra: { iss: 'https://securetoken.google.com/someone-else' } })],
      [
        'unknown key',
        await tokens.sign({ email: TEST_ADMIN_EMAIL, provider: 'google.com' }, NOW, { kid: 'nope' }),
      ],
    ];
    for (const [why, idToken] of cases) {
      const r = await googleLogin(url, { idToken });
      expect({
        why,
        status: r.status,
        error: (r.body as { error?: string }).error,
        cookie: r.cookie,
      }).toEqual({
        why,
        status: 401,
        error: 'invalidToken',
        cookie: '',
      });
    }
    clock.advance(2 * 3600_000); // the token ran out an hour ago; the limit's bucket is full again too
    const late = await googleLogin(url, { idToken: expired });
    expect(late).toMatchObject({
      status: 401,
      body: { error: 'invalidToken', message: expect.stringMatching(/expired/) },
    });
  });

  it('a sign-in more than 5 minutes old → 401 invalidToken, even in a token issued just now (refreshed)', async () => {
    expect(ADMIN_GOOGLE_MAX_AUTH_AGE_MS).toBe(5 * 60_000);
    const url = await start(testConfig({ admin: googleAdmin() }));
    // Issued now (iat), for a Google sign-in this long ago (auth_time, which a refreshed token keeps).
    const signedInAgo = (ms: number) =>
      googleToken({ extra: { auth_time: Math.floor((clock.now() - ms) / 1000) } });
    for (const ago of [30 * 24 * 3600_000, ADMIN_GOOGLE_MAX_AUTH_AGE_MS + 1000]) {
      const r = await googleLogin(url, { idToken: await signedInAgo(ago) });
      expect({ ago, status: r.status, body: r.body, cookie: r.cookie }).toEqual({
        ago,
        status: 401,
        body: { error: 'invalidToken', message: 'the Google sign-in is too old: sign in again' },
        cookie: '',
      });
    }
    expect(logged).toEqual([]);
    // Right at the limit: in.
    const fresh = await googleLogin(url, { idToken: await signedInAgo(ADMIN_GOOGLE_MAX_AUTH_AGE_MS) });
    expect(fresh.status).toBe(204);
    expect(logged).toEqual([`[admin] admin sign-in: ${TEST_ADMIN_EMAIL}`]);
  });

  it('a body that is not {idToken: string} → 400; a huge one → 413', async () => {
    const url = await start(testConfig({ admin: googleAdmin() }));
    for (const body of [{}, { idToken: '' }, { idToken: 42 }, { token: 'x' }]) {
      const r = await googleLogin(url, body);
      expect({ body, status: r.status, error: (r.body as { error?: string }).error }).toEqual({
        body,
        status: 400,
        error: 'badRequest',
      });
    }
    clock.advance(60_000);
    const huge = await googleLogin(url, { idToken: 'x'.repeat(10_000) });
    expect(huge).toMatchObject({ status: 413, body: { error: 'tooLarge' } });
    const form = await fetch(`${url}${API}/login/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'idToken=x',
    });
    expect(form.status).toBe(400);
  });

  it("answers 503 unavailable when Google's keys can't be reached", async () => {
    clock = fakeClock(NOW);
    logged = [];
    const keysDown = {
      projectId: TEST_FIREBASE_PROJECT_ID,
      devTokens: false,
      verifyIdToken: () =>
        Promise.resolve({ ok: false as const, failure: 'unavailable' as const, message: 'down' }),
    };
    http = await startHttp({
      config: testConfig({ admin: googleAdmin() }),
      db: t.db,
      now: clock.now,
      adminSiteDir: null,
      tokens: keysDown,
      adminLog: (m) => logged.push(m),
    });
    const r = await googleLogin(http.url, { idToken: await googleToken() });
    expect(r).toMatchObject({ status: 503, body: { error: 'unavailable' }, cookie: '' });
  });

  it('Google sign-in off on the server → 403 disabled', async () => {
    const url = await start(); // password only
    const r = await googleLogin(url, { idToken: await googleToken() });
    expect(r).toMatchObject({ status: 403, body: { error: 'disabled' }, cookie: '' });
  });

  it('shares the per-IP limit with the password: 5 tries a minute in all, then 429 with Retry-After', async () => {
    const url = await start(testConfig({ admin: googleAdmin() }));
    for (let i = 0; i < 3; i++) expect((await adminLogin(url, { password: `wrong${i}` })).status).toBe(401);
    for (let i = 0; i < 2; i++)
      expect(
        (await googleLogin(url, { idToken: await googleToken({ email: 'other@example.com' }) })).status,
      ).toBe(403);
    const blocked = await googleLogin(url, { idToken: await googleToken() });
    expect(blocked).toMatchObject({ status: 429, body: { error: 'tooManyRequests' }, cookie: '' });
    expect(blocked.headers.get('retry-after')).toBe('12');
    expect((await adminLogin(url)).status).toBe(429);
    clock.advance(12_000);
    expect((await googleLogin(url, { idToken: await googleToken() })).status).toBe(204);
  });

  it('a session ends when its address leaves the list, or its method is turned off', async () => {
    const config = testConfig({ admin: googleAdmin() });
    const url = await start(config);
    const google = await googleLogin(url, { idToken: await googleToken() });
    const password = await adminLogin(url);
    expect((await getWith(url, '/session', google.cookie)).status).toBe(200);
    expect((await getWith(url, '/session', password.cookie)).status).toBe(200);
    await http?.close();

    // Same secret and password, the address taken off the list: the Google session is over, the password's not.
    const fewer = await start(testConfig({ admin: googleAdmin(['someone.else@example.com']) }));
    expect((await getWith(fewer, '/session', google.cookie)).status).toBe(401);
    expect((await getWith(fewer, '/overview', google.cookie)).status).toBe(401);
    expect((await getWith(fewer, '/session', password.cookie)).status).toBe(200);
    await http?.close();

    // Google sign-in off: its sessions end too.
    const noGoogle = await start(testConfig({ admin: { ...googleAdmin(), google: null } as AdminConfig }));
    expect((await getWith(noGoogle, '/session', google.cookie)).status).toBe(401);
    expect((await getWith(noGoogle, '/session', password.cookie)).status).toBe(200);
  });

  it('the CSP lets the Firebase popup work, only when Google sign-in is on', async () => {
    const web = testGoogleAdmin().web;
    const csp = adminCsp(web);
    expect(csp).toContain("script-src 'self' https://apis.google.com;");
    expect(csp).toContain(`frame-src https://${TEST_FIREBASE_PROJECT_ID}.firebaseapp.com;`);
    expect(csp).toContain(
      "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;",
    );
    expect(csp).toMatch(/^default-src 'none';/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-|\*/);
    expect(ADMIN_CSP).not.toMatch(/apis\.google\.com|identitytoolkit|securetoken|firebaseapp|frame-src/);

    const url = await start(testConfig({ admin: googleAdmin() }));
    const res = await getWith(url, '/auth/methods');
    expect(res.headers.get('content-security-policy')).toBe(csp);
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    await http?.close();
    const plain = await start();
    const plainRes = await getWith(plain, '/auth/methods');
    expect(plainRes.headers.get('content-security-policy')).toBe(ADMIN_CSP);
    expect(plainRes.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });
});
