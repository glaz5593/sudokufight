import { INTERFERENCE_KINDS, type InterferenceKind } from '@sudoku-fight/engine';

/**
 * The arsenal's settings (spec §7.1, §7.3). A change of mind is a change here, not in the components.
 */
export interface ArsenalConfig {
  /**
   * The tokens this player may launch [D17]. V1 opens the three of spec §7.1 from the start; V1.1 will open
   * them by level, so this list will come from the player's level then. A kind left out shows locked. The game's
   * own rules (view.rules.interferenceKinds) still have the last word: a kind they don't allow is locked too.
   */
  unlocked: readonly InterferenceKind[];
}

export const ARSENAL_CONFIG: ArsenalConfig = {
  unlocked: INTERFERENCE_KINDS,
};
