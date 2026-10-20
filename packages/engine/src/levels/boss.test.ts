import { buildFillRegion } from './builder/fillRegion';
import { bossFasterPct, type BossTrait, bossTraits } from './boss';
import { FIRST_BOSS, levelPlan, type LevelPlanOf, levelsOfKind } from './levels.config';
import { maxLevel } from './progress';
import type { AppLevel } from './spec';

/*
 * bossTraits (levels-content.md §6) [D72]: the one contract the boss screens build on. Read off the plans of
 * the chapter table (a level's head, its kind and bot), as the built levels carry them.
 */

/** A level as the app holds it, made from its plan: enough for bossTraits (no board needed). */
function levelOf(n: number): AppLevel {
  const p = levelPlan(n);
  return {
    id: p.id,
    rev: p.rev,
    chapter: p.chapter,
    slot: p.slot,
    kind: p.kind,
    boss: p.boss,
    seed: p.seed,
    gameType: p.gameType,
    board: { grid: '0'.repeat(81), solution: '0'.repeat(81) },
    timeLimitMs: p.timeLimitMs,
    stars: 'stars' in p ? p.stars : { by: 'points', max: 0, three: 0, two: 0, one: 0 },
    ...('bot' in p ? { bot: { level: p.bot.level, pace: p.bot.pace } } : null),
  } as AppLevel;
}

const ALL = Array.from({ length: maxLevel() }, (_, k) => k + 1);

describe('bossTraits', () => {
  it('chapter 1: the first bot you meet, Pip', () => {
    expect(FIRST_BOSS.kind).toBe('findDuel');
    expect(bossTraits(levelOf(10))).toEqual<BossTrait[]>([{ key: 'firstBot', bot: 'Pip' }]);
  });

  it('chapter 2: Pip, 10% faster (from BOSS.pace)', () => {
    expect(bossFasterPct()).toBe(10);
    expect(bossTraits(levelOf(20))).toEqual<BossTrait[]>([{ key: 'faster', bot: 'Pip', pct: 10 }]);
  });

  it('the chapter bot by name: Biscuit in chapter 5, Mr. Hoot in 10, Maestro in 18', () => {
    expect(bossTraits(levelOf(50))).toEqual([{ key: 'faster', bot: 'Biscuit', pct: 10 }]);
    expect(bossTraits(levelOf(100))).toEqual([{ key: 'faster', bot: 'Mr. Hoot', pct: 10 }]);
    expect(bossTraits(levelOf(180))).toEqual([{ key: 'faster', bot: 'Maestro', pct: 10 }]);
  });

  it('L280, L290 and L300: Overlord', () => {
    for (const n of [280, 290, 300]) expect(bossTraits(levelOf(n))).toEqual([{ key: 'overlord' }]);
    expect(bossTraits(levelOf(270))).toEqual([{ key: 'faster', bot: 'Maestro', pct: 10 }]);
  });

  it('not a boss: none; a boss: one or two, never more', () => {
    for (const n of ALL) {
      const traits = bossTraits(levelOf(n));
      if (n % 10 !== 0) expect([n, traits]).toEqual([n, []]);
      else expect([n, traits.length >= 1 && traits.length <= 2]).toEqual([n, true]);
    }
  });

  it('moreCells only for a boss with no bot (D72 ב): a chapter-1 box missing more than the chapter’s', () => {
    expect(ALL.flatMap((n) => bossTraits(levelOf(n))).some((t) => t.key === 'moreCells')).toBe(false);
    // D72 ב, as its build would make it: chapter 1's boss a fillBox of a hard slot's row (chapter 2's: 3
    // missing), and no bot. Chapter 1's own fill levels miss 2.
    const hard = levelPlan(levelsOfKind('fillRow', { chapter: 1 }).at(-1)!) as LevelPlanOf<'fillRow'>;
    expect([hard.tier, hard.missing]).toEqual(['hard', 3]);
    const boss = buildFillRegion({ ...hard, kind: 'fillBox', id: 'L010', slot: 10, boss: true }).spec;
    expect(boss.bot).toBeUndefined();
    expect(bossTraits(boss)).toEqual([{ key: 'moreCells', from: 2, to: 3 }]);
    // The same box as a regular level: nothing.
    expect(bossTraits({ ...boss, boss: false })).toEqual([]);
  });
});
