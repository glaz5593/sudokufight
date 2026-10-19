import {
  type AppLevel,
  type FindLevelOver,
  type GameResult,
  levelGameConfig,
  levelIdOf,
  levelXpFor,
  LocalGameHost,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import Storage from 'expo-sqlite/kv-store';

import { fakeFetch } from '../../api/testing/fakeProgress';
import { initAuth, setAuthDeps, signOut } from '../../auth/authStore';
import { installSignedInPlayer } from '../../auth/testing/testAuth';
import { openPracticeStorage } from '../../game/storage';
import { answerIn, emptyCellsOf, PUZZLE } from '../../game/testing/practice';
import { memoryDb, type SqlJsDb } from '../../game/testing/sqlJsDb';
import { currentOwner, levelsSync, setProgressFetch } from '../../progress/appProgress';
import { createPracticeQueue } from '../../progress/practiceQueue';
import { track } from '../../services/analytics';
import { createLevelFinisher, levelAttemptOf, levelFinished } from '../appLevels';
import { type FinishedLevel, type LevelsRepo, openLevelsRepo } from '../levelsRepo';

/**
 * A level's end on the phone (dev-plan §2ו, §3.1): stored in levels.db, the sync flushed, level_end reported,
 * and chapter_gate at a closed gate once its boss was played. A level is never a practice: no practice.db row,
 * no queued PracticeResult, no game_start / game_end [D58]. expo-sqlite is sql.js (one database per file
 * name), analytics a mock.
 */

const mockDbs = new Map<string, Promise<SqlJsDb>>();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => {
    let db = mockDbs.get(name);
    if (!db) {
      db = jest
        .requireActual<typeof import('../../game/testing/sqlJsDb')>('../../game/testing/sqlJsDb')
        .memoryDb();
      mockDbs.set(name, db);
    }
    return db;
  },
}));
jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

/** A duel against Pip on bank puzzle #1 (plan §2.4): first to 30 in 30 s; a lead of 15 / 8 / any. */
const DUEL: AppLevel = {
  id: 'L021',
  rev: 1,
  chapter: 3,
  slot: 1,
  kind: 'duel',
  boss: false,
  seed: 7,
  gameType: 'fast',
  board: { grid: PUZZLE.givens, solution: PUZZLE.solution },
  timeLimitMs: 30000,
  targets: { endAtScore: 30 },
  stars: { by: 'gap', three: 15, two: 8 },
  bot: { level: 1, pace: 1 },
};

const find = (n: number): FinishedLevel => ({
  id: levelIdOf(n),
  rev: 1,
  kind: 'find',
  chapter: Math.ceil(n / 10),
  stars: { by: 'timeMs', three: 5000, two: 10000, one: 20000 },
});
const tapEnd = (reason: FindLevelOver['reason'], elapsedMs: number, penaltyMs = 0): FindLevelOver => ({
  reason,
  elapsedMs,
  penaltyMs,
  spots: reason === 'targetReached' ? 1 : 0,
  found: 0,
  stars: 0,
});

/** The duel, played: three right digits of mine, then the clock runs out (the bot is not attached). */
function playDuel(): { result: GameResult; startedAt: number; endedAt: number } {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const host = new LocalGameHost({
    config: levelGameConfig(DUEL, { id: 'level-game', player: { id: 'me' }, attempt: 1 }),
    playerId: 'me',
    clock,
    scheduler,
  });
  const startedAt = clock.now();
  for (const cell of emptyCellsOf(PUZZLE).slice(0, 3)) {
    scheduler.advance(1500);
    host.select(cell);
    host.place(cell, answerIn(PUZZLE, cell));
  }
  scheduler.advance(30_000);
  const { result } = host.state;
  host.close();
  if (!result) throw new Error('the duel did not end');
  return { result, startedAt, endedAt: clock.now() };
}

const tracked = () => jest.mocked(track).mock.calls.map(([name, props]) => ({ name, props }));
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

describe('levelFinished, wired to the phone', () => {
  // An old server: GET /v1/me/levels answers 404 (the sync waits, no timer and no retry loop).
  const server = fakeFetch(() => ({ status: 404, body: { error: 'notFound' } }));

  beforeEach(async () => {
    jest.mocked(track).mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    setProgressFetch(server);
    await installSignedInPlayer();
    await initAuth();
    // The practice database is open, as in the app (the root layout opens it): it must stay empty.
    await openPracticeStorage();
  });

  afterEach(async () => {
    levelsSync().stop();
    setProgressFetch(null);
    await signOut().catch(() => undefined);
    setAuthDeps(null);
    jest.restoreAllMocks();
  });

  it('a duel’s end: one attempt in levels.db and level_end; no practice row, no PracticeResult, no game_end', async () => {
    const owner = currentOwner()!;
    const { result, startedAt, endedAt } = playDuel();
    expect(result.level).toBeDefined();
    const done = await levelFinished({
      level: DUEL,
      end: result,
      playerId: 'me',
      attempt: 1,
      startedAt,
      endedAt,
    });
    await settle();

    expect(done).toMatchObject({ attempt: 1, played: true, prevBest: 0, outcome: { reason: 'timeUp' } });
    expect(done!.best).toBeGreaterThan(0);
    expect(done!.xpEstimate).toBe(levelXpFor(0, done!.best, false));
    const levels = await openLevelsRepo(await mockDbs.get('levels.db')!);
    expect(await levels.attempts(owner)).toEqual([
      expect.objectContaining({ levelId: 'L021', reason: 'timeUp', botLevel: 1, attempt: 1 }),
    ]);

    // Nothing of a practice: its database, its puzzle plays, its XP queue, its events.
    const practice = await openPracticeStorage();
    expect(await practice.listRecent()).toEqual([]);
    expect(await practice.playHistory('fast')).toEqual([]);
    expect(await createPracticeQueue(Storage).size(owner)).toBe(0);
    expect(tracked().map((e) => e.name)).toEqual(['level_end']);
    expect(tracked()[0]!.props).toMatchObject({
      level: 21,
      kind: 'duel',
      reason: 'timeUp',
      stars: done!.best,
      prevBest: 0,
      botLevel: 1,
      attempt: 1,
      durationMs: 30_000,
    });
    // The sync was flushed: it asked the server (an old one, so it waits).
    expect(server.calls.some((c) => c.url.endsWith('/v1/me/levels'))).toBe(true);
  });

  it('a find ended by a second wrong tap: a played attempt, reason failed; the next attempt is 2', async () => {
    const done = await levelFinished({
      level: find(1),
      end: tapEnd('tooManyMisses', 8000, 5000),
      startedAt: 1,
      endedAt: 9000,
    });
    expect(done).toMatchObject({
      played: true,
      best: 0,
      outcome: { reason: 'failed', stars: 0, metric: null },
    });
    expect(tracked()).toEqual([
      {
        name: 'level_end',
        props: expect.objectContaining({ level: 1, reason: 'failed', mistakes: 1, metric: null }),
      },
    ]);
    await expect(levelAttemptOf('L001')).resolves.toBe(2);
  });

  it('signed out: nothing is stored, level_end is still reported', async () => {
    await signOut();
    const done = await levelFinished({
      level: find(2),
      end: tapEnd('targetReached', 4000),
      startedAt: 1,
      endedAt: 2,
    });
    expect(done).toBeNull();
    expect(tracked()).toEqual([
      { name: 'level_end', props: expect.objectContaining({ level: 2, stars: 3, prevBest: 0, attempt: 1 }) },
    ]);
    await expect(levelAttemptOf('L002')).resolves.toBe(1);
  });
});

describe('chapter_gate (plan §5.5)', () => {
  const OWNER = 'uid-gate';
  let db: SqlJsDb;
  let repo: LevelsRepo;
  const events: { name: string; props: unknown }[] = [];
  const flushes = jest.fn(async () => undefined);
  let at = 0;
  let finish: ReturnType<typeof createLevelFinisher>;

  beforeEach(async () => {
    db = await memoryDb();
    repo = await openLevelsRepo(db);
    events.length = 0;
    flushes.mockClear();
    finish = createLevelFinisher({
      owner: () => OWNER,
      repo: async () => repo,
      sync: () => ({ flush: flushes }),
      track: (name, props) => events.push({ name, props }),
      now: () => 42,
    });
  });
  afterEach(() => db.close());

  /** Level n of chapter 1 at ★★★ (4 s), ★★ (7 s), ★ (15 s), or quit. */
  const play = (n: number, end: 1 | 2 | 3 | 'quit') => {
    at += 60_000;
    const ms = end === 'quit' ? 2000 : { 1: 15_000, 2: 7000, 3: 4000 }[end];
    return finish({
      level: find(n),
      end: tapEnd(end === 'quit' ? 'quit' : 'targetReached', ms),
      startedAt: at - ms,
      endedAt: at,
    });
  };
  const gates = () => events.filter((e) => e.name === 'chapter_gate').map((e) => e.props);

  it('nothing before the boss is played; open: false after an end that leaves it shut; open: true once', async () => {
    for (let n = 1; n <= 9; n++) await play(n, 2);
    expect(gates()).toEqual([]);
    expect(events.filter((e) => e.name === 'level_end')).toHaveLength(9);
    expect(flushes).toHaveBeenCalledTimes(9);

    // The boss at ★: 19 of 20.
    await play(10, 1);
    expect(gates()).toEqual([{ chapter: 2, stars: 19, open: false }]);
    // A quit there counts as a try at the gate too.
    await play(5, 'quit');
    expect(gates()).toEqual([
      { chapter: 2, stars: 19, open: false },
      { chapter: 2, stars: 19, open: false },
    ]);
    // L001 again at ★★★: 20, the gate opens, kept as opened, its celebration to come.
    const opening = await play(1, 3);
    expect(opening).toMatchObject({ gateOpened: true, newStars: 1 });
    expect(opening!.xpEstimate).toBe(levelXpFor(2, 3, true));
    expect(gates().at(-1)).toEqual({ chapter: 2, stars: 20, open: true });
    expect(await repo.openedGates(OWNER)).toEqual([2]);
    expect(await repo.gatesToCelebrate(OWNER)).toEqual([2]);
    // Open now: no more tries at it.
    await play(2, 3);
    expect(gates()).toHaveLength(3);
  });
});
