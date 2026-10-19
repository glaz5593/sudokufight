/**
 * Staged practice's screen settings (1.0.2; dev-plan §1.1, Moshe's answers of 2026-10-18). Each is a ☐ default
 * of spec §24 (or one of Moshe's decisions) built as a setting, read by the screen it names, with a test that
 * flips it (CLAUDE.md). The game's rules are the engine's LEVEL_RULES; the data's settings (the sync) are
 * LEVELS_DATA in levels/levelsConfig.ts.
 */
export interface LevelUiSettings {
  /** "מוכן?" before a stage's clock starts, this long (D56; ReadyView). */
  readyMs: number;
  /**
   * "לשלב הבא" on a result starts the next stage straight away, through "מוכן?" (D56). Off: it goes back to
   * the map with the next stage chosen in the panel (app/levels/play.tsx).
   */
  quickEntry: boolean;
  /** A map node shows its kind's icon (D60: no, so the map stays calm; LevelNode). */
  nodeKindIcon: boolean;
  /** "שלבים: 87 · ★ 214" on another player's card too (D58: mine only; PlayerCardScreen). */
  cardShowsToOthers: boolean;
  /** The map's zigzag runs from stage 1 at the top down ('down', D60) or from the bottom up (mapModel). */
  mapDirection: 'down' | 'up';
  /** My reactions button in a stage against a bot (D62, Moshe 2026-10-18: none; the bot still reacts). */
  reactions: boolean;
  /**
   * The app leaving the foreground mid-stage freezes it, and "3, 2, 1" over the covered board brings it back
   * (D65, Moshe 2026-10-18; the stage screens).
   */
  backgroundPause: boolean;
  /** The resume countdown's length (D65). */
  resumeCountdownMs: number;
  /** Spot the error: its tip card in the kind's first this many stages. */
  tipLevels: number;
  /** Point hunter: "שווה 6" over my locked cell in the kind's first this many stages. */
  worthHintLevels: number;
}

export const LEVEL_UI: LevelUiSettings = {
  readyMs: 2000,
  quickEntry: true,
  nodeKindIcon: false,
  cardShowsToOthers: false,
  mapDirection: 'down',
  reactions: false,
  backgroundPause: true,
  resumeCountdownMs: 3000,
  tipLevels: 3,
  worthHintLevels: 2,
};
