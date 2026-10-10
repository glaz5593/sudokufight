/**
 * Online games (work plan stage 7, spec §16–§18, §21): RemoteGameHost, the same GameHost as the engine's
 * LocalGameHost, against the game server; and (stage 9) matchmaking for ranked games, and the connection
 * check before a game (spec §16.1).
 *
 * Pure (no React Native or Expo; runs in Node against the real server, import these files directly there):
 * remoteGameHost, onlineClient, devRooms, matchmaking, clockSync, metrics, rollingStats, errors.
 * Wired to the phone: device and matchmakingDevice (SDK clients, clock, timers, AppState, analytics; loaded
 * lazily by the screens that start a game, they bring the SDK), identity (kv-store) and connectivity.
 */
export { ClockSync, type ClockSample, type ClockSyncOptions, robustOffset, TokenBucket } from './clockSync';
export { createDevRoom, DEV_PING_EVERY_MS, deviceHost, deviceHostDeps, joinDevRoom } from './device';
export {
  checkHealth,
  CONNECTIVITY,
  type ConnectivityState,
  type ConnectivityStatus,
  setHealthCheck,
  useConnectivity,
  useConnectivityWatch,
} from './connectivity';
export { type DevRoom, type DevRooms, devRooms } from './devRooms';
export { isRetryable, OnlineError, type OnlineErrorCode, onlineErrorOf } from './errors';
export {
  DEV_USER_ID_KEY,
  devIdentity,
  devNameOf,
  getDevUserId,
  type IdentityStorage,
  netIdentity,
  setNetIdentitySource,
} from './identity';
export {
  createMatchmakingConnector,
  DEFAULT_MATCHMAKING_OPTIONS,
  type FoundMessage,
  type MatchEntry,
  type MatchHostLike,
  type MatchInfo,
  MatchmakingClient,
  type MatchmakingClientDeps,
  type MatchmakingClientOptions,
  type MatchmakingConnector,
  MatchmakingFailure,
  type MatchmakingFailureCode,
  matchmakingFailureOf,
  type MatchmakingInfo,
  type MatchmakingRoomLike,
  type MatchPhase,
  type MatchWaitResult,
  type SearchInfo,
  type TimeoutInfo,
} from './matchmaking';
export {
  answers,
  type MetricsTrack,
  NetMetrics,
  type NetMetricsOptions,
  type NetMetricsSummary,
} from './metrics';
export {
  createOnlineClient,
  type DevRoomOptions,
  type IdentitySource,
  type NetIdentity,
  type OnlineClient,
  type OnlineClientOptions,
  type RoomLike,
  roomOf,
  type SdkClientLike,
  type SdkRoomLike,
} from './onlineClient';
export {
  type AppStateLike,
  type CloseReason,
  DEFAULT_REMOTE_HOST_OPTIONS,
  type LobbyInfo,
  type OnlineInfo,
  type OnlineStatus,
  type ReconnectInfo,
  RemoteGameHost,
  type RemoteHostDeps,
  type RemoteHostOptions,
} from './remoteGameHost';
export { percentile, RollingStats, type StatsSummary } from './rollingStats';
