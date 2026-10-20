import { FRIENDS_ERROR_CODES, FRIENDS_ERROR_STATUS, type FriendRoomTicket } from '@sudoku-fight/protocol';

import { createRoomsApi, isRoomsApiError, type RoomsApiError } from '../roomsApi';
import { bodyOf, type FakeReply, fakeFetch } from '../testing/fakeProgress';

/**
 * The friends rooms' routes as the app calls them (1.0.4; protocol friends.ts): the paths, the bodies and the
 * ID token (refreshed once on a 401), the ticket checked, and every failure as a code a friends screen explains:
 * the server's own, `network` for no answer, `notAvailable` for a server without the routes.
 */

const BASE = 'https://game.example';

const TICKET: FriendRoomTicket = {
  reservation: { name: 'friends', sessionId: 'sess-1', roomId: 'Zq81kPx0aRt7' },
  room: {
    code: '123456',
    gameType: 'normal',
    players: 1,
    maxPlayers: 4,
    state: 'lobby',
    host: { name: 'MosheG', avatarId: 'av00', country: 'IL' },
  },
};

function api(reply: (url: string) => FakeReply, { token = 'tok' as string | null } = {}) {
  const fetch = fakeFetch((call) => reply(call.url));
  const tokens: boolean[] = [];
  const timers: (() => void)[] = [];
  const client = createRoomsApi({
    baseUrl: BASE,
    getToken: async (force) => {
      tokens.push(force);
      return token === null ? null : force ? `${token}-fresh` : token;
    },
    fetch,
    timeoutMs: 1000,
    setTimeout: (cb) => timers.push(cb),
    clearTimeout: () => undefined,
  });
  return { client, fetch, tokens, timers };
}

const fail = async (p: Promise<unknown>): Promise<RoomsApiError> => {
  try {
    await p;
  } catch (error) {
    if (isRoomsApiError(error)) return error;
    throw error;
  }
  throw new Error('expected a failure');
};

describe('POST /v1/rooms: a new room, me its host', () => {
  it('sends the game type, the kinds this app shows and the token; a 201 is the ticket', async () => {
    const { client, fetch } = api(() => ({ status: 201, body: TICKET }));
    await expect(client.create({ gameType: 'hard', interferenceKinds: ['freeze'] })).resolves.toEqual(TICKET);
    expect(fetch.calls[0]!.url).toBe(`${BASE}/v1/rooms`);
    expect(fetch.calls[0]!.init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    });
    expect(bodyOf(fetch.calls[0]!)).toEqual({ gameType: 'hard', interferenceKinds: ['freeze'] });
  });

  it('409 tooManyRooms says which lobby I host already (then replace: true)', async () => {
    const { client, fetch } = api(() => ({
      status: 409,
      body: { error: 'tooManyRooms', rooms: true, code: '654321' },
    }));
    const e = await fail(client.create({ gameType: 'normal' }));
    expect(e).toMatchObject({ code: 'tooManyRooms', status: 409, openCode: '654321' });
    await fail(client.create({ gameType: 'normal', replace: true }));
    expect(bodyOf(fetch.calls[1]!)).toEqual({ gameType: 'normal', replace: true });
  });

  it('an answer it can not read is internal, never half used', async () => {
    const { client } = api(() => ({
      status: 201,
      body: { ...TICKET, room: { ...TICKET.room, code: '12345' } },
    }));
    expect((await fail(client.create({}))).code).toBe('internal');
    const { client: html } = api(() => ({ status: 200, body: '<html>proxy</html>' }));
    expect((await fail(html.create({}))).code).toBe('internal');
  });
});

describe('POST /v1/rooms/join: a seat by the code', () => {
  it('sends the code in its canonical form', async () => {
    const { client, fetch } = api(() => ({ body: TICKET }));
    await expect(client.join({ code: ' 123-456 ' })).resolves.toEqual(TICKET);
    expect(fetch.calls[0]!.url).toBe(`${BASE}/v1/rooms/join`);
    expect(bodyOf(fetch.calls[0]!)).toEqual({ code: '123456' });
  });

  it('a code that can not be one is badRequest (field code), without a call', async () => {
    const { client, fetch } = api(() => ({ body: TICKET }));
    const e = await fail(client.join({ code: '12345' }));
    expect(e).toMatchObject({ code: 'badRequest', field: 'code' });
    expect(fetch.calls).toHaveLength(0);
  });

  it('a room that is not there (404 with rooms: true) is notFound; an old server’s 404 is notAvailable', async () => {
    const { client } = api(() => ({ status: 404, body: { error: 'notFound', rooms: true } }));
    expect((await fail(client.join({ code: '123456' }))).code).toBe('notFound');
    const { client: old } = api(() => ({ status: 404, body: { error: 'notFound' } }));
    expect((await fail(old.join({ code: '123456' }))).code).toBe('notAvailable');
    const { client: bare } = api(() => ({ status: 404, body: 'Cannot POST /v1/rooms/join' }));
    expect((await fail(bare.join({ code: '123456' }))).code).toBe('notAvailable');
  });

  it.each(FRIENDS_ERROR_CODES.filter((c) => c !== 'unauthorized'))(
    'the server’s %s comes out as itself',
    async (code) => {
      const { client } = api(() => ({
        status: FRIENDS_ERROR_STATUS[code],
        body: { error: code, rooms: true },
      }));
      expect((await fail(client.join({ code: '123456' }))).code).toBe(code);
    },
  );

  it('429: how long to wait, from the body or the Retry-After header', async () => {
    const { client } = api(() => ({
      status: 429,
      body: { error: 'tooManyRequests', rooms: true, retryAfterSec: 240 },
    }));
    expect(await fail(client.join({ code: '123456' }))).toMatchObject({
      code: 'tooManyRequests',
      retryAfterMs: 240_000,
    });
    const { client: header } = api(() => ({ status: 429, body: '', headers: { 'Retry-After': '7' } }));
    expect(await fail(header.join({ code: '123456' }))).toMatchObject({
      code: 'tooManyRequests',
      retryAfterMs: 7000,
    });
  });
});

describe('the token, the connection and the time limit', () => {
  it('a 401 refreshes the token once and tries again', async () => {
    let n = 0;
    const { client, tokens, fetch } = api(() =>
      ++n === 1 ? { status: 401, body: { error: 'unauthorized', rooms: true } } : { body: TICKET },
    );
    await expect(client.join({ code: '123456' })).resolves.toEqual(TICKET);
    expect(tokens).toEqual([false, true]);
    expect(fetch.calls[1]!.init.headers.Authorization).toBe('Bearer tok-fresh');
  });

  it('a second 401 is unauthorized', async () => {
    const { client, fetch } = api(() => ({ status: 401, body: { error: 'unauthorized', rooms: true } }));
    expect((await fail(client.create({}))).code).toBe('unauthorized');
    expect(fetch.calls).toHaveLength(2);
  });

  it('nobody signed in is unauthorized, without a call', async () => {
    const { client, fetch } = api(() => ({ body: TICKET }), { token: null });
    expect((await fail(client.create({}))).code).toBe('unauthorized');
    expect(fetch.calls).toHaveLength(0);
  });

  it('no answer, or none in time, is network', async () => {
    const { client } = api(() => ({ fail: true }));
    expect((await fail(client.join({ code: '123456' }))).code).toBe('network');

    let abort: (() => void) | null = null;
    const slow = createRoomsApi({
      baseUrl: BASE,
      getToken: async () => 'tok',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      timeoutMs: 1000,
      setTimeout: (cb) => {
        abort = cb;
        return 1;
      },
      clearTimeout: () => undefined,
    });
    const pending = fail(slow.create({}));
    await Promise.resolve();
    await Promise.resolve();
    abort!();
    expect((await pending).code).toBe('network');
  });

  it('a proxy’s 502 is unavailable; an unknown 4xx goes by its status', async () => {
    const { client } = api(() => ({ status: 502, body: '<html>Bad Gateway</html>' }));
    expect((await fail(client.join({ code: '123456' }))).code).toBe('unavailable');
    const { client: odd } = api(() => ({ status: 418, body: { error: 'teapot' } }));
    expect((await fail(odd.join({ code: '123456' }))).code).toBe('internal');
  });
});
