/**
 * Stage 8 in production: the game room takes Firebase ID tokens of live accounts and nothing else. No
 * development tokens (`dev:<uid>`), no development identity in the join options. Its own file: Colyseus's
 * matchmaker is one per process (one per Jest worker).
 *
 * Production has no private rooms yet (stage 7; matchmaking is stage 9), so a create that gets past the
 * identity check is refused for its options (`badOptions`): that is how this test sees the check pass.
 */
import type { AddressInfo } from 'node:net';

import { Client } from '@colyseus/sdk';
import { ACCOUNT_PATHS, devToken, GAME_ROOM_NAME, gameRoomErrorOf } from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { SIGN_IN_REQUIRED } from '../src/auth';
import { quietLog, testConfig, testPuzzles } from '../src/testing';
import { call, fighter } from '../src/testing/accounts';
import { testTokens, type TestTokens } from '../src/testing/tokens';

let tokens: TestTokens;
let server: ReturnType<typeof createAppServer>;
let url = '';

beforeAll(async () => {
  tokens = await testTokens();
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig({ nodeEnv: 'production' }),
    tokens: tokens.verifier(Date.now, { devTokens: false }),
    game: { puzzles: testPuzzles, log: quietLog() },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await new Promise((r) => setTimeout(r, 1100));
});

const close = { connection: 'close' };

/** The GameRoomError and message of a create with this token (and these options). */
async function createWith(token: string | undefined, options: object = { private: true }) {
  const client = new Client(url);
  if (token !== undefined) client.auth.token = token;
  try {
    const room = await client.create(GAME_ROOM_NAME, options);
    await room.leave();
  } catch (e) {
    const message = (e as Error).message;
    return { error: gameRoomErrorOf(message), message };
  }
  throw new Error('expected a refusal');
}

describe('the game room in production (stage 8)', () => {
  it('lets a Firebase account through the identity check', async () => {
    const token = await tokens.sign({ uid: 'fb-prod-ana', email: 'ana@example.com' }, Date.now());
    const created = await call(url, 'POST', ACCOUNT_PATHS.users, {
      token,
      body: fighter({ displayName: 'Prod_Ana' }),
      headers: close,
    });
    expect(created.status).toBe(201);
    // Past the identity check: refused only because production has no private rooms yet.
    expect((await createWith(token)).error).toBe('badOptions');
  });

  it('refuses development tokens and the development identity, with a clear message', async () => {
    const devJoin = { private: true, devUserId: 'ana', name: 'Ana' };
    const noToken = await createWith(undefined, devJoin);
    expect(noToken.error).toBe('unauthenticated');
    expect(noToken.message).toContain(SIGN_IN_REQUIRED);
    for (const dev of [devToken('ana'), devToken('ana', 'ana@example.com')]) {
      expect((await createWith(dev, devJoin)).error).toBe('unauthenticated');
    }
    // The account routes refuse them too: no way to make a dev account here.
    const register = await call(url, 'POST', ACCOUNT_PATHS.users, {
      token: devToken('ana'),
      body: fighter({ displayName: 'Dev_Ana' }),
      headers: close,
    });
    expect(register.status).toBe(401);
  });

  it('refuses an unregistered sign-in, a deleted account, an expired or forged token', async () => {
    expect((await createWith(await tokens.sign({ uid: 'fb-nobody' }, Date.now()))).error).toBe(
      'unauthenticated',
    );

    const token = await tokens.sign({ uid: 'fb-prod-gone' }, Date.now());
    await call(url, 'POST', ACCOUNT_PATHS.users, {
      token,
      body: fighter({ displayName: 'Prod_Gone' }),
      headers: close,
    });
    expect((await createWith(token)).error).toBe('badOptions');
    expect((await call(url, 'DELETE', ACCOUNT_PATHS.me, { token, headers: close })).status).toBe(204);
    expect((await createWith(token)).error).toBe('unauthenticated');

    const expired = await tokens.sign({ uid: 'fb-prod-ana' }, Date.now() - 2 * 3600_000);
    expect((await createWith(expired)).error).toBe('unauthenticated');
    const forged = await (await testTokens()).sign({ uid: 'fb-prod-ana' }, Date.now());
    expect((await createWith(forged)).error).toBe('unauthenticated');
  });
});
