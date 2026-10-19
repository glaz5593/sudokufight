import { BOXES, boxOf, parseGrid } from '../../sudoku/board';
import { levelPlan, type LevelPlanOf } from '../levels.config';
import { boxCloses, buildFillBox } from './fillBox';
import { validateLevel } from './validate';

/* fillBox (plan §2.3): a box the chapter's techniques fill alone, and only with what the band needs. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'fillBox'>;

describe('buildFillBox', () => {
  it.each([2, 10, 53, 161, 207])('L%i: deterministic per seed, and valid', (n) => {
    const p = plan(n);
    const a = buildFillBox(p).spec;
    expect(buildFillBox(p).spec).toEqual(a);
    expect(validateLevel(a)).toEqual([]);
  });

  it("the editable cells are the box's empties: the chapter's missing, and the givens around it its number", () => {
    const p = plan(53);
    const spec = buildFillBox(p).spec;
    const grid = parseGrid(spec.board.grid);
    const { box, cells } = spec.targets;
    expect(cells).toEqual(BOXES[box]!.cells.filter((c) => grid[c] === 0));
    expect(cells).toHaveLength(p.missing);
    expect(grid.filter((v, i) => v !== 0 && boxOf(i) !== box).length).toBe(p.around);
  });

  it('chapter 6 needs a hidden single: naked singles alone do not fill the box', () => {
    const spec = buildFillBox(plan(53)).spec;
    const grid = parseGrid(spec.board.grid);
    expect(boxCloses(grid, spec.targets.cells, ['nakedSingle', 'hiddenSingle'])).toBe(true);
    expect(boxCloses(grid, spec.targets.cells, ['nakedSingle'])).toBe(false);
  });

  it('chapter 17 needs pointing or claiming', () => {
    const spec = buildFillBox(plan(161)).spec;
    const grid = parseGrid(spec.board.grid);
    expect(boxCloses(grid, spec.targets.cells, ['nakedSingle', 'hiddenSingle', 'pointing', 'claiming'])).toBe(
      true,
    );
    expect(boxCloses(grid, spec.targets.cells, ['nakedSingle', 'hiddenSingle'])).toBe(false);
  });

  it('the box goes round: the seed picks it', () => {
    const boxes = new Set(
      [2, 4, 6, 8, 13, 16, 19, 24, 28, 33, 36].map((n) => buildFillBox(plan(n)).spec.targets.box),
    );
    expect(boxes.size).toBeGreaterThan(3);
  });
});
