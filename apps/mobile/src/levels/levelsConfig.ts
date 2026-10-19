/**
 * Staged practice's data settings on the phone (1.0.2; dev-plan §1.1): what levelsSync reads at every flush.
 * The screens' settings (ready, tips, reactions, the background pause…) are LEVEL_UI in config/levels.ts; the
 * game's rules are the engine's LEVEL_RULES.
 */
export interface LevelsDataSettings {
  /** The best of every level goes to the account (PUT /v1/me/levels) [D57]. Off: the sync sends nothing. */
  sync: boolean;
  /**
   * After a server without the levels' route (404 notFound), or one that listed levels as unknown: how long
   * before the phone asks again (also on the next app start). No retry loop in between.
   */
  unsupportedRetryMs: number;
}

export const LEVELS_DATA: LevelsDataSettings = {
  sync: true,
  unsupportedRetryMs: 6 * 60 * 60 * 1000,
};
