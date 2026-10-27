import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  I18nManager,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { color, radius, size, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { Icon } from '../Icon';
import { Text } from '../ui/Text';
import { useBlink, useShake } from './anim';
import { type LockStripModel, sameCountdown } from './cardModel';
import { metrics, paletteAt } from './metrics';
import { sameData, sameProps, sameStyle } from './sameProps';
import { useDrain } from './TimerRing';
import { lockStripLabel, type PlayerT } from './wording';

export interface LockStripProps {
  model: LockStripModel;
  /** Bump it when a digit is pressed without a lock: "בחר משבצת" shakes once (motion.md `hint.nudge`). */
  nudgeKey?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ME = paletteAt(0);
const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * My lock's strip (components.md §10): "המשבצת שלך F8 · 7 שניות" and a 96 × 4 bar that drains from the start
 * edge. Gold and blinking in the last 3 seconds (still gold, no blink, with reduced motion), muted and frozen
 * while paused, "בחר משבצת" without a lock. Screen readers hear it on lock, at 3 seconds and on release, never
 * every second.
 *
 * The bar drains on the UI thread toward the lock's deadline (useDrain), and the strip renders only when what
 * it shows changes: the whole seconds, the lock, a stop, the last 3 seconds. The screen's 4 re-reads of the
 * time a second skip it.
 */
export const LockStrip = memo(function LockStrip({ model, nudgeKey, style, testID }: LockStripProps) {
  const { t } = useTranslation('player');
  const reduce = useReduceMotion();
  const locked = model.kind === 'locked' ? model : null;
  const urgent = !!locked?.urgent;
  const paused = !!locked?.paused;
  const blink = useBlink(urgent, reduce, motion.loop.lockUrgentBlink);
  const nudge = useShake(nudgeKey, reduce);
  useAnnouncements(model, t);

  // The bar: scaleX from the start edge, linear over the time left; frozen while paused.
  const progress = useDrain(locked?.remainingMs ?? 0, locked?.totalMs ?? 0, locked?.expiresAt ?? null);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

  const label = lockStripLabel(model, t);

  if (!locked) {
    const pickColor = nudge.flash ? color.text : color.textMuted;
    return (
      <View
        style={[styles.strip, style]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={label}
        testID={testID}
      >
        <Animated.View style={[styles.group, styles.pick, nudge.style]}>
          <Icon name="target" size={metrics.lockStrip.pickIcon} color={pickColor} />
          <Text style={[text('status'), { color: pickColor }]}>{t('lock.pick')}</Text>
        </Animated.View>
      </View>
    );
  }

  const tail = paused ? t('lock.paused') : t('seconds', { count: locked.secondsLeft });
  const fillColor = paused ? color.textMuted : urgent ? color.progress.timerWarning : ME.ring;

  return (
    <View style={[styles.strip, style]} testID={testID}>
      <View style={styles.group} accessible accessibilityRole="text" accessibilityLabel={label}>
        {paused ? <PauseGlyph /> : null}
        <Text style={[text('status'), styles.muted]} {...hidden}>
          {t('lock.yourCell')}
        </Text>
        <Text style={[text('cellRef'), { color: ME.ring }]} {...hidden}>
          {locked.cell}
        </Text>
        <Text style={[text('status'), styles.dot]} {...hidden}>
          {t('dot')}
        </Text>
        <Animated.Text
          style={[
            text('status'),
            { color: paused ? color.textMuted : urgent ? color.accent : color.text },
            blink,
          ]}
          {...hidden}
          testID={testID ? `${testID}-seconds` : undefined}
        >
          {tail}
        </Animated.Text>
      </View>
      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('lock.progress', { cell: locked.cell })}
        accessibilityValue={{ min: 0, max: Math.round(locked.totalMs / 1000), now: locked.secondsLeft }}
      >
        <Animated.View
          style={[styles.fill, { backgroundColor: fillColor }, fill, urgent ? blink : null]}
          testID={testID ? `${testID}-bar` : undefined}
        />
      </View>
    </View>
  );
}, sameStrip);

/** A re-read of the time that changes nothing on the strip skips its render (the bar drains by itself). */
function sameStrip(a: LockStripProps, b: LockStripProps): boolean {
  return sameProps(a, b, { model: sameLock, style: sameStyle });
}

/** The same lock as drawn: every field, but a running lock's `remainingMs` (sameCountdown). */
function sameLock(a: LockStripModel, b: LockStripModel): boolean {
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind;
  return sameCountdown(a, b) && sameData({ ...a, remainingMs: 0 }, { ...b, remainingMs: 0 });
}

/** Lock, the 3-second mark and release, each said once (components.md §10). */
function useAnnouncements(model: LockStripModel, t: PlayerT) {
  const cell = model.kind === 'locked' ? model.cell : null;
  const urgent = model.kind === 'locked' && model.urgent;
  const lockLine = lockStripLabel(model, t);
  const urgentLine = model.kind === 'locked' ? t('lock.remaining', { count: model.secondsLeft }) : '';
  const prevCell = useRef(cell);
  const prevUrgent = useRef(urgent);
  useEffect(() => {
    if (cell !== prevCell.current) {
      AccessibilityInfo.announceForAccessibility(cell ? lockLine : t('lock.released'));
    } else if (urgent && !prevUrgent.current) {
      AccessibilityInfo.announceForAccessibility(urgentLine);
    }
    prevCell.current = cell;
    prevUrgent.current = urgent;
  }, [cell, urgent, lockLine, urgentLine, t]);
}

/** Two 2 × 7 bars, the pause mark of components.md §11.3 #10. */
function PauseGlyph() {
  return (
    <View style={styles.pause} {...hidden}>
      <View style={styles.pauseBar} />
      <View style={styles.pauseBar} />
    </View>
  );
}

const row = tokens.layout.game.lockStatusRow;

const styles = StyleSheet.create({
  strip: {
    height: metrics.lockStrip.height,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: row.gap,
  },
  group: { flexDirection: 'row', alignItems: 'baseline', gap: row.innerGap, flexShrink: 1 },
  // "בחר משבצת" with its target icon: an icon has no baseline, so this row centres.
  pick: { alignItems: 'center' },
  muted: { color: color.textMuted },
  dot: { color: color.iconFaint },
  track: {
    width: size.lockTimerBar.width,
    height: size.lockTimerBar.height,
    borderRadius: radius.bar,
    backgroundColor: color.progress.timerTrack,
    overflow: 'hidden',
  },
  fill: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.bar,
    transformOrigin: I18nManager.isRTL ? 'right' : 'left',
  },
  pause: { flexDirection: 'row', gap: metrics.lockStrip.pauseGap, alignSelf: 'center' },
  pauseBar: {
    width: metrics.lockStrip.pauseBarWidth,
    height: metrics.lockStrip.pauseBarHeight,
    borderRadius: radius.bar / 2,
    backgroundColor: color.textMuted,
  },
});
