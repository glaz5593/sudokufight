import { boxOf, parseGrid } from '../../sudoku/board';
import { requiresTechniques } from '../../sudoku/targets';
import { createRng } from '../../util/random';
import { levelPlan, type LevelPlanOf, levelsOfKind } from '../levels.config';
import { boxEmpties } from './common';
import { buildFind } from './find';
import { validateLevel } from './validate';

/* find (plan §2.1): one target, as the chapter asks for it. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'find'>;
/** The first level of a kind in a chapter (bosses only with `boss`): by kind, never a fixed id (a rebuild moves them). */
const nOf = (kind: Parameters<typeof levelsOfKind>[0], chapter: number, boss = false): number =>
  levelsOfKind(kind, { chapter, boss })[0]!;
/** Chapter 17's find: the whole board, needing pointing or claiming (not its easy slots). */
const CH17 = levelsOfKind('find', { chapter: 17 }).find((n) => n % 10 > 3)!;

describe('buildFind', () => {
  it.each([
    [1, 'box'],
    [nOf('find', 6), 'row|col'],
    [CH17, 'board'],
  ])('L%i: deterministic per seed, a %s target, and valid', (n, scope) => {
    const p = plan(n);
    const a = buildFind(p).spec;
    expect(buildFind(p).spec).toEqual(a);
    expect(scope.split('|')).toContain(a.targets.target.scope.kind);
    expect(validateLevel(a)).toEqual([]);
  });

  it('chapter 1: a box target with 3 empty cells in its box, on a fast board of 50 givens', () => {
    const spec = buildFind(plan(1)).spec;
    const grid = parseGrid(spec.board.grid);
    const t = spec.targets.target;
    expect([spec.gameType, grid.filter((v) => v !== 0).length]).toEqual(['fast', 50]);
    expect(boxEmpties(grid, boxOf(t.cell!))).toBe(3);
    expect(t.accept).toEqual([t.cell]);
  });

  it('chapter 17: the target needs pointing or claiming (not known with singles alone)', () => {
    const spec = buildFind(plan(CH17)).spec;
    const grid = parseGrid(spec.board.grid);
    expect(spec.check).toEqual({
      techniques: ['nakedSingle', 'hiddenSingle', 'pointing', 'claiming'],
      mustNeed: ['pointing', 'claiming'],
    });
    expect(requiresTechniques(grid, spec.targets.target, spec.check!.techniques, spec.check!.mustNeed)).toBe(
      true,
    );
    expect(['pointing', 'claiming']).toContain(spec.targets.target.tier);
  });

  it('another seed, another board', () => {
    const p = plan(1);
    expect(buildFind({ ...p, seed: p.seed + 1 }).spec.board).not.toEqual(buildFind(p).spec.board);
    expect(buildFind(p, createRng(5)).spec.board).not.toEqual(buildFind(p).spec.board);
  });
});
