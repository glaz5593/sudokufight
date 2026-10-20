import { LEVEL_RULES } from '@sudoku-fight/engine';

import { LEVEL_MOTION, LEVEL_UI, PUZZLE_UI } from '../levels';

/**
 * Staged practice's 1.0.3 screen settings (levels-ui.md §8: D75–D78), each a ☐ default built as a setting
 * (CLAUDE.md). The screens that read them flip them in their own tests (RegionFrame, ReadyView, BossIntro,
 * HowToPlay, PuzzleBoard); this pins the defaults Moshe's "build without asking" of 2026-10-20 took.
 */

describe('LEVEL_UI, 1.0.3', () => {
  it('[D75b] the region’s spotlight on; [D75c] the coordinate rails off', () => {
    expect(LEVEL_UI.regionIntro).toBe(true);
    expect(LEVEL_UI.regionRails).toBe(false);
  });

  it('[D76] "מוכן?" shows where to look', () => {
    expect(LEVEL_UI.readyRegion).toBe(true);
  });

  it('[D77] the boss’s opening: 3 s, longer than "מוכן?"; the first boss’s cards merged', () => {
    expect(LEVEL_UI.bossReadyMs).toBe(3000);
    expect(LEVEL_UI.bossReadyMs).toBeGreaterThan(LEVEL_UI.readyMs);
    expect(LEVEL_UI.mergeFirstBossTutorial).toBe(true);
  });

  it('[D78a] tap a box, then another: for everyone', () => {
    expect(LEVEL_UI.puzzleTapSwap).toBe(true);
  });

  it('[D78b, D70c] the puzzle’s marking and its penalty are the engine’s, not set twice here', () => {
    expect(LEVEL_RULES.puzzleConflicts).toBe('none');
    expect(LEVEL_RULES.puzzleSwapPenaltyMs).toBe(5000);
    expect(Object.keys(LEVEL_UI)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/conflict|penalty/i)]),
    );
  });
});

describe('PUZZLE_UI and LEVEL_MOTION', () => {
  it('[D78] a 6 dp gap between the boxes, a drag after 6 dp, the held box at 1.06', () => {
    expect(PUZZLE_UI.slotGap).toBe(6);
    expect(PUZZLE_UI.dragMinDistance).toBe(6);
    expect(PUZZLE_UI.liftScale).toBe(1.06);
  });

  it('the puzzle’s motion (levels-ui.md §4.3): 200 / 240 ms swaps, 200 ms home, 550 ms solved', () => {
    expect(PUZZLE_UI).toMatchObject({
      swapMs: 200,
      swapOtherMs: 240,
      homeMs: 200,
      solvedFlashMs: 550,
      solvedReducedMs: 300,
      deniedReducedMs: 300,
    });
  });

  it('the spotlight is under a second, and never more than the board’s first moments (levels-ui.md §2.3)', () => {
    expect(LEVEL_MOTION.regionLandMs + LEVEL_MOTION.regionBandMs).toBeLessThan(1000);
    expect(LEVEL_MOTION).toMatchObject({ regionLandScale: 1.06, regionBandWidth: 6 });
  });

  it('the boss’s opening fits its 3 s, the chips one after another (levels-ui.md §3.2)', () => {
    expect(LEVEL_MOTION).toMatchObject({
      bossCrownFrom: 1.4,
      bossCrownMs: 530,
      bossChipMs: 240,
      bossChipStaggerMs: 120,
      bossWonPopMs: 420,
    });
    // Two chips at most (bossTraits never gives more): the last is in long before the opening ends.
    const lastChipIn = LEVEL_MOTION.bossCrownMs + LEVEL_MOTION.bossChipStaggerMs + LEVEL_MOTION.bossChipMs;
    expect(lastChipIn).toBeLessThan(LEVEL_UI.bossReadyMs / 2);
  });
});
