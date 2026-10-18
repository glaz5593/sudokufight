import { INTERFERENCE_KINDS, type InterferenceKind } from '@sudoku-fight/engine';

import { isUnlocked } from '../../../progress/unlocks';

/**
 * The interference picker's settings (spec §7.1, §7.3). A change of mind is a change here, not in the
 * components.
 */
export interface ArsenalConfig {
  /**
   * [D17, D47] The level that opens each interference (original §15: "ההפרעות נפתחות בהדרגה"). The three first
   * ones are open from the start; the newer ones open at levels 2, 3 and 4.
   */
  unlockLevels: Readonly<Record<InterferenceKind, number>>;
  /**
   * The kinds open before the player's level is known (the first level). A kind left out shows locked ("רמה N").
   * The game's own rules (view.rules.interferenceKinds) still have the last word: a kind they don't allow is
   * not shown at all. The game screen passes unlockedKinds(my level) instead.
   */
  unlocked: readonly InterferenceKind[];
  /**
   * [D45] Taps on the picker in its first `armMs` after it opened are ignored, so the tap that opened it (or a
   * quick double tap) can't launch by mistake.
   */
  armMs: number;
  /** [D45] The picker's grid: all six kinds in 3 columns × 2 rows, no scrolling. */
  columns: number;
}

export const INTERFERENCE_UNLOCK_LEVELS: Readonly<Record<InterferenceKind, number>> = {
  fireworks: 0,
  cats: 0,
  warp: 0,
  scramble: 2,
  ink: 3,
  keypad: 4,
};

/** The interferences open to a player of `level` (null: not known yet), in the engine's order [D17]. */
export function unlockedKinds(
  level: number | null,
  levels: Readonly<Partial<Record<InterferenceKind, number>>> = INTERFERENCE_UNLOCK_LEVELS,
): InterferenceKind[] {
  // A kind the table does not name (a newer engine's) stays locked rather than open.
  return INTERFERENCE_KINDS.filter((kind) => isUnlocked(levels[kind] ?? Number.POSITIVE_INFINITY, level));
}

export const ARSENAL_CONFIG: ArsenalConfig = {
  unlockLevels: INTERFERENCE_UNLOCK_LEVELS,
  unlocked: unlockedKinds(null),
  armMs: 250,
  columns: 3,
};
