import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  ADMIN_API_PREFIX,
  ADMIN_FRIEND_ROOMS_PATH,
  type AdminFriendRoomRow,
  type AdminFriendRooms,
  type AdminOverview,
} from '@sudoku-fight/protocol';
import express from 'express';

import { games, puzzles } from '../db/schema';
import { jsonErrorHandler } from '../http/errors';
import { type AdminClient, signedInAdmin } from '../testing/admin';
import { fakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { testTokens } from '../testing/tokens';
import { type FriendRoomsView } from './rooms';
import { createAdminRouter } from './router';

/**
 * GET /admin/api/rooms (1.0.4; friends-room.md §7.5): the friends rooms open now, from the FriendRooms service
 * (a stand-in here), never with a code; the games with friends per day from the database; and the overview's
 * ranked games, which leave the friends games out. Now: 2026-10-09 12:00 UTC = 15:00 in Jerusalem.
 */

const NOW = Date.UTC(2026, 9, 9, 12);
const MIN = 60_000;

const ROWS: (AdminFriendRoomRow & { code?: string })[] = [
  {
    roomId: 'room-old',
    state: 'playing',
    gameType: 'hard',
    players: 4,
    maxPlayers: 4,
    hostId: 'u-ben',
    hostName: 'Ben',
    openedAt: NOW - 90 * MIN,
    startedAt: NOW - 20 * MIN,
  },
  {
    roomId: 'room-new',
    state: 'lobby',
    gameType: 'fast',
    players: 1,
    maxPlayers: 4,
    hostId: 'u-ana',
    hostName: 'Ana',
    openedAt: NOW - 5 * MIN,
    startedAt: null,
    // Whatever else the service may hold is not passed on: the code above all.
    code: '482913',
  },
];

const stub: FriendRoomsView = {
  openRooms: () => ROWS.map((r) => ({ ...r })),
  counts: () => ({ lobby: 1, playing: 1 }),
};

let t: TestDb;
const servers: Server[] = [];
let withRooms: AdminClient;
let withoutRooms: AdminClient;
let withRoomsUrl: string;

async function serve(friendRooms: FriendRoomsView | undefined): Promise<string> {
  const tokens = await testTokens();
  const clock = fakeClock(NOW);
  const app = express();
  app.use(
    createAdminRouter({
      config: testConfig(),
      db: t.db,
      now: clock.now,
      tokens: tokens.verifier(clock.now),
      log: () => {},
      ...(friendRooms === undefined ? null : { friendRooms }),
    }),
  );
  app.use(jsonErrorHandler);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  t = await createTestDb();
  withRoomsUrl = await serve(stub);
  [withRooms, withoutRooms] = await Promise.all([
    signedInAdmin(withRoomsUrl),
    serve(undefined).then((url) => signedInAdmin(url)),
  ]);
}, 30_000);
afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  await t.close();
});

beforeEach(async () => {
  await t.reset();
  await t.db.insert(puzzles).values({
    id: 'p1',
    givens: '0'.repeat(81),
    solution: '1'.repeat(81),
    gameType: 'fast',
    givensCount: 0,
    source: 'test',
    pool: 'ranked',
  });
  const game = (id: string, mode: string, startedAt: string) => ({
    id,
    mode,
    gameType: 'fast',
    playerCount: 2,
    puzzleId: 'p1',
    rules: {},
    startedAt: new Date(startedAt),
  });
  await t.db.insert(games).values([
    // 23:30 UTC on the 8th is 02:30 on the 9th in Jerusalem.
    game('f1', 'friends', '2026-10-08T23:30:00Z'),
    game('f2', 'friends', '2026-10-09T09:00:00Z'),
    game('f3', 'friends', '2026-10-07T12:00:00Z'),
    game('f4', 'friends', '2026-09-01T12:00:00Z'), // before the window
    game('g1', 'ranked', '2026-10-09T08:00:00Z'),
    game('g2', 'ranked', '2026-10-07T08:00:00Z'),
  ]);
});

const ROOM_KEYS = [
  'gameType',
  'hostId',
  'hostName',
  'maxPlayers',
  'openedAt',
  'players',
  'roomId',
  'startedAt',
  'state',
];

describe(`GET ${ADMIN_API_PREFIX}${ADMIN_FRIEND_ROOMS_PATH}`, () => {
  it('the open rooms, newest first and without codes; their counts; the games with friends per day', async () => {
    const res = await withRooms.get<AdminFriendRooms>(ADMIN_FRIEND_ROOMS_PATH, { days: 3 });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body.counts).toEqual({ lobby: 1, playing: 1 });
    expect(res.body.rooms.map((r) => [r.roomId, r.state, r.players, r.hostName, r.startedAt])).toEqual([
      ['room-new', 'lobby', 1, 'Ana', null],
      ['room-old', 'playing', 4, 'Ben', NOW - 20 * MIN],
    ]);
    for (const room of res.body.rooms) expect(Object.keys(room).sort()).toEqual(ROOM_KEYS);
    expect(JSON.stringify(res.body)).not.toContain('482913');
    // The 7th, 8th and 9th in Jerusalem: f3, none, f1 and f2. Ranked games are not counted here.
    expect(res.body.days).toBe(3);
    expect(res.body.gamesPerDay).toEqual([
      { day: '2026-10-07', count: 1 },
      { day: '2026-10-08', count: 0 },
      { day: '2026-10-09', count: 2 },
    ]);
  });

  it('defaults to 30 days, and refuses a bad window', async () => {
    const res = await withRooms.get<AdminFriendRooms>(ADMIN_FRIEND_ROOMS_PATH);
    expect(res.body.days).toBe(30);
    expect(res.body.gamesPerDay).toHaveLength(30);
    expect(res.body.gamesPerDay.reduce((sum, d) => sum + d.count, 0)).toBe(3);
    for (const days of ['0', 'x', '100000']) {
      const bad = await withRooms.get(ADMIN_FRIEND_ROOMS_PATH, { days });
      expect([days, bad.status]).toEqual([days, 400]);
    }
  });

  it('a server without the friends rooms: none open, nothing counted; the games per day still', async () => {
    const res = await withoutRooms.get<AdminFriendRooms>(ADMIN_FRIEND_ROOMS_PATH, { days: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ counts: { lobby: 0, playing: 0 }, rooms: [], days: 3 });
    expect(res.body.gamesPerDay.map((d) => d.count)).toEqual([1, 0, 2]);
  });

  it('needs an admin session', async () => {
    const res = await fetch(`${withRoomsUrl}${ADMIN_API_PREFIX}${ADMIN_FRIEND_ROOMS_PATH}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
  });
});

describe('GET /admin/api/overview with games in friends rooms', () => {
  it('its ranked games leave the friends games out, in the total and per day', async () => {
    const res = await withRooms.get<AdminOverview>('/overview', { days: 3 });
    expect(res.status).toBe(200);
    expect(res.body.totals.games).toBe(2);
    expect(res.body.gamesPerDay).toEqual([
      { day: '2026-10-07', count: 1 },
      { day: '2026-10-08', count: 0 },
      { day: '2026-10-09', count: 1 },
    ]);
  });
});
