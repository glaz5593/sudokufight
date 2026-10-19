import type { GameType } from '../gameType';
import { randomInt, type Rng, shuffled } from '../util/random';
import {
  agreesWith,
  boxOf,
  CELL_COUNT,
  type CellIndex,
  DIGITS,
  filledCount,
  type Grid,
  isSolvedGrid,
} from './board';
import { DEFAULT_GRADING, gradePuzzle, type GradingRules } from './grade';

/**
 * How many givens a game type starts with (spec §5.2) [D43]: the number of digits on the board at the start
 * is what a player sees first, so it sets the types apart as much as the techniques do (Moshe, 2026-10-15).
 *
 * A puzzle with fewer givens than its type's range gets more, taken from its own solution: seeded, the digit
 * with the fewest givens first (so every digit shows and none stands out), the emptiest box first, and never
 * a given that would make the puzzle easier than its type. A given that agrees with the unique solution can't
 * add a second solution, so the puzzle stays unique.
 */

export interface GivensRange {
  readonly min: number;
  readonly max: number;
}

/** The givens range of each game type; null: no range, the type's puzzles stay exactly as they are. */
export type GivensRules = Readonly<Record<GameType, GivensRange | null>>;

/**
 * Givens at the start per game type (Moshe, 2026-10-15) [D43]: fast 45–50, normal 35–40. Hard has no range:
 * Moshe asked to keep the hard boards exactly as they are (about 22–29 givens).
 */
export const DEFAULT_GIVENS: GivensRules = {
  fast: { min: 45, max: 50 },
  normal: { min: 35, max: 40 },
  hard: null,
};

/**
 * Tuning of the fill. attempts: fills tried before a puzzle is given up; slack: how far above the scarcest
 * digit's count a digit may still get a given (when the scarcest digit's cells would make the puzzle too
 * easy); salt: mixed into each puzzle's seed (`seedFromString(id, salt)`), so a bank is filled the same way
 * every time.
 */
export const DEFAULT_FIT = { attempts: 5, slack: 1, salt: 20261015 } as const;

/** Givens per digit: index 0 is digit 1, index 8 is digit 9. */
export function digitCounts(grid: Grid): number[] {
  const counts = new Array<number>(9).fill(0);
  for (const v of grid) if (v >= 1 && v <= 9) counts[v - 1]!++;
  return counts;
}

/** How many more givens the most common digit has than the rarest one (0 = perfectly even). */
export function givensSpread(grid: Grid): number {
  const counts = digitCounts(grid);
  return Math.max(...counts) - Math.min(...counts);
}

export interface AddGivensOptions {
  /** Every added given must keep this grade (gradePuzzle's game type); null (the default) checks nothing. */
  keepGrade?: GameType | null;
  /** See DEFAULT_FIT.slack. */
  slack?: number;
  grading?: GradingRules;
  /**
   * Cells that never get a given (staged practice: the cells a level keeps empty, such as its target box).
   * A cell of it that already holds a given keeps it.
   */
  exclude?: ReadonlySet<CellIndex>;
}

/**
 * The givens with digits of the solution added until there are `target` of them, or null when keepGrade
 * leaves no cell to add. Water filling: each new given goes to a digit with the fewest givens (up to `slack`
 * more, when those digits have no usable cell), on a random cell of that digit in the box with the fewest
 * givens. Deterministic for a given Rng. A target at or below the givens already there returns a copy.
 * Null too when `exclude` leaves too few cells to reach the target.
 */
export function addGivens(
  givens: Grid,
  solution: Grid,
  target: number,
  rng: Rng,
  { keepGrade = null, slack = DEFAULT_FIT.slack, grading = DEFAULT_GRADING, exclude }: AddGivensOptions = {},
): number[] | null {
  if (!Number.isInteger(target) || target < 0 || target > CELL_COUNT)
    throw new RangeError(`A givens target must be an integer from 0 to ${CELL_COUNT}, got ${target}`);
  if (givens.length !== CELL_COUNT || !isSolvedGrid(solution))
    throw new RangeError('addGivens needs an 81-cell puzzle and its complete solution');
  if (!agreesWith(givens, solution)) throw new RangeError('The givens do not agree with the solution');
  if (!Number.isInteger(slack) || slack < 0)
    throw new RangeError(`slack must be a whole number ≥ 0, got ${slack}`);

  const out = givens.slice();
  const counts = digitCounts(out);
  const boxCounts = new Array<number>(9).fill(0);
  for (let i = 0; i < CELL_COUNT; i++) if (out[i] !== 0) boxCounts[boxOf(i)]!++;
  const blocked = new Set<number>();
  let filled = filledCount(out);

  /** Puts one more given on the board; false when no allowed cell is left. */
  const placeOne = (): boolean => {
    const open = DIGITS.filter((d) => counts[d - 1]! < 9);
    if (open.length === 0) return false;
    const minCount = Math.min(...open.map((d) => counts[d - 1]!));
    for (let level = minCount; level <= minCount + slack; level++) {
      for (const d of shuffled(
        rng,
        open.filter((x) => counts[x - 1] === level),
      )) {
        const cells: number[] = [];
        for (let i = 0; i < CELL_COUNT; i++)
          if (out[i] === 0 && solution[i] === d && !blocked.has(i) && !exclude?.has(i)) cells.push(i);
        // Random order first, then the emptiest box first (a stable sort keeps the random order within a box).
        const order = shuffled(rng, cells).sort((a, b) => boxCounts[boxOf(a)]! - boxCounts[boxOf(b)]!);
        for (const c of order) {
          out[c] = d;
          if (keepGrade !== null && gradePuzzle(out, grading).gameType !== keepGrade) {
            // Too easy now, and adding givens never makes a puzzle harder: this cell stays out for good.
            out[c] = 0;
            blocked.add(c);
            continue;
          }
          counts[d - 1]!++;
          boxCounts[boxOf(c)]!++;
          return true;
        }
      }
    }
    return false;
  };

  while (filled < target) {
    if (!placeOne()) return null;
    filled++;
  }
  return out;
}

export type FitGivens =
  /** The type has no givens range (hard): left as it is. */
  | { status: 'noRange' }
  /** Already within its type's range: left as it is (its id and play history stay). */
  | { status: 'inRange' }
  /** Givens added: `givens` is within the range and keeps the type's grade. */
  | { status: 'filled'; givens: number[]; attempts: number }
  /** More givens than the type allows: taking givens away is the generator's job. */
  | { status: 'tooMany' }
  /** No fill within `attempts` kept the type's grade. */
  | { status: 'gradeLost' };

export interface FitGivensOptions {
  rules?: GivensRules;
  attempts?: number;
  slack?: number;
  grading?: GradingRules;
}

/**
 * Brings a puzzle of `gameType` into its givens range (DEFAULT_GIVENS): a random target within the range,
 * then addGivens keeping the grade, up to `attempts` times. A type without a range is never touched.
 */
export function fitGivens(
  givens: Grid,
  solution: Grid,
  gameType: GameType,
  rng: Rng,
  {
    rules = DEFAULT_GIVENS,
    attempts = DEFAULT_FIT.attempts,
    slack = DEFAULT_FIT.slack,
    grading = DEFAULT_GRADING,
  }: FitGivensOptions = {},
): FitGivens {
  const range = rules[gameType];
  if (range === null) return { status: 'noRange' };
  const { min, max } = range;
  const n = filledCount(givens);
  if (n >= min && n <= max) return { status: 'inRange' };
  if (n > max) return { status: 'tooMany' };
  const target = min + randomInt(rng, max - min + 1);
  for (let k = 1; k <= attempts; k++) {
    const out = addGivens(givens, solution, target, rng, { keepGrade: gameType, slack, grading });
    if (out) return { status: 'filled', givens: out, attempts: k };
  }
  return { status: 'gradeLost' };
}
