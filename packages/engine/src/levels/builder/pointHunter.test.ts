import { bestMoves } from '../../sudoku/bestMoves';
import { parseGrid } from '../../sudoku/board';
import { levelPlan, type LevelPlanOf, levelsOfKind } from '../levels.config';
import { pointStars } from '../stars';
import { buildPointHunter } from './pointHunter';
import { validateLevel } from './validate';

/* The point hunter (plan §3.1): the board's best 3 moves over the cells the chapter knows, and its thresholds. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'pointHunter'>;
/** The first level of a kind in a chapter (bosses only with `boss`): by kind, never a fixed id (a rebuild moves them). */
const nOf = (kind: Parameters<typeof levelsOfKind>[0], chapter: number, boss = false): number =>
  levelsOfKind(kind, { chapter, boss })[0]!;
/** The point hunters in order; chapter 27's has the 98% ★★★. */
const HUNTERS = levelsOfKind('pointHunter');
const CH27 = nOf('pointHunter', 27);

describe('buildPointHunter', () => {
  it.each([HUNTERS[0]!, nOf('pointHunter', 12), nOf('pointHunter', 21), CH27])(
    'L%i: deterministic per seed, and valid',
    (n) => {
      const p = plan(n);
      const spec = buildPointHunter(p).spec;
      expect(buildPointHunter(p).spec).toEqual(spec);
      expect(validateLevel(spec)).toEqual([]);
    },
  );

  it('the stored best is a full search, and the thresholds are its shares (98% for ★★★ from chapter 27)', () => {
    for (const n of [HUNTERS[0]!, CH27]) {
      const p = plan(n);
      const spec = buildPointHunter(p).spec;
      const grid = parseGrid(spec.board.grid);
      const solution = parseGrid(spec.board.solution);
      const fresh = bestMoves(grid, solution, { moves: 3, techniques: p.techniques });
      expect(spec.stars).toEqual(pointStars(fresh.max, p.shares));
      expect(spec.targets).toEqual({ maxMoves: 3, best: fresh.line });
    }
    expect(plan(CH27).shares.three).toBe(0.98);
  });

  it('the first two point hunters show what a locked cell is worth; the third does not', () => {
    expect(buildPointHunter(plan(HUNTERS[0]!)).spec.worthHint).toBe(true);
    expect(buildPointHunter(plan(HUNTERS[1]!)).spec.worthHint).toBe(true);
    expect(buildPointHunter(plan(HUNTERS[2]!)).spec.worthHint).toBeUndefined();
  });
});
