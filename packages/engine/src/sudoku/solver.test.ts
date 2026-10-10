import { gridToString, parseGrid } from './board';
import { countSolutions, hasUniqueSolution, solve } from './solver';
import { bankRows, gridFrom } from '../testing/fixtures';

describe('solver', () => {
  it('solves every puzzle of the bank to its stored solution, and each has exactly one solution', () => {
    const rows = bankRows();
    expect(rows).toHaveLength(690);
    for (const { puzzle, solution } of rows) {
      const grid = parseGrid(puzzle);
      expect(gridToString(solve(grid)!)).toBe(solution);
      expect(hasUniqueSolution(grid)).toBe(true);
    }
  });

  it('counts several solutions up to the limit', () => {
    const empty = new Array<number>(81).fill(0);
    expect(countSolutions(empty, 2)).toBe(2);
    expect(countSolutions(empty, 5)).toBe(5);
    expect(hasUniqueSolution(empty)).toBe(false);
    expect(solve(empty)).not.toBeNull();
  });

  it('finds no solution for a clashing grid or a dead end', () => {
    expect(countSolutions(gridFrom({ A1: 5, A2: 5 }))).toBe(0);
    // A9 has no candidate: row A holds 1–8 and column 9 holds 9.
    const deadEnd = gridFrom({ A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6, A7: 7, A8: 8, E9: 9 });
    expect(countSolutions(deadEnd)).toBe(0);
    expect(solve(deadEnd)).toBeNull();
    expect(countSolutions([1, 2, 3])).toBe(0);
  });

  it('reports each solution it finds', () => {
    const seen: string[] = [];
    countSolutions(new Array<number>(81).fill(0), 3, (s) => seen.push(gridToString(s)));
    expect(new Set(seen).size).toBe(3);
  });
});
