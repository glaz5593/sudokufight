import { DEFAULT_PROGRESS_RULES, levelXpFor, type Stars } from '@sudoku-fight/engine';

import { levelXpEstimate } from '../levelXp';

/** The XP a level's result shows (plan §5.1) [D55]: the engine's levelXpFor, for display only. */

describe('levelXpEstimate', () => {
  it('10 for each new star, 50 for a gate it opened: ★ → ★★★ is 20, and a gate adds 50', () => {
    expect(levelXpEstimate({ prevBest: 1, best: 3, gateOpened: false })).toBe(20);
    expect(levelXpEstimate({ prevBest: 1, best: 3, gateOpened: true })).toBe(70);
    expect(levelXpEstimate({ prevBest: 0, best: 0, gateOpened: true })).toBe(50);
  });

  it('a replay with no new star shows none', () => {
    expect(levelXpEstimate({ prevBest: 3, best: 3, gateOpened: false })).toBe(0);
  });

  it('is the engine’s levelXpFor for every case, with its rules', () => {
    const stars: Stars[] = [0, 1, 2, 3];
    for (const prevBest of stars)
      for (const best of stars.filter((s) => s >= prevBest))
        for (const gateOpened of [false, true])
          expect(levelXpEstimate({ prevBest, best, gateOpened })).toBe(
            levelXpFor(prevBest, best, gateOpened),
          );
    const rules = {
      ...DEFAULT_PROGRESS_RULES,
      xp: { ...DEFAULT_PROGRESS_RULES.xp, levelStar: 7, levelGate: 1 },
    };
    expect(levelXpEstimate({ prevBest: 0, best: 2, gateOpened: true }, rules)).toBe(15);
  });
});
