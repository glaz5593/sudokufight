/**
 * Leaderboards, player cards, XP, levels and leagues (work plan stage 12; spec §11.3, §14.2, §14.3, §15), and
 * staged practice's progress (1.0.2, spec §5.3.7: ./levels).
 */
export { type CardResult, readPlayerCard, recentOf, statsOf, TREND_GAMES } from './card';
export { decodeLeaderboardCursor, encodeLeaderboardCursor, type LeaderboardCursor } from './cursor';
export {
  boardFor,
  type LeaderboardPlayers,
  type LeaderboardQuery,
  readLeaderboard,
  RECENT_OPPONENTS,
} from './leaderboard';
export { forgetLevels, type LevelsMerge, mergeMyLevels, readMyLevels, sortLevels, utcDayOf } from './levels';
export { publicPlayers } from './players';
export { type PracticeTally, practiceXp, practiceXpUsedOn, recordPracticeResults } from './practice';
export {
  createProgressRouter,
  DEFAULT_PROGRESS_LIMITS,
  LEVELS_BODY_BYTES,
  PRACTICE_BODY_BYTES,
  type ProgressLimits,
  type ProgressRouterDeps,
} from './router';
export {
  keysOf,
  PRACTICE_CLOCK_SKEW_MS,
  PRACTICE_MAX_AGE_MS,
  progressSettings,
  type ProgressSettings,
} from './settings';
export { addXp, leagueOf, outcomeOf, rankedXpGains, readMyProgress, type XpGain, xpOf } from './xp';
