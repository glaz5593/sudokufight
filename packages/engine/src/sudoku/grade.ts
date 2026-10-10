import type { GameType } from '../gameType';
import type { Grid } from './board';
import { logicalSolve, type Technique, TECHNIQUES } from './logic';

/**
 * Difficulty grading (spec §5.2, §20): which techniques a puzzle needs.
 *
 *   fast    solvable with naked singles alone
 *   normal  needs hidden singles
 *   hard    needs locked candidates (box-line) or pairs
 *   beyond  our techniques get stuck: it still has a unique solution, but needs something stronger.
 *           It goes into no game type (work plan, stage 1).
 *
 * The techniques are monotone (applying one never hides another), so "solvable with set S" does not depend
 * on the order the steps are taken in.
 */

export type Difficulty = GameType | 'beyond';

export interface GradingRules {
  /** The techniques each level may use, from the easiest level up. */
  levels: readonly { level: GameType; techniques: readonly Technique[] }[];
  /** The game type a puzzle beyond every level is filed under; null (the default) leaves it out. */
  beyondAs: GameType | null;
}

export const DEFAULT_GRADING: GradingRules = {
  levels: [
    { level: 'fast', techniques: ['nakedSingle'] },
    { level: 'normal', techniques: ['nakedSingle', 'hiddenSingle'] },
    { level: 'hard', techniques: TECHNIQUES },
  ],
  beyondAs: null,
};

export interface Grade {
  difficulty: Difficulty;
  /** The game type the puzzle belongs to, or null when the rules leave it out. */
  gameType: GameType | null;
  /** The techniques a full solve uses (all techniques allowed, simplest first), in order of difficulty. */
  techniques: Technique[];
  /** Steps of that full solve. */
  steps: number;
}

export function gradePuzzle(grid: Grid, rules: GradingRules = DEFAULT_GRADING): Grade {
  const full = logicalSolve(grid);
  let difficulty: Difficulty = 'beyond';
  for (const { level, techniques } of rules.levels) {
    if (logicalSolve(grid, techniques).solved) {
      difficulty = level;
      break;
    }
  }
  return {
    difficulty,
    gameType: difficulty === 'beyond' ? rules.beyondAs : difficulty,
    techniques: full.techniques,
    steps: full.steps.length,
  };
}
