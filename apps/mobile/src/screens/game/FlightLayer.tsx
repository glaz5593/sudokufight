import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type WithTimingConfig,
} from 'react-native-reanimated';

import { color, radius, space, text } from '../../theme';
import { motion } from '../../theme/motion';
import type { Point } from './geometry';
import type { MoveTimeline } from './model';

/**
 * The flights of the score chips (motion.md §4.2 `points.chip` / `points.flight`, §4.3 `penalty.flight`): a dark
 * chip with "+3.5" in the mover's colour (or "−2" in red) pops over the cell, then travels on a quadratic arc to
 * the delta slot beside the score, shrinking to .85, and hands over to the delta label as it lands.
 *
 * One layer above the board, never touchable, hidden from screen readers (the live region says the move). Each
 * chip runs on the UI thread: one progress value, the arc computed in a worklet, no React render per frame.
 * The screen mounts chips only with full motion; reduced motion shows the delta beside the score instead.
 */

export interface Flight {
  /** The move's event seq. */
  id: number;
  from: Point;
  to: Point;
  /** "+3.5" / "−2", already an LTR isolate. */
  label: string;
  tone: 'gain' | 'penalty';
  /** The mover's ring colour, for a gain. */
  tint: string;
  timeline: MoveTimeline;
}

/** The box a chip is centred in: wider and taller than any "+13.5" chip. */
const SLOT = { width: space[15] + space[10], height: space[12] };
/** The arc's control point sits 60 dp above the higher end (motion.md `points.flight`). */
export const ARC_LIFT = space[15] + space[2];
/** The chip pops 0.8 → 1.15 → 1 (motion.md `points.chip`) and lands at .85 of its size. */
const POP_FROM = 0.8;
const POP_PEAK = 1.15;
const LAND_SCALE = 0.85;

type Curve = readonly [number, number, number, number];
const bezier = ([x1, y1, x2, y2]: Curve) => Easing.bezier(x1, y1, x2, y2);
/** The reduced variant is chosen by the screen (it mounts no chip), so Reanimated must not shorten these. */
const timing = (duration: number, curve: Curve = motion.easing.standard): WithTimingConfig => ({
  duration,
  easing: bezier(curve),
  reduceMotion: ReduceMotion.Never,
});
const pop = { ...motion.spring.pop, reduceMotion: ReduceMotion.Never };

export interface FlightLayerProps {
  flights: readonly Flight[];
}

export function FlightLayer({ flights }: FlightLayerProps) {
  return (
    <View
      pointerEvents="none"
      style={styles.layer}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="flight-layer"
    >
      {flights.map((f) => (
        <FlightChip key={f.id} flight={f} />
      ))}
    </View>
  );
}

function FlightChip({ flight }: { flight: Flight }) {
  const { appearAt, flyAt, landAt } = flight.timeline;
  const x0 = flight.from.x;
  const y0 = flight.from.y;
  const x1 = flight.to.x;
  const y1 = flight.to.y;
  const cx = (x0 + x1) / 2;
  const cy = Math.min(y0, y1) - ARC_LIFT;

  const progress = useSharedValue(0);
  const scale = useSharedValue(POP_FROM);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const quick = motion.duration.tapFeedbackMin;
    // Shows, then fades out over the last moment of the flight, as the delta label appears in its place.
    opacity.set(
      withDelay(
        appearAt,
        withSequence(
          withTiming(1, timing(quick)),
          withDelay(
            Math.max(0, landAt - appearAt - 2 * quick),
            withTiming(0, timing(quick, motion.easing.exit)),
          ),
        ),
      ),
    );
    scale.set(withDelay(appearAt, withSequence(withTiming(POP_PEAK, timing(quick)), withSpring(1, pop))));
    progress.set(withDelay(flyAt, withTiming(1, timing(landAt - flyAt))));
  }, [appearAt, flyAt, landAt, opacity, scale, progress]);

  const style = useAnimatedStyle(() => {
    const t = progress.get();
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    return {
      opacity: opacity.get(),
      transform: [
        { translateX: x - SLOT.width / 2 },
        { translateY: y - SLOT.height / 2 },
        { scale: scale.get() * (1 - (1 - LAND_SCALE) * t) },
      ],
    };
  });

  const fg = flight.tone === 'gain' ? flight.tint : color.danger;
  return (
    <Animated.View style={[styles.slot, style]} testID={`flight-${flight.id}`}>
      <View style={styles.chip}>
        <Text style={[text('scoreDelta'), styles.label, { color: fg }]}>{flight.label}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // LTR, so `left` and translateX are physical: the rects come from onLayout, which is physical too.
  layer: { ...StyleSheet.absoluteFill, direction: 'ltr' },
  slot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SLOT.width,
    height: SLOT.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    backgroundColor: color.bg,
    borderRadius: radius.badge,
    paddingHorizontal: space[3],
    paddingTop: space[2],
    paddingBottom: space[1],
  },
  // Teko is centred by line height, not by Android's font padding (components.md §0.4).
  label: { includeFontPadding: false },
});
