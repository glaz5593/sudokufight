import type { AddressInfo } from 'node:net';

import { ACCOUNT_PATHS, devToken, type Me } from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { call, fighter } from '../src/testing/accounts';
import { testConfig } from '../src/testing/config';

/**
 * The account routes on the real server (Colyseus in front of Express), with the token verifier the server
 * builds for its settings. Development tokens only: a Firebase token would send this verifier to Google.
 */

describe('accounts on the real server', () => {
  const server = createAppServer({ gracefullyShutdown: false, config: testConfig() });
  let base = '';

  beforeAll(async () => {
    await server.listen(0);
    base = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
  }, 30_000);

  afterAll(async () => {
    await server.gracefullyShutdown(false);
    // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
    await new Promise((r) => setTimeout(r, 1100));
  });

  const close = { connection: 'close' };

  it('registers, answers me, changes and deletes with a development token', async () => {
    const token = devToken('e2e_user', 'e2e@example.com');
    expect(
      await call(base, 'GET', `${ACCOUNT_PATHS.namesAvailable}?name=E2E_Player`, { headers: close }),
    ).toMatchObject({
      status: 200,
      body: { available: true },
    });
    const created = await call<Me>(base, 'POST', ACCOUNT_PATHS.users, {
      token,
      body: fighter({ displayName: 'E2E_Player' }),
      headers: close,
    });
    expect(created).toMatchObject({
      status: 201,
      body: { displayName: 'E2E_Player', email: 'e2e@example.com' },
    });
    expect(await call(base, 'GET', ACCOUNT_PATHS.me, { token, headers: close })).toMatchObject({
      status: 200,
      body: { id: created.body.id },
    });
    expect(
      await call(base, 'PATCH', ACCOUNT_PATHS.me, { token, body: { avatarId: 'av02' }, headers: close }),
    ).toMatchObject({ status: 200, body: { avatarId: 'av02' } });
    expect((await call(base, 'DELETE', ACCOUNT_PATHS.me, { token, headers: close })).status).toBe(204);
    expect((await call(base, 'GET', ACCOUNT_PATHS.me, { token, headers: close })).status).toBe(404);
  });

  it("keeps Colyseus's open CORS headers off the account routes, and lists PATCH and DELETE", async () => {
    const origin = 'https://elsewhere.example';
    const res = await fetch(`${base}${ACCOUNT_PATHS.namesAvailable}?name=Someone`, {
      headers: { origin, ...close },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${base}${ACCOUNT_PATHS.me}`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'DELETE', ...close },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.headers.get('allow')).toContain('PATCH, DELETE');
  });
});
