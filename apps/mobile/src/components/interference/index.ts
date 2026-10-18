/**
 * The interferences' 5 s effects (spec §7.1, §22; docs/design/motion.md §4.4): fireworks, cats, warp and ink
 * over the hit layer's region, the scramble over the board's digits and the keypad's moving keys [D47], each
 * live or, with reduced motion, as a static cover of the same area for the same time; and the board's dim of
 * every hit [D46]. They are pure pictures: the game screen's hit layers (screens/game/hit) decide when one
 * shows, from the GameView.
 */
export { Cats } from './Cats';
export {
  DEFAULT_HIT_MS,
  HIT_DIM,
  HIT_FADE_IN_MS,
  HIT_FADE_IN_REDUCED_MS,
  HIT_FADE_OUT_MS,
  INK,
  INTERFERENCE_SCOPE,
  type InterferenceScope,
  KEYPAD,
  SCRAMBLE,
} from './config';
export type { EffectProps, RegionRect } from './effectProps';
export { Fireworks } from './Fireworks';
export { HitEffect, type HitEffectProps } from './HitEffect';
export { elapsedOf, hitAlpha, type HitTime, remainingOf, useHitClock } from './hitClock';
export { Ink } from './Ink';
export {
  type CatPalette,
  CAT_PALETTES,
  type EffectColors,
  effectColors,
  HIT_DIM_COLOR,
  solidOf,
} from './palette';
export { Scramble, type ScrambleProps } from './Scramble';
export { WarpFrame, type WarpFrameProps, WarpOverlay } from './Warp';
export { catsRumble } from './catsModel';
export { fireworksPlan, fireworksRumble } from './fireworksModel';
export { inkPlan, inkPose, inkRumble } from './inkModel';
export {
  type KeypadHit,
  keypadOrderAt,
  type KeypadPlan,
  keypadPlan,
  KeypadShuffler,
  NATURAL_ORDER,
  slotOf,
} from './keypadModel';
export {
  type ScrambleCell,
  type ScrambleDraw,
  scrambleDraws,
  type ScramblePlan,
  scramblePlan,
} from './scrambleModel';
export { warpRumble } from './warpModel';
