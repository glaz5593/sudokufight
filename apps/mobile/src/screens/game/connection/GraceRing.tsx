import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '../../../components/ui/Text';
import { color, space, text } from '../../../theme';
import { metrics } from './metrics';
import { useDrain, useTick } from './motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface GraceRingProps {
  seconds: number;
  remainingMs: number;
  totalMs: number;
  /** The arc: the disconnected player's ring colour. */
  tint: string;
  /** The word under the number ("שניות"). */
  caption: string;
  reduce: boolean;
  testID?: string;
}

/**
 * Opponent-Reconnecting's countdown ring (motion.md `opp.disconnecting`): the arc starts full at 12 o'clock
 * and shrinks linearly to `graceEndsAt`, the seconds tick in its middle. The ring is information, so it
 * drains with reduced motion too; only the tick loses its scale. Decorative for screen readers: the card
 * around it says the time in words.
 */
export function GraceRing({ seconds, remainingMs, totalMs, tint, caption, reduce, testID }: GraceRingProps) {
  const { size: px, stroke } = metrics.ring;
  const r = (px - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const share = useDrain(remainingMs, totalMs);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - share.get()) }));
  const tick = useTick(seconds, reduce);

  return (
    <View
      style={styles.ring}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Svg width={px} height={px} style={styles.rotate}>
        <Circle cx={px / 2} cy={px / 2} r={r} stroke={color.border} strokeWidth={stroke} fill={color.bg} />
        <AnimatedCircle
          cx={px / 2}
          cy={px / 2}
          r={r}
          stroke={tint}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arc}
        />
      </Svg>
      <View style={styles.center}>
        <Animated.Text style={[styles.seconds, tick]} testID={testID && `${testID}-seconds`}>
          {String(seconds)}
        </Animated.Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { width: metrics.ring.size, height: metrics.ring.size },
  rotate: { transform: [{ rotate: '-90deg' }] },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
  seconds: { ...text('scoreXL'), color: color.text, includeFontPadding: false },
  caption: { ...text('micro'), color: color.textMuted },
});
