/**
 * The interferences' 5 s effects (spec §7.1, §22; docs/design/motion.md §4.4): fireworks, cats and warp,
 * each live or, with reduced motion, as a static cover of the same area for the same time. They are pure
 * pictures: the game screen's HitLayer (screens/game/hit) decides when one shows, from the GameView.
 */
export { Cats } from './Cats';
export {
  DEFAULT_HIT_MS,
  HIT_FADE_IN_MS,
  HIT_FADE_IN_REDUCED_MS,
  HIT_FADE_OUT_MS,
  INTERFERENCE_SCOPE,
  type InterferenceScope,
} from './config';
export type { EffectProps, RegionRect } from './effectProps';
export { Fireworks } from './Fireworks';
export { HitEffect, type HitEffectProps } from './HitEffect';
export { elapsedOf, hitAlpha, type HitTime, remainingOf, useHitClock } from './hitClock';
export { type CatPalette, CAT_PALETTES, type EffectColors, effectColors } from './palette';
export { WarpFrame, type WarpFrameProps, WarpOverlay } from './Warp';
export { catsRumble } from './catsModel';
export { fireworksPlan, fireworksRumble } from './fireworksModel';
export { warpRumble } from './warpModel';
