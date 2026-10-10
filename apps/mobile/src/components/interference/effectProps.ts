import type { SharedValue } from 'react-native-reanimated';

import type { InterferenceScope } from './config';
import type { EffectColors } from './palette';

/** A rect in the region's own coordinates. */
export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What each 5 s effect gets from the hit layer. The effect fills `width` × `height` (the whole screen, or the
 * board [D35]) and reads where it is in its time from `elapsed`, on the UI thread.
 */
export interface EffectProps {
  width: number;
  height: number;
  /** ms into the hit (0 … totalMs), from the game clock (hitClock.ts). */
  elapsed: SharedValue<number>;
  totalMs: number;
  colors: EffectColors;
  /** Reduced motion (spec §22): a static cover of the same area, for the same time. */
  reduce: boolean;
  fadeInMs: number;
  fadeOutMs: number;
  /** What the region is: the whole screen or the board. */
  scope: InterferenceScope;
  /** The board inside the region, when known (the warp's offset copy follows it). */
  board?: RegionRect | null;
  testID?: string;
}
