import { bestMoves } from '../../sudoku/bestMoves';
import { parseGrid } from '../../sudoku/board';
import { levelPlan, type LevelPlanOf } from '../levels.config';
import { pointStars } from '../stars';
import { buildPointHunter } from './pointHunter';
import { validateLevel } from './validate';

/* The point hunter (plan §3.1): the board's best 3 moves over the cells the chapter knows, and its thresholds. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'pointHunter'>;

describe('buildPointHunter', () => {
  it.each([66, 116, 206, 266])('L%i: deterministic per seed, and valid', (n) => {
    const p = plan(n);
    const spec = buildPointHunter(p).spec;
    expect(buildPointHunter(p).spec).toEqual(spec);
    expect(validateLevel(spec)).toEqual([]);
  });

  it('the stored best is a full search, and the thresholds are its shares (98% for ★★★ from chapter 27)', () => {
    for (const n of [66, 266]) {
      const p = plan(n);
      const spec = buildPointHunter(p).spec;
      const grid = parseGrid(spec.board.grid);
      const solution = parseGrid(spec.board.solution);
      const fresh = bestMoves(grid, solution, { moves: 3, techniques: p.techniques });
      expect(spec.stars).toEqual(pointStars(fresh.max, p.shares));
      expect(spec.targets).toEqual({ maxMoves: 3, best: fresh.line });
    }
    expect(plan(266).shares.three).toBe(0.98);
  });

  it('the first two point hunters show what a locked cell is worth; the third does not', () => {
    expect(buildPointHunter(plan(66)).spec.worthHint).toBe(true);
    expect(buildPointHunter(plan(68)).spec.worthHint).toBe(true);
    expect(buildPointHunter(plan(116)).spec.worthHint).toBeUndefined();
  });
});
