import type { AdminOverview, AdminScreens, TelemetryEventName, TelemetryProps } from '@sudoku-fight/protocol';

import { appEvents, games, installs, puzzles, users } from '../db/schema';
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
import { GONE_AFTER_DAYS, SESSION_GAP_MINUTES } from './constants';

/**
 * The statistics routes on a small dataset whose numbers are worked out by hand below.
 * Now: 2026-10-09 12:00 UTC = 15:00 in Jerusalem (UTC+3 in October).
 */
const NOW = Date.UTC(2026, 9, 9, 12);
const at = (iso: string) => new Date(iso);

let t: TestDb;
let http: TestHttp;
let admin: AdminClient;

beforeAll(async () => {
  t = await createTestDb();
  http = await startHttp({ config: testConfig(), db: t.db, now: fakeClock(NOW).now, adminSiteDir: null });
  admin = await signedInAdmin(http.url);
}, 30_000); // a cold PGlite takes seconds when many suites start at once
beforeEach(() => t.reset());
afterAll(async () => {
  await http.close();
  await t.close();
});

let eventNo = 0;
function event(
  installId: string,
  name: TelemetryEventName,
  tClient: string,
  props: TelemetryProps = {},
  tServer: string = tClient,
) {
  eventNo++;
  return { id: `e${eventNo}`, installId, name, props, tClient: at(tClient), tServer: at(tServer) };
}
const screen = (installId: string, name: string, tClient: string, tServer?: string) =>
  event(installId, 'screen_view', tClient, { screen: name }, tServer);

function install(id: string, firstSeen: string, lastSeen: string) {
  return {
    id,
    platform: 'android' as const,
    appVersion: '0.1.0',
    firstSeen: at(firstSeen),
    lastSeen: at(lastSeen),
  };
}

describe('GET /admin/api/overview', () => {
  beforeEach(async () => {
    await t.db.insert(installs).values([
      // First seen 23:30 on the 6th in Jerusalem: the day before a 3-day window (7th–9th).
      install('i1', '2026-10-06T20:30:00Z', '2026-10-07T10:00:00Z'),
      // 00:30 on the 7th in Jerusalem: the window's first day.
      install('i2', '2026-10-06T21:30:00Z', '2026-10-09T11:00:00Z'),
      // 23:30 UTC on the 8th is 02:30 on the 9th in Jerusalem.
      install('i3', '2026-10-08T23:30:00Z', '2026-10-08T23:45:00Z'),
      install('i4', '2026-09-20T08:00:00Z', '2026-09-25T08:00:00Z'),
      install('i5', '2026-10-06T19:00:00Z', '2026-10-06T20:00:00Z'),
    ]);
    await t.db.insert(appEvents).values([
      event('i1', 'game_end', '2026-10-07T10:00:00Z', { mode: 'solo' }),
      event('i2', 'app_open', '2026-10-06T21:30:00Z'),
      event('i2', 'screen_view', '2026-10-08T08:00:00Z', { screen: 'Home' }),
      event('i2', 'game_end', '2026-10-09T10:00:00Z', { mode: 'ranked' }),
      event('i2', 'game_end', '2026-10-09T11:00:00Z', { mode: 'solo' }),
      event('i3', 'app_open', '2026-10-08T23:30:00Z'),
      event('i3', 'game_end', '2026-10-08T23:45:00Z', { mode: 'bot' }),
      event('i4', 'game_end', '2026-09-20T08:00:00Z', { mode: 'bot' }),
      // Happened before the window (23:00 on the 6th in Jerusalem), arrived inside it: counts by when it happened.
      event('i5', 'app_open', '2026-10-06T20:00:00Z', {}, '2026-10-07T08:00:00Z'),
    ]);
    await t.db.insert(users).values([
      { id: 'u1', firebaseUid: 'f1', displayName: 'A' },
      { id: 'u2', firebaseUid: 'f2', displayName: 'B' },
      { id: 'u3', firebaseUid: 'f3', displayName: 'C', deletedAt: at('2026-10-01T00:00:00Z') },
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
    const game = (id: string, startedAt: string) => ({
      id,
      mode: 'ranked',
      gameType: 'fast',
      playerCount: 2,
      puzzleId: 'p1',
      rules: {},
      startedAt: at(startedAt),
    });
    await t.db
      .insert(games)
      .values([
        game('g1', '2026-10-08T22:00:00Z'),
        game('g2', '2026-10-07T12:00:00Z'),
        game('g3', '2026-09-01T12:00:00Z'),
      ]);
  });

  it('counts per day in the admin time zone, zero-filled, with totals and rolling activity', async () => {
    const res = await admin.get<AdminOverview>('/overview', { days: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      days: 3,
      totals: { installs: 5, users: 2, games: 3, practiceGames: 4, events: 9 },
      installsPerDay: [
        { day: '2026-10-07', count: 1 },
        { day: '2026-10-08', count: 0 },
        { day: '2026-10-09', count: 1 },
      ],
      activePerDay: [
        { day: '2026-10-07', count: 2 },
        { day: '2026-10-08', count: 1 },
        { day: '2026-10-09', count: 2 },
      ],
      // Seen after 12:00 UTC on the 8th: i2, i3. After 12:00 UTC on the 2nd: i1, i2, i3, i5.
      activeToday: 2,
      activeThisWeek: 4,
      gamesPerDay: [
        { day: '2026-10-07', count: 1 },
        { day: '2026-10-08', count: 0 },
        { day: '2026-10-09', count: 1 },
      ],
      practicePerDay: [
        { day: '2026-10-07', count: 1 },
        { day: '2026-10-08', count: 0 },
        { day: '2026-10-09', count: 2 },
      ],
    });
  });

  it('the same moments fall on other days in another time zone', async () => {
    const utc = await startHttp({
      config: testConfig({ adminTz: 'UTC' }),
      db: t.db,
      now: fakeClock(NOW).now,
      adminSiteDir: null,
    });
    try {
      const res = await (await signedInAdmin(utc.url)).get<AdminOverview>('/overview', { days: 3 });
      expect(res.body.installsPerDay).toEqual([
        { day: '2026-10-07', count: 0 },
        { day: '2026-10-08', count: 1 },
        { day: '2026-10-09', count: 0 },
      ]);
      expect(res.body.gamesPerDay.map((d) => d.count)).toEqual([1, 1, 0]);
    } finally {
      await utc.close();
    }
  });

  it('defaults to 30 days ending today; every day is there', async () => {
    const res = await admin.get<AdminOverview>('/overview');
    expect(res.body.days).toBe(30);
    for (const series of ['installsPerDay', 'activePerDay', 'gamesPerDay', 'practicePerDay'] as const) {
      expect(res.body[series]).toHaveLength(30);
      expect(res.body[series][0]?.day).toBe('2026-09-10');
      expect(res.body[series][29]?.day).toBe('2026-10-09');
    }
    // i4's practice game on 20 September is inside 30 days.
    expect(res.body.practicePerDay.find((d) => d.day === '2026-09-20')?.count).toBe(1);
    expect(res.body.installsPerDay.reduce((s, d) => s + d.count, 0)).toBe(5);
  });

  it('refuses a bad days value', async () => {
    for (const days of ['0', '367', 'abc', '1.5', '-3']) {
      const res = await admin.get('/overview', { days });
      expect({ days, status: res.status, error: (res.body as { error: string }).error }).toEqual({
        days,
        status: 400,
        error: 'badRequest',
      });
    }
  });
});

describe('GET /admin/api/screens', () => {
  beforeEach(async () => {
    await t.db
      .insert(installs)
      .values([
        install('s1', '2026-10-09T08:00:00Z', '2026-10-09T11:00:00Z'),
        install('s2', '2026-09-20T10:00:00Z', '2026-09-25T12:01:00Z'),
        install('s3', '2026-09-30T10:00:00Z', '2026-09-30T10:32:00Z'),
        install('s4', '2026-08-01T10:00:00Z', '2026-08-01T10:00:00Z'),
      ]);
    await t.db.insert(appEvents).values([
      // s1, still around. Session 1 ends on Results; 40 minutes later session 2 ends on Settings.
      event('s1', 'app_open', '2026-10-09T08:00:00Z'),
      screen('s1', 'Home', '2026-10-09T08:00:05Z'),
      screen('s1', 'Modes', '2026-10-09T08:01:00Z'),
      screen('s1', 'GameType', '2026-10-09T08:02:00Z'),
      screen('s1', 'Game', '2026-10-09T08:05:00Z'),
      screen('s1', 'Results', '2026-10-09T08:20:00Z'),
      screen('s1', 'Home', '2026-10-09T09:00:00Z'),
      // Not a screen name: ignored as a view, but still an event.
      event('s1', 'screen_view', '2026-10-09T09:05:00Z', { screen: 42 }),
      event('s1', 'screen_view', '2026-10-09T09:06:00Z', {}),
      screen('s1', 'Settings', '2026-10-09T09:10:00Z'),
      // Long before the window, sent late: not in it.
      screen('s1', 'Leaderboard', '2026-09-01T10:00:00Z', '2026-10-09T10:00:00Z'),

      // s2, gone (last seen 25 September). Three sessions; the very last screen is Modes.
      screen('s2', 'Home', '2026-09-20T10:00:00Z'),
      screen('s2', 'Modes', '2026-09-20T10:05:00Z'),
      screen('s2', 'Home', '2026-09-20T10:40:00Z'),
      screen('s2', 'Leaderboard', '2026-09-20T10:42:00Z'),
      event('s2', 'app_open', '2026-09-25T12:00:00Z'),
      screen('s2', 'Home', '2026-09-25T12:00:05Z'),
      screen('s2', 'Modes', '2026-09-25T12:01:00Z'),

      // s3, gone. One session: a gap of exactly 30 minutes does not end it. Last screen Profile.
      screen('s3', 'Home', '2026-09-30T10:00:00Z'),
      screen('s3', 'Settings', '2026-09-30T10:01:00Z'),
      screen('s3', 'Home', '2026-09-30T10:02:00Z'),
      screen('s3', 'Profile', '2026-09-30T10:32:00Z'),

      // s4, gone long ago: its last screen is outside a 30-day window.
      screen('s4', 'Home', '2026-08-01T10:00:00Z'),
    ]);
  });

  it('views, installs, sessions, exits, exit rate and the last screen of installs that left', async () => {
    const res = await admin.get<AdminScreens>('/screens');
    expect(res.status).toBe(200);
    const stat = (
      screenName: string,
      views: number,
      installsN: number,
      exits: number,
      opened: number,
      gone = 0,
    ) => ({
      screen: screenName,
      views,
      installs: installsN,
      exits,
      exitRate: exits / opened,
      lastScreenOfGone: gone,
    });
    expect(res.body).toEqual({
      days: 30,
      sessionGapMinutes: SESSION_GAP_MINUTES,
      goneAfterDays: GONE_AFTER_DAYS,
      sessions: 6,
      screens: [
        stat('Home', 7, 3, 0, 6),
        stat('Modes', 3, 2, 2, 3, 1),
        stat('Settings', 2, 2, 1, 2),
        stat('Game', 1, 1, 0, 1),
        stat('GameType', 1, 1, 0, 1),
        stat('Leaderboard', 1, 1, 1, 1),
        stat('Profile', 1, 1, 1, 1, 1),
        stat('Results', 1, 1, 1, 1),
      ],
    });
  });

  it('a shorter window sees only its own days', async () => {
    const res = await admin.get<AdminScreens>('/screens', { days: 1 });
    expect(res.body.sessions).toBe(2);
    expect(res.body.screens.map((s) => [s.screen, s.views, s.exits, s.lastScreenOfGone])).toEqual([
      ['Home', 2, 0, 0],
      ['Game', 1, 0, 0],
      ['GameType', 1, 0, 0],
      ['Modes', 1, 0, 0],
      ['Results', 1, 1, 0],
      ['Settings', 1, 1, 0],
    ]);
  });

  it('with no events: no screens and no sessions', async () => {
    await t.reset();
    expect((await admin.get<AdminScreens>('/screens')).body).toMatchObject({ sessions: 0, screens: [] });
  });
});
