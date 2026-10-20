/* Test-only puzzle level fixtures (1.0.3, levels-content.md §5): the boxes of bank puzzle #1's solution. */
import type { LevelSpecOf } from '../levels/spec';
import { seedFromString } from '../util/random';
import { PUZZLE } from './game';

/*
 * Bank puzzle #1's solution (testing/game.ts) cut into its nine boxes. On this board only band-mates fit side
 * by side, so any two fixed boxes in different bands and stacks leave one valid arrangement, and every such
 * puzzle solves step by step (counted in levels/builder/puzzle.test.ts). They are not built levels:
 * levels:validate checks the builder's; these only play the rules of the puzzle engine.
 */

const board = { grid: PUZZLE.solution, solution: PUZZLE.solution };

/**
 * A chapter-1 puzzle: 3 moving boxes, one cycle (place 1 holds the box of 3, place 3 the box of 5, place 5 the
 * box of 1), the other six fixed; ★★★ 26 s, ★★ 36, ★ 45 = the limit (levels-content.md §5.3).
 */
export const PUZZLE_LEVEL: LevelSpecOf<'puzzle'> = {
  id: 'L003',
  rev: 2,
  chapter: 1,
  slot: 3,
  kind: 'puzzle',
  boss: false,
  seed: seedFromString('L003:r2'),
  gameType: 'fast',
  board,
  timeLimitMs: 45000,
  targets: { start: [0, 3, 2, 5, 4, 1, 6, 7, 8], fixed: [0, 2, 4, 6, 7, 8], lockOnCorrect: false },
  stars: { by: 'timeMs', three: 26000, two: 36000, one: 45000 },
  check: { techniques: [], mustNeed: [] },
};

/**
 * A late puzzle: the diagonal fixed (different bands and stacks), the other six one cycle: place 1 holds the
 * box of 2, 2 of 3, 3 of 5, 5 of 6, 6 of 7, 7 of 1. ★★★ 45 s, ★★ 55, ★ 60.
 */
export const PUZZLE_SIX_LEVEL: LevelSpecOf<'puzzle'> = {
  ...PUZZLE_LEVEL,
  id: 'L207',
  chapter: 21,
  slot: 7,
  seed: seedFromString('L207:r2'),
  timeLimitMs: 60000,
  targets: { start: [0, 2, 3, 5, 4, 6, 7, 1, 8], fixed: [0, 4, 8], lockOnCorrect: false },
  stars: { by: 'timeMs', three: 45000, two: 55000, one: 60000 },
};

/** The same with lockOnCorrect on (the alternative of D71). */
export const lockedPuzzle = (level: LevelSpecOf<'puzzle'>): LevelSpecOf<'puzzle'> => ({
  ...level,
  targets: { ...level.targets, lockOnCorrect: true },
});

/**
 * No fixed box (never built: the builder needs two): the top two bands of boxes swapped, and then the boxes at
 * places 0 and 1. Swapping places 0 and 1 back leaves a valid sudoku that is not the stored arrangement [D70b].
 */
export const PUZZLE_UNFIXED_LEVEL: LevelSpecOf<'puzzle'> = {
  ...PUZZLE_LEVEL,
  id: 'L013',
  targets: { start: [4, 3, 5, 0, 1, 2, 6, 7, 8], fixed: [], lockOnCorrect: false },
};
