import type { GameType } from '../gameType';
import { randomInt, type Rng } from '../util/random';
import { boxOf, CELL_COUNT, colOf, DIGITS, rowOf } from './board';
import { DEFAULT_GRADING, type Difficulty, gradePuzzle, type GradingRules } from './grade';
import { countSolutions } from './solver';

/**
 * A puzzle generator with the grader in the loop (spec §20, option 2 for the missing "normal" and "hard"
 * puzzles). Seeded, so the same seed gives the same puzzle.
 *
 * 1. A random solved grid (backtracking with shuffled digits).
 * 2. Givens are removed in random order, keeping a unique solution, until the grade reaches the target or
 *    no more can be removed.
 */

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A random complete, valid grid. */
export function generateSolvedGrid(rng: Rng): number[] {
  const grid = new Array<number>(CELL_COUNT).fill(0);
  const ok = (i: number, d: number): boolean => {
    for (let k = 0; k < CELL_COUNT; k++) {
      if (grid[k] !== d || k === i) continue;
      if (rowOf(k) === rowOf(i) || colOf(k) === colOf(i) || boxOf(k) === boxOf(i)) return false;
    }
    return true;
  };
  const fill = (i: number): boolean => {
    if (i === CELL_COUNT) return true;
    for (const d of shuffled(rng, DIGITS)) {
      if (!ok(i, d)) continue;
      grid[i] = d;
      if (fill(i + 1)) return true;
    }
    grid[i] = 0;
    return false;
  };
  fill(0);
  return grid;
}

const RANK: Record<Difficulty, number> = { fast: 0, normal: 1, hard: 2, beyond: 3 };

export interface GeneratedPuzzle {
  givens: number[];
  solution: number[];
  difficulty: Difficulty;
}

/**
 * A puzzle of exactly `target` difficulty, or null if `attempts` grids did not give one.
 * `minGivens` stops removing early (fewer givens tend to be harder).
 */
export function generatePuzzle(
  rng: Rng,
  target: GameType,
  {
    attempts = 20,
    minGivens = 22,
    grading = DEFAULT_GRADING,
  }: {
    attempts?: number;
    minGivens?: number;
    grading?: GradingRules;
  } = {},
): GeneratedPuzzle | null {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const solution = generateSolvedGrid(rng);
    const givens = solution.slice();
    let filled = CELL_COUNT;
    let best: GeneratedPuzzle | null = null;
    for (const cell of shuffled(
      rng,
      Array.from({ length: CELL_COUNT }, (_, i) => i),
    )) {
      if (filled <= minGivens) break;
      const keep = givens[cell]!;
      givens[cell] = 0;
      if (countSolutions(givens, 2) !== 1) {
        givens[cell] = keep;
        continue;
      }
      filled--;
      const { difficulty } = gradePuzzle(givens, grading);
      if (RANK[difficulty] > RANK[target]) {
        givens[cell] = keep; // one step too far: undo and try other cells
        filled++;
        continue;
      }
      if (difficulty === target) best = { givens: givens.slice(), solution, difficulty };
    }
    if (best) return best;
  }
  return null;
}
