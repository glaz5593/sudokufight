/** The replay of a game (work plan stage 11, spec §13): its model over the engine's log, and its screen. */
export {
  buildReplay,
  type ExplanationStatus,
  type KeyMoments,
  nextMoment,
  type PlayerExplanation,
  type Replay,
  type ReplayOptions,
  type ReplayPlayer,
  type ReplayStep,
  stepAtFraction,
  type StepKind,
  stepView,
  type StepView,
  type TimelineDot,
} from './replayModel';
export { ReplayScreen, type ReplayScreenProps } from './ReplayScreen';
export {
  loadReplay,
  type ReplayLoad,
  type ReplayMeta,
  type ReplaySourceDeps,
  type ReplaySourceKind,
} from './replaySource';
