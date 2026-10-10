import { useMemo } from 'react';
import { type SharedValue, useSharedValue } from 'react-native-reanimated';

import type { Point, Rect } from '../geometry';
import { arsenalMetrics } from './metrics';

/**
 * The drag's live values, shared by the token being dragged (its Pan gesture writes them on the UI thread)
 * and the ghost that follows the finger (reads them in an animated style). Nothing here goes through React
 * while the finger moves: only lift, entering or leaving the zone, and letting go are told to JS.
 *
 * Coordinates: `start`, the translation and `zone` are in the window (the gesture's absoluteX/Y and
 * measureInWindow); `origin` is where the overlay itself sits in the window, to draw the ghost in it.
 */
export interface DragValues {
  /** The finger where the drag started. */
  startX: SharedValue<number>;
  startY: SharedValue<number>;
  /** How far the finger has moved since (then animated: back to 0 on a cancel, to the zone on a launch). */
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  /** The ghost's lift (1 → 1.08), and 0 as it lands in the card. */
  scale: SharedValue<number>;
  /** The ghost's own size, to centre it over the finger. */
  ghostWidth: SharedValue<number>;
  ghostHeight: SharedValue<number>;
  /** The finger is over the zone (only the changes are told to JS). */
  hover: SharedValue<boolean>;
  /** The drop zone, measured in the window; null until measured (then nothing launches). */
  zone: SharedValue<Rect | null>;
  /** The overlay's own place in the window. */
  origin: SharedValue<Point>;
}

/** How far above the finger the ghost floats (a number, so the worklets below capture only it). */
const ABOVE = arsenalMetrics.ghost.aboveFinger;

/** A first guess at the ghost's size, until it has been laid out once. */
const GHOST_GUESS = {
  width: arsenalMetrics.ghost.art * 4,
  height: arsenalMetrics.ghost.art + 2 * arsenalMetrics.ghost.paddingY,
};

/** The drag's values: one stable object for the life of the overlay. */
export function useDragValues(): DragValues {
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const ghostWidth = useSharedValue(GHOST_GUESS.width);
  const ghostHeight = useSharedValue(GHOST_GUESS.height);
  const hover = useSharedValue(false);
  const zone = useSharedValue<Rect | null>(null);
  const origin = useSharedValue<Point>({ x: 0, y: 0 });
  return useMemo(
    () => ({ startX, startY, tx, ty, scale, ghostWidth, ghostHeight, hover, zone, origin }),
    [startX, startY, tx, ty, scale, ghostWidth, ghostHeight, hover, zone, origin],
  );
}

/**
 * Where the ghost's top-left corner goes, in the overlay: centred over the finger and a little above it, so
 * the finger never hides it.
 */
export function ghostOffset(d: DragValues): Point {
  'worklet';
  const origin = d.origin.get();
  return {
    x: d.startX.get() + d.tx.get() - origin.x - d.ghostWidth.get() / 2,
    y: d.startY.get() + d.ty.get() - origin.y - d.ghostHeight.get() - ABOVE,
  };
}

/** The translation that puts the ghost's centre on the zone's centre (where it shrinks into the card). */
export function landingOf(d: DragValues, zone: Rect): Point {
  'worklet';
  return {
    x: zone.x + zone.width / 2 - d.startX.get(),
    y: zone.y + zone.height / 2 - d.startY.get() + d.ghostHeight.get() / 2 + ABOVE,
  };
}
