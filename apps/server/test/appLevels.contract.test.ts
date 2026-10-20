/**
 * The contract between the app's staged-practice data and this server (1.0.2; dev-plan §2ו, §3.1) [D55, D57],
 * end to end: the app's own levels.db repository (apps/mobile/src/levels/levelsRepo.ts, on sql.js as in the
 * app's tests), its sync (levelsSync.ts) and its progress client with its answer guards (api/progressApi.ts),
 * all pure TypeScript the phone runs, against the real server (Express + an in-memory PGlite, a free port).
 *
 * - A phone plays and syncs: the server keeps each level's best, and pays 10 XP per best star.
 * - A second phone of the same account gets everything back on its first sync (a new phone, a reinstall).
 * - Both phones play: the server keeps the max of each level (stars and plays apart), and each phone ends with
 *   the best of both.
 * - A gate opened: 50 XP once; the same bests sent again pay nothing.
 * - A server without the route (the real server's own 404 for a path it does not have): the phone keeps its
 *   levels, waits LEVELS_DATA.unsupportedRetryMs without retrying, then sends them all.
 */
import type { AddressInfo } from 'node:net';

import { type FindLevelOver, levelIdOf, levelRev, maxLevel, type Stars } from '@sudoku-fight/engine';
import { devToken, type LevelBest, type MyProgress, PROGRESS_PATHS } from '@sudoku-fight/protocol';
import { asc, eq } from 'drizzle-orm';

// The app's code (pure TypeScript, no React Native): what the phone runs.
import { createAccountApi, type AccountFetch } from '../../mobile/src/api/accountApi';
import { createProgressApi, type ProgressApi } from '../../mobile/src/api/progressApi';
import { memoryDb, type SqlJsDb } from '../../mobile/src/game/testing/sqlJsDb';
import { LEVELS_DATA } from '../../mobile/src/levels/levelsConfig';
import { type FinishedLevel, type LevelsRepo, openLevelsRepo } from '../../mobile/src/levels/levelsRepo';
import { LevelsSync } from '../../mobile/src/levels/levelsSync';
import { createAppServer } from '../src/app';
import { userLevels } from '../src/db/schema';
import { createTestDb, fakeClock, type TestDb, testConfig } from '../src/testing';

const T = Date.UTC(2026, 9, 18, 9);
const clock = fakeClock(T);
let db: TestDb;
let server: ReturnType<typeof createAppServer>;
let url = '';

beforeAll(async () => {
  db = await createTestDb();
  server = createAppServer({ gracefullyShutdown: false, config: testConfig(), db, now: clock.now });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

const phoneDbs: SqlJsDb[] = [];
afterAll(async () => {
  phoneDbs.forEach((d) => d.close());
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await db.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

// ---- the players and their phones ---------------------------------------------------------------------

const realFetch: AccountFetch = (target, init) => fetch(target, init);

/** A registered player (a development token), and their progress client. */
async function account(name: string, uid: string) {
  const token = devToken(uid, `${uid}@private.example`);
  const getToken = () => Promise.resolve(token);
  const accounts = createAccountApi({ baseUrl: url, getToken, fetch: realFetch, timeoutMs: 10_000 });
  const me = await accounts.createUser({ displayName: name, avatarId: 'lava-lamp', country: 'IL' });
  const client = (f: AccountFetch = realFetch): ProgressApi =>
    createProgressApi({ baseUrl: url, getToken, fetch: f, timeoutMs: 10_000 });
  return { uid, me, client };
}

type Account = Awaited<ReturnType<typeof account>>;

/** Kind 1 ("איפה ה־7?"): ★★★ up to 5 s, ★★ up to 10 s, ★ up to 20 s. */
const find = (n: number): FinishedLevel => ({
  id: levelIdOf(n),
  rev: 1,
  kind: 'find',
  chapter: Math.ceil(n / 10),
  stars: { by: 'timeMs', three: 5000, two: 10000, one: 20000 },
});
const MS = { 1: 15_000, 2: 7000, 3: 4000 } as const;
const tapEnd = (end: 1 | 2 | 3 | 'quit'): FindLevelOver => ({
  reason: end === 'quit' ? 'quit' : 'targetReached',
  elapsedMs: end === 'quit' ? 2000 : MS[end],
  penaltyMs: 0,
  spots: end === 'quit' ? 0 : 1,
  found: 0,
  stars: 0,
});

/**
 * A phone of `who`: levels.db in memory, the app's sync on the test's clock, its timers only recorded (the
 * test triggers every flush). `fetch` stands for the phone's network.
 */
async function phone(who: Account, f: AccountFetch = realFetch) {
  const sqlite = await memoryDb();
  phoneDbs.push(sqlite);
  const repo: LevelsRepo = await openLevelsRepo(sqlite);
  const timers: number[] = [];
  const progress: MyProgress[] = [];
  const api = who.client(f);
  /** The app's sync of one run (a new one: the app started again). */
  const newRun = () =>
    new LevelsSync({
      repo: () => Promise.resolve(repo),
      owner: () => who.uid,
      api: () => api,
      now: clock.now,
      timers: {
        setTimeout: (_callback, ms) => timers.push(ms),
        clearTimeout: () => undefined,
      },
      random: () => 0.5,
      onProgress: (_owner, p) => progress.push(p),
    });
  const p = {
    repo,
    timers,
    progress,
    sync: newRun(),
    restart() {
      p.sync = newRun();
    },
    /** An attempt at level `n`, finished now. */
    play: (n: number, end: 1 | 2 | 3 | 'quit') =>
      repo.recordAttempt({
        owner: who.uid,
        level: find(n),
        end: tapEnd(end),
        startedAt: clock.now() - 10_000,
        endedAt: clock.now(),
      }),
  };
  return p;
}

/** What the server keeps of `who`'s levels (user_levels), in level order. */
const stored = async (who: Account): Promise<LevelBest[]> =>
  (
    await db.db
      .select({ id: userLevels.levelId, stars: userLevels.bestStars, plays: userLevels.plays })
      .from(userLevels)
      .where(eq(userLevels.userId, who.me.id))
      .orderBy(asc(userLevels.levelId))
  ).map((r) => ({ id: r.id, stars: r.stars as Stars, plays: r.plays }));

// ---- the reports --------------------------------------------------------------------------------------

describe('staged practice: the app’s levels against the real server', () => {
  let ana: Account;
  let phoneA: Awaited<ReturnType<typeof phone>>;
  let phoneB: Awaited<ReturnType<typeof phone>>;

  beforeAll(async () => {
    ana = await account('AnaLevels', 'levels-ana');
    phoneA = await phone(ana);
  });

  it('a phone plays and syncs: the server keeps the bests and pays 10 XP a best star', async () => {
    await phoneA.play(1, 3);
    await phoneA.play(2, 2);
    await phoneA.play(3, 'quit');
    await expect(phoneA.sync.flush()).resolves.toEqual({ status: 'done', sent: 3, rejected: 0, xp: 50 });
    expect(await stored(ana)).toEqual([
      { id: 'L001', stars: 3, plays: 1 },
      { id: 'L002', stars: 2, plays: 1 },
      { id: 'L003', stars: 0, plays: 1 },
    ]);
    expect(phoneA.progress.at(-1)?.xp).toBe(50);
    await expect(ana.client().myProgress()).resolves.toMatchObject({ xp: 50 });
    expect(await phoneA.repo.dirty(ana.uid)).toEqual([]);
    // Nothing new: nothing sent, nothing paid.
    await expect(phoneA.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 0, xp: 0 });
    await expect(ana.client().myLevels()).resolves.toEqual({
      levels: await stored(ana),
      maxLevel: maxLevel(),
      owedXp: 0,
    });
  });

  it('a second phone of the account gets everything back on its first sync', async () => {
    phoneB = await phone(ana);
    await expect(phoneB.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 0 });
    const restored = await phoneB.repo.progress(ana.uid);
    expect(restored).toMatchObject({
      L001: { stars: 3, plays: 1 },
      L002: { stars: 2, plays: 1 },
      L003: { stars: 0, plays: 1 },
    });
    expect(await phoneB.repo.summary(ana.uid)).toEqual({ played: 3, stars: 5, current: 4 });
    // The next attempt's number counts the plays the other phone made ("שוב" gets its own board, D63), at the
    // level's rev now (a restored row's plays count at any rev).
    expect(await phoneB.repo.attemptOf(ana.uid, 'L001', levelRev('L001'))).toBe(2);
    expect(await phoneB.repo.dirty(ana.uid)).toEqual([]);
  });

  it('both phones play: the server keeps the max of each level, and each phone ends with the best of both', async () => {
    await phoneB.play(4, 1);
    await phoneB.play(1, 1);
    await phoneA.play(2, 3);
    await expect(phoneA.sync.flush()).resolves.toMatchObject({ sent: 1, xp: 10 });
    await expect(phoneB.sync.flush()).resolves.toMatchObject({ sent: 2, xp: 10 });
    expect(await stored(ana)).toEqual([
      { id: 'L001', stars: 3, plays: 2 },
      { id: 'L002', stars: 3, plays: 2 },
      { id: 'L003', stars: 0, plays: 1 },
      { id: 'L004', stars: 1, plays: 1 },
    ]);
    // Phone B learned of A's ★★★ on L002 from its PUT's answer; phone A learns of B's levels at its next start.
    expect((await phoneB.repo.progress(ana.uid)).L002).toMatchObject({ stars: 3, plays: 2 });
    phoneA.restart();
    await expect(phoneA.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 0 });
    expect(await phoneA.repo.progress(ana.uid)).toMatchObject({
      L001: { stars: 3, plays: 2, metric: 4000 },
      L004: { stars: 1, plays: 1 },
    });
    expect(await phoneA.repo.summary(ana.uid)).toEqual(await phoneB.repo.summary(ana.uid));
    await expect(ana.client().myProgress()).resolves.toMatchObject({ xp: 70 });
  });

  it('a gate: 50 XP when it opens, once; the same bests sent again pay nothing', async () => {
    const cy = await account('CyLevels', 'levels-cy');
    const p = await phone(cy);
    // Chapter 1 at ★★ each: 20 of 30, the boss played. The phone sees the gate open.
    for (let n = 1; n <= 9; n++) await p.play(n, 2);
    await expect(p.play(10, 2)).resolves.toMatchObject({ gateOpened: true });
    await expect(p.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 10, xp: 20 * 10 + 50 });
    const again = await cy.client().putMyLevels(await stored(cy));
    expect(again).toMatchObject({ xp: 0, owedXp: 0, unknown: [] });
    expect(again.progress.xp).toBe(250);
  });

  it('a server without the levels’ route: unsupported, the levels kept; asked again only after the wait', async () => {
    const dan = await account('DanLevels', 'levels-dan');
    const net = { old: true, requests: 0 };
    // The real server, asked for a path it does not have: its own 404 notFound, as before 1.0.2.
    const oldServer: AccountFetch = (target, init) => {
      net.requests++;
      return fetch(
        net.old ? target.replace(PROGRESS_PATHS.myLevels, '/v1/me/levels-before-1-0-2') : target,
        init,
      );
    };
    const p = await phone(dan, oldServer);
    await p.play(1, 3);
    await expect(p.sync.flush()).resolves.toMatchObject({ status: 'unsupported', sent: 0 });
    expect(p.timers).toEqual([]);
    expect(await p.repo.dirty(dan.uid)).toEqual([{ id: 'L001', stars: 3, plays: 1 }]);
    // A level's end, the foreground: within the wait, nothing goes.
    await p.play(2, 2);
    clock.advance(LEVELS_DATA.unsupportedRetryMs - 1);
    await expect(p.sync.flush()).resolves.toMatchObject({ status: 'unsupported' });
    expect(net.requests).toBe(1);
    // The server was updated meanwhile; after the wait, everything goes.
    net.old = false;
    clock.advance(1);
    await expect(p.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 2, xp: 50 });
    expect(await stored(dan)).toEqual([
      { id: 'L001', stars: 3, plays: 1 },
      { id: 'L002', stars: 2, plays: 1 },
    ]);
  });
});
