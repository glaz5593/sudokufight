import type {
  AdminGameDetail,
  AdminGameRow,
  AdminInstallDetail,
  AdminInstallRow,
  AdminPage,
  AdminUserDetail,
  AdminUserRow,
  TelemetryProps,
} from '@sudoku-fight/protocol';
import { eq } from 'drizzle-orm';

import {
  appEvents,
  gameEvents,
  gamePlayers,
  games,
  installs,
  puzzles,
  ratings,
  users,
  xp,
} from '../db/schema';
import {
  type AdminClient,
  createTestDb,
  fakeClock,
  signedInAdmin,
  startHttp,
  type TestDb,
  type TestHttp,
  testConfig,
} from '../testing';
import { RECENT_EVENTS_LIMIT } from './constants';

/** The list and detail routes on a small dataset written out below. Now: 2026-10-09 12:00 UTC. */
const NOW = Date.UTC(2026, 9, 9, 12);
const ms = (iso: string) => Date.parse(iso);
const at = (iso: string) => new Date(iso);

const IA = '0a0a0a0a-0000-4000-8000-00000000000a';
const IB = '0b0b0b0b-0000-4000-8000-00000000000b';
const IC = '0c0c0c0c-0000-4000-8000-00000000000c';
const ID = '0d0d0d0d-0000-4000-8000-00000000000d';

let t: TestDb;
let http: TestHttp;
let admin: AdminClient;

beforeAll(async () => {
  t = await createTestDb();
  http = await startHttp({ config: testConfig(), db: t.db, now: fakeClock(NOW).now, adminSiteDir: null });
  admin = await signedInAdmin(http.url);

  await t.db.insert(users).values([
    {
      id: 'u1',
      firebaseUid: 'fb-moshe',
      displayName: 'Moshe',
      email: 'moshe@example.com',
      country: 'IL',
      avatarId: 'av07',
      createdAt: at('2026-10-01T09:00:00Z'),
    },
    { id: 'u2', firebaseUid: 'fb-dana', displayName: 'Dana_100%', createdAt: at('2026-10-02T09:00:00Z') },
    {
      id: 'u3',
      firebaseUid: 'fb-old',
      displayName: 'Old',
      createdAt: at('2026-09-01T09:00:00Z'),
      deletedAt: at('2026-10-05T09:00:00Z'),
    },
  ]);
  // Stage 12: u1 has earned some XP (spec §15).
  await t.db.insert(xp).values({ userId: 'u1', xp: 650, level: 3 });
  await t.db.insert(ratings).values([
    { userId: 'u1', ratingKey: 'normal', rating: 1210, games: 3, provisional: true, peak: 1215 },
    { userId: 'u1', ratingKey: 'fast', rating: 1287.5, games: 12, provisional: false, peak: 1300 },
    { userId: 'u2', ratingKey: 'fast', rating: 1180, games: 4, provisional: true, peak: 1200 },
  ]);
  const install = (
    id: string,
    platform: 'ios' | 'android',
    appVersion: string,
    first: string,
    last: string,
  ) => ({
    id,
    platform,
    appVersion,
    firstSeen: at(first),
    lastSeen: at(last),
  });
  await t.db
    .insert(installs)
    .values([
      { ...install(IA, 'android', '0.2.0', '2026-10-01T09:00:00Z', '2026-10-09T11:00:00Z'), userId: 'u1' },
      { ...install(IB, 'ios', '0.1.0', '2026-10-02T09:00:00Z', '2026-10-08T09:00:00Z'), userId: 'u1' },
      { ...install(IC, 'android', '0.1.1', '2026-10-03T09:00:00Z', '2026-10-05T09:00:00Z'), userId: 'u2' },
      install(ID, 'ios', '0.2.0', '2026-10-04T09:00:00Z', '2026-10-09T06:00:00Z'),
    ]);
  const ev = (
    id: string,
    installId: string,
    name: 'app_open' | 'screen_view',
    tClient: string,
    screen?: string,
  ) => ({
    id,
    installId,
    name,
    props: (screen === undefined ? {} : { screen }) as TelemetryProps,
    tClient: at(tClient),
    tServer: at(tClient),
  });
  await t.db.insert(appEvents).values([
    ev('a1', IA, 'app_open', '2026-10-09T10:00:00Z'),
    ev('a2', IA, 'screen_view', '2026-10-09T10:00:01Z', 'Home'),
    ev('a3', IA, 'screen_view', '2026-10-09T11:00:00Z', 'Settings'),
    ev('b1', IB, 'app_open', '2026-10-08T09:00:00Z'),
    // ID: a session at 05:00, another from 05:40 (40 minutes later).
    ev('d4', ID, 'screen_view', '2026-10-09T06:00:00Z', 'GameType'),
    ev('d1', ID, 'app_open', '2026-10-09T05:00:00Z'),
    ev('d2', ID, 'screen_view', '2026-10-09T05:00:10Z', 'Home'),
    ev('d3', ID, 'screen_view', '2026-10-09T05:40:00Z', 'Modes'),
  ]);

  await t.db.insert(puzzles).values({
    id: 'p1',
    givens: '0'.repeat(81),
    solution: '1'.repeat(81),
    gameType: 'fast',
    givensCount: 0,
    source: 'test',
    pool: 'ranked',
  });
  const game = (
    id: string,
    mode: string,
    gameType: string,
    playerCount: number,
    started: string,
    ended: string | null,
  ) => ({
    id,
    mode,
    gameType,
    playerCount,
    puzzleId: 'p1',
    rules: { thinkTimeMs: 8000 },
    startedAt: at(started),
    endedAt: ended === null ? null : at(ended),
    endReason: ended === null ? null : 'boardComplete',
  });
  await t.db
    .insert(games)
    .values([
      game('g1', 'ranked', 'fast', 2, '2026-10-08T10:00:00Z', '2026-10-08T10:05:00Z'),
      game('g2', 'ranked', 'fast', 3, '2026-10-07T10:00:00Z', '2026-10-07T10:09:00Z'),
      game('g3', 'ranked', 'normal', 2, '2026-10-09T09:00:00Z', null),
      game('g4', 'friend', 'fast', 2, '2026-10-06T10:00:00Z', '2026-10-06T10:07:00Z'),
    ]);
  const seat = (
    gameId: string,
    s: number,
    userId: string | null,
    place: number | null,
    finalScore: number | null,
    mistakes: number | null,
    status = 'active',
  ) => ({ gameId, seat: s, userId, place, finalScore, mistakes, status });
  await t.db.insert(gamePlayers).values([
    { ...seat('g1', 1, 'u2', 2, 10, 3), ratingKey: 'fast', ratingBefore: 1197.5, ratingAfter: 1180 },
    { ...seat('g1', 0, 'u1', 1, 20.5, 1), ratingKey: 'fast', ratingBefore: 1270, ratingAfter: 1287.5 },
    seat('g2', 0, 'u2', 1, 15, 0),
    seat('g2', 1, 'u1', 2, 12, 2),
    seat('g2', 2, null, 3, -4, 5, 'abandoned'),
    seat('g3', 0, 'u1', null, null, null),
    seat('g3', 1, 'u2', null, null, null),
    // A shared first place: a win for both.
    seat('g4', 0, 'u1', 1, 30, 0),
    seat('g4', 1, 'u2', 1, 30, 1),
  ]);
  await t.db.insert(gameEvents).values([
    { gameId: 'g1', seq: 3, tMs: ms('2026-10-08T10:00:05Z'), type: 'cellLocked', payload: { cell: 4 } },
    { gameId: 'g1', seq: 1, tMs: ms('2026-10-08T09:59:58Z'), type: 'gameCreated', payload: { config: {} } },
    { gameId: 'g1', seq: 2, tMs: ms('2026-10-08T10:00:00Z'), type: 'gameStarted', payload: {} },
  ]);
}, 30_000); // a cold PGlite takes seconds when many suites start at once
afterAll(async () => {
  await http.close();
  await t.close();
});

const ROW_A: AdminInstallRow = {
  id: IA,
  platform: 'android',
  appVersion: '0.2.0',
  firstSeen: ms('2026-10-01T09:00:00Z'),
  lastSeen: ms('2026-10-09T11:00:00Z'),
  userId: 'u1',
  userName: 'Moshe',
  events: 3,
};
const ROW_B: AdminInstallRow = {
  id: IB,
  platform: 'ios',
  appVersion: '0.1.0',
  firstSeen: ms('2026-10-02T09:00:00Z'),
  lastSeen: ms('2026-10-08T09:00:00Z'),
  userId: 'u1',
  userName: 'Moshe',
  events: 1,
};

const ids = (page: AdminPage<{ id: string }>) => page.items.map((i) => i.id);

describe('GET /admin/api/installs', () => {
  it('lists every install, last seen first, with its user and event count', async () => {
    const res = await admin.get<AdminPage<AdminInstallRow>>('/installs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        ROW_A,
        {
          id: ID,
          platform: 'ios',
          appVersion: '0.2.0',
          firstSeen: ms('2026-10-04T09:00:00Z'),
          lastSeen: ms('2026-10-09T06:00:00Z'),
          userId: null,
          userName: null,
          events: 4,
        },
        ROW_B,
        {
          id: IC,
          platform: 'android',
          appVersion: '0.1.1',
          firstSeen: ms('2026-10-03T09:00:00Z'),
          lastSeen: ms('2026-10-05T09:00:00Z'),
          userId: 'u2',
          userName: 'Dana_100%',
          events: 0,
        },
      ],
      page: 1,
      pageSize: 50,
      total: 4,
    });
  });

  it.each([
    ['moshe', [IA, IB]],
    ['IOS', [ID, IB]],
    ['0.1.', [IB, IC]],
    ['0b0b0b0b', [IB]],
    ['EXAMPLE.com', [IA, IB]],
    ['u2', [IC]],
    // Pattern characters are taken literally: only Dana_100% has a % or an _.
    ['%', [IC]],
    ['_', [IC]],
    ['  dana  ', [IC]],
    ['nobody', []],
  ])('search %j', async (search, expected) => {
    const res = await admin.get<AdminPage<AdminInstallRow>>('/installs', { search });
    expect(ids(res.body)).toEqual(expected);
    expect(res.body.total).toBe(expected.length);
  });

  it('pages', async () => {
    const page = (n: number) => admin.get<AdminPage<AdminInstallRow>>('/installs', { page: n, pageSize: 3 });
    expect((await page(1)).body).toMatchObject({ page: 1, pageSize: 3, total: 4 });
    expect(ids((await page(1)).body)).toEqual([IA, ID, IB]);
    expect(ids((await page(2)).body)).toEqual([IC]);
    expect((await page(3)).body).toEqual({ items: [], page: 3, pageSize: 3, total: 4 });
  });

  it('refuses bad paging and over-long searches', async () => {
    const queries: Record<string, string | number>[] = [
      { page: 0 },
      { page: 'x' },
      { pageSize: 0 },
      { pageSize: 201 },
      { pageSize: '1e2' },
      { search: 'x'.repeat(101) },
    ];
    for (const query of queries) {
      const res = await admin.get('/installs', query);
      expect({ query, status: res.status }).toEqual({ query, status: 400 });
    }
    const repeated = await fetch(`${http.url}/admin/api/installs?page=1&page=2`, {
      headers: { cookie: admin.cookie },
    });
    expect(repeated.status).toBe(400);
    expect((await admin.get('/installs', { pageSize: 200 })).status).toBe(200);
  });

  it('search strings that look like SQL are just text', async () => {
    for (const search of [
      "' or 1=1 --",
      "%'; drop table installs; --",
      '\\',
      "x' union select * from users --",
    ]) {
      const res = await admin.get<AdminPage<AdminInstallRow>>('/installs', { search });
      expect({ search, status: res.status, total: res.body.total }).toEqual({
        search,
        status: 200,
        total: 0,
      });
    }
    const res = await admin.get<AdminPage<AdminUserRow>>('/users', { search: "' or ''='" });
    expect([res.status, res.body.total]).toEqual([200, 0]);
    expect((await admin.get<AdminPage<AdminInstallRow>>('/installs')).body.total).toBe(4);
  });
});

describe('GET /admin/api/installs/:id', () => {
  it('the install with its latest events and its sessions, newest first', async () => {
    const res = await admin.get<AdminInstallDetail>(`/installs/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.recentEvents.map((e) => e.id)).toEqual(['d4', 'd3', 'd2', 'd1']);
    expect(res.body.recentEvents[0]).toEqual({
      id: 'd4',
      name: 'screen_view',
      props: { screen: 'GameType' },
      tClient: ms('2026-10-09T06:00:00Z'),
      tServer: ms('2026-10-09T06:00:00Z'),
    });
    expect(res.body.sessions).toEqual([
      {
        startedAt: ms('2026-10-09T05:40:00Z'),
        endedAt: ms('2026-10-09T06:00:00Z'),
        screens: ['Modes', 'GameType'],
      },
      { startedAt: ms('2026-10-09T05:00:00Z'), endedAt: ms('2026-10-09T05:00:10Z'), screens: ['Home'] },
    ]);
    expect(res.body).toMatchObject({ id: ID, events: 4, userId: null });
  });

  it('a session without screens has an empty list; ids are found in any case', async () => {
    const res = await admin.get<AdminInstallDetail>(`/installs/${IB.toUpperCase()}`);
    expect(res.body).toEqual({
      ...ROW_B,
      recentEvents: [
        {
          id: 'b1',
          name: 'app_open',
          props: {},
          tClient: ms('2026-10-08T09:00:00Z'),
          tServer: ms('2026-10-08T09:00:00Z'),
        },
      ],
      sessions: [{ startedAt: ms('2026-10-08T09:00:00Z'), endedAt: ms('2026-10-08T09:00:00Z'), screens: [] }],
    });
    const none = await admin.get<AdminInstallDetail>(`/installs/${IC}`);
    expect(none.body).toMatchObject({ recentEvents: [], sessions: [] });
  });

  it('shows at most the latest 200 events', async () => {
    const many = Array.from({ length: RECENT_EVENTS_LIMIT + 5 }, (_, k) => ({
      id: `m${String(k).padStart(3, '0')}`,
      installId: IC,
      name: 'app_open' as const,
      props: {},
      tClient: new Date(NOW - 1000 * (k + 1)),
      tServer: new Date(NOW),
    }));
    await t.db.insert(appEvents).values(many);
    try {
      const res = await admin.get<AdminInstallDetail>(`/installs/${IC}`);
      expect(res.body.recentEvents).toHaveLength(RECENT_EVENTS_LIMIT);
      expect(res.body.recentEvents[0]?.id).toBe('m000');
      expect(res.body.events).toBe(RECENT_EVENTS_LIMIT + 5);
    } finally {
      await t.db.delete(appEvents).where(eq(appEvents.installId, IC));
    }
  });

  it('404 for an unknown install', async () => {
    expect(await admin.get('/installs/nope')).toMatchObject({ status: 404, body: { error: 'notFound' } });
    expect((await admin.get(`/installs/${'x'.repeat(300)}`)).status).toBe(404);
  });
});

describe('GET /admin/api/users', () => {
  const U1: AdminUserRow = {
    id: 'u1',
    displayName: 'Moshe',
    email: 'moshe@example.com',
    country: 'IL',
    avatarId: 'av07',
    createdAt: ms('2026-10-01T09:00:00Z'),
    deletedAt: null,
    lastSeen: ms('2026-10-09T11:00:00Z'),
    games: 4,
    bestRating: 1287.5,
  };

  it('lists users, latest activity first, with games and best rating; deleted ones too', async () => {
    const res = await admin.get<AdminPage<AdminUserRow>>('/users');
    expect(res.body).toEqual({
      items: [
        U1,
        {
          id: 'u2',
          displayName: 'Dana_100%',
          email: null,
          country: null,
          avatarId: null,
          createdAt: ms('2026-10-02T09:00:00Z'),
          deletedAt: null,
          lastSeen: ms('2026-10-05T09:00:00Z'),
          games: 4,
          bestRating: 1180,
        },
        {
          id: 'u3',
          displayName: 'Old',
          email: null,
          country: null,
          avatarId: null,
          createdAt: ms('2026-09-01T09:00:00Z'),
          deletedAt: ms('2026-10-05T09:00:00Z'),
          lastSeen: null,
          games: 0,
          bestRating: null,
        },
      ],
      page: 1,
      pageSize: 50,
      total: 3,
    });
  });

  it.each([
    ['MOSHE', ['u1']],
    ['example', ['u1']],
    ['fb-', ['u1', 'u2', 'u3']],
    ['il', ['u1']],
    ['100%', ['u2']],
    ['_1', ['u2']],
    ['u3', ['u3']],
  ])('search %j', async (search, expected) => {
    const res = await admin.get<AdminPage<AdminUserRow>>('/users', { search });
    expect(ids(res.body)).toEqual(expected);
  });

  it('pages', async () => {
    const res = await admin.get<AdminPage<AdminUserRow>>('/users', { page: 2, pageSize: 2 });
    expect([ids(res.body), res.body.total]).toEqual([['u3'], 3]);
  });

  it('a user in full: ratings, stats (a win is place 1), newest games, installs', async () => {
    const res = await admin.get<AdminUserDetail>('/users/u1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...U1,
      // 650 XP: 200 to level 2, 400 to level 3, 50 into it.
      xp: 650,
      level: 3,
      ratings: [
        { key: 'fast', rating: 1287.5, games: 12, provisional: false, peak: 1300 },
        { key: 'normal', rating: 1210, games: 3, provisional: true, peak: 1215 },
      ],
      // g1 won, g2 second, g3 running, g4 a shared first place.
      stats: { games: 4, wins: 2, losses: 1, winRate: 2 / 3, avgMistakes: 1, avgScore: 62.5 / 3 },
      recentGames: [
        {
          gameId: 'g3',
          mode: 'ranked',
          gameType: 'normal',
          playerCount: 2,
          startedAt: ms('2026-10-09T09:00:00Z'),
          endedAt: null,
          place: null,
          finalScore: null,
          mistakes: null,
          status: 'active',
          ratingKey: null,
          ratingBefore: null,
          ratingAfter: null,
        },
        {
          gameId: 'g1',
          mode: 'ranked',
          gameType: 'fast',
          playerCount: 2,
          startedAt: ms('2026-10-08T10:00:00Z'),
          endedAt: ms('2026-10-08T10:05:00Z'),
          place: 1,
          finalScore: 20.5,
          mistakes: 1,
          status: 'active',
          ratingKey: 'fast',
          ratingBefore: 1270,
          ratingAfter: 1287.5,
        },
        expect.objectContaining({ gameId: 'g2', place: 2, finalScore: 12 }),
        expect.objectContaining({ gameId: 'g4', place: 1, mode: 'friend' }),
      ],
      installs: [ROW_A, ROW_B],
      cheatFlags: [],
    });
  });

  it('stats of a user without games are empty, not zero', async () => {
    const res = await admin.get<AdminUserDetail>('/users/u3');
    expect(res.body).toMatchObject({
      xp: 0,
      level: 1,
      ratings: [],
      recentGames: [],
      installs: [],
      stats: { games: 0, wins: 0, losses: 0, winRate: null, avgMistakes: null, avgScore: null },
    });
    const u2 = await admin.get<AdminUserDetail>('/users/u2');
    expect(u2.body.stats).toEqual({
      games: 4,
      wins: 2,
      losses: 1,
      winRate: 2 / 3,
      avgMistakes: 4 / 3,
      avgScore: 55 / 3,
    });
  });

  it('404 for an unknown user', async () => {
    expect(await admin.get('/users/nope')).toMatchObject({ status: 404, body: { error: 'notFound' } });
  });
});

describe('GET /admin/api/games', () => {
  it('lists games, newest first, with their players in seat order', async () => {
    const res = await admin.get<AdminPage<AdminGameRow>>('/games');
    expect(ids(res.body)).toEqual(['g3', 'g1', 'g2', 'g4']);
    expect(res.body.total).toBe(4);
    expect(res.body.items[1]).toEqual({
      id: 'g1',
      mode: 'ranked',
      gameType: 'fast',
      playerCount: 2,
      puzzleId: 'p1',
      startedAt: ms('2026-10-08T10:00:00Z'),
      endedAt: ms('2026-10-08T10:05:00Z'),
      endReason: 'boardComplete',
      players: [
        {
          userId: 'u1',
          displayName: 'Moshe',
          seat: 0,
          finalScore: 20.5,
          mistakes: 1,
          place: 1,
          status: 'active',
          ratingKey: 'fast',
          ratingBefore: 1270,
          ratingAfter: 1287.5,
        },
        {
          userId: 'u2',
          displayName: 'Dana_100%',
          seat: 1,
          finalScore: 10,
          mistakes: 3,
          place: 2,
          status: 'active',
          ratingKey: 'fast',
          ratingBefore: 1197.5,
          ratingAfter: 1180,
        },
      ],
    });
    // A seat without an account (a bot): no user, no name.
    expect(res.body.items[2]?.players[2]).toMatchObject({
      userId: null,
      displayName: null,
      status: 'abandoned',
    });
  });

  it('filters by mode and searches ids and player names', async () => {
    const get = async (query: Record<string, string>) =>
      ids((await admin.get<AdminPage<AdminGameRow>>('/games', query)).body);
    expect(await get({ mode: 'ranked' })).toEqual(['g3', 'g1', 'g2']);
    expect(await get({ mode: 'friend' })).toEqual(['g4']);
    expect(await get({ mode: 'nothing' })).toEqual([]);
    expect(await get({ search: 'g2' })).toEqual(['g2']);
    expect(await get({ search: 'dana_' })).toEqual(['g3', 'g1', 'g2', 'g4']);
    expect(await get({ search: 'P1' })).toEqual(['g3', 'g1', 'g2', 'g4']);
    expect(await get({ mode: 'ranked', search: 'g4' })).toEqual([]);
    expect(await get({ search: "'; delete from games; --" })).toEqual([]);
    const paged = await admin.get<AdminPage<AdminGameRow>>('/games', { page: 2, pageSize: 3 });
    expect([ids(paged.body), paged.body.total]).toEqual([['g4'], 4]);
  });

  it('a game in full: rules and the event log in seq order', async () => {
    const res = await admin.get<AdminGameDetail>('/games/g1');
    expect(res.status).toBe(200);
    expect(res.body.rules).toEqual({ thinkTimeMs: 8000 });
    expect(res.body.events).toEqual([
      { seq: 1, tMs: ms('2026-10-08T09:59:58Z'), type: 'gameCreated', payload: { config: {} } },
      { seq: 2, tMs: ms('2026-10-08T10:00:00Z'), type: 'gameStarted', payload: {} },
      { seq: 3, tMs: ms('2026-10-08T10:00:05Z'), type: 'cellLocked', payload: { cell: 4 } },
    ]);
    expect(res.body.players.map((p) => p.seat)).toEqual([0, 1]);
    const empty = await admin.get<AdminGameDetail>('/games/g4');
    expect(empty.body.events).toEqual([]);
  });

  it('404 for an unknown game', async () => {
    expect(await admin.get('/games/nope')).toMatchObject({ status: 404, body: { error: 'notFound' } });
  });
});
