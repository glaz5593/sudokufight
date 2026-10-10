import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { color } from '../../theme';
import { easing, NEVER_REDUCE } from './anim';
import { metrics } from './metrics';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface TimerRingProps {
  size: number;
  /** The arc: the lock holder's ring colour. */
  tint: string;
  remainingMs: number;
  totalMs: number;
  /** A stopped timer keeps its arc still. */
  paused: boolean;
  /** The compact card writes the seconds inside the ring. */
  seconds?: number | null;
  testID?: string;
}

/**
 * The small lock timer on a card (components.md §3.3, §7.2): starts full at 12 o'clock and drains linearly
 * over the time left. It is information, so it keeps moving with reduced motion (motion.md `lockTimerRing`).
 */
export function TimerRing({
  size,
  tint,
  remainingMs,
  totalMs,
  paused,
  seconds = null,
  testID,
}: TimerRingProps) {
  const stroke = metrics.timerRing.stroke;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = useSharedValue(totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0);

  useEffect(() => {
    const start = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
    cancelAnimation(progress);
    progress.set(start);
    if (!paused && remainingMs > 0) {
      progress.set(
        withTiming(0, { duration: remainingMs, easing: easing.linear, reduceMotion: NEVER_REDUCE }),
      );
    }
  }, [remainingMs, totalMs, paused, progress]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.get()) }));

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Svg width={size} height={size} style={styles.rotate}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.border} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tint}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
        />
      </Svg>
      {seconds === null ? null : (
        <View style={styles.center}>
          <Text style={[metrics.timerRing.secondsStyle, styles.seconds]}>{String(seconds)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rotate: { transform: [{ rotate: '-90deg' }] },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  seconds: { color: color.text },
});
