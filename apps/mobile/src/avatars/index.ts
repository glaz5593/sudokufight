/** Our avatars in the app (spec §3.4): the bridge from an id to its character, and AvatarArt, which draws it. */
export { AvatarArt, type AvatarArtProps, type AvatarReaction, REACTION_FACE_MS } from './AvatarArt';
export {
  AVATAR_GROUPS,
  AVATAR_META,
  avatarDef,
  type AvatarGroup,
  type AvatarIdOrNone,
  type AvatarMeta,
  avatarName,
  avatarUnlockLevel,
  expressionName,
  kindOf,
  NO_AVATAR_ID,
  normalizeAvatarId,
} from './catalog';
export {
  AVATAR_REACTIONS,
  AVATAR_STAGES,
  type AvatarStage,
  type AvatarFace,
  type AvatarMoods,
  type AvatarReactionsConfig,
  type EndCue,
  endFaceOf,
  placeCue,
  type ReactionDef,
  sameFace,
} from './reactions';
export { useAfter, useReadyFace } from './useFaces';
