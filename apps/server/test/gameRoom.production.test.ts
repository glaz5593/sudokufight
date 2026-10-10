/**
 * The game room in production takes accounts only (stage 8): a join with the development identity and no
 * token, or with a token that is no Firebase ID token of this project, is refused with a clear message; and
 * the dev endpoints are off. (Live accounts with real Firebase tokens, and private rooms being off:
 * gameRoom.accounts.production.test.ts.) Its own file: Colyseus's matchmaker is one per process (one per Jest
 * worker).
 */
import type { AddressInfo } from 'node:net';

import { Client } from '@colyseus/sdk';
import { GAME_ROOM_NAME, gameRoomErrorOf } from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { SIGN_IN_REQUIRED } from '../src/auth';
import { quietLog, testConfig, testPuzzles } from '../src/testing';

const server = createAppServer({
  gracefullyShutdown: false,
  config: testConfig({ nodeEnv: 'production' }),
  game: { puzzles: testPuzzles, log: quietLog() },
});
let port = 0;

beforeAll(async () => {
  await server.listen(0);
  port = (server.transport.server!.address() as AddressInfo).port;
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await new Promise((r) => setTimeout(r, 1100));
});

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a refusal');
};

describe('the game room in production', () => {
  it('refuses the development identity and a token that is not a Firebase ID token, with a clear message', async () => {
    const client = new Client(`http://127.0.0.1:${port}`);
    const devJoin = { private: true, devUserId: 'ana', name: 'Ana' };
    const message = await refusal(client.create(GAME_ROOM_NAME, devJoin));
    expect(gameRoomErrorOf(message)).toBe('unauthenticated');
    expect(message).toContain(SIGN_IN_REQUIRED);

    client.auth.token = 'a-firebase-id-token';
    expect(gameRoomErrorOf(await refusal(client.create(GAME_ROOM_NAME, devJoin)))).toBe('unauthenticated');
    expect(gameRoomErrorOf(await refusal(client.joinOrCreate(GAME_ROOM_NAME, devJoin)))).toBe(
      'unauthenticated',
    );
  });

  it('has no /dev/metrics', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/dev/metrics`, { headers: { connection: 'close' } });
    expect(res.status).toBe(404);
  });
});
