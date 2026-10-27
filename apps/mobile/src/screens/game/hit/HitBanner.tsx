import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  ReduceMotion,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { AVATAR_REACTIONS, type AvatarIdOrNone } from '../../../avatars';
import { HIT_FADE_OUT_MS } from '../../../components/interference/config';
import { hitAlpha } from '../../../components/interference/hitClock';
import { Avatar } from '../../../components/player';
import { Text } from '../../../components/ui/Text';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { motion } from '../../../theme/motion';

export interface HitBannerProps {
  /** "NinaVolt שלח/ה לך זיקוקים!" */
  title: string;
  /** "זה עלה 2 נק׳ · המשחק ממשיך" */
  subtitle: string;
  /** Whole seconds left, in the ring. */
  seconds: number;
  /** What a screen reader says when it reaches the banner (title, subtitle and the time left). */
  label: string;
  fromAvatar?: AvatarIdOrNone | null;
  /** The sender's seat colour as this phone shows it: the avatar's frame. */
  fromColorIndex: number;
  /** ms into the hit, from its clock: the ring drains with it, and the banner fades out at the end. */
  elapsed: SharedValue<number>;
  totalMs: number;
  reduce: boolean;
  /** Distance from the top of the screen (under the safe area plus 8). */
  top: number;
  testID?: string;
}

/** components.md §15.2: 52 high; the ring 38 with a 3 dp stroke; the banner drops 16 dp in. */
const RING = 38;
const RING_STROKE = 3;
const DROP = space[8];
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const NEVER = ReduceMotion.Never;

/**
 * The banner the hit player sees (spec §7.4; components.md §15.2; motion.md `hit.banner`): the sender's avatar
 * in their seat colour (with the sender's face, a wink: AVATAR_REACTIONS.moods.sender), "NinaVolt שלח/ה לך זיקוקים!", "המשחק ממשיך", and a gold ring counting the 5 s down.
 * It drops in 16 dp with the `settle` spring (reduced motion: a 200 ms fade) and fades out over the effect's
 * last 240 ms, so it is gone at `endsAt` with the effect. The ring is information: it drains with reduced
 * motion too.
 *
 * Above the effect and never touchable (play goes on under it). For screen readers it is one element, an
 * alert, whose label says what happened and how long is left; the hit layer announces its start and end.
 */
export function HitBanner({
  title,
  subtitle,
  seconds,
  label,
  fromAvatar,
  fromColorIndex,
  elapsed,
  totalMs,
  reduce,
  top,
  testID = 'hit-banner',
}: HitBannerProps) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.set(
      reduce
        ? withTiming(1, { duration: motion.duration.reducedFade, reduceMotion: NEVER })
        : withSpring(1, { ...motion.spring.settle, reduceMotion: NEVER }),
    );
  }, [enter, reduce]);

  const motionStyle = useAnimatedStyle(() => {
    const shown = Math.min(1, enter.get());
    const leaving = hitAlpha(elapsed.get(), totalMs, 0, HIT_FADE_OUT_MS);
    return {
      opacity: shown * leaving,
      transform: [{ translateY: reduce ? 0 : (enter.get() - 1) * DROP }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityRole="alert"
      accessibilityLabel={label}
      style={[styles.banner, { top }, motionStyle]}
      testID={testID}
    >
      <Avatar
        avatarId={fromAvatar}
        size="compact"
        colorIndex={fromColorIndex}
        backdrop={color.surface2}
        expression={AVATAR_REACTIONS.moods.sender}
        testID={`${testID}-avatar`}
      />
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={1} testID={`${testID}-title`}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1} testID={`${testID}-subtitle`}>
          {subtitle}
        </Text>
      </View>
      <CountdownRing elapsed={elapsed} totalMs={totalMs} seconds={seconds} testID={`${testID}-ring`} />
    </Animated.View>
  );
}

/** The 5 s ring: a gold arc that drains from 12 o'clock, the seconds in the middle (components.md §15.2). */
function CountdownRing({
  elapsed,
  totalMs,
  seconds,
  testID,
}: {
  elapsed: SharedValue<number>;
  totalMs: number;
  seconds: number;
  testID: string;
}) {
  const r = (RING - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const arc = useAnimatedProps(() => ({
    strokeDashoffset: circumference * Math.min(1, Math.max(0, totalMs > 0 ? elapsed.get() / totalMs : 1)),
  }));
  return (
    <View style={styles.ring} testID={testID}>
      <Svg width={RING} height={RING} style={styles.rotate}>
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={color.border}
          strokeWidth={RING_STROKE}
          fill={color.bg}
        />
        <AnimatedCircle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={color.accent}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arc}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={styles.seconds} testID={`${testID}-seconds`}>
          {String(seconds)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: tokens.layout.gutterGame,
    right: tokens.layout.gutterGame,
    // The least: a taller script may need more, never cut (localization plan 0ט).
    minHeight: size.buttonMd,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    paddingHorizontal: space[5],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
    backgroundColor: color.surface2,
  },
  texts: { flex: 1, minWidth: 0, gap: space[2] },
  title: { ...text('playerName'), color: color.text },
  subtitle: { ...text('micro'), color: color.textMuted },
  ring: { width: RING, height: RING },
  rotate: { transform: [{ rotate: '-90deg' }] },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  seconds: { ...text('scoreSm'), color: color.accent, includeFontPadding: false },
});
