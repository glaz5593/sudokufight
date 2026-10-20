import { isSolvedGrid, parseGrid } from '../../sudoku/board';
import { PUZZLE } from '../../testing/game';
import { lockedPuzzle, PUZZLE_LEVEL, PUZZLE_SIX_LEVEL } from '../../testing/puzzleLevels';
import { seedFromString } from '../../util/random';
import { puzzleCycles, puzzleExplainSteps } from '../puzzle';
import type { LevelSpecOf } from '../spec';
import { transformLevel } from '../transform';
import { CHECKED_ATTEMPTS } from './build';
import {
  BLIND_SWAPPER,
  blindSwapperProblem,
  blindSwapperRuns,
  buildPuzzle,
  countArrangements,
  fixedApart,
  type PuzzleBuildPlan,
  puzzleProblems,
  solvesStepByStep,
} from './puzzle';

/* The puzzle's builder and its levels:validate rules (levels-content.md §5.2, §5.3, §5.7) [D70, D71]. */

/** The thresholds of §5.3 by moving boxes (the plan's PUZZLE_ROWS; the times are assumptions, D74). */
const ROWS = {
  3: { three: 26000, two: 36000, one: 45000 },
  4: { three: 36000, two: 48000, one: 60000 },
  5: { three: 44000, two: 54000, one: 60000 },
  6: { three: 45000, two: 55000, one: 60000 },
} as const;

function plan(n: number, moving: 3 | 4 | 5 | 6, lockOnCorrect = false): PuzzleBuildPlan {
  const id = `L${String(n).padStart(3, '0')}`;
  const stars = { by: 'timeMs' as const, ...ROWS[moving] };
  return {
    id,
    rev: 2,
    seed: seedFromString(`${id}:r2`),
    chapter: Math.ceil(n / 10),
    slot: ((n - 1) % 10) + 1,
    kind: 'puzzle',
    boss: false,
    gameType: 'fast',
    timeLimitMs: stars.one,
    stars,
    moving,
    lockOnCorrect,
  };
}

const PLANS = [plan(3, 3), plan(7, 3), plan(44, 4), plan(76, 5), plan(124, 5), plan(167, 6), plan(258, 6)];

const withTargets = (
  level: LevelSpecOf<'puzzle'>,
  t: Partial<LevelSpecOf<'puzzle'>['targets']>,
): LevelSpecOf<'puzzle'> => ({ ...level, targets: { ...level.targets, ...t } });

describe('counting the valid arrangements [D70b]', () => {
  it('without a fixed box: the 36 moves of whole bands and stacks', () => {
    expect(countArrangements(PUZZLE.solution, [])).toBe(36);
    expect(countArrangements(PUZZLE.solution, [], 5)).toBe(5);
  });

  it('with two fixed boxes in different bands and stacks: one', () => {
    expect(countArrangements(PUZZLE.solution, [0, 4])).toBe(1);
    expect(countArrangements(PUZZLE.solution, PUZZLE_SIX_LEVEL.targets.fixed)).toBe(1);
    expect(countArrangements(PUZZLE.solution, PUZZLE_LEVEL.targets.fixed)).toBe(1);
  });

  it('two fixed boxes in one band leave the stacks free to move', () => {
    expect(fixedApart([0, 1])).toBe(false);
    expect(countArrangements(PUZZLE.solution, [0, 1])).toBeGreaterThan(1);
    expect(fixedApart([0, 1, 5])).toBe(true);
  });

  it('step by step: every fixture solves one place at a time', () => {
    expect(solvesStepByStep(PUZZLE.solution, PUZZLE_SIX_LEVEL.targets.fixed)).toBe(true);
    expect(solvesStepByStep(PUZZLE.solution, [])).toBe(false);
  });
});

describe('buildPuzzle', () => {
  it.each(PLANS.map((p) => [p.id, p.moving, p] as const))(
    '%s (%i moving): one cycle, one arrangement, step by step, the plan kept',
    (_id, moving, p) => {
      const { spec } = buildPuzzle(p);
      const { start, fixed, lockOnCorrect } = spec.targets;
      expect(spec.kind).toBe('puzzle');
      expect(spec.board.grid).toBe(spec.board.solution);
      expect(isSolvedGrid(parseGrid(spec.board.solution))).toBe(true);
      expect(fixed).toHaveLength(9 - moving);
      expect(fixed).toEqual([...fixed].sort((a, b) => a - b));
      expect(fixedApart(fixed)).toBe(true);
      for (const f of fixed) expect(start[f]).toBe(f);
      expect(puzzleCycles(start)).toHaveLength(1);
      expect(puzzleCycles(start)[0]).toHaveLength(moving);
      expect(countArrangements(spec.board.solution, fixed)).toBe(1);
      expect(puzzleExplainSteps(spec)).toHaveLength(moving);
      expect(lockOnCorrect).toBe(false);
      expect(spec).toMatchObject({
        id: p.id,
        rev: 2,
        seed: p.seed,
        timeLimitMs: p.timeLimitMs,
        stars: p.stars,
      });
      expect(spec.check).toEqual({ techniques: [], mustNeed: [] });
      expect(puzzleProblems(spec, { moving, lockOnCorrect: false })).toEqual([]);
    },
  );

  it('the same seed gives the same level; another seed another one', () => {
    const p = plan(44, 4);
    expect(buildPuzzle(p)).toEqual(buildPuzzle(p));
    expect(buildPuzzle({ ...p, seed: p.seed + 1 }).spec.board.solution).not.toBe(
      buildPuzzle(p).spec.board.solution,
    );
  });

  it('keeps the plan lockOnCorrect in the level (the alternative of D71)', () => {
    expect(buildPuzzle(plan(5, 3, true)).spec.targets.lockOnCorrect).toBe(true);
  });

  it('refuses a plan that leaves fewer than two fixed boxes', () => {
    expect(() => buildPuzzle({ ...plan(9, 6), moving: 8 })).toThrow('fewer than 2 fixed');
  });

  it('the equivalent boards of "שוב" (attempts 2–8) keep every rule [D63]', () => {
    for (const p of [plan(44, 4), plan(167, 6)]) {
      const { spec } = buildPuzzle(p);
      for (const a of CHECKED_ATTEMPTS) {
        const level = transformLevel(spec, a);
        expect(level.board.solution).not.toBe(spec.board.solution);
        expect(puzzleProblems(level, { moving: p.moving, lockOnCorrect: false })).toEqual([]);
      }
    }
  });
});

describe('puzzleProblems: what levels:validate checks in a puzzle (§5.7)', () => {
  it('the fixtures keep every rule', () => {
    expect(puzzleProblems(PUZZLE_LEVEL, { moving: 3, lockOnCorrect: false })).toEqual([]);
    expect(puzzleProblems(PUZZLE_SIX_LEVEL, { moving: 6 })).toEqual([]);
  });

  it('a board that is not its solution', () => {
    const level = { ...PUZZLE_LEVEL, board: { ...PUZZLE_LEVEL.board, grid: PUZZLE.givens } };
    expect(puzzleProblems(level)).toContain("a puzzle's board is its solution");
    const broken = { ...PUZZLE_LEVEL, board: { grid: PUZZLE.givens, solution: PUZZLE.givens } };
    expect(puzzleProblems(broken)).toEqual(['the solution is not a solved grid']);
  });

  it('two valid arrangements (the fixed boxes all in one band)', () => {
    const level = withTargets(PUZZLE_LEVEL, { start: [0, 1, 2, 4, 5, 6, 7, 8, 3], fixed: [0, 1, 2] });
    const problems = puzzleProblems(level);
    expect(problems).toContain('no two fixed boxes lie in different bands and stacks');
    expect(problems.some((p) => /^\d+ valid arrangements, not one$/.test(p))).toBe(true);
  });

  it('a moving box that starts at home', () => {
    const level = withTargets(PUZZLE_SIX_LEVEL, { start: [0, 3, 2, 5, 4, 6, 7, 1, 8] });
    expect(puzzleProblems(level)).toContain('moving box 2 starts at home');
  });

  it('a start that is not one cycle', () => {
    const level = withTargets(PUZZLE_SIX_LEVEL, { start: [0, 2, 1, 5, 4, 3, 7, 6, 8] });
    expect(puzzleProblems(level)).toEqual(['the moving boxes make 3 cycles, not one']);
  });

  it('a fixed box away from home, fixed places out of order, too few fixed boxes', () => {
    expect(puzzleProblems(withTargets(PUZZLE_SIX_LEVEL, { fixed: [0, 4, 7] }))).toContain(
      'the fixed box of place 7 does not start at home',
    );
    expect(puzzleProblems(withTargets(PUZZLE_SIX_LEVEL, { fixed: [4, 0, 8] }))[0]).toMatch(/ascending/);
    expect(puzzleProblems(withTargets(PUZZLE_SIX_LEVEL, { fixed: [0] }))[0]).toMatch(/2\+ ascending/);
    expect(puzzleProblems(withTargets(PUZZLE_SIX_LEVEL, { start: [0, 1, 1, 3, 4, 5, 6, 7, 8] }))).toEqual([
      'the start is not an arrangement of the nine boxes',
    ]);
  });

  it('one valid arrangement that does not solve step by step (§5.7)', () => {
    // A real board: the fixed boxes 6 and 8 (places 5 and 7) lie in different bands and stacks and leave exactly
    // one arrangement, but at some step no place has only one box that fits, and no box only one place.
    const solution = '382479516164253897759816243917528364548631729623947158835194672296785431471362985';
    const fixed = [5, 7];
    expect(countArrangements(solution, fixed)).toBe(1);
    expect(solvesStepByStep(solution, fixed)).toBe(false);
    const level: LevelSpecOf<'puzzle'> = {
      ...PUZZLE_LEVEL,
      board: { grid: solution, solution },
      // One 7-cycle: every moving box away from home.
      targets: { start: [1, 2, 3, 4, 6, 5, 8, 7, 0], fixed, lockOnCorrect: false },
    };
    expect(puzzleCycles(level.targets.start)).toHaveLength(1);
    expect(puzzleProblems(level)).toEqual(['it does not solve step by step']);
  });

  it('the moving boxes or lockOnCorrect unlike the chapter', () => {
    expect(puzzleProblems(PUZZLE_LEVEL, { moving: 4 })).toEqual(['3 moving boxes, not 4']);
    expect(puzzleProblems(lockedPuzzle(PUZZLE_LEVEL), { lockOnCorrect: false })).toEqual([
      "lockOnCorrect true, not the chapter's false",
    ]);
  });
});

describe('the blind swapper (§5.3)', () => {
  it('plays through the engine, deterministic per seed; with 3 moving it is often fast (the introduction)', () => {
    const runs = blindSwapperRuns(PUZZLE_LEVEL);
    expect(runs).toHaveLength(BLIND_SWAPPER.runs);
    expect(blindSwapperRuns(PUZZLE_LEVEL)).toEqual(runs);
    const solved = runs.filter((r) => r.solved);
    // Its first swap always puts a box home, so 2 swaps (3 s) is its best.
    expect(Math.min(...solved.map((r) => r.elapsedMs))).toBe(3000);
    expect(runs.every((r) => r.mistakes * 5000 <= r.elapsedMs)).toBe(true);
    const sorted = runs.map((r) => (r.solved ? r.elapsedMs : Infinity)).sort((a, b) => a - b);
    expect(sorted[runs.length / 2]).toBeLessThan(PUZZLE_LEVEL.stars.three);
    // From 4 moving only: chapters 1–3 cannot keep a guesser out.
    expect(blindSwapperProblem(PUZZLE_LEVEL)).toBeNull();
  });

  it('from 4 moving boxes it gets ★★★ in under 35% of its runs on the built puzzles (the agreed rule)', () => {
    expect(BLIND_SWAPPER.maxThreeShare).toBe(0.35);
    for (const p of PLANS.filter((x) => x.moving >= 4))
      expect(blindSwapperProblem(buildPuzzle(p).spec)).toBeNull();
  });

  it('fails a puzzle whose ★★★ a blind swapper reaches in 35% of its runs or more', () => {
    expect(blindSwapperProblem(PUZZLE_LEVEL, { fromMoving: 3 })).toMatch(
      /^a blind swapper gets ★★★ in \d+% of its runs \(under 35% allowed\)$/,
    );
    // Not "never" with 4 moving boxes at ★★★ 36 s: a lucky guesser gets ★★★ in about a quarter of its runs
    // there, so a stricter share (10%) would fail it. That holds from 5 moving only.
    const { spec } = buildPuzzle(plan(44, 4));
    const share = blindSwapperRuns(spec).filter((r) => r.stars === 3).length / BLIND_SWAPPER.runs;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(BLIND_SWAPPER.maxThreeShare);
    expect(blindSwapperProblem(spec, { maxThreeShare: 0.1 })).not.toBeNull();
  });
});
