/**
 * The interference arsenal and its drag launch (work plan stage 6; spec §7.3, §7.4): the controller the game
 * screen keeps (useArsenal), the overlay it renders last (ArsenalOverlay), the sender's confirmation
 * (useSenderFeedback), and the pure model behind them (arsenalModel).
 */
export {
  type ArsenalModel,
  arsenalModel,
  type ArsenalToken,
  dropZoneOf,
  inZone,
  launchable,
  relativeTo,
  scrimPieces,
  type TokenBlock,
} from './arsenalModel';
export { ArsenalOverlay, type ArsenalOverlayProps, type ArsenalTargetInfo } from './ArsenalOverlay';
export { ARSENAL_CONFIG, type ArsenalConfig, INTERFERENCE_UNLOCK_LEVELS, unlockedKinds } from './config';
export {
  DragGhost,
  type DragGhostProps,
  type GhostRoute,
  LaunchRipple,
  type LaunchRippleProps,
  type RouteEnd,
} from './DragGhost';
export { TokenArt, type TokenArtProps } from './TokenArt';
export { TokenCard, type TokenCardProps } from './TokenCard';
export {
  type ArsenalCardProps,
  type ArsenalController,
  type Measurable,
  useArsenal,
  type UseArsenalOptions,
} from './useArsenal';
export { type InterferenceSent, useSenderFeedback } from './useSenderFeedback';
export {
  blockedPill,
  dropLabel,
  ghostText,
  isolate,
  kindTitle,
  kindWord,
  routeText,
  senderText,
  tapHint,
  tokenLabel,
} from './wording';
