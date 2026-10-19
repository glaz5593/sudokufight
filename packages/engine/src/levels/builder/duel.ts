import type { GameType } from '../../gameType';
import { DEFAULT_GRADING } from '../../sudoku/grade';
import type { Technique } from '../../sudoku/logic';
import { createRng, type Rng } from '../../util/random';
import type { LevelPlanOf } from '../levels.config';
import type { LevelSpecOf } from '../spec';
import { makeBoard } from './boards';
import { BuildError, specHead } from './common';
import type { Built } from './find';

/**
 * The duel, "דו־קרב ל־30" (plan §2.4): the game against the chapter's bot on a board of its type (the lock time
 * comes with the type, spec §5.2) [D43], first to 30 in 30 s. A full game is played on it, so the board is a
 * puzzle of its type, with one solution: every given added keeps its grade (its check: the grade's techniques). The bot plays the live BOT_CONFIG
 * (levelBotConfig of the level's pace); the file's botConfigFingerprint makes a change of it a rebuild.
 */

export const DUEL_ATTEMPTS = 40;

/** The techniques a board of `type` is solved with (its grade, sudoku/grade): what a full game asks. */
export function gradeTechniques(type: GameType): Technique[] {
  const level = DEFAULT_GRADING.levels.find((l) => l.level === type);
  if (!level) throw new RangeError(`No grade for ${type}`);
  return [...level.techniques];
}

export function buildDuel(
  plan: LevelPlanOf<'duel'>,
  rng: Rng = createRng(plan.seed),
): Built<LevelSpecOf<'duel'>> {
  for (let attempt = 1; attempt <= DUEL_ATTEMPTS; attempt++) {
    const board = makeBoard(rng, { type: plan.gameType, total: plan.givens, keepGrade: true });
    if (!board) continue;
    return {
      spec: {
        ...specHead(plan, board),
        targets: { endAtScore: plan.endAtScore },
        stars: plan.stars,
        bot: { level: plan.bot.level, pace: plan.bot.pace },
        check: { techniques: gradeTechniques(plan.gameType), mustNeed: [] },
      },
      attempts: attempt,
    };
  }
  throw new BuildError(
    plan.id,
    `no ${plan.gameType} board of ${plan.givens} givens in ${DUEL_ATTEMPTS} tries`,
  );
}
