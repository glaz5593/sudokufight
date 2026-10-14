/**
 * The home-level screens of work-plan stages 4–5: Home, "משחק חדש" (modes), "סוג משחק", the bot selection, the
 * settings, and the bottom-nav tabs that come later (placeholders). Routes in app/ render these. Stage 9 opens
 * ranked 2 players from here (startRankedAndOpen: the matchmaking screens are src/screens/match).
 */
export { BotSelectScreen, type BotSelectScreenProps } from './BotSelectScreen';
export { GameTypeScreen, type GameTypeScreenProps } from './GameTypeScreen';
export { HomeScreen, type HomeScreenProps } from './HomeScreen';
export {
  AVAILABLE_MODES,
  botLevelOfGame,
  type BotOption,
  botOptions,
  DEFAULT_BOT_LEVEL,
  DEFAULT_GAME_TYPE,
  DEFAULT_MODE,
  DEFAULT_RANKED_PLAYERS,
  gameTypeInfo,
  gameTypeInfos,
  type GameTypeInfo,
  HOME_RECENT_COUNT,
  isAvailable,
  isOpenPlayerCount,
  isStartableMode,
  lastPlayOf,
  MODE_GROUPS,
  MODE_OPTIONS,
  type ModeGroup,
  type ModeKey,
  type ModeOption,
  percentOf,
  playedAtText,
  RANKED_TABLES_OPEN,
  rankedRatingIn,
  type RecentOutcome,
  recentOutcome,
  secondsText,
  STARTABLE_MODES,
  thinkSeconds,
} from './homeModel';
export { ModesScreen } from './ModesScreen';
export { goBack, goToTab, TAB_PATHS } from './navigation';
export { PlaceholderScreen, type PlaceholderTab } from './PlaceholderScreen';
export {
  countGamesPlayed,
  createPracticeStats,
  INTERRUPTED_COUNTS_AS_LOSS,
  type PracticeStatsState,
  usePracticeStats,
  winStats,
  type WinStats,
} from './practiceStats';
export { SettingsScreen, type SettingsScreenProps } from './SettingsScreen';
export { MATCH_PATH, startAndOpen, startRankedAndOpen } from './startGame';
