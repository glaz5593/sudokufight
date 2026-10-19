import { DEFAULT_PROGRESS_RULES, levelXpFor, type ProgressRules, type Stars } from '@sudoku-fight/engine';

/**
 * The XP an attempt shows on its result (plan §5.1) [D55]: an estimate, for display only. The server pays its
 * own count from the bests it stores (PUT /v1/me/levels), within the daily cap, so the phone never adds this
 * to my XP; the next answer brings the real number.
 */
export function levelXpEstimate(
  attempt: { prevBest: Stars; best: Stars; gateOpened: boolean },
  rules: ProgressRules = DEFAULT_PROGRESS_RULES,
): number {
  return levelXpFor(attempt.prevBest, attempt.best, attempt.gateOpened, rules);
}
