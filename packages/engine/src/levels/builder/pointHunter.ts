import { defaultRules } from '../../game/rules';
import type { GameType } from '../../gameType';
import { bestMoves } from '../../sudoku/bestMoves';
import type { Grid } from '../../sudoku/board';
import type { Technique } from '../../sudoku/logic';
import type { ScoreY } from '../../sudoku/scoring';
import { createRng, type Rng } from '../../util/random';
import type { LevelPlanOf } from '../levels.config';
import type { LevelSpecOf } from '../spec';
import { pointStars, starRuleIsOrdered } from '../stars';
import { makeBoard } from './boards';
import { BuildError, specHead } from './common';
import type { Built } from './find';

/**
 * Idea-2, the point hunter (plan §3.1): as many points as 3 moves can make, by the game's own score (§6.4).
 * The board is a puzzle of its type, as in a game. Its best is the full search over the cells the chapter's
 * techniques know at each moment (sudoku/bestMoves; on a normal or hard board the best over any cell would
 * need a guess, dev-plan §1.4), and the star thresholds are shares of it (stars.ts): 70 / 85 / 95%, 98% for
 * ★★★ from chapter 27.
 */

/** The score's Y as the game counts it on a board of this type (Rules.scoreY). */
export const scoreYOf = (type: GameType): ScoreY => defaultRules('solo', type).scoreY;

/** The board's best line with these techniques, as the stored level keeps it. */
export const pointHunterBest = (
  grid: Grid,
  solution: Grid,
  moves: number,
  techniques: readonly Technique[],
  type: GameType,
) => bestMoves(grid, solution, { moves, techniques, scoreY: scoreYOf(type) });

export const POINT_HUNTER_ATTEMPTS = 40;

export function buildPointHunter(
  plan: LevelPlanOf<'pointHunter'>,
  rng: Rng = createRng(plan.seed),
): Built<LevelSpecOf<'pointHunter'>> {
  for (let attempt = 1; attempt <= POINT_HUNTER_ATTEMPTS; attempt++) {
    const board = makeBoard(rng, { type: plan.gameType, total: plan.givens, keepGrade: true });
    if (!board) continue;
    const best = pointHunterBest(board.givens, board.solution, plan.maxMoves, plan.techniques, plan.gameType);
    if (best.line.length < plan.maxMoves) continue;
    const stars = pointStars(best.max, plan.shares);
    if (!starRuleIsOrdered(stars)) continue;
    return {
      spec: {
        ...specHead(plan, board),
        targets: { maxMoves: plan.maxMoves, best: best.line },
        stars,
        ...(plan.worthHint ? { worthHint: true } : null),
        check: { techniques: [...plan.techniques], mustNeed: [] },
      },
      attempts: attempt,
    };
  }
  throw new BuildError(plan.id, `no point hunter board in ${POINT_HUNTER_ATTEMPTS} tries`);
}
