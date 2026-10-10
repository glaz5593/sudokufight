import { ADMIN_API_PREFIX } from '@sudoku-fight/protocol';

import { ApiError, createApi, queryString } from './api';
import { fakeServer, SIGNED_IN } from './testing/server';

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

  it('returns the session', async () => {
    const api = createApi({ fetch: fakeServer({ 'GET /session': SIGNED_IN }).fetch });
    await expect(api.session()).resolves.toMatchObject({ ok: true });
  });

  it('queryString leaves out empty values', () => {
    expect(queryString({ a: '', b: undefined, c: 0, d: 'x y' })).toBe('?c=0&d=x+y');
    expect(queryString({})).toBe('');
  });
});
