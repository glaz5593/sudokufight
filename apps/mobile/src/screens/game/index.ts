/**
 * The game screen of practice, alone (work plan stage 4) or against a bot (stage 5) with interferences and
 * reactions (stage 6: ./arsenal, ./hit, ./reactions), and of online games (stage 7: ./online, ./connection),
 * and of games of 3–4 players (stage 10: GroupHud, OutStrip), and its parts.
 */
export { BoardProgress, type BoardProgressProps } from './BoardProgress';
export { DuelHud, type DuelHudProps } from './DuelHud';
export { type Flight, FlightLayer, type FlightLayerProps } from './FlightLayer';
export { GameScreen, type GameScreenProps, type GameSession, type SessionProfile } from './GameScreen';
export {
  avatarCenterOf,
  boardSide,
  cellCenter,
  centerOf,
  compactAvatarCenterOf,
  compactScoreSlotOf,
  type Point,
  type Rect,
  scoreSlotOf,
  within,
} from './geometry';
export { GroupHud, type GroupHudProps } from './GroupHud';
export { botLevelOf, identityOf, playerIdentity, type PlayerIdentity, type PlayerLike } from './identity';
export {
  endDelayMs,
  FLASH_CLEAR_MS,
  formatClock,
  formatSeconds,
  groupCardWidths,
  hitCue,
  type HudLayout,
  hudLayoutOf,
  leadShift,
  type LeadShift,
  MOVE_TIMELINE,
  type MoveTimeline,
  opponentOf,
  opponentsOf,
  outOfGame,
  type OutOfGame,
  reactionCue,
  seatOrder,
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
  type DevRoomPlayers,
  NetMetricsPanel,
  OnlineGame,
  type OnlineGameProps,
  useOnlineInfo,
} from './online';
export { OutStrip, type OutStripProps } from './OutStrip';
export { SoloHud, type SoloHudProps } from './SoloHud';
export { ANNOUNCE_GAP_MS, type LiveAnnouncer, useLiveAnnouncer } from './useLiveAnnouncer';
