/**
 * Progress (work plan stage 12; spec §11.3, §14.2, §14.3, §15): my XP, level and league cached for offline,
 * the practice XP queue and its sync [D41], and the wiring to the phone. The rules (XP per game, levels,
 * leagues) are the engine's progress module; the server applies them, and the app shows its numbers.
 */
export {
  currentOwner,
  practiceFinished,
  practiceSync,
  refreshMyProgress,
  setProgressFetch,
  signedInProgressApi,
  startProgress,
} from './appProgress';
export { useMyCard, useMyLevel, useMyProgress, useOwner } from './hooks';
export {
  createPracticeQueue,
  isPracticeResult,
  PRACTICE_QUEUE_KEY,
  PRACTICE_QUEUE_MAX,
  type PracticeQueue,
  type QueuedResult,
} from './practiceQueue';
export { type FinishedPractice, practiceResultOf } from './practiceResult';
export {
  DEFAULT_SYNC_BATCHES,
  FOLLOW_UP_MS,
  PracticeSync,
  type PracticeSyncDeps,
  type SyncOutcome,
  type SyncStatus,
} from './practiceSync';
export {
  adoptCard,
  adoptProgress,
  cardOf,
  forgetProgress,
  progressOf,
  type ProgressState,
  type ProgressStatus,
  setPending,
  setProgressStatus,
  useProgress,
} from './progressStore';
