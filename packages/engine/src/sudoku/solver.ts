import { boxOf, CELL_COUNT, colOf, type Grid, isConsistent, rowOf } from './board';

/**
 * A fast backtracking solver (bitmasks + "fewest candidates first").
 * It answers "what is the solution" and "is it the only one"; the human-style reasoning lives in ./logic.
 */

const ALL = 0x1ff; // digits 1..9 → bits 0..8
const bit = (d: number): number => 1 << (d - 1);

function popcount(m: number): number {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

/**
 * Counts solutions, stopping at `limit`. Returns 0 for an inconsistent grid.
 * `onSolution` sees each solution found (at most `limit`).
 */
export function countSolutions(grid: Grid, limit = 2, onSolution?: (solution: number[]) => void): number {
  if (grid.length !== CELL_COUNT || !isConsistent(grid)) return 0;
  const cells = grid.map((v) => (v >= 1 && v <= 9 ? v : 0));
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);
  for (let i = 0; i < CELL_COUNT; i++) {
    const v = cells[i]!;
    if (!v) continue;
    rows[rowOf(i)]! |= bit(v);
    cols[colOf(i)]! |= bit(v);
    boxes[boxOf(i)]! |= bit(v);
  }

  let found = 0;
  const search = (): boolean => {
    // Pick the empty cell with the fewest candidates.
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < CELL_COUNT; i++) {
      if (cells[i]) continue;
      const mask = ALL & ~(rows[rowOf(i)]! | cols[colOf(i)]! | boxes[boxOf(i)]!);
      const n = popcount(mask);
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
        if (n <= 1) break;
      }
    }
    if (best === -1) {
      found++;
      onSolution?.(cells.slice());
      return found >= limit;
    }
    if (bestCount === 0) return false;
    const r = rowOf(best);
    const c = colOf(best);
    const b = boxOf(best);
    let mask = bestMask;
    while (mask) {
      const low = mask & -mask;
      mask &= mask - 1;
      const d = 31 - Math.clz32(low) + 1;
      cells[best] = d;
      rows[r]! |= low;
      cols[c]! |= low;
      boxes[b]! |= low;
      const stop = search();
      cells[best] = 0;
      rows[r]! &= ~low;
      cols[c]! &= ~low;
      boxes[b]! &= ~low;
      if (stop) return true;
    }
    return false;
  };
  search();
  return found;
}

/** The first solution found, or null when there is none. */
export function solve(grid: Grid): number[] | null {
  let solution: number[] | null = null;
  countSolutions(grid, 1, (s) => (solution = s));
  return solution;
}

/** True when the grid has exactly one solution. */
export const hasUniqueSolution = (grid: Grid): boolean => countSolutions(grid, 2) === 1;
