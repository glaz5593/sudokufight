import { filledCount, parseGrid } from '../../sudoku/board';
import { gradePuzzle } from '../../sudoku/grade';
import { hasUniqueSolution } from '../../sudoku/solver';
import { levelPlan, type LevelPlanOf, levelsOfKind } from '../levels.config';
import { buildDuel, gradeTechniques } from './duel';
import { validateLevel } from './validate';

/* The duel (plan §2.4): a puzzle of its type, against the chapter's bot at the chapter's pace. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'duel'>;
/** The first level of a kind in a chapter (bosses only with `boss`): by kind, never a fixed id (a rebuild moves them). */
const nOf = (kind: Parameters<typeof levelsOfKind>[0], chapter: number, boss = false): number =>
  levelsOfKind(kind, { chapter, boss })[0]!;
/** The first duel (chapter 3), and chapter 29's boss: Overlord. */
const FIRST = nOf('duel', 3);
const OVERLORD = nOf('duel', 29, true);

describe('buildDuel', () => {
  it.each([
    [FIRST, 'fast'],
    [nOf('duel', 8), 'normal'],
    [nOf('duel', 17), 'hard'],
    [OVERLORD, 'hard'],
  ] as const)('L%i: deterministic, a %s puzzle with one solution and the plan givens, valid', (n, type) => {
    const p = plan(n);
    const spec = buildDuel(p).spec;
    expect(buildDuel(p).spec).toEqual(spec);
    const grid = parseGrid(spec.board.grid);
    expect([spec.gameType, gradePuzzle(grid).gameType, filledCount(grid)]).toEqual([type, type, p.givens]);
    expect(hasUniqueSolution(grid)).toBe(true);
    expect(validateLevel(spec)).toEqual([]);
  });

  it('first to 30, the bot of the plan (a boss its chapter bot ×0.9; Overlord in L290)', () => {
    expect(OVERLORD).toBe(290);
    expect(buildDuel(plan(FIRST)).spec).toMatchObject({
      targets: { endAtScore: 30 },
      bot: { level: 1, pace: 1 },
    });
    expect(buildDuel(plan(OVERLORD)).spec.bot).toEqual({ level: 5, pace: 0.765 });
  });

  it("its check is its grade's techniques", () => {
    expect(gradeTechniques('fast')).toEqual(['nakedSingle']);
    expect(buildDuel(plan(nOf('duel', 8))).spec.check).toEqual({
      techniques: ['nakedSingle', 'hiddenSingle'],
      mustNeed: [],
    });
  });
});
