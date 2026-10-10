/**
 * Online games (work plan stage 7, spec §16–§18, §21): RemoteGameHost, the same GameHost as the engine's
 * LocalGameHost, against the game server.
 *
 * Pure (no React Native or Expo; runs in Node against the real server, import these files directly there):
 * remoteGameHost, onlineClient, devRooms, clockSync, metrics, rollingStats, errors.
 * Wired to the phone: device (SDK client, clock, timers, AppState, analytics) and identity (kv-store).
 */
export { ClockSync, type ClockSample, type ClockSyncOptions, robustOffset, TokenBucket } from './clockSync';
export { createDevRoom, DEV_PING_EVERY_MS, deviceHost, deviceHostDeps, joinDevRoom } from './device';
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
