/**
 * The interference picker and its two-tap launch [D45] (work plan stage 6; spec §7.3, §7.4): the controller the
 * game screen keeps (useArsenal), the overlay it renders last (ArsenalOverlay), the sender's confirmation
 * (useSenderFeedback), and the pure model behind them (arsenalModel).
 */
export {
  type ArsenalModel,
  arsenalModel,
  type ArsenalToken,
  isInterferenceRefusal,
  launchable,
  pickerLayout,
  type PickerLayout,
  relativeTo,
  scrimPieces,
  targetFrameOf,
  type TokenBlock,
} from './arsenalModel';
export { ArsenalOverlay, type ArsenalOverlayProps, type ArsenalTargetInfo } from './ArsenalOverlay';
export { ARSENAL_CONFIG, type ArsenalConfig, INTERFERENCE_UNLOCK_LEVELS, unlockedKinds } from './config';
export { KindButton, type KindButtonProps } from './KindButton';
export { LaunchRipple, type LaunchRippleProps } from './LaunchRipple';
export { type RouteEnd, RouteLine, type RouteLineProps } from './RouteLine';
export { TokenArt, type TokenArtProps } from './TokenArt';
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
  blockedSentence,
  isolate,
  kindTitle,
  kindWord,
  priceText,
  senderText,
  tokenLabel,
} from './wording';
