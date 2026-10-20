import {
  FRIENDS_ERROR_STATUS,
  FRIENDS_PATHS,
  type FriendRoomCreateRequest,
  type FriendRoomJoinRequest,
  type FriendRoomTicket,
  type FriendsError,
  friendsErrorOf,
  isFriendRoomTicket,
  NO_AVATAR_ID,
} from '@sudoku-fight/protocol';
import { eq } from 'drizzle-orm';

import type { TokenVerifier } from '../auth/firebaseToken';
import { type FriendsLimits, NO_FRIENDS_LINKS, type ServerConfig } from '../config';
import { users } from '../db/schema';
import type { HttpDeps } from '../http';
import { createTestDb, fakeClock, startHttp, type TestDb, type TestHttp, testConfig } from '../testing';
import { type Answer, call, type CallOptions } from '../testing/accounts';
import { addAccounts, T0 } from '../testing/ranked';
import { testTokens, type TestTokens } from '../testing/tokens';
import { FRIENDS_BODY_BYTES } from './router';
import type { FriendRooms, FriendRoomsResult, FriendsCaller } from './service';

/**
 * friends-room.md §5, §10 (router.test.ts): POST /v1/rooms and /v1/rooms/join over HTTP, against a stand-in of
 * the FriendRooms service (the service and the room have their own tests): the account it takes, the bodies,
 * the limits of §5, how every answer of the service goes out (status, `rooms: true`, Retry-After), and a server
 * without the service (the app's "not available yet").
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const TICKET: FriendRoomTicket = {
  reservation: { name: 'friends', sessionId: 'session-1', roomId: 'Qw3rTy9uIoP0aSdF' },
  room: {
    code: '123456',
    gameType: 'normal',
    players: 1,
    maxPlayers: 4,
    state: 'lobby',
    host: { name: 'Ana', avatarId: NO_AVATAR_ID, country: null },
  },
};

type Call =
  | { kind: 'create'; caller: FriendsCaller; request: FriendRoomCreateRequest }
  | { kind: 'join'; caller: FriendsCaller; request: FriendRoomJoinRequest };

/** The service as the router sees it: records each call, and answers with `answer` (default: a ticket). */
class StandInRooms implements FriendRooms {
  calls: Call[] = [];
  answer: () => FriendRoomsResult | Promise<FriendRoomsResult> = () => ({ ok: true, ticket: TICKET });

  async create(caller: FriendsCaller, request: FriendRoomCreateRequest) {
    this.calls.push({ kind: 'create', caller, request });
    return this.answer();
  }
  async join(caller: FriendsCaller, request: FriendRoomJoinRequest) {
    this.calls.push({ kind: 'join', caller, request });
    return this.answer();
  }
  openRooms() {
    return [];
  }
  counts() {
    return { lobby: 0, playing: 0 };
  }
  async shutdown() {}
}

let t: TestDb;
let tokens: TestTokens;
const clock = fakeClock(T0);
const rooms = new StandInRooms();
const servers: TestHttp[] = [];

async function start(
  deps: Partial<HttpDeps> & { limits?: FriendsLimits; verifier?: TokenVerifier } = {},
): Promise<string> {
  const { limits, verifier, ...rest } = deps;
  const config: ServerConfig = testConfig(
    limits === undefined ? {} : { friends: { links: NO_FRIENDS_LINKS, limits } },
  );
  const http = await startHttp({
    config,
    db: t.db,
    now: clock.now,
    tokens: verifier ?? tokens.verifier(clock.now),
    adminSiteDir: null,
    friendRooms: rooms,
    ...rest,
  });
  servers.push(http);
  return http.url;
}

let url: string;

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  url = await start();
}, 30_000);
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  // A day later every time: every rate limit's bucket is full again.
  clock.advance(24 * HOUR);
  rooms.calls = [];
  rooms.answer = () => ({ ok: true, ticket: TICKET });
  await addAccounts(t.db, [
    { id: 'ana', name: 'Ana' },
    { id: 'ben', name: 'Ben' },
    { id: 'gone', name: 'Gone', deleted: true },
  ]);
});

const tokenOf = (id: string) => tokens.sign({ uid: `uid-${id}`, email: `${id}@example.com` }, clock.now());

async function post<T = FriendsError>(
  base: string,
  path: string,
  who: string | null,
  options: CallOptions = {},
): Promise<Answer<T>> {
  return call<T>(base, 'POST', path, { ...options, ...(who === null ? {} : { token: await tokenOf(who) }) });
}

/** Every error answer: its status is the code's, it carries `rooms: true`, and the app reads the code back. */
function expectError(answer: Answer<FriendsError>, error: FriendsError['error']): void {
  expect({ status: answer.status, error: answer.body?.error, rooms: answer.body?.rooms }).toEqual({
    status: FRIENDS_ERROR_STATUS[error],
    error,
    rooms: true,
  });
  expect(friendsErrorOf(answer.status, answer.body)).toBe(error);
  expect(answer.headers.get('cache-control')).toBe('no-store');
}

describe('who may call', () => {
  it('needs a token (401 unauthorized, with rooms: true), and a live account (404 notRegistered)', async () => {
    const none = await post(url, FRIENDS_PATHS.rooms, null, { body: {} });
    expectError(none, 'unauthorized');
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    const forged = await call<FriendsError>(url, 'POST', FRIENDS_PATHS.join, {
      token: 'not-a-token',
      body: { code: '123456' },
    });
    expectError(forged, 'unauthorized');
    expect(forged.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    expectError(await post(url, FRIENDS_PATHS.rooms, 'nobody', { body: {} }), 'notRegistered');
    expectError(await post(url, FRIENDS_PATHS.join, 'gone', { body: { code: '123456' } }), 'notRegistered');
    expect(rooms.calls).toEqual([]);
  });

  it('hands the service the account: id, display name, suspension, and the IP’s key (never the token)', async () => {
    await t.db
      .update(users)
      .set({ suspendedAt: new Date(T0) })
      .where(eq(users.id, 'ben'));
    await post(url, FRIENDS_PATHS.rooms, 'ana', { body: {} });
    await post(url, FRIENDS_PATHS.join, 'ben', { body: { code: '123456' } });
    expect(rooms.calls.map((c) => c.caller)).toEqual([
      { userId: 'ana', name: 'Ana', suspended: false, ipKey: '127.0.0.1' },
      { userId: 'ben', name: 'Ben', suspended: true, ipKey: '127.0.0.1' },
    ]);
  });

  it('accounts off on this server (production without FIREBASE_PROJECT_ID): 503 disabled', async () => {
    const off = await start({ verifier: tokens.verifier(clock.now, { projectId: null, devTokens: false }) });
    expectError(await post(off, FRIENDS_PATHS.rooms, 'ana', { body: {} }), 'disabled');
  });

  it('tokens that can’t be checked right now: 503 unavailable', async () => {
    const down = await start({
      verifier: {
        projectId: 'sudoku-fight-test',
        devTokens: false,
        verifyIdToken: () =>
          Promise.resolve({ ok: false, failure: 'unavailable', message: 'Google keys unreachable' }),
      },
    });
    expectError(await post(down, FRIENDS_PATHS.join, 'ana', { body: { code: '123456' } }), 'unavailable');
  });
});

describe('POST /v1/rooms', () => {
  it('201 with the service’s ticket, which the app’s check takes', async () => {
    const res = await post<FriendRoomTicket>(url, FRIENDS_PATHS.rooms, 'ana', {
      body: { gameType: 'hard', interferenceKinds: ['freeze', 'fog', 'newKind'], replace: true, extra: 1 },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(TICKET);
    expect(isFriendRoomTicket(res.body)).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Keys this server does not know are left out (a newer app may send more); unknown kinds are kept.
    expect(rooms.calls[0]?.request).toEqual({
      gameType: 'hard',
      interferenceKinds: ['freeze', 'fog', 'newKind'],
      replace: true,
    });
  });

  it('every field is optional: no body at all, or {}, is a room of the defaults', async () => {
    expect((await post(url, FRIENDS_PATHS.rooms, 'ana')).status).toBe(201);
    expect((await post(url, FRIENDS_PATHS.rooms, 'ana', { body: {} })).status).toBe(201);
    expect(rooms.calls.map((c) => c.request)).toEqual([{}, {}]);
  });

  it('a malformed body: 400 badRequest naming the field; the service is never asked', async () => {
    const cases: [unknown, FriendsError['field']][] = [
      [{ gameType: 'easy' }, 'gameType'],
      [{ gameType: 3 }, 'gameType'],
      [{ replace: 'yes' }, 'replace'],
      [{ interferenceKinds: 'freeze' }, 'interferenceKinds'],
      [{ interferenceKinds: Array<string>(17).fill('freeze') }, 'interferenceKinds'],
      [{ interferenceKinds: ['x'.repeat(33)] }, 'interferenceKinds'],
      [[1, 2], 'body'],
      ['a string', 'body'],
    ];
    for (const [body, field] of cases) {
      const res = await post(url, FRIENDS_PATHS.rooms, 'ana', { body });
      expectError(res, 'badRequest');
      expect({ body, field: res.body.field }).toEqual({ body, field });
    }
    const json = await post(url, FRIENDS_PATHS.rooms, 'ana', { raw: '{"gameType":' });
    expectError(json, 'badRequest');
    expect(json.body).toMatchObject({ field: 'body', message: 'invalid JSON' });
    const big = await post(url, FRIENDS_PATHS.rooms, 'ana', {
      body: { gameType: 'fast', pad: 'x'.repeat(FRIENDS_BODY_BYTES) },
    });
    expectError(big, 'tooLarge');
    expect(rooms.calls).toEqual([]);
  });
});

describe('POST /v1/rooms/join', () => {
  it('200 with the ticket; the code in any form the app may send, canonical for the service', async () => {
    for (const code of ['123456', '123 456', ' 123-456 ']) {
      const res = await post<FriendRoomTicket>(url, FRIENDS_PATHS.join, 'ben', {
        body: { code, interferenceKinds: ['freeze'] },
      });
      expect(res.status).toBe(200);
      expect(isFriendRoomTicket(res.body)).toBe(true);
    }
    expect(rooms.calls.map((c) => c.request)).toEqual(
      Array(3).fill({ code: '123456', interferenceKinds: ['freeze'] }),
    );
  });

  it('a code that is not one: 400 badRequest, field code (the service never sees it)', async () => {
    for (const body of [{}, { code: '12345' }, { code: '1234567' }, { code: 123456 }, { code: 'abcdef' }]) {
      const res = await post(url, FRIENDS_PATHS.join, 'ben', { body });
      expectError(res, 'badRequest');
      expect(res.body.field).toBe('code');
    }
    expect((await post(url, FRIENDS_PATHS.join, 'ben')).body.field).toBe('body');
    expect(rooms.calls).toEqual([]);
  });

  it('every refusal of the service goes out with its status and rooms: true (the app tells notFound from an old server)', async () => {
    for (const error of [
      'notFound',
      'cantJoin',
      'kicked',
      'suspended',
      'roomFull',
      'gameStarted',
      'roomClosed',
      'unavailable',
    ] as const) {
      rooms.answer = () => ({ ok: false, error, message: `because ${error}` });
      const res = await post(url, FRIENDS_PATHS.join, 'ben', { body: { code: '654321' } });
      expectError(res, error);
      expect(res.body).toEqual({ error, rooms: true, message: `because ${error}` });
    }
    // A blocked player's notFound is the very answer of a wrong code [D85c]: nothing more in it.
    rooms.answer = () => ({ ok: false, error: 'notFound' });
    expect((await post(url, FRIENDS_PATHS.join, 'ben', { body: { code: '654321' } })).body).toEqual({
      error: 'notFound',
      rooms: true,
    });
  });

  it('tooManyRooms carries the open lobby’s code; tooManyRequests its wait (Retry-After, whole seconds ≥ 1)', async () => {
    rooms.answer = () => ({
      ok: false,
      error: 'tooManyRooms',
      code: '777888',
      message: 'host of one already',
    });
    const many = await post(url, FRIENDS_PATHS.rooms, 'ana', { body: {} });
    expectError(many, 'tooManyRooms');
    expect(many.body).toEqual({
      error: 'tooManyRooms',
      rooms: true,
      code: '777888',
      message: 'host of one already',
    });

    rooms.answer = () => ({ ok: false, error: 'tooManyRequests', retryAfterMs: 61_500 });
    const slow = await post(url, FRIENDS_PATHS.join, 'ben', { body: { code: '654321' } });
    expectError(slow, 'tooManyRequests');
    expect(slow.body.retryAfterSec).toBe(62);
    expect(slow.headers.get('retry-after')).toBe('62');
    rooms.answer = () => ({ ok: false, error: 'tooManyRequests', retryAfterMs: 1 });
    expect(
      (await post(url, FRIENDS_PATHS.join, 'ben', { body: { code: '654321' } })).body.retryAfterSec,
    ).toBe(1);

    rooms.answer = () => ({ ok: false, error: 'badRequest', field: 'interferenceKinds', message: 'no' });
    const bad = await post(url, FRIENDS_PATHS.join, 'ben', { body: { code: '654321' } });
    expectError(bad, 'badRequest');
    expect(bad.body.field).toBe('interferenceKinds');
  });

  it('a bug in the service: 500 internal, still with rooms: true', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      rooms.answer = () => {
        throw new Error('boom');
      };
      expectError(await post(url, FRIENDS_PATHS.join, 'ben', { body: { code: '654321' } }), 'internal');
      expect(quiet).toHaveBeenCalledTimes(1);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('the rate limits of §5 [D86] (FRIENDS_*)', () => {
  const LIMITS: FriendsLimits = {
    create: { limit: 2, windowMs: HOUR },
    joinPerAccount: { limit: 3, windowMs: 10 * MINUTE },
    joinPerIp: { limit: 5, windowMs: 10 * MINUTE },
  };
  let limited: string;
  beforeAll(async () => {
    limited = await start({ limits: LIMITS });
  });

  it('create: per account, then 429 with the wait, and the service is not asked', async () => {
    for (let i = 0; i < 2; i++)
      expect((await post(limited, FRIENDS_PATHS.rooms, 'ana', { body: {} })).status).toBe(201);
    const over = await post(limited, FRIENDS_PATHS.rooms, 'ana', { body: {} });
    expectError(over, 'tooManyRequests');
    // A token comes back every half hour: wait 30 minutes (the bucket's arithmetic may round up a second).
    expect(over.body.retryAfterSec).toBeGreaterThanOrEqual(1800);
    expect(over.body.retryAfterSec).toBeLessThanOrEqual(1801);
    expect(over.headers.get('retry-after')).toBe(String(over.body.retryAfterSec));
    // Another account has its own.
    expect((await post(limited, FRIENDS_PATHS.rooms, 'ben', { body: {} })).status).toBe(201);
    expect(rooms.calls.filter((c) => c.kind === 'create')).toHaveLength(3);
    // After the wait it said, one more.
    clock.advance((over.body.retryAfterSec ?? 0) * 1000);
    expect((await post(limited, FRIENDS_PATHS.rooms, 'ana', { body: {} })).status).toBe(201);
  });

  it('join: per account, and per IP across accounts; a create does not count', async () => {
    const join = (who: string) => post(limited, FRIENDS_PATHS.join, who, { body: { code: '123456' } });
    for (let i = 0; i < 3; i++) expect((await join('ana')).status).toBe(200);
    expectError(await join('ana'), 'tooManyRequests');
    expect((await post(limited, FRIENDS_PATHS.rooms, 'ana', { body: {} })).status).toBe(201);
    // Ben, from the same address: 2 more tries reach the IP's 5 (Ana's 4th was refused before it counted).
    for (let i = 0; i < 2; i++) expect((await join('ben')).status).toBe(200);
    expectError(await join('ben'), 'tooManyRequests');
    expect(rooms.calls.filter((c) => c.kind === 'join')).toHaveLength(5);
  });

  it('a flood from one IP is stopped before its tokens are checked', async () => {
    const flooded = await start({ friendsFloodLimit: { limit: 2, windowMs: MINUTE } });
    for (let i = 0; i < 2; i++) expectError(await post(flooded, FRIENDS_PATHS.rooms, null), 'unauthorized');
    expectError(await post(flooded, FRIENDS_PATHS.rooms, 'ana', { body: {} }), 'tooManyRequests');
  });
});

describe('a server without the service', () => {
  it('has no /v1/rooms: 404 without rooms, which the app reads as "not available yet"; the link page stays', async () => {
    const old = await start({ friendRooms: undefined });
    const res = await post(old, FRIENDS_PATHS.join, 'ana', { body: { code: '123456' } });
    expect(res.status).toBe(404);
    expect(res.body.rooms).toBeUndefined();
    expect(friendsErrorOf(res.status, res.body)).toBe('notAvailable');
    expect((await fetch(`${old}/r/123456`)).status).toBe(200);
    expect((await fetch(`${old}${FRIENDS_PATHS.assetLinks}`)).status).toBe(404);
  });
});
