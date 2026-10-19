import type { GameType } from '../../gameType';
import { CELL_COUNT, type CellIndex, filledCount, type Grid } from '../../sudoku/board';
import { generatePuzzle } from '../../sudoku/generate';
import { addGivens } from '../../sudoku/givens';
import type { Rng } from '../../util/random';

/**
 * The boards of the level builder (dev-plan §2ד): a puzzle from the engine's generator, seeded by the level,
 * then filled up to the chapter's givens from its own solution (plan §2.1). Adding givens that agree with the
 * one solution keeps it the only one; the cells a level keeps empty never get one (addGivens' exclude).
 */

export interface FitBoardOptions {
  /** How many givens the board ends with. */
  total: number;
  /** Cells that stay empty (a target's box, a fillBox box). */
  keepEmpty?: ReadonlySet<CellIndex>;
  /** Every given added keeps this grade (a duel's or point hunter's board stays its type); null: any. */
  keepGrade?: GameType | null;
}

/** `givens` filled up to `total` from `solution` (never in `keepEmpty`), or null when it cannot get there. */
export function fitBoard(
  givens: Grid,
  solution: Grid,
  { total, keepEmpty, keepGrade = null }: FitBoardOptions,
  rng: Rng,
): number[] | null {
  if (filledCount(givens) > total) return null;
  for (const c of keepEmpty ?? []) if (givens[c] !== 0) return null;
  return addGivens(givens, solution, total, rng, { exclude: keepEmpty, keepGrade });
}

export interface Board {
  givens: number[];
  solution: number[];
}

export interface MakeBoardOptions {
  type: GameType;
  total: number;
  /** The board must keep its type's grade (a full game is played on it: duel, point hunter). */
  keepGrade?: boolean;
  /** Generator runs before giving up. */
  attempts?: number;
}

/**
 * A puzzle with one solution and exactly `total` givens: the generator's puzzle of `type` (fewer givens than
 * the chapter's), filled up. Null when `attempts` runs did not get one (a hard board can come out with more
 * givens than an act-6 board allows).
 */
export function makeBoard(
  rng: Rng,
  { type, total, keepGrade = false, attempts = 12 }: MakeBoardOptions,
): Board | null {
  if (!(Number.isInteger(total) && total >= 17 && total <= CELL_COUNT))
    throw new RangeError(`A board's givens are 17–81, got ${total}`);
  for (let k = 0; k < attempts; k++) {
    const p = generatePuzzle(rng, type, { attempts: 1, minGivens: Math.min(total, 22) });
    if (!p || filledCount(p.givens) > total) continue;
    const givens = fitBoard(p.givens, p.solution, { total, keepGrade: keepGrade ? type : null }, rng);
    if (givens) return { givens, solution: p.solution };
  }
  return null;
}
