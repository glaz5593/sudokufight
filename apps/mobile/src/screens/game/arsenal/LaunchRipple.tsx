import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { curve } from '../../../components/ui/motion';
import { color, radius } from '../../../theme';
import type { Rect } from '../geometry';
import { arsenalMetrics as m } from './metrics';

export interface LaunchRippleProps {
  /** The target card's frame, in the overlay's coordinates. */
  zone: Rect;
  /** Reduced motion: no ripple at all; it is done at once. */
  reduce?: boolean;
  onDone: () => void;
}

const RIPPLE_FROM = m.ripple.from;
const RIPPLE_GROW = m.ripple.scale - 1;
const rippleTiming = {
  duration: m.ripple.ms,
  easing: curve('standard'),
  reduceMotion: ReduceMotion.Never,
};

/**
 * A stroke ring that ripples out of the target card as an interference is launched (motion.md `launch`: scale
 * 1 → 1.15, opacity 0.6 → 0, 480 ms). Full motion only (the picker leaves it out under Reduced Motion); never
 * touchable.
 */
export function LaunchRipple({ zone, reduce = false, onDone }: LaunchRippleProps) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      onDone();
      return;
    }
    p.set(
      withTiming(1, rippleTiming, (done) => {
        if (done) scheduleOnRN(onDone);
      }),
    );
  }, [p, reduce, onDone]);
  const style = useAnimatedStyle(() => ({
    opacity: RIPPLE_FROM * (1 - p.get()),
    transform: [{ scale: 1 + RIPPLE_GROW * p.get() }],
  }));
  if (reduce) return null;
  const place = { left: zone.x, top: zone.y, width: zone.width, height: zone.height };
  return <Animated.View style={[styles.ripple, place, style]} pointerEvents="none" testID="arsenal-ripple" />;
}

const styles = StyleSheet.create({
  ripple: {
    position: 'absolute',
    borderRadius: radius.button,
    borderWidth: m.ripple.width,
    borderColor: color.accent,
  },
});
