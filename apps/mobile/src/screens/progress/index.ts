/**
 * The progress tab and the interferences collection (work plan stage 12; spec §7.1, §11.3, §15), and the
 * pieces the stage-12 screens share.
 */
export { InterferencesScreen, type InterferencesScreenProps } from './InterferencesScreen';
export { Note, Panel, ProgressBar, Segmented, type SegmentItem, StateMessage } from './parts';
export {
  type CollectionEntry,
  FUTURE_INTERFERENCES,
  type FutureInterference,
  type InterferenceCollection,
  interferenceCollection,
  interferenceFacts,
  type LadderStep,
  leagueLadder,
  type LevelView,
  levelView,
  provisionalGames,
  xpRules,
} from './progressModel';
export { ProgressScreen, type ProgressScreenProps } from './ProgressScreen';
