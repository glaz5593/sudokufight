import type { BackgroundPauseSettings } from '../game/backgroundPause';

/**
 * A practice's settings on the phone (solo practice and practice against a bot). Each is a default built as a
 * setting, read by the code it names, with a test that flips it (CLAUDE.md).
 */
export interface PracticeUiSettings extends BackgroundPauseSettings {
  /**
   * The app leaving the foreground mid-practice freezes it, and "3, 2, 1" over the covered board brings it back
   * (D65, extended by Moshe on 2026-10-18 to solo practice and practice against a bot; game/session.ts). Never an
   * online game.
   */
  backgroundPause: boolean;
  /** The resume countdown's length (D65), as in the stages. */
  resumeCountdownMs: number;
}

export const PRACTICE_UI: PracticeUiSettings = {
  backgroundPause: true,
  resumeCountdownMs: 3000,
};
