import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { color, text } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { Text } from '../ui/Text';
import { easing, NEVER_REDUCE, springs, useBlink } from './anim';
import type { Activity } from './cardModel';
import { ltr } from './format';
import { metrics, paletteAt } from './metrics';
import { TimerRing } from './TimerRing';
import { activityTrails, activityWord, type Gender, mistakesShort } from './wording';

const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

export interface ActivityLineProps {
  activity: Activity;
  colorIndex: number;
  gender?: Gender;
  /** The compact card: a 16-dp ring with the seconds inside, the cell in Teko 17 (§7.2). */
  compact?: boolean;
}

/**
 * What a player is doing (components.md §3.3): "בוחרת · A8" with the lock's timer ring, "מושהה · A8",
 * "חושב…" with a blinking ellipsis, "מתנתק…", "נטש". Silent for screen readers: the card's label says it.
 */
export function ActivityLine({ activity, colorIndex, gender, compact = false }: ActivityLineProps) {
  const { t } = useTranslation('player');
  const reduce = useReduceMotion();
  const trails = activityTrails(activity);
  const blink = useBlink(trails, reduce, motion.loop.statusBlink);
  if (activity.kind === 'idle') return null;

  const word = activityWord(activity, t, gender);
  const lock = activity.kind === 'locking' ? activity : null;
  const wordStyle = compact ? text('plateNameCompact') : text('body');
  const ring = compact ? metrics.timerRing.compact : metrics.timerRing.card;

  return (
    <View style={[styles.row, compact && styles.compactRow]} {...hidden} testID="activity">
      {lock ? (
        <TimerRing
          size={ring}
          tint={paletteAt(colorIndex).ring}
          remainingMs={lock.remainingMs}
          expiresAt={lock.expiresAt}
          totalMs={lock.totalMs}
          seconds={compact ? lock.secondsLeft : null}
          testID="activity-ring"
        />
      ) : null}
      {compact ? (
        <>
          <Text style={[wordStyle, styles.muted]} numberOfLines={1}>
            {word}
          </Text>
          {lock ? <Text style={[metrics.compact.cellStyle, styles.strong]}>{lock.cell}</Text> : null}
        </>
      ) : (
        <Text style={[wordStyle, styles.muted, styles.shrink]} numberOfLines={1}>
          {word}
          {lock ? t('sep') : null}
          {lock ? <Text style={styles.strong}>{ltr(lock.cell)}</Text> : null}
        </Text>
      )}
      {trails ? (
        <Animated.Text style={[wordStyle, styles.muted, blink]}>{t('ellipsis')}</Animated.Text>
      ) : null}
    </View>
  );
}

/**
 * My mistake count on the 2P card ("1 טעות", components.md §3.2). A new mistake pops it (.8 → 1) and turns it
 * red for 600 ms (motion.md `mistakes.tag`); reduced motion keeps the colour and drops the pop.
 */
export function MistakesText({ count }: { count: number }) {
  const { t } = useTranslation('player');
  const reduce = useReduceMotion();
  const scale = useSharedValue(1);
  const red = useSharedValue(0);
  const last = useRef(count);
  useEffect(() => {
    const before = last.current;
    last.current = count;
    if (count <= before) return;
    red.set(1);
    red.set(
      withDelay(
        metrics.mistakeFlashMs,
        withTiming(0, {
          duration: motion.duration.stateChange,
          easing: easing.standard,
          reduceMotion: NEVER_REDUCE,
        }),
      ),
    );
    if (!reduce) {
      scale.set(metrics.mistakePopFrom);
      scale.set(withSpring(1, { ...springs.pop, reduceMotion: NEVER_REDUCE }));
    }
  }, [count, reduce, red, scale]);
  const anim = useAnimatedStyle(() => ({
    color: interpolateColor(red.get(), [0, 1], [color.textMuted, color.danger]),
    transform: [{ scale: scale.get() }],
  }));
  return (
    <Animated.Text
      style={[text('body'), styles.shrink, anim]}
      numberOfLines={1}
      {...hidden}
      testID="mistakes"
    >
      {mistakesShort(count, t)}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: metrics.card.statusGap,
    flexShrink: 1,
    minWidth: 0,
  },
  compactRow: { gap: metrics.compact.activityGap },
  muted: { color: color.textMuted },
  strong: { color: color.text },
  shrink: { flexShrink: 1 },
});
