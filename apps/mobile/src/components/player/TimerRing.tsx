import { memo, useEffect, useEffectEvent } from 'react';
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
import { sameCountdown } from './cardModel';
import { metrics } from './metrics';
import { sameProps } from './sameProps';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const fraction = (remainingMs: number, totalMs: number): number =>
  totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;

/**
 * A countdown's share left, 1 → 0, drained on the UI thread (motion.md §6, "Timers come from the server's
 * clock"): linear over the time left toward `expiresAt`. It starts again only when the deadline changes (a new
 * lock, a resume after a freeze), the total does, or a stopped one's time left does; the screen's re-reads of
 * the time in between change nothing, so React renders nothing for it. Stopped (`expiresAt` null), it stands at
 * the time left. Information, not decoration: the same with reduced motion (motion.md `lock.timer`).
 */
export function useDrain(remainingMs: number, totalMs: number, expiresAt: number | null) {
  const progress = useSharedValue(fraction(remainingMs, totalMs));
  const stoppedAt = expiresAt === null ? remainingMs : null;
  const restart = useEffectEvent(() => {
    cancelAnimation(progress);
    progress.set(fraction(remainingMs, totalMs));
    if (expiresAt !== null && remainingMs > 0) {
      progress.set(
        withTiming(0, { duration: remainingMs, easing: easing.linear, reduceMotion: NEVER_REDUCE }),
      );
    }
  });
  useEffect(() => {
    restart();
  }, [expiresAt, stoppedAt, totalMs]);
  return progress;
}

export interface TimerRingProps {
  size: number;
  /** The arc: the lock holder's ring colour. */
  tint: string;
  /** The time left now: a running ring reads it only when it starts again. */
  remainingMs: number;
  /** When it runs out, in the view's clock; null while it is stopped (the arc stands still). */
  expiresAt: number | null;
  totalMs: number;
  /** The compact card writes the seconds inside the ring. */
  seconds?: number | null;
  testID?: string;
}

/**
 * The small lock timer on a card (components.md §3.3, §7.2): starts full at 12 o'clock and drains linearly
 * over the time left. It is information, so it keeps moving with reduced motion (motion.md `lockTimerRing`).
 *
 * The arc drains on the UI thread (useDrain), and the ring renders only when what it shows changes: the whole
 * seconds inside it, a new deadline, a stop. A 2-player card's ring (no seconds) renders once per lock.
 */
export const TimerRing = memo(function TimerRing({
  size,
  tint,
  remainingMs,
  expiresAt,
  totalMs,
  seconds = null,
  testID,
}: TimerRingProps) {
  const stroke = metrics.timerRing.stroke;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = useDrain(remainingMs, totalMs, expiresAt);
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
}, sameRing);

/**
 * A re-read of the time that changes nothing on the ring skips its render: every prop the same, but a running
 * ring's `remainingMs` (sameCountdown).
 */
function sameRing(a: TimerRingProps, b: TimerRingProps): boolean {
  return sameCountdown(a, b) && sameProps({ ...a, remainingMs: 0 }, { ...b, remainingMs: 0 });
}

const styles = StyleSheet.create({
  rotate: { transform: [{ rotate: '-90deg' }] },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  seconds: { color: color.text },
});
