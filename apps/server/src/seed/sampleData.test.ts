import { type GameEvent, replay } from '@sudoku-fight/engine';
import type { AdminOverview, AdminPage, AdminUserDetail, AdminUserRow } from '@sudoku-fight/protocol';

import { createTestDb, fakeClock, signedInAdmin, startHttp, type TestDb, testConfig } from '../testing';
import { generateSampleData, SAMPLE_DEFAULTS, SAMPLE_SCREENS, type SampleData } from './sampleData';
import { countRows, hasSampleData, loadPuzzleBank, writeSampleData } from './store';

const NOW = Date.UTC(2026, 9, 9, 12);
const DAY = 24 * 3_600_000;
const bank = loadPuzzleBank();
const ms = (d: Date | null | undefined) => d?.getTime() ?? NaN;

let full: SampleData;
beforeAll(() => {
  full = generateSampleData({ now: NOW, puzzles: bank });
}, 30_000);

describe('generateSampleData', () => {
  it('is deterministic: the same seed and now give the same rows, another seed others', () => {
    const small = { now: NOW, puzzles: bank, installs: 40, users: 12, games: 8, days: 20 };
    expect(JSON.stringify(generateSampleData(small))).toBe(JSON.stringify(generateSampleData(small)));
    const other = generateSampleData({ ...small, seed: 7 });
    expect(other.installs.map((i) => i.id)).not.toEqual(generateSampleData(small).installs.map((i) => i.id));
  });

  it('has the asked-for size: installs, users, ranked games', () => {
    expect(full.installs).toHaveLength(SAMPLE_DEFAULTS.installs);
    expect(full.users).toHaveLength(SAMPLE_DEFAULTS.users);
    expect(full.games).toHaveLength(SAMPLE_DEFAULTS.games);
    expect(full.appEvents.length).toBeGreaterThan(5000);
    expect(new Set(full.installs.map((i) => i.platform))).toEqual(new Set(['ios', 'android']));
    expect(new Set(full.installs.map((i) => i.appVersion)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(full.games.map((g) => g.playerCount))).toEqual(new Set([2, 3, 4]));
  });

  it('tells a story of drop-off: many installs stop within a day or two', () => {
    const lives = full.installs.map((i) => (ms(i.lastSeen) - ms(i.firstSeen)) / DAY);
    expect(lives.filter((d) => d < 2).length / lives.length).toBeGreaterThan(0.4);
    expect(lives.filter((d) => d > 14).length).toBeGreaterThan(5);
    const linked = full.installs.filter((i) => i.userId !== null && i.userId !== undefined);
    expect(linked.length).toBeGreaterThanOrEqual(SAMPLE_DEFAULTS.users);
    // Named as the app names them (route patterns); test/appTelemetry.contract.test.ts holds them to its routes.
    const screens = new Set(
      full.appEvents.flatMap((e) => (e.name === 'screen_view' ? [e.props?.screen] : [])),
    );
    const S = SAMPLE_SCREENS;
    for (const s of [S.home, S.modes, S.gameType, S.botSelect, S.game, S.results, S.settings, S.login]) {
      expect(screens).toContain(s);
    }
    expect([...screens].filter((s) => !(Object.values(S) as unknown[]).includes(s))).toEqual([]);
  });

  it('is consistent: events within their install’s first and last seen, times never after now', () => {
    const byInstall = new Map(full.installs.map((i) => [i.id, i]));
    const seen = new Map<string, number[]>();
    for (const e of full.appEvents) {
      expect(byInstall.has(e.installId)).toBe(true);
      expect(ms(e.tClient)).toBeLessThanOrEqual(NOW);
      expect(ms(e.tServer)).toBeLessThanOrEqual(NOW);
      expect(ms(e.tServer)).toBeGreaterThanOrEqual(ms(e.tClient));
      const times = seen.get(e.installId) ?? [];
      times.push(ms(e.tClient));
      seen.set(e.installId, times);
    }
    for (const i of full.installs) {
      const times = seen.get(i.id) ?? [];
      expect([ms(i.firstSeen), ms(i.lastSeen)]).toEqual([Math.min(...times), Math.max(...times)]);
      expect(ms(i.firstSeen)).toBeGreaterThanOrEqual(NOW - SAMPLE_DEFAULTS.days * DAY);
    }
    const userIds = new Set(full.users.map((u) => u.id));
    for (const i of full.installs) if (i.userId) expect(userIds.has(i.userId)).toBe(true);
    for (const e of full.appEvents) if (e.userId) expect(userIds.has(e.userId)).toBe(true);
    for (const p of full.gamePlayers) expect(userIds.has(p.userId!)).toBe(true);
    const names = full.users.map((u) => u.displayName.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(full.appEvents.map((e) => e.id)).size).toBe(full.appEvents.length);
  });

  it('ranked games are real engine logs: they replay to the stored scores and places', () => {
    for (const game of full.games) {
      const rows = full.gameEvents.filter((e) => e.gameId === game.id);
      expect(rows.map((e) => e.seq)).toEqual(rows.map((_, k) => k + 1));
      const events = rows.map(
        (e) => ({ ...(e.payload as object), seq: e.seq, t: e.tMs, type: e.type }) as GameEvent,
      );
      const final = replay(events).at(-1)!;
      expect(final.status).toBe('over');
      expect(final.result?.reason).toBe(game.endReason);
      expect(final.startedAt).toBe(ms(game.startedAt));
      const players = full.gamePlayers.filter((p) => p.gameId === game.id);
      expect(players).toHaveLength(game.playerCount);
      for (const r of final.result!.ranking) {
        expect(players.find((p) => p.seat === r.seat)).toMatchObject({
          userId: r.playerId,
          finalScore: r.score,
          mistakes: r.mistakes,
          place: r.place,
        });
      }
    }
  });

  it('ratings follow the games: count, last rating, peak', () => {
    for (const rating of full.ratings) {
      const mine = full.gamePlayers
        .filter((p) => p.userId === rating.userId && p.ratingKey === rating.ratingKey)
        .map((p) => ({ p, at: ms(full.games.find((g) => g.id === p.gameId)?.startedAt) }))
        .sort((a, b) => a.at - b.at);
      expect(rating.games).toBe(mine.length);
      expect(rating.rating).toBe(mine.at(-1)?.p.ratingAfter);
      expect(rating.peak).toBe(Math.max(...mine.map(({ p }) => p.ratingAfter!), mine[0]!.p.ratingBefore!));
      expect(rating.provisional).toBe(mine.length < 10);
    }
  });
});

describe('writeSampleData', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 30_000); // a cold PGlite takes seconds when many suites start at once
  afterAll(() => t.close());

  it('fills the database, and the admin API reads it back', async () => {
    const data = generateSampleData({
      now: NOW,
      puzzles: bank,
      installs: 60,
      users: 15,
      games: 12,
      days: 30,
    });
    expect(await hasSampleData(t.db)).toBe(false);
    await writeSampleData(t.db, data);
    expect(await hasSampleData(t.db)).toBe(true);
    expect(await countRows(t.db)).toEqual({
      installs: data.installs.length,
      appEvents: data.appEvents.length,
      users: data.users.length,
      games: data.games.length,
      gameEvents: data.gameEvents.length,
      ratings: data.ratings.length,
    });

    const http = await startHttp({
      config: testConfig(),
      db: t.db,
      now: fakeClock(NOW).now,
      adminSiteDir: null,
    });
    try {
      const admin = await signedInAdmin(http.url);
      const overview = await admin.get<AdminOverview>('/overview', { days: 30 });
      expect(overview.body.totals).toMatchObject({
        installs: 60,
        games: 12,
        events: data.appEvents.length,
        users: data.users.filter((u) => !u.deletedAt).length,
      });
      expect(overview.body.installsPerDay.reduce((s, d) => s + d.count, 0)).toBe(60);
      const users = await admin.get<AdminPage<AdminUserRow>>('/users', { pageSize: 200 });
      const player = users.body.items.find((u) => u.games > 0)!;
      const detail = await admin.get<AdminUserDetail>(`/users/${player.id}`);
      expect(detail.body.stats.games).toBe(data.gamePlayers.filter((p) => p.userId === player.id).length);
      expect(detail.body.ratings).toHaveLength(1);
    } finally {
      await http.close();
    }
  }, 30_000);
});
