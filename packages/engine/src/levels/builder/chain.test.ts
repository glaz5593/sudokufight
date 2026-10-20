import { filledCount, parseGrid } from '../../sudoku/board';
import { knowableCells } from '../../sudoku/reading';
import { levelPlan, type LevelPlanOf, levelsOfKind } from '../levels.config';
import { buildChain, walkChain } from './chain';
import { validateLevel } from './validate';

/* The chain (plan Idea-3, dev-plan §1.4): one knowable cell at a time, with every technique the solver has. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'chain'>;
const LONG = 60_000;
/** The first level of a kind in a chapter (bosses only with `boss`): by kind, never a fixed id (a rebuild moves them). */
const nOf = (kind: Parameters<typeof levelsOfKind>[0], chapter: number, boss = false): number =>
  levelsOfKind(kind, { chapter, boss })[0]!;
/** Chapter 9's chain (3 steps) and chapter 14's (4 steps, a normal board). */
const SHORT = nOf('chain', 9);
const LONG_CHAIN = nOf('chain', 14);

describe('buildChain', () => {
  const short = buildChain(plan(SHORT)).spec;
  const long = buildChain(plan(LONG_CHAIN)).spec;

  it(
    'is deterministic per seed',
    () => {
      expect(buildChain(plan(SHORT)).spec).toEqual(short);
    },
    LONG,
  );

  it('chapter 9’s and chapter 14’s chains are valid', () => {
    expect([...validateLevel(short), ...validateLevel(long)]).toEqual([]);
  });

  it('chapter 14: 4 steps on a normal board of the plan givens; at each, the solver knows exactly the next cell', () => {
    const board = parseGrid(long.board.grid);
    const solution = parseGrid(long.board.solution);
    expect([long.gameType, filledCount(board), long.targets.cells.length]).toEqual([
      'normal',
      plan(LONG_CHAIN).givens,
      4,
    ]);
    for (const cell of long.targets.cells) {
      expect(knowableCells(board)).toEqual([cell]);
      board[cell] = solution[cell]!;
    }
  });

  it('walkChain: 0 for a chain that holds; more for a board with several knowable cells', () => {
    const grid = parseGrid(short.board.grid);
    const solution = parseGrid(short.board.solution);
    const logic = plan(SHORT).logic;
    expect(walkChain(grid, solution, 3, logic)).toEqual({ cost: 0, cells: [...short.targets.cells] });
    expect(
      walkChain(
        solution.map((v, i) => (i < 40 ? v : 0)),
        solution,
        3,
        logic,
      ).cost,
    ).toBeGreaterThan(0);
  });
});
