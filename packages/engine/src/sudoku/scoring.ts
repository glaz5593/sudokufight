import {
  boxOf,
  BOXES,
  type CellIndex,
  colOf,
  COLS,
  type Digit,
  digitCount,
  filledIn,
  type Grid,
  isDigit,
  rowOf,
  ROWS,
} from './board';

/**
 * Scoring (spec §6.4, §6.5, §7.2).
 *
 * A correct move of digit d in cell c is scored on the board BEFORE the move. "Filled" means a given or a
 * solved cell; wrong marks are not on the grid and never count.
 *   row  filled cells in c's row, without c          0–8
 *   col  filled cells in c's column, without c       0–8
 *   box  filled cells in c's box, without c          0–8
 *   num  how many times d is already on the board    0–8
 * X is the highest of the four and Y the second highest after sorting, so a tie at the top gives Y = X [D13].
 * The [D13] alternative: Y is the highest value below X (all four equal → Y = X).
 *   points = 9 − X + (9 − Y) / 2                      1.5 … 13.5 in steps of 0.5
 */

/** How Y is picked [D13]: second after sorting (default), or the second distinct value. */
export type ScoreY = 'sorted' | 'distinct';

export interface MoveScore {
  row: number;
  col: number;
  box: number;
  num: number;
  X: number;
  Y: number;
  points: number;
}

export function moveScore(grid: Grid, cell: CellIndex, digit: Digit, y: ScoreY = 'sorted'): MoveScore {
  if (grid[cell] !== 0) throw new RangeError('A move is scored on an empty cell');
  if (!isDigit(digit)) throw new RangeError(`Not a digit: ${String(digit)}`);
  const row = filledIn(grid, ROWS[rowOf(cell)]!.cells, cell);
  const col = filledIn(grid, COLS[colOf(cell)]!.cells, cell);
  const box = filledIn(grid, BOXES[boxOf(cell)]!.cells, cell);
  const num = Math.min(8, digitCount(grid, digit));
  const sorted = [row, col, box, num].sort((a, b) => b - a);
  const X = sorted[0]!;
  const Y = y === 'sorted' ? sorted[1]! : (sorted.find((v) => v < X) ?? X);
  return { row, col, box, num, X, Y, points: 9 - X + (9 - Y) / 2 };
}

/** The score line shown with a correct move (spec §13.2): "points = 9 − 7 + (9 − 6) / 2 = 3.5". */
export const formatScoreLine = (s: Pick<MoveScore, 'X' | 'Y' | 'points'>): string =>
  `points = 9 − ${s.X} + (9 − ${s.Y}) / 2 = ${s.points}`;

/**
 * The penalty for a player's k-th mistake in a game (k ≥ 1): 1, 2, 4, 8, 16 … = 2^(k−1).
 * The ladder never resets during a game. `cap` is the [D14] proposal (e.g. 8); null keeps the original rule.
 */
export function mistakePenalty(k: number, cap: number | null = null): number {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`Mistake number must be 1 or more, got ${k}`);
  const p = 2 ** (k - 1);
  return cap === null ? p : Math.min(p, cap);
}

/** The cost of a player's n-th interference in a game (n ≥ 1): 2, 4, 8 … = 2^n [D10]. */
export function interferenceCost(n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Interference number must be 1 or more, got ${n}`);
  return 2 ** n;
}
