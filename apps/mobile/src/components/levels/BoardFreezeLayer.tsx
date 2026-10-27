import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { color, radius, space, text } from '../../theme';
import { secondsOf } from '../player/format';
import { TimerRing } from '../player/TimerRing';

import { Text } from '../ui/Text';
/**
 * The race's freeze over the board (components.md §19.7, plan §2.2): after my wrong tap, 3 s with no taps. The
 * board dims under a scrim, and a ring in the middle drains the 3 s (the engine's frozenUntil, in the stage's
 * clock); out of the spot (a second wrong tap on it), it says so until the next spot shows. It takes every
 * touch meanwhile (the engine would refuse them anyway, 'frozen'), and tells a screen reader once.
 *
 * The ring is information, so it drains the same with Reduced Motion (TimerRing, motion.md `lock.timer`); the
 * layer itself comes and goes with no motion.
 */

export interface BoardFreezeLayerProps {
  /** When my taps count again, in the stage's clock; null: not frozen. */
  frozenUntil: number | null;
  /** The freeze's length (FindRules.freezeMs, 3 s). */
  totalMs: number;
  /** The stage's time now. */
  now: number;
  /** Out of the current spot until the next one shows (no timer). */
  out?: boolean;
  testID?: string;
}

/** The ring in the middle of the board. */
const RING = 72;

export const BoardFreezeLayer = memo(function BoardFreezeLayer({
  frozenUntil,
  totalMs,
  now,
  out = false,
  testID = 'board-freeze',
}: BoardFreezeLayerProps) {
  const { t } = useTranslation('levels');
  if (frozenUntil === null && !out) return null;
  const remainingMs = frozenUntil === null ? 0 : Math.max(0, frozenUntil - now);
  const seconds = secondsOf(remainingMs);
  // Said once per freeze (the label changes only with a new freeze or the end of it).
  const label = out ? t('hud.race.out') : t('hud.race.frozen', { count: secondsOf(totalMs) });
  return (
    <View style={styles.scrim} onStartShouldSetResponder={() => true} testID={testID}>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={label}
        style={styles.center}
      >
        {out ? (
          <Text style={styles.out}>{t('hud.race.out')}</Text>
        ) : (
          <View style={styles.ring}>
            <TimerRing
              size={RING}
              tint={color.danger}
              remainingMs={remainingMs}
              expiresAt={frozenUntil}
              totalMs={totalMs}
              testID={`${testID}-ring`}
            />
            <Text style={styles.seconds} testID={`${testID}-seconds`}>
              {seconds}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color.scrim,
    borderRadius: radius.board,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  seconds: { ...text('scoreXL'), position: 'absolute', color: color.text },
  out: {
    ...text('rowTitle'),
    color: color.text,
    textAlign: 'center',
    paddingHorizontal: space[6],
    paddingVertical: space[4],
    borderRadius: radius.md,
    backgroundColor: color.surface2,
  },
});
