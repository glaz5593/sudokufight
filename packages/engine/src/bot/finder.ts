import type { FindScope, FindTarget, TargetTier } from '../levels/spec';
import { BOXES, CELL_COUNT, type CellIndex, COLS, type Grid, ROWS } from '../sudoku/board';
import { pick, type Rng } from '../util/random';
import { BOT_CONFIG, type BotConfig, type BotLevelId } from './levels';

/**
 * The bot of the race ("מרוץ מול הבוט", plan §2.2; spec §9) [D61]: it searches for each spot, it does not solve.
 * The builder freezes each spot's search range into the level (LevelBot.findMs) with findMsRange; the tap
 * engine draws the bot's plan within it (levels/find.ts), and picks its wrong taps with chooseWrongTap.
 */

/**
 * When the bot's wrong tap comes, as a share of its search time for the spot: the plan's shape, not a tuned
 * number (so a later change of BOT_CONFIG.find never moves a built level's bot).
 */
export const BOT_MISS_AT = { min: 0.3, max: 0.8 } as const;

/**
 * A spot's search range, [min, max] ms: the level's base (BOT_CONFIG.find.ms) × the tier's factor (1.3 for
 * every tier but a single) × the level's pace. The pace is final (a boss's ×0.9 already in it), so there is no
 * boss factor here.
 */
export function findMsRange(
  level: BotLevelId,
  tier: TargetTier,
  pace: number,
  config: BotConfig = BOT_CONFIG,
): [min: number, max: number] {
  if (!(Number.isFinite(pace) && pace > 0)) throw new RangeError(`A pace is positive, got ${pace}`);
  const base = config.find.ms[level];
  if (!base) throw new RangeError(`No search time for bot level ${String(level)}`);
  const factor = config.find.tierFactor[tier];
  return [Math.round(base.min * factor * pace), Math.round(base.max * factor * pace)];
}

/** The cells of a scope (the whole board: every cell). */
function scopeCells(scope: FindScope): readonly CellIndex[] {
  switch (scope.kind) {
    case 'box':
      return BOXES[scope.index]!.cells;
    case 'row':
      return ROWS[scope.index]!.cells;
    case 'col':
      return COLS[scope.index]!.cells;
    case 'board':
      return Array.from({ length: CELL_COUNT }, (_, i) => i);
  }
}

/**
 * A wrong tap a person could make on `target` (plan §2.2: the bot sometimes taps a wrong place): an empty cell
 * of its scope that is not one of its answers. Null when the scope has none.
 */
export function chooseWrongTap(grid: Grid, target: FindTarget, rng: Rng): CellIndex | null {
  const wrong = scopeCells(target.scope).filter((c) => grid[c] === 0 && !target.accept.includes(c));
  return wrong.length ? pick(rng, wrong) : null;
}
