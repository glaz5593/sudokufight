import { LEVEL_RULES, levelIdOf, levelRev, maxLevel } from '@sudoku-fight/engine';
import {
  ADMIN_API_PREFIX,
  type AdminGateStat,
  type AdminLevels,
  type AdminLevelStat,
  type AdminUserDetail,
  type TelemetryEventName,
  type TelemetryProps,
} from '@sudoku-fight/protocol';

import { appEvents, installs, userLevels, users } from '../db/schema';
import {
  type AdminClient,
  createTestDb,
  fakeClock,
  getUrl,
  signedInAdmin,
  startHttp,
  type TestDb,
  type TestHttp,
  testConfig,
} from '../testing';
import { GATE_STUCK_ATTEMPTS, GATE_STUCK_SHARE, LEVEL_TOO_HARD_SHARE } from './constants';
import { getLevels, LEGACY_LEVEL_REV } from './levels';

/**
 * GET /admin/api/levels (plan §5.5) on a small dataset whose numbers are worked out by hand below.
 * Now: 2026-10-09 12:00 UTC = 15:00 in Jerusalem. The default 30-day window starts at midnight on 10 September
 * in Jerusalem (21:00 UTC on the 9th); a 1-day window at midnight today (21:00 UTC on the 8th).
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

const INSTALLS = ['a', 'b', 'c', 'd', 'e'] as const;
type InstallId = (typeof INSTALLS)[number];

let eventNo = 0;
function event(
  installId: InstallId,
  name: TelemetryEventName,
  tClient: string,
  props: TelemetryProps,
  tServer: string = tClient,
) {
  eventNo++;
  return { id: `e${eventNo}`, installId, name, props, tClient: at(tClient), tServer: at(tServer) };
}

/** The rev level n is at now (the engine's levelRev): what a 1.0.3 app sends with it [D73]. */
const revAt = (n: number) => (Number.isInteger(n) && n >= 1 ? levelRev(levelIdOf(n)) : LEGACY_LEVEL_REV);

/** A level_start with the props the app sends (the level's current rev, unless `over` says otherwise). */
const start = (
  id: InstallId,
  tClient: string,
  level: number,
  attempt: number,
  kind = 'find',
  over: TelemetryProps = {},
) =>
  event(id, 'level_start', tClient, {
    level,
    rev: revAt(level),
    chapter: 1,
    kind,
    attempt,
    bestStars: 0,
    quick: false,
    ...over,
  });

/** A level_end; `over` replaces or adds props (junk included). */
function end(
  id: InstallId,
  tClient: string,
  props: { level: number; stars: number; attempt: number; durationMs: number; reason: string },
  over: TelemetryProps = {},
  tServer?: string,
) {
  return event(
    id,
    'level_end',
    tClient,
    {
      kind: 'find',
      rev: revAt(props.level),
      prevBest: 0,
      mistakes: 0,
      metric: null,
      botLevel: null,
      ...props,
      ...over,
    },
    tServer,
  );
}

/** A level_quit (the app went away mid-level). */
const quit = (id: InstallId, tClient: string, level: number, over: TelemetryProps = {}) =>
  event(id, 'level_quit', tClient, { level, rev: revAt(level), atMs: 3_000, ...over });

/** An event as a 1.0.2 app sent it: no rev. */
const withoutRev = <E extends { props: TelemetryProps }>(e: E): E => {
  const props = { ...e.props };
  delete props.rev;
  return { ...e, props };
};

/** A chapter_gate; junk may come in as a string. */
const gate = (id: InstallId, tClient: string, chapter: number | string, open: boolean | string) =>
  event(id, 'chapter_gate', tClient, { chapter, stars: 18, open });

const DAY5 = '2026-10-05T10:00:00Z';
const TODAY = '2026-10-09T08:00:00Z';

/** A level nobody played. */
function empty(levelId: string, chapter: number, boss = false): AdminLevelStat {
  return {
    levelId,
    chapter,
    boss,
    kind: null,
    starts: 0,
    plays: 0,
    players: 0,
    stars: [0, 0, 0, 0],
    medianMs: null,
    replayRate: null,
    midQuitRate: null,
    quitRate: null,
    firstTries: 0,
    firstTryZeroRate: null,
  };
}

const level = (body: AdminLevels, id: string) => body.levels.find((l) => l.levelId === id);
const gateOf = (body: AdminLevels, chapter: number) => body.gates.find((g) => g.chapter === chapter);

describe('GET /admin/api/levels', () => {
  beforeEach(async () => {
    await t.db.insert(installs).values(
      INSTALLS.map((id) => ({
        id,
        platform: 'android' as const,
        appVersion: '1.0.2',
        firstSeen: at('2026-07-01T00:00:00Z'),
        lastSeen: at(TODAY),
      })),
    );
    await t.db.insert(appEvents).values([
      // L001 on the 5th. a: 0★ then 2★ on the second try; b: 0★ (a second wrong tap); c: 3★; d: the X on the
      // first try, then a start left when the app went away (level_quit).
      start('a', DAY5, 1, 1),
      end('a', DAY5, { level: 1, stars: 0, attempt: 1, durationMs: 30_000, reason: 'timeUp' }),
      start('a', DAY5, 1, 2, 'fillBox'), // one start says another kind: the most frequent wins
      end('a', DAY5, { level: 1, stars: 2, attempt: 2, durationMs: 12_000, reason: 'completed' }),
      start('b', DAY5, 1, 1),
      end('b', DAY5, { level: 1, stars: 0, attempt: 1, durationMs: 8_000, reason: 'failed' }),
      start('c', DAY5, 1, 1),
      end('c', DAY5, { level: 1, stars: 3, attempt: 1, durationMs: 4_000, reason: 'completed' }),
      start('d', DAY5, 1, 1),
      end('d', DAY5, { level: 1, stars: 0, attempt: 1, durationMs: 5_000, reason: 'quit' }),
      start('d', DAY5, 1, 2),
      quit('d', DAY5, 1),

      // L002 today, fillBox. c is on its third try (the first two before the window).
      start('a', TODAY, 2, 1, 'fillBox'),
      end(
        'a',
        TODAY,
        { level: 2, stars: 1, attempt: 1, durationMs: 20_000, reason: 'completed' },
        { kind: 'fillBox' },
      ),
      end(
        'b',
        TODAY,
        { level: 2, stars: 3, attempt: 1, durationMs: 6_000, reason: 'completed' },
        { kind: 'fillBox' },
      ),
      end(
        'c',
        TODAY,
        { level: 2, stars: 2, attempt: 3, durationMs: 9_000, reason: 'completed' },
        { kind: 'fillBox' },
      ),

      // L010, the boss of chapter 1: a play whose attempt is not a number (counted, but in no rate of attempts).
      end(
        'e',
        DAY5,
        { level: 10, stars: 2, attempt: 1, durationMs: 14_000, reason: 'completed' },
        {
          kind: 'fillBox',
          attempt: 'x',
        },
      ),

      // Not counted: L003 before the window (also when it arrived inside it), and props of the wrong kind.
      end('a', '2026-09-01T10:00:00Z', {
        level: 3,
        stars: 3,
        attempt: 1,
        durationMs: 5_000,
        reason: 'completed',
      }),
      end(
        'b',
        '2026-09-09T20:00:00Z',
        { level: 3, stars: 3, attempt: 1, durationMs: 5_000, reason: 'completed' },
        {},
        '2026-10-01T10:00:00Z',
      ),
      start('a', '2026-09-01T10:00:00Z', 3, 1),
      end('e', DAY5, { level: 1, stars: 3, attempt: 1, durationMs: 1, reason: 'completed' }, { level: '1' }),
      end('e', DAY5, { level: 1, stars: 3, attempt: 1, durationMs: 1, reason: 'completed' }, { level: 1.5 }),
      end('e', DAY5, { level: 0, stars: 3, attempt: 1, durationMs: 1, reason: 'completed' }),
      end('e', DAY5, {
        level: maxLevel(LEVEL_RULES) + 1,
        stars: 3,
        attempt: 1,
        durationMs: 1,
        reason: 'completed',
      }),
      end(
        'e',
        DAY5,
        { level: 2, stars: 5, attempt: 1, durationMs: 1, reason: 'completed' },
        { kind: 'nonsense' },
      ),
      end('e', DAY5, { level: 2, stars: 3, attempt: 1, durationMs: 1, reason: 'completed' }, { stars: '3' }),
      event('e', 'level_quit', DAY5, { level: '3', atMs: 1_000 }),
      event('e', 'level_map_open', DAY5, { level: 3, stars: 9 }),
      event('e', 'screen_view', DAY5, { screen: '/levels', level: 3 }),

      // The gate to chapter 2 (all time). a: three closed attempts, then it opens; b: three closed; c: two in
      // the window and one long before it; d: opens it at once; e: two closed.
      ...[1, 2, 3].map((k) => gate('a', `2026-10-0${k}T10:00:00Z`, 2, false)),
      gate('a', '2026-10-04T10:00:00Z', 2, true),
      ...[1, 2, 3].map((k) => gate('b', `2026-10-0${k}T10:00:00Z`, 2, false)),
      gate('c', '2026-08-01T10:00:00Z', 2, false),
      gate('c', '2026-10-01T10:00:00Z', 2, false),
      gate('c', '2026-10-02T10:00:00Z', 2, false),
      gate('d', '2026-10-01T10:00:00Z', 2, true),
      gate('e', '2026-10-01T10:00:00Z', 2, false),
      gate('e', '2026-10-02T10:00:00Z', 2, false),
      // The gate to chapter 3: a opens it on the first attempt. The rest is junk.
      gate('a', '2026-10-05T10:00:00Z', 3, true),
      gate('b', '2026-10-05T10:00:00Z', '3', true),
      gate('b', '2026-10-05T10:00:00Z', 3, 'yes'),
      gate('b', '2026-10-05T10:00:00Z', 3.5, true),
      gate('b', '2026-10-05T10:00:00Z', 1, false),
      gate('b', '2026-10-05T10:00:00Z', LEVEL_RULES.chapterCount + 1, false),
    ]);
  });

  it('every level and every gate, with the numbers worked out by hand', async () => {
    const res = await admin.get<AdminLevels>('/levels');
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).toMatchObject({
      days: 30,
      tooHardShare: LEVEL_TOO_HARD_SHARE,
      stuckShare: GATE_STUCK_SHARE,
      stuckAttempts: GATE_STUCK_ATTEMPTS,
    });
    expect([LEVEL_TOO_HARD_SHARE, GATE_STUCK_SHARE, GATE_STUCK_ATTEMPTS]).toEqual([0.6, 0.3, 3]);

    // Every level in order, every gate (2 … 30) in order.
    expect(body.levels).toHaveLength(maxLevel(LEVEL_RULES));
    expect(body.levels.map((l) => l.levelId).slice(0, 3)).toEqual(['L001', 'L002', 'L003']);
    expect(body.levels.at(-1)).toEqual(empty('L300', 30, true));
    expect(body.gates.map((g) => g.chapter)).toEqual(
      Array.from({ length: LEVEL_RULES.chapterCount - 1 }, (_, k) => k + 2),
    );

    expect(level(body, 'L001')).toEqual({
      ...empty('L001', 1),
      kind: 'find',
      starts: 6,
      plays: 5,
      players: 4,
      stars: [3, 0, 1, 1],
      // Without d's quit: 4, 8, 12, 30 s → between 8 and 12.
      medianMs: 10_000,
      // a's second try, of five plays.
      replayRate: 1 / 5,
      // d's level_quit, of six starts.
      midQuitRate: 1 / 6,
      quitRate: 1 / 5,
      // First tries a, b, c, d: three with 0 stars. Above 60%: too hard.
      firstTries: 4,
      firstTryZeroRate: 3 / 4,
    });
    expect(level(body, 'L002')).toEqual({
      ...empty('L002', 1),
      kind: 'fillBox',
      starts: 1,
      plays: 3,
      players: 3,
      stars: [0, 1, 1, 1],
      // 6, 9, 20 s.
      medianMs: 9_000,
      replayRate: 1 / 3,
      midQuitRate: 0,
      quitRate: 0,
      firstTries: 2,
      firstTryZeroRate: 0,
    });
    expect(level(body, 'L010')).toEqual({
      ...empty('L010', 1, true),
      kind: 'fillBox',
      plays: 1,
      players: 1,
      stars: [0, 0, 1, 0],
      medianMs: 14_000,
      quitRate: 0,
    });
    // Outside the window, or junk.
    expect(level(body, 'L003')).toEqual(empty('L003', 1));
    expect(body.levels.filter((l) => l.plays > 0 || l.starts > 0).map((l) => l.levelId)).toEqual([
      'L001',
      'L002',
      'L010',
    ]);

    const gate2: AdminGateStat = {
      chapter: 2,
      reached: 5,
      opened: 2,
      stuck: 3,
      // b, and c with its old attempt; a opened it after three; e has only two.
      stuckAfter3: 2,
      stuckAfter3Rate: 2 / 5,
    };
    expect(gateOf(body, 2)).toEqual(gate2);
    expect(gateOf(body, 3)).toEqual({
      chapter: 3,
      reached: 1,
      opened: 1,
      stuck: 0,
      stuckAfter3: 0,
      stuckAfter3Rate: 0,
    });
    expect(gateOf(body, 4)).toEqual({
      chapter: 4,
      reached: 0,
      opened: 0,
      stuck: 0,
      stuckAfter3: 0,
      stuckAfter3Rate: null,
    });
  });

  it('a shorter window sees only its own days; the gates are all time anyway', async () => {
    const res = await admin.get<AdminLevels>('/levels', { days: 1 });
    expect(res.body.days).toBe(1);
    expect(level(res.body, 'L001')).toEqual(empty('L001', 1));
    expect(level(res.body, 'L002')).toMatchObject({ plays: 3, medianMs: 9_000 });
    expect(gateOf(res.body, 2)).toMatchObject({ reached: 5, stuckAfter3: 2 });
  });

  it('with no events: every level and gate, all empty', async () => {
    await t.reset();
    const res = await admin.get<AdminLevels>('/levels');
    expect(res.body.levels.every((l) => l.plays === 0 && l.firstTryZeroRate === null)).toBe(true);
    expect(res.body.levels.filter((l) => l.boss).map((l) => l.levelId)).toHaveLength(
      LEVEL_RULES.chapterCount,
    );
    expect(res.body.gates.every((g) => g.reached === 0 && g.stuckAfter3Rate === null)).toBe(true);
  });

  it('refuses a bad days value, and answers 401 without a session', async () => {
    for (const days of ['0', '367', 'x']) {
      const res = await admin.get('/levels', { days });
      expect({ days, status: res.status, body: res.body }).toMatchObject({
        days,
        status: 400,
        body: { error: 'badRequest' },
      });
    }
    const anonymous = await getUrl(`${http.url}${ADMIN_API_PREFIX}/levels`);
    expect({ status: anonymous.status, body: anonymous.body }).toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
  });
});

describe('only the current rev of each level [D73]', () => {
  const WINDOW = { tz: testConfig().adminTz, now: NOW, days: 30 };

  beforeEach(async () => {
    await t.db.insert(installs).values(
      INSTALLS.map((id) => ({
        id,
        platform: 'android' as const,
        appVersion: '1.0.3',
        firstSeen: at('2026-07-01T00:00:00Z'),
        lastSeen: at(TODAY),
      })),
    );
    await t.db.insert(appEvents).values([
      // L003 at rev 1, from a 1.0.2 app (no rev): find, 3 stars twice, and a start left midway.
      withoutRev(start('a', DAY5, 3, 1)),
      withoutRev(end('a', DAY5, { level: 3, stars: 3, attempt: 1, durationMs: 4_000, reason: 'completed' })),
      withoutRev(start('b', DAY5, 3, 1)),
      withoutRev(end('b', DAY5, { level: 3, stars: 3, attempt: 1, durationMs: 5_000, reason: 'completed' })),
      withoutRev(start('c', DAY5, 3, 1)),
      withoutRev(quit('c', DAY5, 3)),
      // L003 rebuilt (rev 2) as a puzzle: a's second try, 1 star; d leaves midway.
      start('a', TODAY, 3, 2, 'puzzle', { rev: 2 }),
      end(
        'a',
        TODAY,
        { level: 3, stars: 1, attempt: 2, durationMs: 40_000, reason: 'completed' },
        { kind: 'puzzle', rev: 2 },
      ),
      start('d', TODAY, 3, 1, 'puzzle', { rev: 2 }),
      quit('d', TODAY, 3, { rev: 2 }),
      // Another rev (3); and a rev that is not a number, read as none (rev 1).
      end(
        'e',
        TODAY,
        { level: 3, stars: 0, attempt: 1, durationMs: 60_000, reason: 'timeUp' },
        { kind: 'puzzle', rev: 3 },
      ),
      end(
        'e',
        TODAY,
        { level: 3, stars: 2, attempt: 1, durationMs: 6_000, reason: 'completed' },
        { rev: '2' },
      ),
    ]);
  });

  it('at rev 2: only the rebuilt level’s plays, and its new kind', async () => {
    const body = await getLevels(t.db, WINDOW, { revOf: () => 2 });
    expect(level(body, 'L003')).toEqual({
      ...empty('L003', 1),
      kind: 'puzzle',
      starts: 2,
      plays: 1,
      players: 1,
      stars: [0, 1, 0, 0],
      medianMs: 40_000,
      replayRate: 1,
      midQuitRate: 1 / 2,
      quitRate: 0,
      firstTries: 0,
      firstTryZeroRate: null,
    });
  });

  it(`at rev ${LEGACY_LEVEL_REV}: the events without a rev are a 1.0.2 app’s, at rev 1`, async () => {
    const body = await getLevels(t.db, WINDOW, { revOf: () => LEGACY_LEVEL_REV });
    expect(level(body, 'L003')).toEqual({
      ...empty('L003', 1),
      kind: 'find',
      starts: 3,
      plays: 3,
      players: 3,
      stars: [0, 0, 1, 2],
      medianMs: 5_000,
      replayRate: 0,
      midQuitRate: 1 / 3,
      quitRate: 0,
      firstTries: 3,
      firstTryZeroRate: 0,
    });
  });

  it('allRevs: every rev mixed, as before 1.0.3', async () => {
    const body = await getLevels(t.db, WINDOW, { revOf: () => 2, allRevs: true });
    expect(level(body, 'L003')).toEqual({
      ...empty('L003', 1),
      kind: 'find', // 6 of find, 4 of puzzle
      starts: 5,
      plays: 5,
      players: 3,
      stars: [1, 1, 1, 2],
      medianMs: 6_000,
      replayRate: 1 / 5,
      midQuitRate: 2 / 5,
      quitRate: 0,
      firstTries: 4,
      firstTryZeroRate: 1 / 4,
    });
  });

  it('?allRevs=1 counts every rev, as getLevels(…, { allRevs: true }); off by default; a bad value is a 400', async () => {
    const all = (await admin.get<AdminLevels>('/levels', { allRevs: '1' })).body;
    expect(all).toEqual(await getLevels(t.db, WINDOW, { allRevs: true }));
    expect((await admin.get<AdminLevels>('/levels', { allRevs: 'true' })).body).toEqual(all);
    const now = await getLevels(t.db, WINDOW);
    expect((await admin.get<AdminLevels>('/levels', { allRevs: '0' })).body).toEqual(now);
    expect((await admin.get<AdminLevels>('/levels', { allRevs: '' })).body).toEqual(now);
    // The 1.0.2 plays (no rev, read as rev 1) are there only with the switch on.
    expect(level(all, 'L003')?.plays).toBe(5);
    const bad = await admin.get('/levels', { allRevs: 'maybe' });
    expect({ status: bad.status, body: bad.body }).toMatchObject({
      status: 400,
      body: { error: 'badRequest' },
    });
  });

  it('the route counts each level at the engine’s levelRev', async () => {
    const byRoute = (await admin.get<AdminLevels>('/levels')).body;
    expect(byRoute).toEqual(await getLevels(t.db, WINDOW));
    expect(byRoute).toEqual(await getLevels(t.db, WINDOW, { revOf: levelRev }));
    const playsAt: Record<number, number> = { 1: 3, 2: 1, 3: 1 };
    expect(level(byRoute, 'L003')?.plays).toBe(playsAt[levelRev('L003')] ?? 0);
  });
});

describe('GET /admin/api/users/:id: the synced level progress', () => {
  it('the levels played and their stars, only for an account that synced any', async () => {
    await t.db.insert(users).values([
      { id: 'u1', firebaseUid: 'f1', displayName: 'Ana' },
      { id: 'u2', firebaseUid: 'f2', displayName: 'Ben' },
    ]);
    await t.db.insert(userLevels).values([
      { userId: 'u1', levelId: 'L001', bestStars: 3, plays: 2 },
      { userId: 'u1', levelId: 'L002', bestStars: 1, plays: 1 },
      { userId: 'u1', levelId: 'L010', bestStars: 0, plays: 1 },
    ]);
    const u1 = await admin.get<AdminUserDetail>('/users/u1');
    expect(u1.body.levels).toEqual({ played: 3, stars: 4 });
    const u2 = await admin.get<AdminUserDetail>('/users/u2');
    expect(u2.status).toBe(200);
    expect('levels' in u2.body).toBe(false);
  });
});
