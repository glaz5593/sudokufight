import type { BestLineMove } from '../levels/spec';
import { agreesWith, CELL_COUNT, type CellIndex, type Digit, type Grid, isSolvedGrid } from './board';
import { type Technique, TECHNIQUES } from './logic';
import { knowableCells } from './reading';
import { moveScore, type ScoreY } from './scoring';

/**
 * The most points a few moves can make (staged practice, "point hunter", plan Idea-2): a full search over
 * ordered moves, because every move changes what the next one is worth (spec §6.4: a filled cell raises
 * the counts of its row, column, box and digit) and what is knowable next.
 *
 * A move is a cell the techniques know on the board of that moment (./reading), played with the solution's
 * digit; with `techniques: null` any empty cell is a move (what a lucky guesser could make). The search is
 * exact: a branch is cut only when even the best points left on the board could not beat the best line so
 * far. A cell's points never grow as the board fills (its counts only go up), so that bound is safe.
 * Among equal lines the first one in search order wins (the most points first, then the lowest cell).
 */

export interface BestMovesOptions {
  /** How many moves (the point hunter's 3). */
  moves?: number;
  /** The techniques that make a cell playable, re-read after every move; null: any empty cell. */
  techniques?: readonly Technique[] | null;
  scoreY?: ScoreY;
}

export interface BestMoves {
  /** The most points; 0 when no move can be made. */
  max: number;
  /** A line that makes them, in play order; shorter than `moves` when the board runs out of moves. */
  line: BestLineMove[];
  /** How many states the search visited. */
  nodes: number;
}

export function bestMoves(
  grid: Grid,
  solution: Grid,
  { moves = 3, techniques = TECHNIQUES, scoreY = 'sorted' }: BestMovesOptions = {},
): BestMoves {
  if (!Number.isInteger(moves) || moves < 0)
    throw new RangeError(`moves must be a whole number ≥ 0, got ${moves}`);
  if (grid.length !== CELL_COUNT || !isSolvedGrid(solution) || !agreesWith(grid, solution))
    throw new RangeError('bestMoves needs an 81-cell board and its solution');

  const board = grid.map((v) => (v >= 1 && v <= 9 ? v : 0));
  const placed: CellIndex[] = [];
  const line: BestLineMove[] = [];
  /** The knowable cells of each state, by the cells placed so far (the order does not change the board). */
  const knowable = new Map<string, CellIndex[]>();
  let best = -Infinity;
  let bestLine: BestLineMove[] = [];
  let nodes = 0;

  const empties = (): CellIndex[] => {
    const out: CellIndex[] = [];
    for (let c = 0; c < CELL_COUNT; c++) if (board[c] === 0) out.push(c);
    return out;
  };
  const movesNow = (): CellIndex[] => {
    if (techniques === null) return empties();
    const key = [...placed].sort((a, b) => a - b).join(',');
    let cells = knowable.get(key);
    if (!cells) {
      cells = knowableCells(board, techniques);
      knowable.set(key, cells);
    }
    return cells;
  };
  const pointsOf = (cell: CellIndex): number =>
    moveScore(board, cell, solution[cell] as Digit, scoreY).points;
  /** The sum of the `k` highest points among `values` (sorted high to low), leaving out index `skip`. */
  const topSum = (values: readonly number[], k: number, skip = -1): number => {
    let sum = 0;
    for (let i = 0, n = 0; i < values.length && n < k; i++) {
      if (i === skip) continue;
      sum += values[i]!;
      n++;
    }
    return sum;
  };

  const search = (left: number, sum: number): void => {
    nodes++;
    const cells = left > 0 ? movesNow() : [];
    if (!cells.length) {
      if (sum > best) {
        best = sum;
        bestLine = line.slice();
      }
      return;
    }
    // The bound: whatever is played later, from any empty cell, scores at most what it scores now.
    const bound = empties()
      .map(pointsOf)
      .sort((a, b) => b - a);
    if (sum + topSum(bound, left) <= best) return;
    const options = cells
      .map((cell) => ({ cell, points: pointsOf(cell) }))
      .sort((a, b) => b.points - a.points || a.cell - b.cell);
    for (const { cell, points } of options) {
      const rest = topSum(bound, left - 1, bound.indexOf(points));
      if (sum + points + rest <= best) continue;
      const digit = solution[cell] as Digit;
      board[cell] = digit;
      placed.push(cell);
      line.push({ cell, digit, points });
      search(left - 1, sum + points);
      line.pop();
      placed.pop();
      board[cell] = 0;
    }
  };

  search(moves, 0);
  return { max: best, line: bestLine, nodes };
}
