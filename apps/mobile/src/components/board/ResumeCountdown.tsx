import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { color, space, text } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { POP_FROM, springs, timing } from './animation';

/**
 * [D65] The cover of a game frozen because the app left the foreground (a phone call, another app, the screen
 * off): opaque over the board, so the freeze gives no time to think. While the app is away it says the game
 * stands still; back, it counts "3", "2", "1" (a live region reads each number), and the screen takes it away
 * as the game goes on from the very same point.
 *
 * Motion (`resume.countdown`): each number pops in (scale 0.6 → 1 with the `pop` spring, a 140 ms fade).
 * Reduced Motion: the number just changes, nothing animated (no scale, no fade). It takes every touch, so
 * nothing under it can be pressed meanwhile. Reusable by any local game (1.0.2: the stages; solo and bot
 * practice after them).
 */

export type ResumeCover = { kind: 'paused' } | { kind: 'countdown'; count: number };

export interface ResumeCountdownProps {
  /** What to show; null: no cover. */
  state: ResumeCover | null;
  testID?: string;
}

export function ResumeCountdown({ state, testID = 'resume-countdown' }: ResumeCountdownProps) {
  const { t } = useTranslation('board');
  const reduce = useReduceMotion();
  if (!state) return null;
  const counting = state.kind === 'countdown';
  const label = counting ? t('resume.label', { count: state.count }) : t('resume.paused');
  return (
    <View style={styles.cover} accessibilityViewIsModal testID={testID}>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={label}
        style={styles.content}
        testID={`${testID}-content`}
      >
        <Text style={styles.title}>{counting ? t('resume.title') : t('resume.paused')}</Text>
        {counting ? (
          reduce ? (
            <Text style={styles.number} testID={`${testID}-number`}>
              {state.count}
            </Text>
          ) : (
            <PoppingNumber key={state.count} count={state.count} testID={`${testID}-number`} />
          )
        ) : null}
      </View>
    </View>
  );
}

/** A number that pops in as it comes (full motion only: under Reduced Motion the plain number is drawn). */
function PoppingNumber({ count, testID }: { count: number; testID: string }) {
  const scale = useSharedValue(POP_FROM);
  const opacity = useSharedValue(0);
  useEffect(() => {
    scale.set(withSpring(1, springs.pop));
    opacity.set(withTiming(1, timing(motion.duration.tapFeedbackMax)));
  }, [scale, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));
  return (
    <Animated.View style={style} testID={`${testID}-animated`}>
      <Text style={styles.number} testID={testID}>
        {count}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { alignItems: 'center', gap: space[6] },
  title: { ...text('h1'), color: color.textMuted, textAlign: 'center' },
  number: { ...text('scoreXL'), color: color.accent, textAlign: 'center' },
});
