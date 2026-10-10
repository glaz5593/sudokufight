/**
 * Stage 8: players join game rooms as their accounts (spec §21: "a Firebase ID token on every connection; the
 * server maps each room to a user_id"). The real server (Colyseus + Express + an in-memory PGlite, one port),
 * with real SDK clients: the app sets `client.auth.token` to its ID token, and the room knows the player by
 * the account's users.id and display name, never by what the join options claim.
 *
 * Outside production (this file): Firebase tokens (signed with this test's keys, never Google's) and the
 * app's development tokens (`dev:<uid>`) both work; a join without any token keeps stage 7's development
 * identity. Production is in gameRoom.accounts.production.test.ts (Colyseus's matchmaker is one per process).
 */
import type { AddressInfo } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  ACCOUNT_PATHS,
  devToken,
  GAME_ROOM_NAME,
  type GameRoomError,
  gameRoomErrorOf,
  type Me,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
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
    config: testConfig(),
    tokens: tokens.verifier(Date.now),
    game: { puzzles: testPuzzles, log: quietLog(), closeAfterGameMs: 300 },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

const close = { connection: 'close' };

async function register(token: string, displayName: string): Promise<Me> {
  const res = await call<Me>(url, 'POST', ACCOUNT_PATHS.users, {
    token,
    body: fighter({ displayName }),
    headers: close,
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** An SDK client signed in with `token` (the app: `client.auth.token = await getIdToken()`). */
function clientWith(token?: string): Client {
  const client = new Client(url);
  if (token !== undefined) client.auth.token = token;
  return client;
}

type Lobby = Extract<ServerMessage, { type: 'lobby' }>;

/** The lobby messages a room receives, and a way to wait for the n-th (the other messages are let be). */
function lobbies(room: SdkRoom) {
  const seen: Lobby[] = [];
  for (const type of SERVER_MESSAGE_TYPES)
    room.onMessage(type, (m: ServerMessage) => {
      if (m.type === 'lobby') seen.push(m);
    });
  return {
    async nth(n: number): Promise<Lobby> {
      for (let i = 0; i < 200 && seen.length < n; i++) await new Promise((r) => setTimeout(r, 20));
      const found = seen[n - 1];
      if (found === undefined) throw new Error(`no lobby message #${n}`);
      return found;
    },
  };
}

async function refusal(p: Promise<unknown>): Promise<{ error: GameRoomError | null; message: string }> {
  try {
    const room = (await p) as SdkRoom;
    await room.leave();
  } catch (e) {
    const message = (e as Error).message;
    return { error: gameRoomErrorOf(message), message };
  }
  throw new Error('expected a refusal');
}

describe('game rooms know players by their accounts', () => {
  it("a development token and a Firebase token: the room shows each account's id and name", async () => {
    const anaToken = devToken('ana_uid', 'ana@example.com');
    const ana = await register(anaToken, 'Ana_Dev');
    const benToken = await tokens.sign({ uid: 'fb-ben', email: 'ben@example.com' }, Date.now());
    const ben = await register(benToken, 'Ben_Fb');

    // The join options say nothing about who it is; what they would claim is ignored.
    const anaRoom = await clientWith(anaToken).create(GAME_ROOM_NAME, {
      private: true,
      devUserId: 'impostor',
      name: 'Impostor',
    });
    const anaLobby = lobbies(anaRoom);
    expect(await anaLobby.nth(1)).toMatchObject({
      players: [{ id: ana.id, name: 'Ana_Dev' }],
      playerId: ana.id,
    });

    const benRoom = await clientWith(benToken).joinById(anaRoom.roomId, {});
    const benLobby = lobbies(benRoom);
    const both = [
      { id: ana.id, name: 'Ana_Dev' },
      { id: ben.id, name: 'Ben_Fb' },
    ];
    expect((await anaLobby.nth(2)).players).toEqual(both);
    expect(await benLobby.nth(1)).toMatchObject({ players: both, playerId: ben.id });
    await Promise.all([anaRoom.leave(), benRoom.leave()]);
  });

  it('the same account cannot take two seats, whatever the options say', async () => {
    const token = devToken('cy_uid');
    await register(token, 'Cy_Dev');
    const room = await clientWith(token).create(GAME_ROOM_NAME, { private: true, playerCount: 3 });
    lobbies(room);
    // The SDK warns about the refused connection's close; expected here.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const again = await refusal(
        clientWith(token).joinById(room.roomId, { devUserId: 'someone_else', name: 'Other' }),
      );
      expect(again.error).toBe('alreadyInRoom');
      await new Promise((r) => setTimeout(r, 200)); // the close arrives after the refusal
    } finally {
      warn.mockRestore();
    }
    await room.leave();
  });

  it('refuses a token without an account, a deleted account, and a bad token (no fallback to the options)', async () => {
    const devJoin = { private: true, devUserId: 'dan', name: 'Dan' };
    const unregistered = await refusal(clientWith(devToken('nobody_uid')).create(GAME_ROOM_NAME, devJoin));
    expect(unregistered.error).toBe('unauthenticated');
    expect(unregistered.message).toMatch(/register first/);

    const token = await tokens.sign({ uid: 'fb-gone' }, Date.now());
    await register(token, 'Gone_Soon');
    expect((await call(url, 'DELETE', ACCOUNT_PATHS.me, { token, headers: close })).status).toBe(204);
    expect((await refusal(clientWith(token).create(GAME_ROOM_NAME, devJoin))).error).toBe('unauthenticated');

    for (const bad of ['garbage', 'dev:', await tokens.sign({ uid: 'fb-x' }, Date.now() - 2 * 3600_000)]) {
      expect((await refusal(clientWith(bad).create(GAME_ROOM_NAME, devJoin))).error).toBe('unauthenticated');
    }
    const foreign = await testTokens();
    const forged = await foreign.sign({ uid: 'fb-ben' }, Date.now());
    expect((await refusal(clientWith(forged).create(GAME_ROOM_NAME, devJoin))).error).toBe('unauthenticated');
  });

  it("without any token, stage 7's development identity still works here (the fake client)", async () => {
    const room = await clientWith().create(GAME_ROOM_NAME, { private: true, devUserId: 'eve', name: 'Eve' });
    expect(await lobbies(room).nth(1)).toMatchObject({
      players: [{ id: 'eve', name: 'Eve' }],
      playerId: 'eve',
    });
    await room.leave();
  });
});
