import {
  type FindLevelOver,
  type GameResult,
  isLevelOpen,
  LEVEL_RULES,
  levelIdOf,
  type LevelResult,
  type PuzzleLevelOver,
} from '@sudoku-fight/engine';

import { memoryDb, type SqlJsDb } from '../../game/testing/sqlJsDb';
import {
  bestMetricAt,
  type FinishedLevel,
  type LevelFinish,
  type LevelsRepo,
  mistakesOf,
  openLevelsRepo,
} from '../levelsRepo';
import { LEVELS_MIGRATIONS, migrateLevels } from '../levelsSchema';

/**
 * Staged practice's progress on the phone (dev-plan §2ו, §3.1): levels.db's schema, an attempt stored in one
 * transaction with the engine's reading of its end, bests that never drop, what counts as played, attempt
 * numbers, gates that stay open, owners apart, and what the sync reads and marks. sql.js in place of
 * expo-sqlite.
 */

const OWNER = 'uid-1';
const T0 = 1_760_000_000_000;

/** Kind 1, "איפה ה־7?": ★★★ up to 5 s, ★★ up to 10 s, ★ up to 20 s. */
const level = (n: number, over: Partial<FinishedLevel> = {}): FinishedLevel => ({
  id: levelIdOf(n),
  rev: 1,
  kind: 'find',
  chapter: Math.ceil(n / 10),
  stars: { by: 'timeMs', three: 5000, two: 10000, one: 20000 },
  ...over,
});

/** A race (findDuel): the spots I took, ★★★ at 5, ★★ at 4, ★ at 3. */
const RACE = level(12, {
  kind: 'findDuel',
  stars: { by: 'spots', three: 5, two: 4, one: 3 },
  bot: { level: 2, pace: 1 },
});

/** The tap engine's end of a level. */
const tapEnd = (reason: FindLevelOver['reason'], elapsedMs: number, spots = 1): FindLevelOver => ({
  reason,
  elapsedMs,
  penaltyMs: 0,
  spots,
  found: 0,
  stars: 0,
});

/** The game engine's end of a digit level: my row, and the level's measure. */
const digitEnd = (reason: GameResult['reason'], level: LevelResult, mistakes = 0): GameResult => ({
  reason,
  durationMs: level.elapsedMs,
  ranking: [{ playerId: 'me', seat: 0, place: 1, score: 10, mistakes, correct: 3, status: 'active' }],
  ratingChanges: [],
  awards: [],
  stats: [],
  level,
});

/** An end that took `ms` on the level clock (3 stars up to 5 s). */
const found = (ms: number) => tapEnd('targetReached', ms);

let db: SqlJsDb;
let repo: LevelsRepo;
let clock = T0;

const finish = (l: FinishedLevel, end: LevelFinish['end'], over: Partial<LevelFinish> = {}): LevelFinish => {
  clock += 60_000;
  return { owner: OWNER, level: l, end, startedAt: clock - 30_000, endedAt: clock, ...over };
};

const record = (l: FinishedLevel, end: LevelFinish['end'], over: Partial<LevelFinish> = {}) =>
  repo.recordAttempt(finish(l, end, over));

beforeEach(async () => {
  db = await memoryDb();
  repo = await openLevelsRepo(db);
  clock = T0;
});

afterEach(() => db.close());

const tables = async (d: SqlJsDb) =>
  (
    await d.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      [],
    )
  ).map((r) => r.name);

describe('levels.db, its own file (dev-plan §1.4)', () => {
  it('v1 makes exactly the three tables, and sets user_version 1', async () => {
    const fresh = await memoryDb();
    try {
      await expect(migrateLevels(fresh)).resolves.toBe(1);
      expect(await tables(fresh)).toEqual(['level_attempts', 'level_gates', 'level_progress']);
      expect(
        (await fresh.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version,
      ).toBe(1);
      expect(LEVELS_MIGRATIONS.map((m) => m.version)).toEqual([1]);
    } finally {
      fresh.close();
    }
  });

  it('refuses a database newer than the app, saying it is levels.db (not the practice database)', async () => {
    await db.execAsync('PRAGMA user_version = 7');
    await expect(openLevelsRepo(db)).rejects.toThrow(/levels\.db.*v7/);
    await expect(openLevelsRepo(db)).rejects.not.toThrow(/practice/);
  });
});

describe('an attempt (plan §4.5, §5.4)', () => {
  it('is stored in one transaction: a failure leaves neither the attempt nor the best', async () => {
    await record(level(1), found(4000));
    db.failOnce('INSERT INTO level_attempts');
    await expect(record(level(1), found(3000))).rejects.toThrow(/on purpose/);
    expect(await repo.attempts(OWNER)).toHaveLength(1);
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 3, plays: 1, metric: 4000 });
    // …and the repository goes on.
    await expect(record(level(1), found(3000))).resolves.toMatchObject({ attempt: 2 });
  });

  it('reads the end as the engine does, and the best never drops: ★★★ then ★ is ★★★, with 2 plays', async () => {
    const first = await record(level(1), found(4000));
    expect(first).toMatchObject({
      attempt: 1,
      outcome: { reason: 'completed', stars: 3, metric: 4000, elapsedMs: 4000 },
      played: true,
      prevBest: 0,
      best: 3,
      newStars: 3,
    });
    const second = await record(level(1), found(15_000));
    expect(second).toMatchObject({ attempt: 2, prevBest: 3, best: 3, newStars: 0, bestMetric: 4000 });
    expect(second.outcome.stars).toBe(1);
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 3, plays: 2, metric: 4000 });
    expect((await repo.attempts(OWNER, 'L001')).map((a) => [a.stars, a.prevBest])).toEqual([
      [3, 0],
      [1, 3],
    ]);
  });

  it('keeps the best measure in each kind’s direction: a time lower, spots higher', async () => {
    for (const ms of [7000, 4000, 9000]) await record(level(1), found(ms));
    expect((await repo.progress(OWNER)).L001?.metric).toBe(4000);
    for (const spots of [3, 2, 4]) await record(RACE, tapEnd('targetReached', 20_000, spots));
    expect((await repo.progress(OWNER)).L012).toMatchObject({ metric: 4, stars: 2, plays: 3 });
  });

  it('the rev of the best is the attempt’s that made it; one that did not beat it keeps the row’s', async () => {
    await record(level(1), found(4000));
    await record(level(1), found(9000));
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 3, metric: 4000, rev: 1 });
  });

  it('[D73] a new rev keeps the stars and starts the best measure over, even with a worse one', async () => {
    await record(level(1), found(4000));
    // Rebuilt: rev 2, maybe of another kind. 12 s gives ★, but the stars stay ★★★; 12 s is the new best.
    const first = await record(level(1, { rev: 2 }), found(12_000));
    expect(first).toMatchObject({ prevBest: 3, best: 3, newStars: 0, bestMetric: 12_000 });
    expect(first.outcome.stars).toBe(1);
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 3, plays: 2, metric: 12_000, rev: 2 });
    // On the new rev the best goes on as usual: 9 s beats 12 s, 15 s does not.
    await record(level(1, { rev: 2 }), found(9000));
    await record(level(1, { rev: 2 }), found(15_000));
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 3, metric: 9000, rev: 2 });
    // An attempt at the old rev (an older app's, synced late): its stars count, its measure does not.
    await record(level(1), found(1000));
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 3, metric: 9000, rev: 2, plays: 5 });
    // Every attempt keeps the rev it was played at.
    expect((await repo.attempts(OWNER, 'L001')).map((a) => a.rev)).toEqual([1, 2, 2, 2, 1]);
  });

  it('[D73] a new rev with more stars, or a kind that changed: the stars rise, the measure is the new rev’s', async () => {
    await record(level(1), found(15_000)); // ★ at rev 1, 15 s
    // Now a race (the kind changed): 4 spots, ★★.
    await record({ ...RACE, id: 'L001', chapter: 1, rev: 2 }, tapEnd('targetReached', 20_000, 4));
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 2, metric: 4, rev: 2 });
  });

  it('[D73] a quit that counts as played on a new rev: the stars stay, there is no best measure yet', async () => {
    await record(level(1), found(4000));
    await record(level(1, { rev: 2 }), tapEnd('quit', 3000));
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 3, metric: null, rev: 2 });
  });

  it('[D73] a row restored from the server (no rev) takes the rev of its first attempt here', async () => {
    await repo.mergeFromServer(OWNER, [{ id: 'L001', stars: 2, plays: 3 }], T0);
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 2, metric: null, rev: null });
    await record(level(1, { rev: 2 }), found(15_000)); // ★: not more stars, but the first measure
    expect((await repo.progress(OWNER)).L001).toMatchObject({ stars: 2, plays: 4, metric: 15_000, rev: 2 });
  });

  it('[D73] bestMetricAt: the stored best on its own rev, none on another rev or before any', () => {
    expect(bestMetricAt({ metric: 4000, rev: 1 }, 1)).toBe(4000);
    expect(bestMetricAt({ metric: 4000, rev: 1 }, 2)).toBeNull();
    expect(bestMetricAt({ metric: 4000, rev: 3 }, 2)).toBeNull();
    expect(bestMetricAt({ metric: 4000, rev: null }, 2)).toBe(4000);
    expect(bestMetricAt({ metric: null, rev: 2 }, 2)).toBeNull();
    expect(bestMetricAt(undefined, 2)).toBeNull();
  });

  it('a quit counts as played, with 0 stars and no measure: the next level opens [D51]', async () => {
    const quit = await record(level(1), tapEnd('quit', 2000));
    expect(quit).toMatchObject({
      played: true,
      best: 0,
      outcome: { reason: 'quit', stars: 0, metric: null },
    });
    const progress = await repo.progress(OWNER);
    expect(progress.L001).toMatchObject({ stars: 0, plays: 1, metric: null });
    expect(isLevelOpen('L002', progress)).toBe(true);
  });

  it('with quitCountsAsPlayed off, a quit is recorded but not played: the next level stays closed', async () => {
    const strict = await openLevelsRepo(db, { rules: { ...LEVEL_RULES, quitCountsAsPlayed: false } });
    const quit = await strict.recordAttempt(finish(level(1), tapEnd('quit', 2000)));
    expect(quit).toMatchObject({ played: false, attempt: 1, outcome: { reason: 'quit' } });
    expect(await strict.attempts(OWNER)).toHaveLength(1);
    const progress = await strict.progress(OWNER);
    expect(progress.L001).toBeUndefined();
    expect(isLevelOpen('L002', progress)).toBe(false);
    expect(await strict.dirty(OWNER)).toEqual([]);
  });

  it('a find ended by a second wrong tap is a played attempt with 0 stars, reason failed', async () => {
    const failed = await record(level(1), { ...tapEnd('tooManyMisses', 6000), penaltyMs: 5000 });
    expect(failed).toMatchObject({
      played: true,
      best: 0,
      mistakes: 1,
      outcome: { reason: 'failed', stars: 0, metric: null },
    });
    expect((await repo.progress(OWNER)).L001).toMatchObject({ plays: 1, stars: 0 });
    expect((await repo.attempts(OWNER))[0]).toMatchObject({ reason: 'failed', durationMs: 6000 });
  });

  it('counts quits and failures in the attempt number (plays or attempts, + 1)', async () => {
    const strict = await openLevelsRepo(db, { rules: { ...LEVEL_RULES, quitCountsAsPlayed: false } });
    expect(await strict.attemptOf(OWNER, 'L001', 1)).toBe(1);
    await strict.recordAttempt(finish(level(1), tapEnd('quit', 1000)));
    await strict.recordAttempt(finish(level(1), tapEnd('quit', 1000)));
    expect(await strict.attemptOf(OWNER, 'L001', 1)).toBe(3);
    const failed = await strict.recordAttempt(finish(level(1), tapEnd('tooManyMisses', 4000)));
    expect(failed.attempt).toBe(3);
    expect(await strict.attemptOf(OWNER, 'L001', 1)).toBe(4);
    // A phone that restored 5 plays from the server and recorded none: the plays count.
    await strict.mergeFromServer(OWNER, [{ id: 'L002', stars: 2, plays: 5 }], T0);
    expect(await strict.attemptOf(OWNER, 'L002', 1)).toBe(6);
  });

  it('[D73, D63] a rebuilt level (a new rev) numbers its attempts from 1 again; the plays stay cumulative', async () => {
    for (const ms of [4000, 8000, 15_000]) await record(level(1), found(ms)); // 3 plays at rev 1
    expect(await repo.attemptOf(OWNER, 'L001', 1)).toBe(4);
    // Rev 2: the first attempt is the stored board (1), not the 4th.
    expect(await repo.attemptOf(OWNER, 'L001', 2)).toBe(1);
    const first = await record(level(1, { rev: 2 }), found(9000));
    expect(first.attempt).toBe(1);
    expect(await repo.attemptOf(OWNER, 'L001', 2)).toBe(2);
    expect((await record(level(1, { rev: 2 }), found(6000))).attempt).toBe(2);
    expect(await repo.attemptOf(OWNER, 'L001', 2)).toBe(3);
    // The row's plays count every rev (the stars and the sync read them).
    expect((await repo.progress(OWNER)).L001).toMatchObject({ plays: 5, rev: 2 });
    expect(await repo.dirty(OWNER)).toEqual([{ id: 'L001', stars: 3, plays: 5 }]);
    expect((await repo.attempts(OWNER, 'L001')).map((a) => [a.rev, a.attempt])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
    ]);
  });

  it('[D73] a row restored from the server keeps its plays in the count, at any rev', async () => {
    await repo.mergeFromServer(OWNER, [{ id: 'L003', stars: 1, plays: 2 }], T0);
    expect(await repo.attemptOf(OWNER, 'L003', 2)).toBe(3);
    await record(level(3, { rev: 2 }), found(9000));
    expect(await repo.attemptOf(OWNER, 'L003', 2)).toBe(4);
  });

  it('stores the attempt the session played (its number, quick, the bot, my mistakes)', async () => {
    const duel = level(21, {
      kind: 'duel',
      stars: { by: 'gap', three: 15, two: 8 },
      bot: { level: 1, pace: 1 },
    });
    await record(duel, digitEnd('timeUp', { stars: 2, metric: 9.5, elapsedMs: 30_000, penaltyMs: 0 }, 2), {
      attempt: 4,
      quick: true,
      playerId: 'me',
    });
    expect(await repo.attempts(OWNER)).toEqual([
      expect.objectContaining({
        levelId: 'L021',
        attempt: 4,
        chapter: 3,
        kind: 'duel',
        stars: 2,
        metric: 9.5,
        mistakes: 2,
        reason: 'timeUp',
        quick: true,
        botLevel: 1,
        durationMs: 30_000,
      }),
    ]);
    const lost = await record(
      duel,
      digitEnd('targetReached', { stars: 0, metric: -6, elapsedMs: 21_000, penaltyMs: 0 }),
    );
    expect(lost.outcome).toMatchObject({ reason: 'botWon', stars: 0, metric: -6 });
    expect((await repo.progress(OWNER)).L021).toMatchObject({ stars: 2, metric: 9.5, plays: 2 });
  });

  it('a puzzle (1.0.3): its mistakes are the wrong swaps [D70c], its measure the level clock', async () => {
    const PUZZLE = level(3, {
      kind: 'puzzle',
      stars: { by: 'timeMs', three: 26_000, two: 36_000, one: 45_000 },
    });
    const puzzleEnd = (reason: PuzzleLevelOver['reason'], elapsedMs: number, mistakes: number) =>
      ({
        reason,
        elapsedMs,
        penaltyMs: mistakes * LEVEL_RULES.puzzleSwapPenaltyMs,
        swaps: mistakes + 4,
        mistakes,
        stars: 0,
      }) satisfies PuzzleLevelOver;
    const done = await record(PUZZLE, puzzleEnd('targetReached', 30_000, 2));
    expect(done).toMatchObject({
      outcome: { reason: 'completed', stars: 2, metric: 30_000, elapsedMs: 30_000 },
      mistakes: 2,
      best: 2,
      bestMetric: 30_000,
    });
    const late = await record(PUZZLE, puzzleEnd('timeUp', 60_000, 3));
    expect(late).toMatchObject({ outcome: { reason: 'timeUp', stars: 0, metric: null }, mistakes: 3 });
    expect((await repo.attempts(OWNER, 'L003')).map((a) => [a.kind, a.mistakes, a.reason])).toEqual([
      ['puzzle', 2, 'completed'],
      ['puzzle', 3, 'timeUp'],
    ]);
    expect(mistakesOf({ end: puzzleEnd('quit', 5000, 1) })).toBe(1);
    // The session's own count wins, as for every kind.
    expect(mistakesOf({ end: puzzleEnd('quit', 5000, 1), mistakes: 4 })).toBe(4);
  });

  it('a boss: the outcome carries the engine’s verdict (bossBeaten), null for a level that is not one', async () => {
    const BOSS_RACE = level(10, {
      kind: 'findDuel',
      boss: true,
      stars: { by: 'spots', three: 5, two: 4, one: 3 },
      bot: { level: 1, pace: 0.9 },
    });
    const won = await record(BOSS_RACE, { ...tapEnd('targetReached', 20_000, 3), opponentSpots: 2 });
    expect(won.outcome).toMatchObject({ stars: 1, bossBeaten: true });
    const lost = await record(BOSS_RACE, { ...tapEnd('targetReached', 20_000, 2), opponentSpots: 3 });
    expect(lost.outcome).toMatchObject({ stars: 0, bossBeaten: false });
    expect((await record(level(1), found(4000))).outcome.bossBeaten).toBeNull();
  });

  it('refuses an id that is not a level’s', async () => {
    await expect(record(level(1, { id: 'L1' }), found(1000))).rejects.toThrow(RangeError);
    expect(await repo.attempts(OWNER)).toEqual([]);
  });
});

describe('gates and what is open (plan §4.5) [D51]', () => {
  /** Chapter 1 played at `stars` each (2 → 20 of 30). */
  async function playChapter1(stars: 1 | 2 | 3) {
    const ms = { 1: 15_000, 2: 7000, 3: 4000 }[stars];
    const results = [];
    for (let n = 1; n <= 10; n++) results.push(await record(level(n), found(ms)));
    return results;
  }

  it('the gate opens with the boss played and 20 stars; the attempt that opened it says so', async () => {
    const results = await playChapter1(2);
    expect(results.slice(0, 9).every((r) => !r.gateOpened && r.gate?.bossPlayed === false)).toBe(true);
    expect(results[9]).toMatchObject({
      gateWasOpen: false,
      gateOpened: true,
      gate: { chapter: 1, open: true, stars: 20, need: 20, bossPlayed: true },
    });
    const again = await record(level(3), found(4000));
    expect(again).toMatchObject({ gateWasOpen: true, gateOpened: false });
  });

  it('a gate that opened once stays open when gateStars rises (openedGates → isLevelOpen)', async () => {
    await playChapter1(2);
    expect(await repo.openGate(OWNER, 2, T0)).toBe(true);
    const higher = { ...LEVEL_RULES, gateStars: 25 };
    const later = await openLevelsRepo(db, { rules: higher });
    const progress = await later.progress(OWNER);
    const opened = await later.openedGates(OWNER);
    expect(opened).toEqual([2]);
    expect(isLevelOpen('L011', progress, opened, higher)).toBe(true);
    expect(isLevelOpen('L011', progress, [], higher)).toBe(false);
    expect((await later.summary(OWNER)).current).toBe(11);
  });

  it('openGate keeps a gate once: true, then false; its celebration waits until marked', async () => {
    expect(await repo.openGate(OWNER, 2, T0)).toBe(true);
    expect(await repo.openGate(OWNER, 2, T0 + 1)).toBe(false);
    expect(await repo.gatesToCelebrate(OWNER)).toEqual([2]);
    await repo.markCelebrated(OWNER, 2);
    expect(await repo.gatesToCelebrate(OWNER)).toEqual([]);
    expect(await repo.openedGates(OWNER)).toEqual([2]);
  });

  it('the last chapter has no gate after it', async () => {
    const last = await record(level(300), found(4000));
    expect(last).toMatchObject({ gate: null, gateOpened: false });
  });
});

describe('owners and the summary', () => {
  it('each owner sees only their own rows', async () => {
    await record(level(1), found(4000));
    await record(level(1), found(15_000), { owner: 'uid-2' });
    expect((await repo.progress(OWNER)).L001?.stars).toBe(3);
    expect((await repo.progress('uid-2')).L001?.stars).toBe(1);
    expect(await repo.attemptOf('uid-2', 'L001', 1)).toBe(2);
    await repo.openGate('uid-2', 2, T0);
    expect(await repo.openedGates(OWNER)).toEqual([]);
    expect(await repo.progress('uid-3')).toEqual({});
  });

  it('summary: levels played, all my best stars, and the level to go on with', async () => {
    expect(await repo.summary(OWNER)).toEqual({ played: 0, stars: 0, current: 1 });
    await record(level(1), found(4000));
    await record(level(2), found(7000));
    await record(level(3), tapEnd('quit', 1000));
    expect(await repo.summary(OWNER)).toEqual({ played: 3, stars: 5, current: 4 });
    // At a closed gate (the boss played, 10 stars): the boss is the last open one.
    for (let n = 4; n <= 10; n++) await record(level(n), tapEnd('quit', 1000));
    expect(await repo.summary(OWNER)).toEqual({ played: 10, stars: 5, current: 10 });
  });
});

describe('what the sync reads and marks', () => {
  it('a new or changed row is dirty until the server has it as it is', async () => {
    await record(level(1), found(4000));
    await record(level(2), found(15_000));
    const sent = await repo.dirty(OWNER);
    expect(sent).toEqual([
      { id: 'L001', stars: 3, plays: 1 },
      { id: 'L002', stars: 1, plays: 1 },
    ]);
    // L002 is played again while the PUT is out: it stays dirty, L001 is synced.
    await record(level(2), found(7000));
    await expect(repo.markSynced(OWNER, sent)).resolves.toBe(1);
    expect(await repo.dirty(OWNER)).toEqual([{ id: 'L002', stars: 2, plays: 2 }]);
    await repo.markSynced(OWNER, [{ id: 'L002', stars: 2, plays: 2 }]);
    expect(await repo.dirty(OWNER)).toEqual([]);
    // Played again: dirty again.
    await record(level(1), found(9000));
    expect(await repo.dirty(OWNER)).toEqual([{ id: 'L001', stars: 3, plays: 2 }]);
  });

  it('mergeFromServer takes the max of each, adds what is missing, and resends what the server lacks', async () => {
    await record(level(1), found(4000));
    await record(level(2), found(15_000));
    await repo.markSynced(OWNER, await repo.dirty(OWNER));
    const changed = await repo.mergeFromServer(
      OWNER,
      [
        { id: 'L001', stars: 1, plays: 4 },
        { id: 'L003', stars: 2, plays: 1 },
        // Not a level id: left out.
        { id: 'l004', stars: 3, plays: 1 },
      ],
      T0,
    );
    expect(changed).toBe(2);
    const progress = await repo.progress(OWNER);
    expect(progress.L001).toMatchObject({ stars: 3, plays: 4, metric: 4000 });
    expect(progress.L003).toMatchObject({ stars: 2, plays: 1, metric: null });
    expect(progress.l004).toBeUndefined();
    // L001 has more stars here (the server: more plays): it goes; L002 is missing there: it goes again.
    expect(await repo.dirty(OWNER)).toEqual([
      { id: 'L001', stars: 3, plays: 4 },
      { id: 'L002', stars: 1, plays: 1 },
    ]);
  });

  it('a restore opens the chapters the records open, as gates seen elsewhere (no celebration)', async () => {
    const restored = Array.from({ length: 10 }, (_, k) => ({
      id: levelIdOf(k + 1),
      stars: 2 as const,
      plays: 1,
    }));
    await repo.mergeFromServer(OWNER, restored, T0);
    expect(await repo.openedGates(OWNER)).toEqual([2]);
    expect(await repo.gatesToCelebrate(OWNER)).toEqual([]);
    expect(await repo.openGate(OWNER, 2, T0)).toBe(false);
    expect((await repo.summary(OWNER)).current).toBe(11);
  });

  it('a row the server refused alone is not sent again until it changes', async () => {
    await record(level(1), found(4000));
    await record(level(2), found(4000));
    await expect(repo.markRejected(OWNER, [{ id: 'L002', stars: 3, plays: 1 }])).resolves.toBe(1);
    expect((await repo.dirty(OWNER)).map((l) => l.id)).toEqual(['L001']);
    // A GET that lacks it keeps it refused; a new play makes it dirty again.
    await repo.mergeFromServer(OWNER, [], T0);
    expect((await repo.dirty(OWNER)).map((l) => l.id)).toEqual(['L001']);
    await record(level(2), found(4000));
    expect((await repo.dirty(OWNER)).map((l) => l.id)).toEqual(['L001', 'L002']);
  });
});
