import { findMsRange } from '../../bot/finder';
import { BOT_CONFIG } from '../../bot/levels';
import { parseGrid } from '../../sudoku/board';
import { requiresTechniques } from '../../sudoku/targets';
import { levelPlan, type LevelPlanOf, levelsOfKind } from '../levels.config';
import { buildFindDuel, staysTarget, subsetsOf, withSpots } from './findDuel';
import { validateLevel } from './validate';

/* The race (plan §2.2): five spots that stay targets whoever took, or left, the ones before. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'findDuel'>;
/** The first level of a kind in a chapter (bosses only with `boss`): by kind, never a fixed id (a rebuild moves them). */
const nOf = (kind: Parameters<typeof levelsOfKind>[0], chapter: number, boss = false): number =>
  levelsOfKind(kind, { chapter, boss })[0]!;
/** A race from chapter 17 in a base or hard slot (its spots need an elimination): chapter 18's. */
const LATE = levelsOfKind('findDuel', { chapter: 18, boss: false }).find((n) => n % 10 > 3)!;

describe('buildFindDuel', () => {
  it.each([nOf('findDuel', 2), nOf('findDuel', 6), LATE])('L%i: deterministic per seed, and valid', (n) => {
    const p = plan(n);
    const a = buildFindDuel(p).spec;
    expect(buildFindDuel(p).spec).toEqual(a);
    expect(validateLevel(a)).toEqual([]);
  });

  it('five spots on five cells; each a target with every subset of the earlier ones filled', () => {
    const spec = buildFindDuel(plan(nOf('findDuel', 6))).spec;
    const grid = parseGrid(spec.board.grid);
    const spots = spec.targets.spots;
    const logic = { techniques: spec.check!.techniques, mustNeed: spec.check!.mustNeed };
    expect(new Set(spots.map((s) => s.cell)).size).toBe(5);
    spots.forEach((spot, k) => {
      expect(staysTarget(grid, spots, k, logic)).toBe(true);
      for (const taken of subsetsOf(k))
        expect(requiresTechniques(withSpots(grid, spots, taken), spot, logic.techniques, [])).toBe(true);
    });
  });

  it("the bot's search per spot is frozen: findMsRange of its tier, at the level's pace, and its shares", () => {
    const spec = buildFindDuel(plan(LATE)).spec;
    const bot = spec.bot!;
    expect(bot.findMs).toEqual(spec.targets.spots.map((s) => findMsRange(bot.level, s.tier, bot.pace)));
    expect([bot.missShare, bot.reactShare]).toEqual([
      BOT_CONFIG.find.missShare[bot.level],
      BOT_CONFIG.find.reactShare[bot.level],
    ]);
  });

  it('from chapter 17 every spot of a base or hard slot needs an elimination', () => {
    const spec = buildFindDuel(plan(LATE)).spec;
    expect(spec.targets.spots.every((s) => s.tier !== 'single')).toBe(true);
  });

  it('subsetsOf lists every subset once', () => {
    expect(subsetsOf(2)).toEqual([[], [0], [1], [0, 1]]);
    expect(subsetsOf(4)).toHaveLength(16);
  });
});
