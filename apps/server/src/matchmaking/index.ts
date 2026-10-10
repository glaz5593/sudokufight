/** Matchmaking for ranked games (stage 9, spec §10): see service.ts for the flow, matcher.ts for the rules. */
export * from './matcher';
export * from './ranked';
export * from './service';
export { dbMatchmakingStore } from './store';
export { colyseusMatchGames } from './games';
export { matchmakingIdentityVerifier } from './identity';
export {
  createMatchmakingRoom,
  MATCHMAKING_ROOM_DEFAULTS,
  MatchmakingRoom,
  type MatchmakingRoomDeps,
} from './room';
