import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { Icon } from '../../../components/Icon';
import { paletteAt } from '../../../components/player/metrics';
import { type Gender, secondsText } from '../../../components/player/wording';
import { Spinner } from '../../../components/ui/Spinner';
import { Text } from '../../../components/ui/Text';
import { cue } from '../../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import { formatClock } from '../model';
import { Announcer } from './Announcer';
import { ConnectionIcon } from './ConnectionIcon';
import type { OpponentReconnectingModel } from './connectionModel';
import { GraceRing } from './GraceRing';
import { metrics } from './metrics';
import { useEnter, usePulse } from './motion';
import { useHeldOverlay } from './useHeld';
import { about, nameOf, sentences } from './wording';

export interface OpponentReconnectingProps {
  /** The model while the engine keeps the game frozen for an opponent; null hides it (with a fade). */
  model: OpponentReconnectingModel | null;
  /** The opponent's grammatical gender, for the Hebrew verbs ("איבדה חיבור"). */
  gender?: Gender;
  /** Where the freeze begins in the container: the cards above it stay in view ("מתנתק…" on theirs). */
  top?: number;
  /** Room under the footer (the safe area). */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The game frozen for a disconnected opponent (spec §16.2; design Opponent-Reconnecting, in C's calm look;
 * motion.md `opp.disconnecting`). Over the board and the keypad: "המשחק מוקפא · כל הטיימרים עצורים", a card
 * with "NinaVolt איבד חיבור", "היריב מתנתק…", the ring counting down to the server's graceEndsAt with
 * "Reconnecting... 15", "המשחק נשמר בשרת", and under it what happens if the time runs out ("ניצחון בנטישה
 * בעוד 0:15"). When it does, it waits for the server's word ("בודקים מול השרת…"); the abandonment itself
 * arrives as the game's end ("the opponent left").
 *
 * Takes every touch while shown (the board is frozen), and is modal for screen readers: the card is one alert
 * whose label says who, the freeze and the time left; the change is announced once, not each second. With
 * reduced motion the card only fades and nothing blinks; the ring still drains (it is information).
 */
export function OpponentReconnecting({
  model,
  gender,
  top = 0,
  bottomInset = 0,
  style,
  testID = 'opponent-reconnecting',
}: OpponentReconnectingProps) {
  const { t } = useTranslation('game');
  const { t: tp } = useTranslation('player');
  const reduce = useReduceMotion();
  const { mounted, shown, progress, leaving } = useHeldOverlay(model, reduce);
  const fade = useAnimatedStyle(() => ({ opacity: progress.get() }));

  // A warning cue as an opponent drops (motion.md §7), once per disconnection.
  const cued = useRef<string | null>(null);
  const awayId = model?.playerId ?? null;
  useEffect(() => {
    if (awayId !== null && cued.current !== awayId) cue('disconnect');
    cued.current = awayId;
  }, [awayId]);

  if (!mounted || !shown) return null;
  const m = shown;
  const name = nameOf(m.name, t);
  const ctx = about(gender);
  const lost = t('connection.opponent.lost', { name, ...ctx });
  const time = secondsText(m.secondsLeft, tp);
  const label = m.expired
    ? sentences(
        [
          t('connection.opponent.timeUp'),
          t('connection.opponent.notBack', { name, ...ctx }),
          t('connection.opponent.checking'),
        ],
        t,
      )
    : sentences(
        [
          lost,
          t('connection.frozen.label'),
          t('connection.opponent.timeLeft', { time }),
          t('connection.opponent.hint', { name, ...ctx }),
        ],
        t,
      );
  const announcement = leaving
    ? null
    : m.expired
      ? t('connection.opponent.announceExpired')
      : t('connection.opponent.announce', { name, ...ctx });

  return (
    <Animated.View
      style={[styles.root, { top }, fade, style]}
      pointerEvents={leaving ? 'none' : 'auto'}
      accessibilityViewIsModal
      testID={testID}
    >
      <View style={styles.scrim} />
      <FrozenBadge style={styles.badge} testID={`${testID}-frozen`} />
      <View style={styles.middle}>
        <Card
          model={m}
          lost={lost}
          title={
            m.expired ? t('connection.opponent.notBack', { name, ...ctx }) : t('connection.opponent.title')
          }
          label={label}
          reduce={reduce}
          testID={`${testID}-card`}
        />
      </View>
      <View
        style={[styles.footer, { paddingBottom: bottomInset + space[6] }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.winPill} testID={`${testID}-win`}>
          {m.expired ? (
            <>
              <Spinner color={color.textMuted} size={size.icon.inline} />
              <Text style={styles.winText}>{t('connection.opponent.checking')}</Text>
            </>
          ) : (
            <>
              <Icon name="lock" size={size.icon.inline} color={color.textMuted} />
              <Text style={styles.winText}>{t('connection.opponent.winLabel')}</Text>
              <View style={styles.timeChip}>
                <Text style={styles.timeText} testID={`${testID}-clock`}>
                  {formatClock(m.secondsLeft * 1000)}
                </Text>
              </View>
            </>
          )}
        </View>
        {m.expired ? null : (
          <Text style={styles.hint} testID={`${testID}-hint`}>
            {t('connection.opponent.hint', { name, ...ctx })}
          </Text>
        )}
      </View>
      <Announcer line={announcement} testID={`${testID}-live`} />
    </Animated.View>
  );
}

function Card({
  model: m,
  lost,
  title,
  label,
  reduce,
  testID,
}: {
  model: OpponentReconnectingModel;
  lost: string;
  title: string;
  label: string;
  reduce: boolean;
  testID: string;
}) {
  const { t } = useTranslation('game');
  const enter = useEnter(reduce, 'scale');
  const pulse = usePulse(!m.expired, reduce);
  return (
    <Animated.View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={label}
      style={[styles.card, m.expired && styles.cardExpired, enter]}
      testID={testID}
    >
      <View style={styles.labelRow}>
        <Animated.View style={pulse} testID={`${testID}-pulse`}>
          <Icon name="wifiOff" size={size.icon.inline} color={color.textMuted} />
        </Animated.View>
        <Text style={styles.label} numberOfLines={1}>
          {m.expired ? t('connection.opponent.timeUp') : lost}
        </Text>
      </View>
      <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
        {title}
      </Text>
      <GraceRing
        seconds={m.secondsLeft}
        remainingMs={m.remainingMs}
        totalMs={m.graceMs}
        tint={paletteAt(m.colorIndex).ring}
        caption={t('connection.opponent.seconds')}
        reduce={reduce}
        testID={`${testID}-ring`}
      />
      <Text style={styles.ringCaption} testID={`${testID}-reconnecting`}>
        {t('connection.opponent.ring', { seconds: m.secondsLeft })}
      </Text>
      <View style={styles.saved}>
        <ConnectionIcon name="server" size={size.icon.card} color={color.success} />
        <View style={styles.savedTexts}>
          <Text style={styles.savedTitle}>{t('connection.opponent.saved')}</Text>
          <Text style={styles.savedSub}>{t('connection.opponent.savedSub')}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

export interface FrozenBadgeProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * "המשחק מוקפא · כל הטיימרים עצורים" (spec §16.2), with the pause glyph the stopped lock timers use
 * (components.md §10). One element for screen readers.
 */
export function FrozenBadge({ style, testID = 'frozen-badge' }: FrozenBadgeProps) {
  const { t } = useTranslation('game');
  return (
    <View
      accessible
      accessibilityLabel={t('connection.frozen.label')}
      style={[styles.frozen, style]}
      testID={testID}
    >
      <Icon name="pause" size={size.icon.inline - space[2]} color={color.text} />
      <Text style={styles.frozenTitle}>{t('connection.frozen.title')}</Text>
      <View style={styles.frozenDot} />
      <Text style={styles.frozenTimers}>{t('connection.frozen.timers')}</Text>
    </View>
  );
}

const gutter = tokens.layout.gutterGame;

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: color.scrim },
  badge: { marginTop: space[4], marginHorizontal: gutter, alignSelf: 'flex-start' },
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: gutter,
  },
  card: {
    width: '100%',
    maxWidth: metrics.cardMaxWidth,
    alignItems: 'center',
    gap: space[4],
    padding: space[9],
    borderRadius: radius.xxl,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  cardExpired: { borderColor: color.accent },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  label: { ...text('micro'), color: color.textMuted },
  title: { ...text('h1'), color: color.text, textAlign: 'center' },
  ringCaption: { ...text('scoreSm'), color: color.textMuted, writingDirection: 'ltr' },
  saved: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    padding: space[5],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.iconBg.success,
  },
  savedTexts: { flex: 1, minWidth: 0, gap: space[2] },
  savedTitle: { ...text('label'), color: color.text },
  savedSub: { ...text('caption'), color: color.textMuted },
  footer: { paddingHorizontal: gutter, gap: space[4] },
  winPill: {
    height: size.buttonMd,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  winText: { ...text('button'), color: color.textMuted },
  timeChip: {
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  timeText: { ...text('scoreSm'), color: color.text, writingDirection: 'ltr' },
  hint: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  frozen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    height: size.toastIcon + space[1],
    paddingHorizontal: space[5],
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.textMuted,
    backgroundColor: color.surface2,
  },
  frozenTitle: { ...text('label'), color: color.text },
  frozenDot: {
    width: space[2],
    height: space[2],
    borderRadius: radius.pill,
    backgroundColor: color.textMuted,
  },
  frozenTimers: { ...text('caption'), color: color.textMuted },
});
