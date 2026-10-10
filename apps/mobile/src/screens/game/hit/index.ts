/**
 * An interference on me, on the game screen (spec §7.4, work plan stage 6): the 5 s effect, its banner, its
 * cue, rumble and announcements. HitLayer goes over the screen; WarpFrame (components/interference) wraps
 * the content a warp distorts; hitOf builds the layer's `hit` from the GameView.
 */
export { HitBanner, type HitBannerProps } from './HitBanner';
export { HitLayer, type HitLayerProps } from './HitLayer';
export {
  type HitInfo,
  hitKeyOf,
  type HitNames,
  hitOf,
  hitSeconds,
  isHitOn,
  isolateName,
  rumbleOf,
} from './hitModel';
export { type HitAnnounce, useHitFeedback } from './useHitFeedback';
