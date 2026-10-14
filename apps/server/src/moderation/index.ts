/** Report a player, block, and the admin's moderation actions (spec §3.5; UGC-PROPOSAL option A). */
export {
  adminName,
  closeReport,
  listAudit,
  listReportedPlayers,
  type ModerationTools,
  resetName,
  setSuspended,
  TEMPORARY_NAME_PREFIX,
  temporaryName,
} from './admin';
export { moderationAdminRoutes } from './adminRoutes';
export {
  createModerationRouter,
  DEFAULT_MODERATION_LIMITS,
  type ModerationLimits,
  type ModerationRouterDeps,
} from './router';
export {
  addBlock,
  blockedEitherWay,
  blocksAmong,
  createReport,
  forgetModeration,
  isRetiredName,
  keepSuspension,
  liveUserById,
  lockActor,
  removeBlock,
  retireName,
  roomBlocks,
  signInFingerprints,
  takeSuspension,
} from './store';
export { type BlockChange, type BlockPair, BlockWatch, type RoomBlocks } from './watch';
