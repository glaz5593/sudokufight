import {
  currentCycle,
  defaultRules,
  type GameEvent,
  type GameResult,
  type LocalGameHost,
  ManualClock,
  ManualScheduler,
  type PlayRecord,
  replay,
  THINK_TIME_MS,
  toView,
} from '@sudoku-fight/engine';

import { gameEndProps, gameStartProps, resultLabel } from '../analyticsProps';
import { allOfflinePuzzles, offlinePool, poolIds, type PuzzlePool } from '../offlinePool';
import { openPracticeRepo, type PracticeRepo } from '../practiceRepo';
import { choosePuzzle, ME, type PracticeDeps, type PracticeSession, startPractice } from '../session';
import { answerIn, emptyCellsOf, smallPool, wrongIn } from '../testing/practice';
import { memoryDb, type SqlJsDb } from '../testing/sqlJsDb';

interface Rig {
  db: SqlJsDb;
  repo: PracticeRepo;
  clock: ManualClock;
  scheduler: ManualScheduler;
  track: jest.Mock;
  errors: [string, unknown][];
  deps: PracticeDeps;
}

async function rig({
  pool = smallPool(10),
  repo,
}: { pool?: PuzzlePool; repo?: (r: PracticeRepo) => PracticeRepo | null } = {}): Promise<Rig> {
  const db = await memoryDb();
  const real = await openPracticeRepo(db);
  const clock = new ManualClock(1_700_000_000_000);
  const scheduler = new ManualScheduler(clock);
  const track = jest.fn();
  const errors: [string, unknown][] = [];
  const deps: PracticeDeps = {
    repo: repo ? repo(real) : real,
    clock,
    scheduler,
    pool,
    seed: 7,
    track,
    onError: (what, error) => errors.push([what, error]),
  };
  return { db, repo: real, clock, scheduler, track, errors, deps };
}

/** Every method of a repository, passed through; `over` replaces some. */
function wrapRepo(repo: PracticeRepo, over: Partial<PracticeRepo> = {}): PracticeRepo {
  return {
    createGame: (g) => repo.createGame(g),
    appendEvents: (id, events) => repo.appendEvents(id, events),
    finishGame: (id, end) => repo.finishGame(id, end),
    markInterrupted: (id) => repo.markInterrupted(id),
    listRecent: (limit) => repo.listRecent(limit),
    listByMode: (mode) => repo.listByMode(mode),
    getGame: (id) => repo.getGame(id),
    loadEvents: (id) => repo.loadEvents(id),
    playHistory: (type) => repo.playHistory(type),
    ...over,
  };
}

jest.mock('../../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});
const crash = jest
  .requireMock<{ crashReporter: () => { recordError: jest.Mock } }>('../../services/crashlytics')
  .crashReporter();

/** A listener that throws the first time a lock is released (a lock running out, in these tests). */
function failOnce(s: PracticeSession): Error {
  const boom = new Error('a listener failed');
  let failed = false;
  s.subscribe((u) => {
    if (failed || u.kind !== 'events' || !u.events.some((e) => e.type === 'cellReleased')) return;
    failed = true;
    throw boom;
  });
  return boom;
}

const local = (s: PracticeSession) => s.host as unknown as LocalGameHost;
const puzzleOf = (s: PracticeSession) => allOfflinePuzzles().find((p) => p.id === s.puzzleId)!;
const plain = (events: readonly GameEvent[]) => JSON.parse(JSON.stringify(events)) as GameEvent[];
/** Lets queued promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Places the right digit in a cell, a little later. */
function solve(r: Rig, s: PracticeSession, cell: number) {
  r.scheduler.advance(1200);
  s.host.select(cell);
  s.host.place(cell, answerIn(puzzleOf(s), cell));
}

describe('a practice from start to finish', () => {
  it('plays a whole puzzle to gameOver; the saved log replays to the same final state', async () => {
    const r = await rig();
    const s = await startPractice({ gameType: 'fast' }, r.deps);
    expect(r.track).toHaveBeenCalledWith('game_start', { mode: 'solo', type: 'fast', players: 1 });
    const puzzle = puzzleOf(s);
    const empty = emptyCellsOf(puzzle);
    const startedAt = s.events[0]!.t;

    // A lock that runs out [D2], then a mistake, then every cell.
    r.scheduler.advance(1000);
    s.host.select(empty[0]!);
    r.scheduler.advance(THINK_TIME_MS.fast + 1);
    expect(s.events.at(-1)).toMatchObject({ type: 'cellReleased', reason: 'timeout' });
    r.scheduler.advance(1200);
    s.host.select(empty[0]!);
    s.host.place(empty[0]!, wrongIn(puzzle, empty[0]!));
    for (const cell of empty) solve(r, s, cell);

    const view = s.getView();
    expect(view.status).toBe('over');
    expect(view.result?.reason).toBe('boardComplete');
    await s.flush();

    const saved = await r.repo.loadEvents(s.id);
    expect(saved).toEqual(plain(s.events));
    expect(saved[0]).toMatchObject({
      type: 'gameCreated',
      config: { puzzle: { solution: puzzle.solution } },
    });
    const final = replay(saved).at(-1)!;
    expect(final).toEqual(local(s).state);
    expect(toView(final, ME, r.clock.now())).toEqual(view);

    const me = view.players[0]!;
    expect(await r.repo.getGame(s.id)).toMatchObject({
      status: 'finished',
      mode: 'solo',
      gameType: 'fast',
      puzzleId: puzzle.id,
      seed: 7,
      startedAt,
      endedAt: final.endedAt,
      endReason: 'boardComplete',
      score: me.score,
      mistakes: 1,
      correct: empty.length,
      result: view.result,
    });
    expect(await r.repo.playHistory('fast')).toEqual([{ puzzleId: puzzle.id, playedAt: startedAt }]);
    expect(r.track).toHaveBeenLastCalledWith('game_end', {
      mode: 'solo',
      result: 'completed',
      score: me.score,
      mistakes: 1,
      durationSec: Math.round((view.result as GameResult).durationMs / 1000),
    });
    expect(r.errors).toEqual([]);

    s.close();
    await s.flush();
    expect((await r.repo.getGame(s.id))?.status).toBe('finished');
  });

  it('a practice of solo rules: one player (me), the game type’s think time, no interferences', async () => {
    const r = await rig({ pool: smallPool(3, 'normal') });
    const s = await startPractice({ gameType: 'normal' }, r.deps);
    const created = s.events[0]!;
    if (created.type !== 'gameCreated') throw new Error('first event');
    expect(created.config).toMatchObject({
      mode: 'solo',
      gameType: 'normal',
      players: [{ id: ME }],
      seed: 7,
      rules: defaultRules('solo', 'normal'),
    });
    expect(created.config.rules.interferences).toBe(false);
    expect(s.getView().status).toBe('running');
    const cell = emptyCellsOf(puzzleOf(s))[0]!;
    s.host.select(cell);
    expect(s.getView().players[0]!.lock).toEqual({
      cell,
      expiresAt: r.clock.now() + THINK_TIME_MS.normal,
      remainingMs: THINK_TIME_MS.normal,
    });
    s.close();
  });

  it('"end practice" ends it with practiceEnded, saved as finished', async () => {
    const r = await rig();
    const s = await startPractice({ gameType: 'fast' }, r.deps);
    solve(r, s, emptyCellsOf(puzzleOf(s))[0]!);
    s.endPractice();
    expect(s.getView().result?.reason).toBe('practiceEnded');
    s.endPractice(); // nothing more to end
    await s.flush();
    expect(await r.repo.getGame(s.id)).toMatchObject({
      status: 'finished',
      endReason: 'practiceEnded',
      correct: 1,
    });
    expect(r.track).toHaveBeenLastCalledWith(
      'game_end',
      expect.objectContaining({ result: 'ended', mistakes: 0 }),
    );
    s.close();
  });

  it('a failure to track the end is reported; the end is still saved and its XP still queued', async () => {
    const r = await rig();
    const finished: string[] = [];
    const broken = new Error('analytics down');
    r.track.mockImplementation((name: string) => {
      if (name === 'game_end') throw broken;
    });
    const s = await startPractice(
      { gameType: 'fast' },
      { ...r.deps, onFinish: (end) => finished.push(end.id) },
    );
    expect(() => s.endPractice()).not.toThrow();
    await s.flush();
    expect(r.errors).toEqual([['could not track the end of the game', broken]]);
    expect(finished).toEqual([s.id]);
    expect(await r.repo.getGame(s.id)).toMatchObject({ status: 'finished', endReason: 'practiceEnded' });
    s.close();
  });
});

describe('a game timer that fails (bug 9: a throw out of a timer is fatal on the phone)', () => {
  it('a listener failing on a lock that runs out is reported, never thrown at the timer; the game goes on', async () => {
    const r = await rig();
    const timerErrors: unknown[] = [];
    const s = await startPractice(
      { gameType: 'fast' },
      { ...r.deps, onTimerError: (error) => timerErrors.push(error) },
    );
    const empty = emptyCellsOf(puzzleOf(s));
    const boom = failOnce(s);
    r.scheduler.advance(1000);
    s.host.select(empty[0]!);
    // The host's own clock: the lock runs out [D2] inside the timer, and the listener throws there.
    expect(() => r.scheduler.advance(THINK_TIME_MS.fast + 1)).not.toThrow();
    expect(s.events.at(-1)).toMatchObject({ type: 'cellReleased', reason: 'timeout' });
    expect(timerErrors).toEqual([boom]);
    // The game is still on, and plays on.
    expect(s.getView().status).toBe('running');
    solve(r, s, empty[1]!);
    expect(s.getView().players[0]!.score).toBeGreaterThan(0);
    s.close();
  });

  it('on the phone the error goes to Crashlytics ("game: tick")', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const r = await rig();
      const s = await startPractice({ gameType: 'fast' }, r.deps);
      const boom = failOnce(s);
      r.scheduler.advance(1000);
      s.host.select(emptyCellsOf(puzzleOf(s))[0]!);
      expect(() => r.scheduler.advance(THINK_TIME_MS.fast + 1)).not.toThrow();
      expect(crash.recordError).toHaveBeenCalledWith(boom, 'game: tick');
      s.close();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('a practice that does not finish', () => {
  it('closing mid-game stops it and saves it as interrupted, events kept', async () => {
    const r = await rig();
    const s = await startPractice({ gameType: 'fast' }, r.deps);
    const empty = emptyCellsOf(puzzleOf(s));
    solve(r, s, empty[0]!);
    s.host.select(empty[1]!);
    const points = s.getView().players[0]!.score;
    s.close();
    s.close();
    expect(() => s.host.select(empty[2]!)).toThrow(/closed/);
    expect(r.scheduler.pending).toBe(0);
    await s.flush();
    expect(await r.repo.getGame(s.id)).toMatchObject({ status: 'interrupted', score: points, correct: 1 });
    expect(await r.repo.loadEvents(s.id)).toEqual(plain(s.events));
    expect((await r.repo.listRecent()).map((g) => g.id)).toEqual([s.id]);
    expect(r.track).not.toHaveBeenCalledWith('game_end', expect.anything());
    s.endPractice(); // after close: nothing
  });

  it('a game the app left running is interrupted on the next start', async () => {
    const r = await rig();
    const s = await startPractice({ gameType: 'fast' }, r.deps);
    solve(r, s, emptyCellsOf(puzzleOf(s))[0]!);
    await s.flush(); // … and the app is killed here
    const nextRun = await openPracticeRepo(r.db);
    expect(await nextRun.markInterrupted()).toBe(1);
    expect(await nextRun.listRecent()).toEqual([
      expect.objectContaining({ id: s.id, status: 'interrupted' }),
    ]);
  });
});

describe('saving as the game goes', () => {
  it('writes in order; updates that come while a write runs go together in the next batch', async () => {
    const batches: number[][] = [];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const r = await rig({
      repo: (real) =>
        wrapRepo(real, {
          appendEvents: async (id, events) => {
            batches.push(events.map((e) => e.seq));
            await gate;
            return real.appendEvents(id, events);
          },
        }),
    });
    const s = await startPractice({ gameType: 'fast' }, r.deps);
    while (!batches.length) await settle();
    expect(batches).toEqual([[1, 2]]); // gameCreated, gameStarted: held at the gate

    const empty = emptyCellsOf(puzzleOf(s));
    solve(r, s, empty[0]!);
    solve(r, s, empty[1]!);
    open();
    await s.flush();
    expect(batches).toEqual([[1, 2], s.events.slice(2).map((e) => e.seq)]);
    expect(await r.repo.loadEvents(s.id)).toEqual(plain(s.events));
    s.close();
  });

  it('a failed write is reported and retried with the next update', async () => {
    const r = await rig();
    r.db.failOnce('INSERT OR IGNORE INTO practice_events');
    const s = await startPractice({ gameType: 'fast' }, r.deps);
    await s.flush();
    expect(r.errors.map(([what]) => what)).toEqual(['could not save the game events']);
    expect(await r.repo.loadEvents(s.id)).toEqual([]);
    solve(r, s, emptyCellsOf(puzzleOf(s))[0]!);
    await s.flush();
    expect(await r.repo.loadEvents(s.id)).toEqual(plain(s.events));
    s.close();
  });

  it('when the game row cannot be created, the game goes on unsaved (no orphan events)', async () => {
    const r = await rig();
    r.db.failOnce('INSERT INTO practice_games');
    const s = await startPractice({ gameType: 'fast' }, r.deps);
    solve(r, s, emptyCellsOf(puzzleOf(s))[0]!);
    s.close();
    await s.flush();
    expect(r.errors.map(([what]) => what)).toEqual(['could not save the new game']);
    expect(await r.repo.loadEvents(s.id)).toEqual([]);
    expect(await r.repo.listRecent()).toEqual([]);
    expect(s.getView().players[0]!.correct).toBe(1);
  });

  it('plays without a database, and without a readable history', async () => {
    const offline = await rig({ repo: () => null });
    const s = await startPractice({ gameType: 'fast' }, offline.deps);
    solve(offline, s, emptyCellsOf(puzzleOf(s))[0]!);
    s.endPractice();
    s.close();
    await s.flush();
    expect(offline.errors).toEqual([]);

    const r = await rig({
      repo: (real) => wrapRepo(real, { playHistory: () => Promise.reject(new Error('locked')) }),
    });
    const t = await startPractice({ gameType: 'fast' }, r.deps);
    expect(r.errors.map(([what]) => what)).toEqual(['could not read the play history']);
    expect(t.getView().status).toBe('running');
    t.close();
  });
});

describe('choosing the puzzle without repeats (spec §20)', () => {
  it('sessions never repeat a puzzle until 80% of the pool was played, then start a new cycle', async () => {
    const pool = smallPool(10); // the reset comes after 9 distinct puzzles (more than 8)
    const r = await rig({ pool });
    const picks: string[] = [];
    for (let k = 0; k < 18; k++) {
      r.clock.advance(60_000);
      const s = await startPractice({ gameType: 'fast' }, { ...r.deps, seed: 1000 + k });
      picks.push(s.puzzleId);
      s.close();
      await s.flush();
    }
    expect(new Set(picks.slice(0, 9)).size).toBe(9);
    expect(new Set(picks.slice(9)).size).toBe(9);
    expect(picks.every((id) => pool.ids('fast').includes(id))).toBe(true);
    const history = await r.repo.playHistory('fast');
    expect(history.map((p) => p.puzzleId)).toEqual(picks);
    expect(currentCycle(history, pool.ids('fast'))).toHaveLength(0);
  });

  it('with the real pool: 241 of 300 "normal" puzzles before any repeat', () => {
    const pool = poolIds('normal');
    expect(pool).toHaveLength(300);
    const history: PlayRecord[] = [];
    for (let k = 0; k < 241; k++)
      history.push({ puzzleId: choosePuzzle(offlinePool, 'normal', history, k), playedAt: k });
    expect(new Set(history.map((p) => p.puzzleId)).size).toBe(241);
    expect(currentCycle(history, pool)).toEqual([]); // the 80% reset
    expect(choosePuzzle(offlinePool, 'normal', history, 5)).toBe(
      choosePuzzle(offlinePool, 'normal', history, 5),
    );
  });

  it('another game type’s plays do not count', async () => {
    const r = await rig({ pool: smallPool(2, 'hard') });
    const a = await startPractice({ gameType: 'hard' }, r.deps);
    a.close();
    await a.flush();
    const b = await startPractice({ gameType: 'hard' }, { ...r.deps, seed: 8 });
    expect(b.puzzleId).not.toBe(a.puzzleId);
    expect(await r.repo.playHistory('fast')).toEqual([]);
    b.close();
  });

  it('every session gets its own id', async () => {
    const r = await rig();
    const a = await startPractice({ gameType: 'fast' }, r.deps);
    const b = await startPractice({ gameType: 'fast' }, { ...r.deps, seed: 8 });
    r.clock.advance(1);
    const c = await startPractice({ gameType: 'fast' }, r.deps);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    for (const s of [a, b, c]) s.close();
  });
});

describe('game_end result (spec §22)', () => {
  const result = (
    places: [string, number][],
    reason: GameResult['reason'] = 'boardComplete',
  ): GameResult => ({
    reason,
    durationMs: 1000,
    ranking: places.map(([playerId, place], seat) => ({
      playerId,
      seat,
      place,
      score: 0,
      mistakes: 0,
      correct: 0,
      status: 'active',
    })),
    ratingChanges: [],
    awards: [],
    stats: [],
  });

  it('a practice is completed or ended; with others, won, lost or tied', () => {
    expect(resultLabel('solo', result([['me', 1]]), 'me')).toBe('completed');
    expect(resultLabel('solo', result([['me', 1]], 'practiceEnded'), 'me')).toBe('ended');
    expect(
      resultLabel(
        'bot',
        result([
          ['me', 1],
          ['bot', 2],
        ]),
        'me',
      ),
    ).toBe('win');
    expect(
      resultLabel(
        'bot',
        result([
          ['bot', 1],
          ['me', 2],
        ]),
        'me',
      ),
    ).toBe('loss');
    expect(
      resultLabel(
        'ranked',
        result([
          ['me', 1],
          ['p2', 1],
        ]),
        'me',
      ),
    ).toBe('tie');
    expect(resultLabel('ranked', result([['p2', 1]]), 'me')).toBe('unknown');
  });

  it("the events' props: only the mode, the type, counts and the outcome (the server's contract test sends these)", () => {
    expect(gameStartProps('bot', 'hard', 2)).toEqual({ mode: 'bot', type: 'hard', players: 2 });
    const r = result([
      ['bot', 1],
      ['me', 2],
    ]);
    r.durationMs = 301_499;
    r.ranking[1] = { ...r.ranking[1]!, score: 12.5, mistakes: 3 };
    expect(gameEndProps('bot', r, 'me')).toEqual({
      mode: 'bot',
      result: 'loss',
      score: 12.5,
      mistakes: 3,
      durationSec: 301,
    });
    // A player the ranking does not have: zeros, never someone else's numbers.
    expect(gameEndProps('ranked', r, 'p9')).toMatchObject({ result: 'unknown', score: 0, mistakes: 0 });
  });
});
