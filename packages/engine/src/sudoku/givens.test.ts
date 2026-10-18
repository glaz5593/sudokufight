import { GAME_TYPES } from '../gameType';
import { bankRows } from '../testing/fixtures';
import { createRng } from '../util/random';
import { agreesWith, boxOf, CELL_COUNT, filledCount, parseGrid } from './board';
import { generatePuzzle } from './generate';
import {
  addGivens,
  DEFAULT_FIT,
  DEFAULT_GIVENS,
  digitCounts,
  fitGivens,
  type GivensRules,
  givensSpread,
} from './givens';
import { gradePuzzle } from './grade';
import { hasUniqueSolution } from './solver';

const ROW0 = bankRows()[0]!;
const GIVENS0 = parseGrid(ROW0.puzzle);
const SOLUTION0 = parseGrid(ROW0.solution);
const EMPTY = new Array<number>(CELL_COUNT).fill(0);

const boxCounts = (grid: readonly number[]): number[] => {
  const out = new Array<number>(9).fill(0);
  grid.forEach((v, i) => {
    if (v !== 0) out[boxOf(i)]!++;
  });
  return out;
};

describe('givens at the start per game type (§5.2) [D43]', () => {
  it('fast 45–50, normal 35–40; hard has no range (kept as it is)', () => {
    expect(DEFAULT_GIVENS).toEqual({
      fast: { min: 45, max: 50 },
      normal: { min: 35, max: 40 },
      hard: null,
    });
    for (const type of GAME_TYPES) {
      const range = DEFAULT_GIVENS[type];
      if (range === null) continue;
      expect(range.min).toBeLessThanOrEqual(range.max);
      expect(range.min).toBeGreaterThanOrEqual(17); // fewer givens never have a unique solution
      expect(range.max).toBeLessThanOrEqual(81);
    }
    // Fewer givens, harder board: the ranges don't overlap.
    expect(DEFAULT_GIVENS.normal!.max).toBeLessThan(DEFAULT_GIVENS.fast!.min);
    expect(DEFAULT_FIT).toEqual({ attempts: 5, slack: 1, salt: 20261015 });
  });
});

describe('digitCounts and givensSpread', () => {
  it('count the givens of each digit, and the gap between the most and the least common', () => {
    const grid = EMPTY.slice();
    grid[0] = 1;
    grid[1] = 1;
    grid[2] = 1;
    grid[10] = 9;
    expect(digitCounts(grid)).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(givensSpread(grid)).toBe(3);
    expect(digitCounts(SOLUTION0)).toEqual(new Array(9).fill(9));
    expect(givensSpread(SOLUTION0)).toBe(0);
    expect(givensSpread(EMPTY)).toBe(0);
  });
});

describe('addGivens: givens from the solution, the scarcest digit first', () => {
  it('fills an empty board evenly: every digit the same, and the boxes nearly so', () => {
    const at45 = addGivens(EMPTY, SOLUTION0, 45, createRng(1))!;
    expect(filledCount(at45)).toBe(45);
    expect(digitCounts(at45)).toEqual(new Array(9).fill(5));
    expect(agreesWith(at45, SOLUTION0)).toBe(true);
    const boxes = boxCounts(at45);
    expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThanOrEqual(2);

    const at47 = addGivens(EMPTY, SOLUTION0, 47, createRng(2))!;
    expect([...digitCounts(at47)].sort()).toEqual([5, 5, 5, 5, 5, 5, 5, 6, 6]);
  });

  it('keeps every given, adds only digits of the solution, and the puzzle keeps its one solution', () => {
    const out = addGivens(GIVENS0, SOLUTION0, 45, createRng(3))!;
    expect(filledCount(out)).toBe(45);
    for (let i = 0; i < CELL_COUNT; i++) if (GIVENS0[i] !== 0) expect(out[i]).toBe(GIVENS0[i]);
    expect(agreesWith(out, SOLUTION0)).toBe(true);
    expect(hasUniqueSolution(out)).toBe(true);
    expect(digitCounts(out).every((n) => n > 0)).toBe(true);
    expect(givensSpread(out)).toBeLessThanOrEqual(Math.max(2, givensSpread(GIVENS0)));
  });

  it('gives the next given to a digit that has none, whatever the seed', () => {
    const no9 = GIVENS0.map((v) => (v === 9 ? 0 : v));
    expect(digitCounts(no9)[8]).toBe(0);
    for (let seed = 1; seed <= 10; seed++) {
      const out = addGivens(no9, SOLUTION0, filledCount(no9) + 1, createRng(seed))!;
      const added = out.findIndex((v, i) => v !== no9[i]);
      expect(out[added]).toBe(9);
    }
  });

  it('is deterministic: the same seed, the same board; another seed, another board', () => {
    const a = addGivens(GIVENS0, SOLUTION0, 47, createRng(42));
    expect(addGivens(GIVENS0, SOLUTION0, 47, createRng(42))).toEqual(a);
    expect(addGivens(GIVENS0, SOLUTION0, 47, createRng(43))).not.toEqual(a);
  });

  it('keepGrade: a "normal" board still needs a hidden single, and a "hard" one stays hard', () => {
    const normal = generatePuzzle(createRng(11), 'normal', { attempts: 40 })!;
    expect(filledCount(normal.givens)).toBeLessThan(35);
    const n35 = addGivens(normal.givens, normal.solution, 35, createRng(1), { keepGrade: 'normal' })!;
    expect(filledCount(n35)).toBe(35);
    const grade = gradePuzzle(n35);
    expect(grade.difficulty).toBe('normal');
    expect(grade.techniques).toContain('hiddenSingle');
    expect(digitCounts(n35).every((n) => n > 0)).toBe(true);

    const hard = generatePuzzle(createRng(11), 'hard', { attempts: 40 })!;
    expect(filledCount(hard.givens)).toBeLessThan(24);
    const h24 = addGivens(hard.givens, hard.solution, 24, createRng(1), { keepGrade: 'hard' })!;
    expect(filledCount(h24)).toBe(24);
    expect(gradePuzzle(h24).difficulty).toBe('hard');
  });

  it('keepGrade: null when no cell is left that keeps the grade', () => {
    const hard = generatePuzzle(createRng(11), 'hard', { attempts: 40 })!;
    expect(addGivens(hard.givens, hard.solution, 70, createRng(1), { keepGrade: 'hard' })).toBeNull();
  });

  it('refuses a bad target or givens that disagree with the solution; a reached target returns a copy', () => {
    for (const target of [-1, 82, 1.5])
      expect(() => addGivens(GIVENS0, SOLUTION0, target, createRng(1))).toThrow(RangeError);
    const wrong = GIVENS0.slice();
    const empty = wrong.indexOf(0);
    wrong[empty] = (SOLUTION0[empty]! % 9) + 1;
    expect(() => addGivens(wrong, SOLUTION0, 45, createRng(1))).toThrow(RangeError);
    expect(() => addGivens(GIVENS0, GIVENS0, 45, createRng(1))).toThrow(RangeError);
    expect(() => addGivens(GIVENS0, SOLUTION0, 45, createRng(1), { slack: -1 })).toThrow(RangeError);
    const copy = addGivens(GIVENS0, SOLUTION0, filledCount(GIVENS0), createRng(1))!;
    expect(copy).toEqual(GIVENS0);
    expect(copy).not.toBe(GIVENS0);
    expect(addGivens(GIVENS0, SOLUTION0, 0, createRng(1))).toEqual(GIVENS0);
  });
});

describe('fitGivens: into the type range', () => {
  it('leaves a puzzle within its range alone', () => {
    const at47 = addGivens(GIVENS0, SOLUTION0, 47, createRng(1))!;
    expect(fitGivens(at47, SOLUTION0, 'fast', createRng(1))).toEqual({ status: 'inRange' });
  });

  it('fills a fast puzzle of the original bank (30–36 givens) to 45–50, still fast, every digit shown', () => {
    for (const row of bankRows().slice(0, 12)) {
      const givens = parseGrid(row.puzzle);
      const solution = parseGrid(row.solution);
      const fit = fitGivens(givens, solution, 'fast', createRng(7));
      expect(fit.status).toBe('filled');
      if (fit.status !== 'filled') continue;
      const n = filledCount(fit.givens);
      expect(n).toBeGreaterThanOrEqual(45);
      expect(n).toBeLessThanOrEqual(50);
      expect(fit.attempts).toBe(1);
      expect(gradePuzzle(fit.givens).difficulty).toBe('fast');
      expect(agreesWith(fit.givens, solution)).toBe(true);
      expect(digitCounts(fit.givens).every((c) => c > 0)).toBe(true);
      expect(givensSpread(fit.givens)).toBeLessThanOrEqual(2);
    }
  });

  it('does not take givens away: a "normal" board with more than 40 is tooMany', () => {
    const at45 = addGivens(GIVENS0, SOLUTION0, 45, createRng(1))!;
    expect(fitGivens(at45, SOLUTION0, 'normal', createRng(1))).toEqual({ status: 'tooMany' });
  });

  it('never touches a type without a range: hard, whatever its givens', () => {
    const hard = generatePuzzle(createRng(11), 'hard', { attempts: 40 })!;
    expect(fitGivens(hard.givens, hard.solution, 'hard', createRng(1))).toEqual({ status: 'noRange' });
    expect(fitGivens(GIVENS0, SOLUTION0, 'hard', createRng(1))).toEqual({ status: 'noRange' });
    // A range can be given to it in the rules.
    const rules: GivensRules = { ...DEFAULT_GIVENS, hard: { min: 20, max: 30 } };
    expect(fitGivens(GIVENS0, SOLUTION0, 'hard', createRng(1), { rules })).toEqual({ status: 'tooMany' });
  });

  it('gradeLost when no fill keeps the grade', () => {
    const normal = generatePuzzle(createRng(11), 'normal', { attempts: 40 })!;
    // One empty cell is always a naked single: no 80-given board needs a hidden single.
    const rules: GivensRules = { ...DEFAULT_GIVENS, normal: { min: 80, max: 80 } };
    expect(fitGivens(normal.givens, normal.solution, 'normal', createRng(1), { rules, attempts: 2 })).toEqual(
      {
        status: 'gradeLost',
      },
    );
  });
});
