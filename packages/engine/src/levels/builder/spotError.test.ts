import { parseGrid, PEERS } from '../../sudoku/board';
import { knowablePlacements } from '../../sudoku/reading';
import { hasUniqueSolution } from '../../sudoku/solver';
import { levelPlan, type LevelPlanOf } from '../levels.config';
import { buildSpotError, cleanedBoard } from './spotError';
import { validateLevel } from './validate';

/* Spot the error (plan §3.1): visible errors clash with a given, silent ones only with the logic. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'spotError'>;

describe('buildSpotError', () => {
  it.each([34, 77, 126, 186])('L%i: deterministic per seed, and valid', (n) => {
    const p = plan(n);
    const spec = buildSpotError(p).spec;
    expect(buildSpotError(p).spec).toEqual(spec);
    expect(validateLevel(spec)).toEqual([]);
  });

  it.each([
    [34, 1, 0],
    [77, 2, 0],
    [126, 0, 2],
    [186, 1, 2],
  ])(
    'L%i: %i visible and %i silent errors among 14 of "my" digits; the givens alone have one solution',
    (n, visible, silent) => {
      const spec = buildSpotError(plan(n)).spec;
      const grid = parseGrid(spec.board.grid);
      const mine = parseGrid(spec.board.mine!);
      const solution = parseGrid(spec.board.solution);
      const errors = spec.targets.errors;
      expect([errors.filter((e) => e.visible).length, errors.filter((e) => !e.visible).length]).toEqual([
        visible,
        silent,
      ]);
      expect(mine.filter((v) => v !== 0)).toHaveLength(14);
      expect(hasUniqueSolution(grid)).toBe(true);
      const shown = grid.map((v, i) => v || mine[i]!);
      const cleaned = cleanedBoard(grid, mine, solution);
      const known = knowablePlacements(cleaned, spec.check!.techniques);
      for (const e of errors) {
        expect(e.digit).not.toBe(solution[e.cell]);
        if (e.visible) expect(PEERS[e.cell]!.some((p) => grid[p] === e.digit)).toBe(true);
        else expect(PEERS[e.cell]!.some((p) => shown[p] === e.digit)).toBe(false);
        expect(known.some((k) => k.cell === e.cell && k.digit === solution[e.cell])).toBe(true);
      }
    },
  );
});
