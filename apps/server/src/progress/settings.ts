import {
  DEFAULT_PROGRESS_RULES,
  LEVEL_RULES,
  type LevelRules,
  type ProgressRules,
  type RatingOption,
} from '@sudoku-fight/engine';
import { ratingKeysFor } from '@sudoku-fight/protocol';

import {
  DEFAULT_LEVEL_XP_CARRY_OVER,
  DEFAULT_PRACTICE_XP_DAILY_CAP,
  type ProgressConfig,
  type ServerConfig,
} from '../config';

/**
 * What the progress routes go by (stage 12; spec §11.3, §14.2, §15): the engine's progress rules (XP, levels,
 * leagues [D38]) and its levels' rules (staged practice, 1.0.2), the server's RATING_OPTION [D7], and the
 * settings of src/config.ts (the daily practice cap, the invite link, the level XP carry-over).
 */

const DAY_MS = 24 * 3600 * 1000;

export interface ProgressSettings extends ProgressConfig {
  ratingOption: RatingOption;
  rules: ProgressRules;
  /** The levels: how many there are, the gates (the engine's LEVEL_RULES). */
  levelRules: LevelRules;
  levelXpCarryOver: boolean;
  /** A practice result that ended longer ago than this is refused (default 30 days). */
  practiceMaxAgeMs: number;
  /** How far ahead of the server's clock a practice result may say it ended: the phone's clock (5 minutes). */
  practiceClockSkewMs: number;
}

export const PRACTICE_MAX_AGE_MS = 30 * DAY_MS;
export const PRACTICE_CLOCK_SKEW_MS = 5 * 60_000;

export function progressSettings(
  config: Pick<ServerConfig, 'ratingOption'> & { progress?: ProgressConfig },
  overrides: Partial<ProgressSettings> = {},
): ProgressSettings {
  return {
    ratingOption: config.ratingOption,
    rules: DEFAULT_PROGRESS_RULES,
    levelRules: LEVEL_RULES,
    practiceXpDailyCap: config.progress?.practiceXpDailyCap ?? DEFAULT_PRACTICE_XP_DAILY_CAP,
    inviteUrl: config.progress?.inviteUrl ?? null,
    levelXpCarryOver: config.progress?.levelXpCarryOver ?? DEFAULT_LEVEL_XP_CARRY_OVER,
    practiceMaxAgeMs: PRACTICE_MAX_AGE_MS,
    practiceClockSkewMs: PRACTICE_CLOCK_SKEW_MS,
    ...overrides,
  };
}

/** The rating keys that count under the settings' option (3 under B, 9 under A). */
export const keysOf = (settings: Pick<ProgressSettings, 'ratingOption'>): string[] =>
  ratingKeysFor(settings.ratingOption);
