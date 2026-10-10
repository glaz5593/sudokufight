import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { radius, size, tokens } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';

export interface SpinnerProps {
  /** Outer diameter in dp. */
  size?: number;
  /** Ring width in dp. */
  stroke?: number;
  /** Color of the moving arc; the track is the same color, faded. */
  color: string;
  testID?: string;
}

/**
 * The loading ring of components.md §1 (motion.md `spinner`): a faint track with one arc that turns every 800 ms,
 * linearly. Decorative: the button around it says "…, טוען" and sets `busy`. Reduced motion: the ring stands still.
 */
export function Spinner({
  size: px = size.icon.header,
  stroke = size.iconStroke,
  color,
  testID,
}: SpinnerProps) {
  const reduce = useReduceMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      cancelAnimation(turn);
      turn.set(0);
      return;
    }
    turn.set(
      withRepeat(
        withTiming(1, {
          duration: motion.loop.spinner,
          easing: Easing.linear,
          reduceMotion: reduceMotionFlag(false),
        }),
        -1,
      ),
    );
    return () => cancelAnimation(turn);
  }, [reduce, turn]);

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  const ring = { width: px, height: px, borderRadius: radius.pill, borderWidth: stroke };

  return (
    <View
      style={{ width: px, height: px }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <View
        style={[StyleSheet.absoluteFill, ring, { borderColor: color, opacity: tokens.opacity.iconBadgeFill }]}
      />
      <Animated.View style={[StyleSheet.absoluteFill, ring, styles.arc, { borderTopColor: color }, spin]} />
    </View>
  );
}

const styles = StyleSheet.create({
  arc: {
    borderColor: 'transparent',
  },
});
