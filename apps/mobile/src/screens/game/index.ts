/**
 * The game screen of practice, alone (work plan stage 4) or against a bot (stage 5) with interferences and
 * reactions (stage 6: ./arsenal, ./hit, ./reactions), and of online games (stage 7: ./online, ./connection),
 * and its parts.
 */
export { BoardProgress, type BoardProgressProps } from './BoardProgress';
export { DuelHud, type DuelHudProps } from './DuelHud';
export { type Flight, FlightLayer, type FlightLayerProps } from './FlightLayer';
export { GameScreen, type GameScreenProps, type GameSession } from './GameScreen';
export {
  avatarCenterOf,
  boardSide,
  cellCenter,
  centerOf,
  type Point,
  type Rect,
  scoreSlotOf,
  within,
} from './geometry';
export { botLevelOf, identityOf, playerIdentity, type PlayerIdentity, type PlayerLike } from './identity';
export {
  endDelayMs,
  FLASH_CLEAR_MS,
  formatClock,
  formatSeconds,
  hitCue,
  type HudLayout,
  hudLayoutOf,
  leadShift,
  type LeadShift,
  MOVE_TIMELINE,
  type MoveTimeline,
  opponentOf,
  reactionCue,
  soloStats,
  type SoloStats,
  staleAt,
} from './model';
export {
  MAX_REACTIONS,
  REACTION_MS,
  type ReactionFloat,
  ReactionLayer,
  type ReactionLayerProps,
  withFloat,
} from './ReactionLayer';
export {
  connectionStatusOf,
  DevMetricsScreen,
  DevMetricsToggle,
  DevOnlineScreen,
  NetMetricsPanel,
  OnlineGame,
  type OnlineGameProps,
  useOnlineInfo,
} from './online';
export { SoloHud, type SoloHudProps } from './SoloHud';
export { ANNOUNCE_GAP_MS, type LiveAnnouncer, useLiveAnnouncer } from './useLiveAnnouncer';
