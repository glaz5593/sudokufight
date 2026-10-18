/**
 * An interference on me, on the game screen (spec §7.4, work plan stage 6): the 5 s effect, its banner, its
 * cue, rumble and announcements. HitLayer goes over the screen; BoardHitLayer goes inside the board's slot,
 * with the board's dim of every hit [D46] and the scramble's tiles [D47]; useKeypadShuffle moves the keypad's
 * keys for a 'keypad' hit [D47]; WarpFrame (components/interference) wraps the content a warp distorts; hitOf
 * builds the layers' `hit` from the GameView.
 */
export { BoardHitLayer, type BoardHitLayerProps, scrambleCellsOf } from './BoardHitLayer';
export { HitBanner, type HitBannerProps } from './HitBanner';
export { HitLayer, type HitLayerProps, hitTitle } from './HitLayer';
export {
  type HitInfo,
  hitKeyOf,
  type HitNames,
  hitOf,
  hitSeconds,
  hitSeedOf,
  isHitOn,
  isolateName,
  rumbleOf,
} from './hitModel';
export { type HitAnnounce, useHitFeedback } from './useHitFeedback';
export { type KeypadShuffle, useKeypadShuffle } from './useKeypadShuffle';
