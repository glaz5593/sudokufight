import { isSolvedGrid } from '../sudoku/board';
import { PUZZLE } from '../testing/game';
import { FILL_BOX_LEVEL, ME } from '../testing/levels';
import { lockedPuzzle, PUZZLE_LEVEL, PUZZLE_SIX_LEVEL, PUZZLE_UNFIXED_LEVEL } from '../testing/puzzleLevels';
import { ManualClock } from '../util/clock';
import { LEVEL_RULES, type LevelRules, levelOutcome } from './progress';
import {
  applyPuzzle,
  assemblePuzzle,
  createPuzzle,
  evolvePuzzle,
  fewestSwaps,
  isValidArrangement,
  nextPuzzleDeadline,
  type PuzzleAction,
  puzzleConflicts,
  puzzleCycles,
  type PuzzleFit,
  puzzleExplainSteps,
  puzzleLevelView,
  type PuzzleState,
  puzzleStepsWithFit,
  puzzleView,
  replayPuzzle,
  tickPuzzle,
} from './puzzle';
import type { AppLevelOf, LevelSpecOf, PuzzleEvent, PuzzleEventType } from './spec';
import { transformLevel } from './transform';

/* The puzzle engine (levels-content.md §5) [D70, D71]: swaps, the wrong swap's 5 s, the end, the freeze. */

function setup(
  level: AppLevelOf<'puzzle'> = PUZZLE_LEVEL,
  o: { conflicts?: boolean; rules?: LevelRules; start?: boolean } = {},
) {
  const clock = new ManualClock();
  const first = createPuzzle(
    { id: 'puzzle-1', spec: level, player: ME, conflicts: o.conflicts },
    { clock, attempt: 1, rules: o.rules },
  );
  let state: PuzzleState = first.state;
  const log: PuzzleEvent[] = [...first.events];
  const act = (action: PuzzleAction, t: number) => {
    const r = applyPuzzle(state, action, t);
    state = r.state;
    log.push(...r.events);
    return r;
  };
  const swap = (from: number, to: number, t: number) => act({ type: 'swap', playerId: ME.id, from, to }, t);
  const tick = (t: number) => {
    const r = tickPuzzle(state, t);
    state = r.state;
    log.push(...r.events);
    return r;
  };
  if (o.start !== false) act({ type: 'start' }, 0);
  return {
    get state() {
      return state;
    },
    log,
    act,
    swap,
    tick,
    view: (t: number) => puzzleView(state, ME.id, t),
    last: <T extends PuzzleEventType>(type: T) =>
      log.filter((e): e is Extract<PuzzleEvent, { type: T }> => e.type === type).at(-1),
  };
}

const types = (events: readonly PuzzleEvent[]) => events.map((e) => e.type);

describe('createPuzzle', () => {
  it('waits for the start, with the level run, me alone, and the rules of now', () => {
    const p = setup(PUZZLE_LEVEL, { start: false });
    expect(p.state).toMatchObject({ status: 'waiting', seq: 1, at: PUZZLE_LEVEL.targets.start, swaps: 0 });
    expect(p.log).toHaveLength(1);
    const created = p.log[0]!;
    expect(created).toMatchObject({ type: 'puzzleCreated', seq: 1, t: 0 });
    if (created.type !== 'puzzleCreated') return;
    expect(created.config.rules).toEqual({ swapPenaltyMs: 5000, lockOnCorrect: false, conflicts: false });
    expect(created.config.players).toEqual([ME]);
    expect(created.config.level).toMatchObject({ id: 'L003', rev: 2, kind: 'puzzle', attempt: 1 });
    expect(nextPuzzleDeadline(p.state)).toBeNull();
  });

  it('takes the penalty from LEVEL_RULES.puzzleSwapPenaltyMs and lockOnCorrect from the level itself', () => {
    const rules = { ...LEVEL_RULES, puzzleSwapPenaltyMs: 3000 };
    const created = setup(lockedPuzzle(PUZZLE_LEVEL), { rules, conflicts: true }).log[0]!;
    if (created.type !== 'puzzleCreated') throw new Error('no puzzleCreated');
    expect(created.config.rules).toEqual({ swapPenaltyMs: 3000, lockOnCorrect: true, conflicts: true });
  });

  it('refuses what is not a playable puzzle', () => {
    const clock = new ManualClock();
    const make =
      (spec: unknown, attempt = 1) =>
      () =>
        createPuzzle({ id: 'x', spec: spec as LevelSpecOf<'puzzle'>, player: ME }, { clock, attempt });
    expect(make(FILL_BOX_LEVEL)).toThrow('not a puzzle');
    expect(make({ ...PUZZLE_LEVEL, board: { ...PUZZLE_LEVEL.board, grid: PUZZLE.givens } })).toThrow(
      'grid is its solution',
    );
    const targets = (t: Partial<LevelSpecOf<'puzzle'>['targets']>) => ({
      ...PUZZLE_LEVEL,
      targets: { ...PUZZLE_LEVEL.targets, ...t },
    });
    expect(make(targets({ start: [0, 1, 2, 3, 4, 5, 6, 7, 7] }))).toThrow('not an arrangement');
    expect(make(targets({ fixed: [1] }))).toThrow('not at home');
    expect(make(targets({ fixed: [9] }))).toThrow('not places');
    expect(make(PUZZLE_LEVEL, 0)).toThrow('An attempt');
  });
});

describe('a swap (levels-content.md §5.1)', () => {
  it('swaps two moving boxes: boxesSwapped, the board and the ids move with them', () => {
    const p = setup();
    const r = p.swap(1, 5, 2000);
    expect(r.rejected).toBeUndefined();
    expect(r.events).toEqual([{ type: 'boxesSwapped', from: 1, to: 5, penaltyMs: 0, seq: 3, t: 2000 }]);
    expect(p.state.at).toEqual([0, 1, 2, 5, 4, 3, 6, 7, 8]);
    expect(p.state.ids).toEqual([0, 5, 2, 3, 4, 1, 6, 7, 8]);
    expect(p.view(2000).grid).toEqual(assemblePuzzle(PUZZLE.solution, p.state.at));
    expect(p.state.swaps).toBe(1);
  });

  it('refuses a fixed box (boxFixed), the same place or no place (badCell), and leaves no trace', () => {
    const p = setup();
    const before = p.state;
    const refused = (from: number, to: number) => p.swap(from, to, 1000);
    expect(refused(0, 1)).toMatchObject({ rejected: 'boxFixed', events: [] });
    expect(refused(1, 8)).toMatchObject({ rejected: 'boxFixed', events: [] });
    expect(refused(1, 1)).toMatchObject({ rejected: 'badCell', events: [] });
    expect(refused(0, 0)).toMatchObject({ rejected: 'badCell' });
    expect(refused(1, 9)).toMatchObject({ rejected: 'badCell' });
    expect(refused(-1, 3)).toMatchObject({ rejected: 'badCell' });
    expect(refused(1.5, 3)).toMatchObject({ rejected: 'badCell' });
    expect(p.act({ type: 'swap', playerId: 'someone', from: 1, to: 3 }, 1000)).toMatchObject({
      rejected: 'unknownPlayer',
    });
    expect(p.state).toBe(before);
    expect(types(p.log)).toEqual(['puzzleCreated', 'levelStarted']);
  });

  it('refuses a swap before the start (notStarted)', () => {
    const p = setup(PUZZLE_LEVEL, { start: false });
    expect(p.swap(1, 5, 0).rejected).toBe('notStarted');
  });
});

describe('the wrong swap costs 5 s [D70c]', () => {
  it('a swap that puts neither box home: penaltyMs 5000, a mistake, and the limit 5 s closer', () => {
    const p = setup();
    p.swap(1, 5, 2000); // box 1 home; places 3 and 5 hold each other's box
    expect(p.view(3000).level!.remainingMs).toBe(42000);
    const r = p.swap(1, 3, 3000); // box 5 to place 1, box 1 to place 3: neither home
    expect(r.events).toEqual([{ type: 'boxesSwapped', from: 1, to: 3, penaltyMs: 5000, seq: 4, t: 3000 }]);
    expect(p.state).toMatchObject({ penaltyMs: 5000, mistakes: 1, swaps: 2, endsAt: 40000 });
    const view = p.view(3000);
    expect(view.level).toMatchObject({
      elapsedMs: 8000,
      remainingMs: 37000,
      penaltyMs: 5000,
      progress: { kind: 'swaps', used: 2, mistakes: 1 },
    });
    expect(view.level!.puzzle).toMatchObject({ swaps: 2, mistakes: 1 });
    // My mistakes in the view are the wrong swaps (level_end's `mistakes`).
    expect(view.players[0]!.mistakes).toBe(1);
  });

  it('a swap that puts a box home costs nothing; the first swap of a 3-cycle never does', () => {
    for (const [from, to] of [
      [1, 3],
      [1, 5],
      [3, 5],
      [5, 1],
    ] as const) {
      const p = setup();
      expect(p.swap(from, to, 1000).events[0]).toMatchObject({ type: 'boxesSwapped', penaltyMs: 0 });
      expect(p.state.at.filter((home, place) => home === place)).toHaveLength(7);
    }
  });

  it('a penalty that reaches the limit ends the level at once (timeUp)', () => {
    const p = setup(PUZZLE_SIX_LEVEL);
    const r = p.swap(1, 3, 56000); // neither lands home: the limit moves to 55 s
    expect(types(r.events)).toEqual(['boxesSwapped', 'levelOver']);
    expect(p.last('levelOver')).toMatchObject({ reason: 'timeUp', elapsedMs: 60000, stars: 0, mistakes: 1 });
  });
});

describe('the end', () => {
  it('every row and column right: targetReached, the last swap putting two boxes home at once', () => {
    const p = setup();
    p.swap(1, 5, 4000);
    const r = p.swap(3, 5, 9000);
    expect(types(r.events)).toEqual(['boxesSwapped', 'levelOver']);
    expect(p.last('levelOver')).toMatchObject({
      reason: 'targetReached',
      elapsedMs: 9000,
      penaltyMs: 0,
      swaps: 2,
      mistakes: 0,
      stars: 3,
    });
    expect(p.state.at).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(isSolvedGrid(p.view(9000).grid)).toBe(true);
    expect(nextPuzzleDeadline(p.state)).toBeNull();
  });

  it('any valid arrangement is right, and the swap that makes it is never wrong [D70b]', () => {
    const p = setup(PUZZLE_UNFIXED_LEVEL);
    const r = p.swap(0, 1, 5000);
    expect(r.events[0]).toMatchObject({ type: 'boxesSwapped', penaltyMs: 0 });
    expect(p.last('levelOver')).toMatchObject({ reason: 'targetReached', mistakes: 0 });
    expect(p.state.at).toEqual([3, 4, 5, 0, 1, 2, 6, 7, 8]); // not the stored arrangement
  });

  it('the thresholds include their edge: 26.000 s is still ★★★, 26.001 s is ★★', () => {
    const at = (t: number) => {
      const p = setup();
      p.swap(1, 5, 1000);
      p.swap(3, 5, t);
      return p.last('levelOver')!.stars;
    };
    expect(at(26000)).toBe(3);
    expect(at(26001)).toBe(2);
    expect(at(36000)).toBe(2);
    expect(at(36001)).toBe(1);
  });

  it('the limit: timeUp and 0 stars, on the tick at the deadline', () => {
    const p = setup();
    expect(nextPuzzleDeadline(p.state)).toBe(45000);
    expect(p.tick(44999).events).toEqual([]);
    expect(types(p.tick(45000).events)).toEqual(['levelOver']);
    expect(p.last('levelOver')).toMatchObject({ reason: 'timeUp', elapsedMs: 45000, stars: 0, t: 45000 });
  });

  it('a swap at the very ms the time runs out is too late (D52)', () => {
    const p = setup();
    p.swap(1, 5, 4000);
    const r = p.swap(3, 5, 45000);
    expect(r.rejected).toBe('gameOver');
    expect(types(r.events)).toEqual(['levelOver']);
    expect(p.last('levelOver')).toMatchObject({ reason: 'timeUp', stars: 0 });
  });

  it('the X: quit, 0 stars; after the end everything is refused (gameOver)', () => {
    const p = setup();
    p.act({ type: 'quit', playerId: ME.id }, 2500);
    expect(p.last('levelOver')).toMatchObject({ reason: 'quit', elapsedMs: 2500, stars: 0 });
    expect(p.swap(1, 5, 3000).rejected).toBe('gameOver');
    expect(p.act({ type: 'quit', playerId: ME.id }, 3000).rejected).toBe('gameOver');
    expect(p.act({ type: 'start' }, 3000).rejected).toBe('gameOver');
    expect(p.act({ type: 'pause' }, 3000).rejected).toBe('gameOver');
  });

  it("levelOutcome reads the puzzle's end: the clock its measure, the wrong swaps its mistakes", () => {
    const p = setup();
    p.swap(1, 5, 1000);
    p.swap(1, 3, 2000); // wrong
    p.swap(1, 3, 3000); // back: box 1 home again
    p.swap(3, 5, 4000);
    const over = p.state.result!;
    expect(over).toMatchObject({ reason: 'targetReached', elapsedMs: 9000, swaps: 4, mistakes: 1 });
    expect(levelOutcome(PUZZLE_LEVEL, over)).toEqual({
      reason: 'completed',
      stars: 3,
      metric: 9000,
      elapsedMs: 9000,
      bossBeaten: null,
    });
  });
});

describe('the lock [D71]', () => {
  it('off (the default): a box at home stays movable, no boxPlaced, and it can move again', () => {
    const p = setup();
    p.swap(1, 5, 1000);
    expect(types(p.log)).not.toContain('boxPlaced');
    expect(p.view(1000).level!.puzzle!.slots[1]).toEqual({ id: 5, state: 'movable' });
    expect(p.swap(1, 3, 2000).rejected).toBeUndefined();
  });

  it('on: the box locks at home (boxPlaced, placed in the view) and is refused after (boxFixed)', () => {
    const p = setup(lockedPuzzle(PUZZLE_LEVEL));
    const r = p.swap(1, 5, 1000);
    expect(r.events.map((e) => e.type)).toEqual(['boxesSwapped', 'boxPlaced']);
    expect(p.last('boxPlaced')).toMatchObject({ place: 1 });
    const puzzle = p.view(1000).level!.puzzle!;
    expect(puzzle.slots[1]).toEqual({ id: 5, state: 'placed' });
    expect(puzzle.lockOnCorrect).toBe(true);
    expect(p.swap(1, 3, 2000).rejected).toBe('boxFixed');
    expect(types(p.swap(3, 5, 3000).events)).toEqual(['boxesSwapped', 'boxPlaced', 'boxPlaced', 'levelOver']);
  });
});

describe('the freeze [D65]', () => {
  it('nothing runs out while frozen; the time left is the same after it', () => {
    const p = setup();
    p.act({ type: 'pause' }, 10000);
    expect(nextPuzzleDeadline(p.state)).toBeNull();
    expect(p.tick(200_000).events).toEqual([]);
    expect(p.view(70000).level).toMatchObject({ elapsedMs: 10000, remainingMs: 35000, endsAt: null });
    p.act({ type: 'resume' }, 70000);
    expect(p.last('levelResumed')).toMatchObject({ pausedMs: 60000 });
    expect(p.view(70000).level).toMatchObject({ elapsedMs: 10000, remainingMs: 35000, endsAt: 105000 });
    expect(nextPuzzleDeadline(p.state)).toBe(105000);
    expect(p.tick(104999).events).toEqual([]);
    p.tick(105000);
    expect(p.last('levelOver')).toMatchObject({ reason: 'timeUp', elapsedMs: 45000 });
  });

  it("a swap while frozen is refused 'paused'; the X works, its clock stopped at the freeze", () => {
    const p = setup();
    p.act({ type: 'pause' }, 4000);
    expect(p.swap(1, 5, 5000).rejected).toBe('paused');
    expect(p.act({ type: 'pause' }, 5000).rejected).toBe('paused');
    p.act({ type: 'quit', playerId: ME.id }, 9000);
    expect(p.last('levelOver')).toMatchObject({ reason: 'quit', elapsedMs: 4000 });
    expect(p.view(9000).level).toMatchObject({ elapsedMs: 4000, final: true });
  });

  it('refuses a pause before the start and a resume that is not after a pause', () => {
    const waiting = setup(PUZZLE_LEVEL, { start: false });
    expect(waiting.act({ type: 'pause' }, 0).rejected).toBe('notStarted');
    const p = setup();
    expect(p.act({ type: 'resume' }, 1000).rejected).toBe('badAction');
    expect(p.act({ type: 'start' }, 1000).rejected).toBe('alreadyStarted');
  });
});

describe('replay', () => {
  it('replayPuzzle(events) builds the same state', () => {
    const p = setup(lockedPuzzle(PUZZLE_SIX_LEVEL));
    p.swap(1, 3, 1000); // wrong
    p.act({ type: 'pause' }, 2000);
    p.act({ type: 'resume' }, 9000);
    p.swap(1, 3, 10000);
    p.swap(1, 7, 11000);
    expect(JSON.stringify(replayPuzzle(p.log))).toBe(JSON.stringify(p.state));
  });

  it('refuses a log that does not start with puzzleCreated, or skips a seq', () => {
    const p = setup();
    expect(() => replayPuzzle(p.log.slice(1))).toThrow('puzzleCreated');
    expect(() => evolvePuzzle(p.state, { type: 'levelPaused', seq: 9, t: 0 })).toThrow('seq');
    expect(() => replayPuzzle([])).toThrow('empty');
  });
});

describe('the view never gives the answer away', () => {
  it('at the start: the boxes as they stand, all as given digits, no keypad; ids are the start places', () => {
    const p = setup();
    const view = p.view(0);
    expect(view).toMatchObject({
      mode: 'solo',
      status: 'running',
      me: ME.id,
      result: null,
      solution: null,
      interference: null,
      keypad: { enabled: false, disabled: [] },
    });
    expect(view.grid).toEqual(assemblePuzzle(PUZZLE.solution, PUZZLE_LEVEL.targets.start));
    expect(view.givens.every(Boolean)).toBe(true);
    expect(view.owner.every((o) => o === null)).toBe(true);
    expect(view.level).toMatchObject({
      kind: 'puzzle',
      limitMs: 45000,
      endsAt: 45000,
      editableCells: null,
      lockTimer: false,
      final: false,
      stars: 3,
      progress: { kind: 'swaps', used: 0, mistakes: 0 },
    });
    expect(view.level!.puzzle).toEqual({
      slots: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({
        id,
        state: PUZZLE_LEVEL.targets.fixed.includes(id) ? 'fixed' : 'movable',
      })),
      moving: 3,
      swaps: 0,
      mistakes: 0,
      minSwaps: 2,
      lockOnCorrect: false,
      conflicts: [],
    });
    expect(puzzleLevelView(p.state)).toEqual(view.level!.puzzle);
    expect(setup(PUZZLE_SIX_LEVEL).view(0).level!.puzzle).toMatchObject({ moving: 6, minSwaps: 5 });
  });

  it('a box keeps its id (where it started) wherever it goes, never its home', () => {
    const p = setup(PUZZLE_SIX_LEVEL);
    p.swap(1, 7, 1000); // the box of 1 (it started at 7) goes home to 1
    const slots = p.view(1000).level!.puzzle!.slots;
    expect(slots[1]).toEqual({ id: 7, state: 'movable' });
    expect(slots[7]).toEqual({ id: 1, state: 'movable' });
  });

  it('conflicts only when the rules allow them [D78b]: the repeated digits now, none once solved', () => {
    const off = setup();
    expect(off.view(0).level!.puzzle!.conflicts).toEqual([]);
    const on = setup(PUZZLE_LEVEL, { conflicts: true });
    const now = on.view(0);
    expect(now.level!.puzzle!.conflicts).toEqual(puzzleConflicts(now.grid));
    expect(now.level!.puzzle!.conflicts.length).toBeGreaterThan(0);
    on.swap(1, 5, 1000);
    on.swap(3, 5, 2000);
    expect(on.view(2000).level!.puzzle!.conflicts).toEqual([]);
  });

  it('after the end: final, the stars, how it ended, and the solution', () => {
    const p = setup();
    p.swap(1, 5, 1000);
    p.swap(3, 5, 30000);
    const view = p.view(40000);
    expect(view.status).toBe('over');
    expect(view.solution).toBe(PUZZLE.solution);
    expect(view.level).toMatchObject({ final: true, stars: 2, elapsedMs: 30000 });
    expect(view.level!.puzzle!.over).toEqual(p.state.result);
  });
});

describe('the geometry', () => {
  it('the solution assembles from the boxes at home; the cycles and the fewest swaps of a start', () => {
    const home = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(assemblePuzzle(PUZZLE.solution, home).join('')).toBe(PUZZLE.solution);
    expect(isValidArrangement(PUZZLE.solution, home)).toBe(true);
    expect(isValidArrangement(PUZZLE.solution, PUZZLE_LEVEL.targets.start)).toBe(false);
    expect(puzzleConflicts(assemblePuzzle(PUZZLE.solution, home))).toEqual([]);
    expect(puzzleCycles(PUZZLE_LEVEL.targets.start)).toEqual([[1, 3, 5]]);
    expect(puzzleCycles(PUZZLE_SIX_LEVEL.targets.start)).toEqual([[1, 2, 3, 5, 6, 7]]);
    expect(puzzleCycles([1, 0, 3, 2, 4, 5, 6, 7, 8])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(fewestSwaps([1, 0, 3, 2, 4, 5, 6, 7, 8])).toBe(2);
    expect(fewestSwaps(PUZZLE_SIX_LEVEL.targets.start)).toBe(5);
  });
});

describe('puzzleExplainSteps: "למה?" step by step', () => {
  /** Plays the steps: each puts the box that started at `from` on `place`. */
  function solvedBy(level: AppLevelOf<'puzzle'>): boolean {
    const at = level.targets.start.slice();
    for (const s of puzzleExplainSteps(level)) at[s.place] = level.targets.start[s.from]!;
    return isValidArrangement(level.board.solution, at);
  }

  it('solves the six moving boxes one place at a time, each step the box of its place', () => {
    const steps = puzzleExplainSteps(PUZZLE_SIX_LEVEL);
    expect(steps).toHaveLength(6);
    expect(new Set(steps.map((s) => s.place))).toEqual(new Set([1, 2, 3, 5, 6, 7]));
    for (const s of steps) {
      expect(PUZZLE_SIX_LEVEL.targets.start[s.from]).toBe(s.place);
      expect(['onlyBoxForPlace', 'onlyPlaceForBox']).toContain(s.reason);
    }
    expect(steps[0]).toEqual({ place: 1, from: 7, reason: 'onlyBoxForPlace' });
    expect(solvedBy(PUZZLE_SIX_LEVEL)).toBe(true);
    expect(puzzleExplainSteps(PUZZLE_LEVEL)).toHaveLength(3);
  });

  it('holds on the equivalent boards of "שוב" too [D63]', () => {
    for (const attempt of [2, 3, 4]) {
      const level = transformLevel(PUZZLE_SIX_LEVEL, attempt);
      expect(puzzleExplainSteps(level)).toHaveLength(6);
      expect(solvedBy(level)).toBe(true);
    }
  });

  it('a place only one box fits comes first; else a box that fits only one place', () => {
    // Made-up tables, fixed boxes 0, 4 and 8: every open place fits two boxes or more, but box 1 fits only 1.
    const has = (sets: Record<number, number[]>) =>
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((h) =>
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((o) => (sets[o] ?? []).includes(h)),
      );
    const fit: PuzzleFit = {
      rows: has({ 0: [1, 2, 3], 4: [2, 3, 5], 8: [2, 6, 7] }),
      cols: has({ 0: [2, 3, 6], 4: [1, 3, 6, 7], 8: [2, 3, 5] }),
    };
    const identity = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(puzzleStepsWithFit(fit, [0, 4, 8], identity)[0]).toEqual({
      place: 1,
      from: 1,
      reason: 'onlyPlaceForBox',
    });
    // With box 3 out of column 4 too, place 1 fits box 1 alone: that comes first.
    const narrower: PuzzleFit = {
      rows: fit.rows,
      cols: has({ 0: [2, 3, 6], 4: [1, 6, 7], 8: [2, 3, 5] }),
    };
    expect(puzzleStepsWithFit(narrower, [0, 4, 8], identity)[0]).toEqual({
      place: 1,
      from: 1,
      reason: 'onlyBoxForPlace',
    });
  });
});
