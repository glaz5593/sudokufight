/** The history tab (work plan stage 11, spec §14.1): ranked games from the server and practices from the phone. */
export {
  createHistoryApi,
  HISTORY_OFFLINE_CODES,
  type HistoryApi,
  type HistoryApiDeps,
  HistoryApiError,
  type HistoryApiErrorCode,
  isHistoryApiError,
} from './historyApi';
export { HistoryCard, type HistoryCardProps } from './HistoryCard';
export { type HistoryDeps, HistoryLoader, type HistorySnapshot, type RankedStatus } from './historyLoader';
export {
  dayOf,
  HISTORY_FILTERS,
  type HistoryEntry,
  type HistoryFilter,
  type HistoryOpponent,
  type HistoryOutcome,
  mergeEntries,
  practiceEntry,
  rankedEntry,
  shortDate,
} from './historyModel';
export { HistoryScreen, type HistoryScreenProps } from './HistoryScreen';
export {
  type HistorySummary,
  historySummaryOf,
  percentText,
  type PracticeNumbers,
  summaryLine,
} from './historySummary';
export { useHistorySummary } from './useHistorySummary';
