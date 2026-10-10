import { INTERFERENCE_KINDS, type InterferenceKind } from '@sudoku-fight/engine';

import { isUnlocked } from '../../../progress/unlocks';

/**
 * The arsenal's settings (spec §7.1, §7.3). A change of mind is a change here, not in the components.
 */
export interface ArsenalConfig {
  /**
   * [D17] The level that opens each interference (spec §7.1: "ההפרעות נפתחות בהדרגה לפי רמה. טבלת הרמות תיקבע
   * ב־V1.1"). V1: 0 for all three, open from the start.
   */
  unlockLevels: Readonly<Record<InterferenceKind, number>>;
  /**
   * The tokens open before the player's level is known (the first level). A kind left out shows locked. The
   * game's own rules (view.rules.interferenceKinds) still have the last word: a kind they don't allow is
   * locked too. The game screen passes unlockedKinds(my level) instead.
   */
  unlocked: readonly InterferenceKind[];
}

export const INTERFERENCE_UNLOCK_LEVELS: Readonly<Record<InterferenceKind, number>> = {
  fireworks: 0,
  cats: 0,
  warp: 0,
};

/** The interferences open to a player of `level` (null: not known yet), in the engine's order [D17]. */
export function unlockedKinds(
  level: number | null,
  levels: Readonly<Record<InterferenceKind, number>> = INTERFERENCE_UNLOCK_LEVELS,
): InterferenceKind[] {
  return INTERFERENCE_KINDS.filter((kind) => isUnlocked(levels[kind], level));
}

export const ARSENAL_CONFIG: ArsenalConfig = {
  unlockLevels: INTERFERENCE_UNLOCK_LEVELS,
  unlocked: unlockedKinds(null),
};
