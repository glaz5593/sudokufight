/**
 * Practice on the phone (work plan stages 4–5): the offline pool, the local save [D25], the session around a
 * LocalGameHost (alone, or with the engine's bot at the table), the store the screens read, and the pure
 * mapping from updates to feedback effects. Screens use this and the GameHost interface only; the engine's
 * rules never run in a screen.
 */
export {
  type GameEndProps,
  gameEndProps,
  type GameStartProps,
  gameStartProps,
  resultLabel,
} from './analyticsProps';
export { systemClock, timeoutScheduler } from './clock';
export { effectsOf, type UiEffect, type UiEffectKind } from './effects';
export {
  createGameStore,
  defaultGameStoreDeps,
  type GameStoreDeps,
  type GameStoreState,
  useGameStore,
} from './gameStore';
export { offlinePool, type OfflinePuzzle, poolIds, poolOf, puzzleById, type PuzzlePool } from './offlinePool';
export { isOutcome, type Outcome, outcomeOf } from './outcome';
export {
  type FinishedGame,
  type Migration,
  MIGRATIONS,
  migrate,
  type NewPracticeGame,
  openPracticeRepo,
  type PracticeGame,
  type PracticeGameRecord,
  type PracticeOpponent,
  type PracticeRepo,
  type PracticeStatus,
} from './practiceRepo';
export { type RankedEnd, rankedEndOf, rankedLeftOf, storedIn } from './rankedEnd';
export {
  BOT_SEED_SALT,
  type BotPracticeOptions,
  botSeedOf,
  choosePuzzle,
  ME,
  type PracticeDeps,
  type PracticeOptions,
  type PracticeSession,
  startBotPractice,
  startPractice,
} from './session';
export type { SqlDb, SqlRunResult, SqlValue } from './sqlDb';
export { openPracticeStorage, PRACTICE_DB_NAME, practiceStorageOrNull } from './storage';
export { useGameEffects } from './useGameEffects';
export { useNow, type UseNowOptions } from './useNow';
