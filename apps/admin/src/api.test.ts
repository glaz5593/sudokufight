import { ADMIN_ACTION_ERRORS, ADMIN_API_PREFIX, ADMIN_GOOGLE_LOGIN_ERRORS } from '@sudoku-fight/protocol';

import { ApiError, createApi, queryString } from './api';
import { fakeServer, GOOGLE_AND_PASSWORD, GOOGLE_WEB, SIGNED_IN } from './testing/server';

describe('api client', () => {
  it('builds the list URLs the contract names, page size included', async () => {
    const server = fakeServer({ 'GET /installs': { body: { items: [], page: 2, pageSize: 50, total: 0 } } });
    const api = createApi({ fetch: server.fetch });

    await api.installs({ search: 'pixel 7', page: 2 });
    await api.installs({});
    expect(server.gets('/installs')).toEqual([
      `${ADMIN_API_PREFIX}/installs?search=pixel+7&page=2&pageSize=50`,
      `${ADMIN_API_PREFIX}/installs?page=1&pageSize=50`,
    ]);
  });

  it('asks for users, games (mode and search) and the day-based pages', async () => {
    const empty = { body: { items: [], page: 1, pageSize: 50, total: 0 } };
    const server = fakeServer({
      'GET /users': empty,
      'GET /games': empty,
      'GET /overview': { body: {} },
      'GET /screens': { body: {} },
    });
    const api = createApi({ fetch: server.fetch });
    await api.users({ search: 'moshe' });
    await api.games({ mode: 'ranked', search: 'pz', page: 3, pageSize: 20 });
    await api.overview(7);
    await api.screens(90);
    expect(server.requests.map((r) => r.url)).toEqual([
      '/admin/api/users?search=moshe&page=1&pageSize=50',
      '/admin/api/games?mode=ranked&search=pz&page=3&pageSize=20',
      '/admin/api/overview?days=7',
      '/admin/api/screens?days=90',
    ]);
  });

  it('the stealth bot (stealth-bot.md §8): its switch, the personas, the games against it', async () => {
    const empty = { body: { items: [], page: 1, pageSize: 50, total: 0 } };
    const state = { enabled: true, on: false, changedAt: null, changedBy: null };
    const server = fakeServer({
      'GET /stealth': { body: state },
      'POST /stealth/switch': { body: { switch: { ...state, on: true }, audit: null } },
      'GET /users': empty,
      'GET /games': empty,
    });
    const api = createApi({ fetch: server.fetch });
    expect(await api.stealthSwitch()).toEqual(state);
    expect((await api.setStealth(true)).switch.on).toBe(true);
    await api.users({ kind: 'persona', search: 'noa' });
    await api.users({ kind: 'person' });
    await api.users({ kind: 'all' });
    await api.games({ stealth: '1' });
    await api.games({ stealth: '' });
    expect(server.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['GET', '/admin/api/stealth', undefined],
      ['POST', '/admin/api/stealth/switch', { on: true }],
      ['GET', '/admin/api/users?kind=persona&search=noa&page=1&pageSize=50', undefined],
      // The people are the server's default: no kind.
      ['GET', '/admin/api/users?page=1&pageSize=50', undefined],
      ['GET', '/admin/api/users?kind=all&page=1&pageSize=50', undefined],
      ['GET', '/admin/api/games?stealth=1&page=1&pageSize=50', undefined],
      ['GET', '/admin/api/games?page=1&pageSize=50', undefined],
    ]);
  });

  it('asks for the reports (open by default, or by status) and the audit log', async () => {
    const empty = { body: { items: [], page: 1, pageSize: 50, total: 0 } };
    const server = fakeServer({ 'GET /reports': empty, 'GET /audit': empty });
    const api = createApi({ fetch: server.fetch });
    await api.reports({});
    await api.reports({ status: 'all', page: 2, pageSize: 20 });
    await api.audit({});
    await api.audit({ page: 3 });
    expect(server.requests.map((r) => r.url)).toEqual([
      '/admin/api/reports?status=open&page=1&pageSize=50',
      '/admin/api/reports?status=all&page=2&pageSize=20',
      '/admin/api/audit?page=1&pageSize=50',
      '/admin/api/audit?page=3&pageSize=50',
    ]);
  });

  it('posts each moderation action as JSON {} to its path, ids escaped', async () => {
    const ok = { body: {} };
    const server = fakeServer({
      'POST /reports/r%2F1/resolve': ok,
      'POST /reports/r-2/dismiss': ok,
      'POST /users/u-1/reset-name': ok,
      'POST /users/u-1/suspend': ok,
      'POST /users/u-1/unsuspend': ok,
    });
    const api = createApi({ fetch: server.fetch });
    await api.resolveReport('r/1');
    await api.dismissReport('r-2');
    await api.resetName('u-1');
    await api.suspend('u-1');
    await api.unsuspend('u-1');
    expect(server.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['POST', '/admin/api/reports/r%2F1/resolve', {}],
      ['POST', '/admin/api/reports/r-2/dismiss', {}],
      ['POST', '/admin/api/users/u-1/reset-name', {}],
      ['POST', '/admin/api/users/u-1/suspend', {}],
      ['POST', '/admin/api/users/u-1/unsuspend', {}],
    ]);
    for (const req of server.requests) {
      expect(req).toMatchObject({
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    }
  });

  it.each(ADMIN_ACTION_ERRORS)('names a moderation refusal: 409 %s', async (error) => {
    const server = fakeServer({ 'POST /users/u-1/suspend': { status: 409, body: { error } } });
    const api = createApi({ fetch: server.fetch });
    await expect(api.suspend('u-1')).rejects.toMatchObject({ code: error, status: 409 });
  });

  it('escapes ids in detail paths', async () => {
    const server = fakeServer();
    const api = createApi({ fetch: server.fetch });
    await expect(api.user('a/b?c')).rejects.toMatchObject({ code: 'notFound', status: 404 });
    expect(server.requests[0]?.url).toBe('/admin/api/users/a%2Fb%3Fc');
  });

  it('logs in with a JSON body, same-origin credentials, and reads the 204', async () => {
    const server = fakeServer({ 'POST /login': { status: 204 } });
    const api = createApi({ fetch: server.fetch });
    await expect(api.login('s3cret-password')).resolves.toBeUndefined();
    const [req] = server.requests;
    expect(req).toMatchObject({
      method: 'POST',
      body: { password: 's3cret-password' },
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('a 401 from a data route calls onUnauthorized; from login or session it does not', async () => {
    const onUnauthorized = jest.fn();
    const server = fakeServer({
      'GET /overview': { status: 401, body: { error: 'unauthorized' } },
      'POST /login': { status: 401, body: { error: 'unauthorized' } },
      'GET /session': { status: 401, body: { error: 'unauthorized' } },
    });
    const api = createApi({ fetch: server.fetch, onUnauthorized });

    await expect(api.login('wrong')).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(api.session()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onUnauthorized).not.toHaveBeenCalled();

    await expect(api.overview(30)).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reads Retry-After on 429, and names 503 disabled, 500 and a dead server', async () => {
    const server = fakeServer({
      'POST /login': { status: 429, body: { error: 'tooManyRequests' }, headers: { 'Retry-After': '12' } },
      'GET /session': { status: 503, body: { error: 'disabled' } },
      'GET /overview': { status: 500, body: { error: 'internal' } },
      'GET /screens': { status: 502 },
    });
    const api = createApi({ fetch: server.fetch });
    await expect(api.login('x')).rejects.toMatchObject({ code: 'tooManyRequests', retryAfterMs: 12_000 });
    await expect(api.session()).rejects.toMatchObject({ code: 'disabled', status: 503 });
    await expect(api.overview(30)).rejects.toMatchObject({ code: 'internal', status: 500 });
    await expect(api.screens(30)).rejects.toMatchObject({ code: 'server', status: 502 });

    const dead = createApi({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(dead.session()).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('asks for the ways to sign in without a session check, and posts a Google sign-in token', async () => {
    const onUnauthorized = jest.fn();
    const server = fakeServer({
      'GET /auth/methods': GOOGLE_AND_PASSWORD,
      'POST /login/google': { status: 204 },
    });
    const api = createApi({ fetch: server.fetch, onUnauthorized });

    await expect(api.authMethods()).resolves.toEqual({ password: true, google: GOOGLE_WEB });
    await expect(api.loginWithGoogle('firebase-id-token')).resolves.toBeUndefined();
    expect(server.requests).toMatchObject([
      { method: 'GET', url: '/admin/api/auth/methods', credentials: 'same-origin' },
      {
        method: 'POST',
        url: '/admin/api/login/google',
        body: { idToken: 'firebase-id-token' },
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      },
    ]);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'badRequest'],
    [413, 'tooLarge'],
    [401, 'invalidToken'],
    [403, 'wrongProvider'],
    [403, 'unverifiedEmail'],
    [403, 'notAllowed'],
    [403, 'disabled'],
    [503, 'disabled'],
    [429, 'tooManyRequests'],
    [503, 'unavailable'],
    [500, 'internal'],
  ] as const)('names a Google sign-in refusal: %i %s', async (status, error) => {
    const onUnauthorized = jest.fn();
    const server = fakeServer({ 'POST /login/google': { status, body: { error, message: 'why' } } });
    const api = createApi({ fetch: server.fetch, onUnauthorized });
    await expect(api.loginWithGoogle('t')).rejects.toMatchObject({ code: error, status, message: 'why' });
    // A refused token is not a session that ran out.
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('every Google sign-in error of the contract is a code the client names', async () => {
    for (const error of ADMIN_GOOGLE_LOGIN_ERRORS) {
      const api = createApi({
        fetch: fakeServer({ 'POST /login/google': { status: 403, body: { error } } }).fetch,
      });
      await expect(api.loginWithGoogle('t')).rejects.toMatchObject({ code: error });
    }
  });

  it('returns the session', async () => {
    const api = createApi({ fetch: fakeServer({ 'GET /session': SIGNED_IN }).fetch });
    await expect(api.session()).resolves.toMatchObject({ ok: true });
  });

  it('queryString leaves out empty values', () => {
    expect(queryString({ a: '', b: undefined, c: 0, d: 'x y' })).toBe('?c=0&d=x+y');
    expect(queryString({})).toBe('');
  });
});
