/**
 * The friends room's held seats on the real server, with the hold scaled down (friends-room.md §4 [D84a, D84b]):
 * `lobbyAwayHoldMs` is 6 h in the server's rules; here 600 ms, so the room's own timer lets an away seat go.
 * - Back within the hold: the seat and the host's role are still there.
 * - The host's hold runs out: the earliest of the others is the host; the held reconnection is gone.
 * - Every hold runs out: the room closes, and its code says `roomClosed`.
 *
 * Its own file: Colyseus's matchmaker is one per process (one per Jest worker).
 */
import type { AddressInfo } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  ACCOUNT_PATHS,
  devToken,
  FRIENDS_PATHS,
  type FriendRoomTicket,
  type FriendsError,
  type Me,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { createTestDb, quietLog, testConfig, testPuzzles, type TestDb } from '../src/testing';
import { call, fighter } from '../src/testing/accounts';
import { testTokens } from '../src/testing/tokens';

const HOLD_MS = 600;

let t: TestDb;
let server: ReturnType<typeof createAppServer>;
let url = '';
const log = quietLog();
const me = new Map<string, Me>();

beforeAll(async () => {
  t = await createTestDb();
  const tokens = await testTokens();
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig(),
    db: t,
    tokens: tokens.verifier(Date.now),
    game: { puzzles: testPuzzles, log },
    friends: { rules: { lobbyAwayHoldMs: HOLD_MS } },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
  for (const name of ['Ana', 'Ben', 'Cy']) {
    const res = await call<Me>(url, 'POST', ACCOUNT_PATHS.users, {
      token: devToken(`hold-${name}`),
      body: fighter({ displayName: `${name}_Hold` }),
      headers: { connection: 'close' },
    });
    expect(res.status).toBe(201);
    me.set(name, res.body);
  }
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await t.close();
  await new Promise((r) => setTimeout(r, 1100));
});

const post = <T>(name: string, path: string, body: unknown) =>
  call<T>(url, 'POST', path, { token: devToken(`hold-${name}`), body, headers: { connection: 'close' } });

class Seat {
  readonly messages: ServerMessage[] = [];
  left: number | null = null;

  constructor(readonly room: SdkRoom) {
    room.reconnection.enabled = false;
    for (const type of SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m: ServerMessage) => this.messages.push(m));
    room.onLeave((code: number) => {
      this.left = code;
    });
  }

  static async enter(ticket: FriendRoomTicket): Promise<Seat> {
    return new Seat(await new Client(url).consumeSeatReservation(ticket.reservation));
  }

  get lobby(): Extract<ServerMessage, { type: 'lobby' }> | undefined {
    return this.messages.filter((m) => m.type === 'lobby').at(-1);
  }

  async until(test: (l: Extract<ServerMessage, { type: 'lobby' }>) => boolean, what: string, ms = 4000) {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 15))) {
      const l = this.lobby;
      if (l !== undefined && test(l)) return l;
    }
    throw new Error(`no ${what} within ${ms} ms`);
  }
}

const idOf = (name: string) => me.get(name)!.id;

describe('a friends room’s held seats [D84a, D84b]', () => {
  it('back within the hold; the host’s hold runs out and the host passes on; every hold out closes it', async () => {
    const created = await post<FriendRoomTicket>('Ana', FRIENDS_PATHS.rooms, {});
    expect(created.status).toBe(201);
    const { code } = created.body.room;
    const ana = await Seat.enter(created.body);
    const joined = await post<FriendRoomTicket>('Ben', FRIENDS_PATHS.join, { code });
    const ben = await Seat.enter(joined.body);
    const cyTicket = await post<FriendRoomTicket>('Cy', FRIENDS_PATHS.join, { code });
    const cy = await Seat.enter(cyTicket.body);
    await ben.until((l) => l.players.length === 3, 'everyone in');

    // Ana (the host) drops and comes back within the hold: still the host.
    let token = ana.room.reconnectionToken;
    void ana.room.leave(false);
    await ben.until((l) => l.players[0]?.away === true, 'Ana away');
    await new Promise((r) => setTimeout(r, HOLD_MS / 3));
    const back = new Seat(await new Client(url).reconnect(token));
    const again = await ben.until((l) => l.players[0]?.away === false, 'Ana back');
    expect(again.hostId).toBe(idOf('Ana'));

    // Ana drops for good: her hold runs out, Ben is the host, and her token is no good any more.
    token = back.room.reconnectionToken;
    void back.room.leave(false);
    const passed = await ben.until((l) => l.players.length === 2, 'Ana’s seat gone');
    expect(passed.hostId).toBe(idOf('Ben'));
    expect(passed.players.map((p) => p.id)).toEqual([idOf('Ben'), idOf('Cy')]);
    await expect(new Client(url).reconnect(token)).rejects.toThrow();

    // Everyone else drops too: when the last hold runs out the room closes, and its code says so.
    void ben.room.leave(false);
    void cy.room.leave(false);
    for (const end = Date.now() + 4000; ; await new Promise((r) => setTimeout(r, 50))) {
      const res = await post<FriendsError>('Ana', FRIENDS_PATHS.join, { code });
      if (res.status === 410) {
        expect(res.body).toMatchObject({ error: 'roomClosed', rooms: true });
        break;
      }
      if (Date.now() > end) throw new Error(`the room did not close: ${res.status}`);
    }
    expect(log.lines.some((l) => l.includes('seat hold ran out'))).toBe(true);
  });

  it('logged nothing unexpected', () => {
    expect(log.errors).toEqual([]);
  });
});
