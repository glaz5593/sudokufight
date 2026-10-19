import { bankPuzzles } from '../testing/bot';
import { PUZZLE } from '../testing/game';
import { type CellIndex, type Digit, emptyCells, type Grid, parseCellName, parseGrid } from './board';
import { bestMoves } from './bestMoves';
import { type Technique, TECHNIQUES } from './logic';
import { knowableCells } from './reading';
import { moveScore } from './scoring';

const SOLUTION = parseGrid(PUZZLE.solution);
const at = (names: string[]): CellIndex[] => names.map(parseCellName);

/** Bank puzzle #1 solved but for A1, A2, B1 and B2 (box 1): 8, 6, 3 and 2, each on the board 8 times. */
const CORNER = SOLUTION.slice();
for (const c of at(['A1', 'A2', 'B1', 'B2'])) CORNER[c] = 0;

/** Every ordered line, no cut: the reference the search must match. */
function exhaustive(
  grid: Grid,
  solution: Grid,
  moves: number,
  techniques: readonly Technique[] | null,
): number {
  const board = grid.slice();
  const go = (left: number): number => {
    const cells =
      left === 0 ? [] : techniques === null ? emptyCells(board) : knowableCells(board, techniques);
    let best = 0;
    for (const c of cells) {
      const points = moveScore(board, c, solution[c] as Digit).points;
      board[c] = solution[c]!;
      best = Math.max(best, points + go(left - 1));
      board[c] = 0;
    }
    return best;
  };
  return go(moves);
}

describe('bestMoves: the point hunter’s maximum (plan Idea-2)', () => {
  it('equals the hand-computed optimum of a tiny board, where the order matters', () => {
    // Before any move each cell scores 9 − 8 + (9 − 7) / 2 = 2: X = 8 (its digit is on the board 8 times),
    // Y = 7 (its row and column each have one other gap). After A1, A2 has a full row A (8): 1.5; B2 still
    // has a gap in its row and its column: 2. So A1 then B2 makes 4, A1 then A2 only 3.5.
    expect(moveScore(CORNER, parseCellName('A1'), 8).points).toBe(2);
    const afterA1 = CORNER.slice();
    afterA1[parseCellName('A1')] = 8;
    expect(moveScore(afterA1, parseCellName('A2'), 6).points).toBe(1.5);
    expect(moveScore(afterA1, parseCellName('B2'), 2).points).toBe(2);

    const two = bestMoves(CORNER, SOLUTION, { moves: 2, techniques: null });
    expect(two.max).toBe(4);
    expect(two.line).toEqual([
      { cell: parseCellName('A1'), digit: 8, points: 2 },
      { cell: parseCellName('B2'), digit: 2, points: 2 },
    ]);
    // The last two each have a full row or column then: 1.5 each.
    expect(bestMoves(CORNER, SOLUTION, { moves: 3, techniques: null }).max).toBe(5.5);
    expect(bestMoves(CORNER, SOLUTION, { moves: 4, techniques: null }).max).toBe(7);
    // More moves than cells: the line stops when the board is full.
    expect(bestMoves(CORNER, SOLUTION, { moves: 9, techniques: null }).line).toHaveLength(4);
    // Every cell of the corner is a single, so the logic changes nothing here.
    expect(bestMoves(CORNER, SOLUTION, { moves: 3 }).max).toBe(5.5);
    expect(bestMoves(CORNER, SOLUTION, { moves: 0 })).toEqual({ max: 0, line: [], nodes: 1 });
  });

  it('cuts branches but never the optimum (an exhaustive search agrees)', () => {
    for (const p of bankPuzzles('fast', 3)) {
      const grid = parseGrid(p.givens);
      const sol = parseGrid(p.solution);
      expect(bestMoves(grid, sol, { moves: 3, techniques: null }).max).toBe(exhaustive(grid, sol, 3, null));
    }
    const p = bankPuzzles('hard', 1)[0]!;
    const grid = parseGrid(p.givens);
    const sol = parseGrid(p.solution);
    expect(bestMoves(grid, sol, { moves: 3 }).max).toBe(exhaustive(grid, sol, 3, TECHNIQUES));
  });

  it('any empty cell scores at least as much as the knowable ones', () => {
    for (const gameType of ['fast', 'normal', 'hard'] as const)
      for (const p of bankPuzzles(gameType, 5)) {
        const grid = parseGrid(p.givens);
        const sol = parseGrid(p.solution);
        const free = bestMoves(grid, sol, { techniques: null }).max;
        const known = bestMoves(grid, sol).max;
        const singles = bestMoves(grid, sol, { techniques: ['nakedSingle', 'hiddenSingle'] }).max;
        expect(free).toBeGreaterThanOrEqual(known);
        expect(known).toBeGreaterThanOrEqual(singles);
      }
  });

  it('averages 17.2–18.0 points over the first 20 offline fast boards (plan: 17.6)', () => {
    const boards = bankPuzzles('fast', 20);
    const mean =
      boards.reduce((s, p) => s + bestMoves(parseGrid(p.givens), parseGrid(p.solution)).max, 0) /
      boards.length;
    expect(mean).toBeGreaterThanOrEqual(17.2);
    expect(mean).toBeLessThanOrEqual(18);
  });

  it('plays every move of the line on a cell knowable at that moment', () => {
    for (const gameType of ['fast', 'normal', 'hard'] as const)
      for (const p of bankPuzzles(gameType, 3)) {
        const board = parseGrid(p.givens);
        const sol = parseGrid(p.solution);
        const { max, line, nodes } = bestMoves(board, sol, { moves: 3, scoreY: 'distinct' });
        expect(nodes).toBeGreaterThan(0);
        let sum = 0;
        for (const m of line) {
          expect(knowableCells(board)).toContain(m.cell);
          expect(m.digit).toBe(sol[m.cell]);
          expect(m.points).toBe(moveScore(board, m.cell, m.digit, 'distinct').points);
          sum += m.points;
          board[m.cell] = m.digit;
        }
        expect(sum).toBe(max);
      }
  });

  it('refuses a board that is not its solution’s', () => {
    expect(() => bestMoves(CORNER, CORNER)).toThrow(RangeError);
    const wrong = CORNER.slice();
    wrong[parseCellName('A1')] = 6;
    expect(() => bestMoves(wrong, SOLUTION)).toThrow(RangeError);
    expect(() => bestMoves(CORNER, SOLUTION, { moves: -1 })).toThrow(RangeError);
  });
});
