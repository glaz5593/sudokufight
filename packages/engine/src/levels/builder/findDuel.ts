import { findMsRange } from '../../bot/finder';
import { BOT_CONFIG, type BotConfig } from '../../bot/levels';
import { boxOf, type Grid } from '../../sudoku/board';
import { requiresTechniques } from '../../sudoku/targets';
import { createRng, type Rng, shuffled } from '../../util/random';
import type { LevelLogic, LevelPlanOf } from '../levels.config';
import type { FindTarget, LevelBot, LevelSpecOf } from '../spec';
import { makeBoard } from './boards';
import { BuildError, checkOf, specHead } from './common';
import { type Built, targetCandidates, type TargetRules } from './find';

/**
 * The race, "מרוץ מול הבוט" (plan §2.2) [D53]: five spots shown one after the other, each a find target on the
 * board as it is when shown (the spots before it taken). Taking a spot fills its cell; a spot nobody took
 * (time ran out, or both were out of it) leaves it empty. So every spot must stay a target whatever happened
 * to the ones before it: it is checked with each subset of the earlier spots filled (sudoku logic is not
 * monotone once eliminations are allowed, dev-plan §2ב). Its tier, the bot's ×1.3 (plan §2.2), is read on
 * the board as shown, and the bot's search range of each spot is frozen into the level (spec.bot.findMs).
 */

/** The board with the cells of the spots in `taken` filled with their digits. */
export function withSpots(grid: Grid, spots: readonly FindTarget[], taken: readonly number[]): number[] {
  const out = grid.slice();
  for (const k of taken) {
    const s = spots[k]!;
    out[s.cell!] = s.digit;
  }
  return out;
}

/** Every subset of 0 … n − 1, as index lists (the empty one first). */
export function subsetsOf(n: number): number[][] {
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const s: number[] = [];
    for (let k = 0; k < n; k++) if (mask & (1 << k)) s.push(k);
    out.push(s);
  }
  return out;
}

/** Spot `k` is a target with every subset of the spots before it filled (known, one place in its scope). */
export function staysTarget(grid: Grid, spots: readonly FindTarget[], k: number, logic: LevelLogic): boolean {
  const spot = spots[k]!;
  return subsetsOf(k).every((taken) =>
    requiresTechniques(withSpots(grid, spots, taken), spot, logic.techniques, []),
  );
}

/** The bot of a race, frozen: its search range per spot, and its shares (plan §2.2, BOT_CONFIG.find). */
export function raceBot(
  plan: LevelPlanOf<'findDuel'>,
  spots: readonly FindTarget[],
  config: BotConfig = BOT_CONFIG,
): LevelBot {
  const { level, pace } = plan.bot;
  return {
    level,
    pace,
    findMs: spots.map((s) => findMsRange(level, s.tier, pace, config)),
    missShare: config.find.missShare[level],
    reactShare: config.find.reactShare[level],
  };
}

export const FIND_DUEL_ATTEMPTS = 400;

/** The next spot on `board` after `spots`: a fresh digit and box first, a fresh digit then, any last. */
function nextSpot(
  givens: Grid,
  solution: Grid,
  spots: readonly FindTarget[],
  rules: TargetRules,
  rng: Rng,
): FindTarget | null {
  const shown = withSpots(
    givens,
    spots,
    spots.map((_, k) => k),
  );
  const used = new Set(spots.map((s) => s.cell));
  const digits = new Set(spots.map((s) => s.digit));
  const boxes = new Set(spots.map((s) => boxOf(s.cell!)));
  // The box empties are the level's board's: what the player sees when the race starts.
  const candidates = targetCandidates(shown, solution, rules, givens).filter(
    (t) => t.cell !== null && !used.has(t.cell),
  );
  const rank = (t: FindTarget) => (digits.has(t.digit) ? 2 : 0) + (boxes.has(boxOf(t.cell!)) ? 1 : 0);
  const ordered = shuffled(rng, candidates).sort((a, b) => rank(a) - rank(b));
  for (const t of ordered) {
    const next = [...spots, t];
    if (staysTarget(givens, next, next.length - 1, rules.logic)) return t;
  }
  return null;
}

export function buildFindDuel(
  plan: LevelPlanOf<'findDuel'>,
  rng: Rng = createRng(plan.seed),
  config: BotConfig = BOT_CONFIG,
): Built<LevelSpecOf<'findDuel'>> {
  if (plan.scopes.includes('board')) throw new RangeError(`${plan.id}: a race has no whole-board spot`);
  const rules: TargetRules = { scopes: plan.scopes, logic: plan.logic, boxEmpties: plan.boxEmpties };
  for (let attempt = 1; attempt <= FIND_DUEL_ATTEMPTS; attempt++) {
    const board = makeBoard(rng, { type: plan.gameType, total: plan.givens });
    if (!board) continue;
    const spots: FindTarget[] = [];
    while (spots.length < plan.spots) {
      const t = nextSpot(board.givens, board.solution, spots, rules, rng);
      if (!t) break;
      spots.push(t);
    }
    if (spots.length < plan.spots) continue;
    return {
      spec: {
        ...specHead(plan, board),
        targets: { spots },
        stars: plan.stars,
        bot: raceBot(plan, spots, config),
        check: checkOf(plan.logic),
      },
      attempts: attempt,
    };
  }
  throw new BuildError(plan.id, `no race of ${plan.spots} spots in ${FIND_DUEL_ATTEMPTS} boards`);
}
