import { findMsRange } from '../../bot/finder';
import { BOT_CONFIG } from '../../bot/levels';
import { parseGrid } from '../../sudoku/board';
import { requiresTechniques } from '../../sudoku/targets';
import { levelPlan, type LevelPlanOf } from '../levels.config';
import { buildFindDuel, staysTarget, subsetsOf, withSpots } from './findDuel';
import { validateLevel } from './validate';

/* The race (plan §2.2): five spots that stay targets whoever took, or left, the ones before. */

const plan = (n: number) => levelPlan(n) as LevelPlanOf<'findDuel'>;

describe('buildFindDuel', () => {
  it.each([12, 52, 168])('L%i: deterministic per seed, and valid', (n) => {
    const p = plan(n);
    const a = buildFindDuel(p).spec;
    expect(buildFindDuel(p).spec).toEqual(a);
    expect(validateLevel(a)).toEqual([]);
  });

  it('five spots on five cells; each a target with every subset of the earlier ones filled', () => {
    const spec = buildFindDuel(plan(52)).spec;
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
    const spec = buildFindDuel(plan(168)).spec;
    const bot = spec.bot!;
    expect(bot.findMs).toEqual(spec.targets.spots.map((s) => findMsRange(bot.level, s.tier, bot.pace)));
    expect([bot.missShare, bot.reactShare]).toEqual([
      BOT_CONFIG.find.missShare[bot.level],
      BOT_CONFIG.find.reactShare[bot.level],
    ]);
  });

  it('from chapter 17 every spot of a base or hard slot needs an elimination', () => {
    const spec = buildFindDuel(plan(168)).spec;
    expect(spec.targets.spots.every((s) => s.tier !== 'single')).toBe(true);
  });

  it('subsetsOf lists every subset once', () => {
    expect(subsetsOf(2)).toEqual([[], [0], [1], [0, 1]]);
    expect(subsetsOf(4)).toHaveLength(16);
  });
});
