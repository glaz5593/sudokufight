/**
 * The connection UI of online games (work plan stage 7; spec §6.6, §16.2, §16.3, §18), self-contained:
 * a pure model of what to show, and one component per state.
 *
 * Wiring (the game screen and app/game.tsx):
 * 1. Map the RemoteGameHost's socket state onto ConnectionStatus (times in the server's clock).
 * 2. On every render tick: `const model = connectionModel(view, status, serverNow, { graceMs })`.
 * 3. Render `<ConnectionLayer model={model} … />` last, over the content. While `blocksInput(model)`, give the
 *    content `importantForAccessibility="no-hide-descendants"` (the layer takes the touches itself).
 * 4. When the game is over, wait for "לתוצאות" while `holdsResults(model)` before going to the results.
 * 5. Surrender in a ranked game: `<RankedSurrender visible … onConfirm={() => host.surrender()} />`.
 * The components play their own cues ('disconnect', 'reconnect'); the screen should not repeat them.
 */
export { Announcer, type AnnouncerProps } from './Announcer';
export { ConnectingView, type ConnectingViewProps } from './ConnectingView';
export { ConnectionError, type ConnectionErrorProps } from './ConnectionError';
export { ConnectionLayer, type ConnectionLayerProps } from './ConnectionLayer';
export {
  blocksInput,
  CONNECTING_STEPS,
  type ConnectingModel,
  type ConnectingStep,
  type ConnectionErrorModel,
  type ConnectionFailure,
  connectionModel,
  type ConnectionModel,
  type ConnectionModelKind,
  type ConnectionModelOptions,
  type ConnectionStatus,
  DEFAULT_GRACE_MS,
  graceShare,
  holdsResults,
  type LobbyInfo,
  type LobbyModel,
  lobbyOf,
  type LobbySeat,
  type OpponentLeftModel,
  type OpponentReconnectingModel,
  type RoomRefusal,
  type SelfPhase,
  type SelfReconnectingModel,
  SYNCED_HOLD_MS,
  type SyncItem,
} from './connectionModel';
export {
  connectingPercent,
  LAST_CELL_POINTS,
  type LoadingPlayer,
  type LoadingTip,
  LOADING_TIPS,
  type MatchLoading,
  matchLoadingOf,
  tipOf,
  TOP_MOVE_POINTS,
} from './loadingModel';
export { COPIED_HOLD_MS, LobbyView, type LobbyViewProps } from './LobbyView';
export { OpponentLeft, type OpponentLeftProps } from './OpponentLeft';
export {
  FrozenBadge,
  type FrozenBadgeProps,
  OpponentReconnecting,
  type OpponentReconnectingProps,
} from './OpponentReconnecting';
export { RankedSurrender, type RankedSurrenderProps, type SurrenderSummary } from './RankedSurrender';
export { ScoreLine, type ScoreLineData, type ScoreLineProps } from './ScoreLine';
export { HURRY_SECONDS, SelfReconnecting, type SelfReconnectingProps } from './SelfReconnecting';
export { spellCode } from './wording';
