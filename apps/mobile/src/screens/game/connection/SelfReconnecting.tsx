import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../../components/Icon';
import { Spinner } from '../../../components/ui/Spinner';
import { usePresence } from '../../../components/ui/motion';
import { Text } from '../../../components/ui/Text';
import { cue } from '../../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { motion, useReduceMotion } from '../../../theme/motion';
import { Announcer } from './Announcer';
import type { SelfReconnectingModel, SyncItem } from './connectionModel';
import { metrics } from './metrics';
import { useDrain, useEnter, usePulse, useTick } from './motion';
import { useHeldOverlay } from './useHeld';
import { MARK, sentences, splitMarked } from './wording';

/** From this many seconds left, the screen reader hears that time is short (once). */
export const HURRY_SECONDS = 5;

export interface SelfReconnectingProps {
  /** The model while my connection is lost or just back; null hides it (with a fade). */
  model: SelfReconnectingModel | null;
  /** The safe areas: the banner goes under the top one, the timer above the bottom one. Default: the device's. */
  topInset?: number;
  bottomInset?: number;
  testID?: string;
}

/**
 * My connection is lost (spec §16.2: "החיבור שלך אבד · מתחבר מחדש… ניסיון 2", the board locked; design
 * Self-Reconnecting in C's look; motion.md `self.lost`, `reconnected`). Over the whole game screen:
 * - a banner at the top: lost (gold, the host's attempt), back and syncing, or all synced (green);
 * - while lost or syncing, the screen dims and takes no touch, and a card says "הלוח נעול עד שתחזור" with what
 *   the reconnection brings back (board, scores, locks or turn, timers);
 * - at the bottom, the time left before it counts as abandonment, with a draining bar ("יש לך עוד 11 שניות
 *   לחזור"), or "חזרת בזמן" once back.
 * When synced only the banner stays, touch-through, until the model ends; then everything fades out.
 *
 * Screen readers: modal while it blocks; each state is announced once (lost with the attempt, short of time,
 * back, synced). Reduced motion: fades only, static dots; the bar still drains (it is information).
 */
export function SelfReconnecting({
  model,
  topInset,
  bottomInset,
  testID = 'self-reconnecting',
}: SelfReconnectingProps) {
  const { t } = useTranslation('game');
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const { mounted, shown, progress, leaving } = useHeldOverlay(model, reduce);
  const fade = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const blocking = !!model && model.phase !== 'synced';
  const lock = usePresence(blocking, {
    inMs: motion.duration.stateChange,
    outMs: motion.duration.stateChange,
    reduce,
  });

  // A warning as the connection drops, two rising tones when it is all back (motion.md §7, §8).
  const phase = model?.phase ?? null;
  const lastPhase = useRef<SelfReconnectingModel['phase'] | null>(null);
  useEffect(() => {
    if (phase === 'lost' && lastPhase.current !== 'lost') cue('disconnect');
    if (phase === 'synced' && lastPhase.current !== 'synced') cue('reconnect');
    lastPhase.current = phase;
  }, [phase]);

  if (!mounted || !shown) return null;
  const m = shown;
  const top = (topInset ?? insets.top) + space[4];
  const bottom = (bottomInset ?? insets.bottom) + space[6];

  const announcement = leaving
    ? null
    : m.phase === 'lost'
      ? m.secondsLeft !== null && m.secondsLeft <= HURRY_SECONDS
        ? t('connection.self.announceHurry', { count: HURRY_SECONDS, seconds: HURRY_SECONDS })
        : m.attempt !== null
          ? t('connection.self.announceAttempt', { attempt: m.attempt })
          : t('connection.self.announceLost')
      : m.phase === 'syncing'
        ? t('connection.self.announceSyncing')
        : t('connection.self.announceSynced');

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, fade]}
      pointerEvents={blocking ? 'auto' : 'none'}
      accessibilityViewIsModal={blocking}
      testID={testID}
    >
      {lock.mounted ? (
        <LockLayer model={m} progress={lock.progress} bottom={bottom} reduce={reduce} testID={testID} />
      ) : null}
      <Banner model={m} top={top} reduce={reduce} testID={`${testID}-banner`} />
      <Announcer line={announcement} testID={`${testID}-live`} />
    </Animated.View>
  );
}

/** The top banner (Self-Reconnecting's status row). */
function Banner({
  model: m,
  top,
  reduce,
  testID,
}: {
  model: SelfReconnectingModel;
  top: number;
  reduce: boolean;
  testID: string;
}) {
  const { t } = useTranslation('game');
  const enter = useEnter(reduce, 'drop');
  const lost = m.phase === 'lost';
  const title = lost ? t('connection.self.lostTitle') : t('connection.self.backTitle');
  const sub = lost
    ? t('connection.self.lostSub')
    : m.phase === 'syncing'
      ? t('connection.self.syncingSub')
      : t('connection.self.syncedSub');
  const attempt = lost ? m.attempt : null;
  const label = sentences(
    [title, sub, attempt !== null && t('connection.self.attemptLabel', { attempt })],
    t,
  );
  const tint = lost ? color.accent : color.success;
  return (
    <Animated.View
      accessible
      accessibilityLabel={label}
      style={[styles.banner, { top, borderColor: tint }, enter]}
      testID={testID}
    >
      <View
        style={[styles.bannerIcon, { backgroundColor: lost ? color.iconBg.warning : color.iconBg.success }]}
      >
        {lost ? (
          <Spinner color={tint} size={size.icon.inline} stroke={tokens.border.lockRing} />
        ) : (
          <Icon name="check" size={size.icon.inline} color={tint} />
        )}
      </View>
      <View style={styles.bannerTexts}>
        <Text style={styles.bannerTitle} numberOfLines={1} testID={`${testID}-title`}>
          {title}
        </Text>
        <Text style={styles.bannerSub} numberOfLines={1} testID={`${testID}-sub`}>
          {sub}
        </Text>
      </View>
      {attempt !== null ? <Attempt attempt={attempt} reduce={reduce} testID={`${testID}-attempt`} /> : null}
    </Animated.View>
  );
}

function Attempt({ attempt, reduce, testID }: { attempt: number; reduce: boolean; testID: string }) {
  const { t } = useTranslation('game');
  const tick = useTick(attempt, reduce);
  return (
    <View style={styles.attempt} testID={testID}>
      <Text style={styles.attemptWord}>{t('connection.self.attempt')}</Text>
      <Animated.Text style={[styles.attemptNumber, tick]}>{String(attempt)}</Animated.Text>
    </View>
  );
}

/** The dimmed, locked game: the scrim that takes the touches, the lock card and the timer. */
function LockLayer({
  model: m,
  progress,
  bottom,
  reduce,
  testID,
}: {
  model: SelfReconnectingModel;
  progress: SharedValue<number>;
  bottom: number;
  reduce: boolean;
  testID: string;
}) {
  const fade = useAnimatedStyle(() => ({ opacity: progress.get() }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, fade]} testID={`${testID}-lock`}>
      <View style={styles.scrim} testID={`${testID}-scrim`} />
      <View style={styles.middle}>
        <LockCard model={m} reduce={reduce} testID={`${testID}-card`} />
      </View>
      {m.phase === 'lost' && m.secondsLeft === null ? null : (
        <View style={[styles.timerSlot, { bottom }]}>
          <Timer model={m} testID={`${testID}-timer`} />
        </View>
      )}
    </Animated.View>
  );
}

function LockCard({
  model: m,
  reduce,
  testID,
}: {
  model: SelfReconnectingModel;
  reduce: boolean;
  testID: string;
}) {
  const { t } = useTranslation('game');
  const lost = m.phase === 'lost';
  const done = m.phase === 'synced';
  // Self-Reconnecting: "הלוח נעול עד שתחזור", then "מסנכרן…", then "הכל סונכרן" as the card fades out.
  const title = lost
    ? t('connection.self.lockedTitle')
    : done
      ? t('connection.self.syncedTitle')
      : t('connection.self.syncingTitle');
  const sub = lost ? t('connection.self.lockedSub') : t('connection.self.savedSub');
  const items = m.syncItems.map((item) => t(`connection.self.item.${item}`));
  const label = sentences([title, sub, items.join(t('listSep'))], t);
  const tint = lost ? color.textMuted : color.success;
  return (
    <View style={styles.cardWrap}>
      <View style={[styles.lockBadge, { borderColor: tint }]}>
        <Icon name={lost ? 'lock' : 'check'} size={size.icon.header} color={lost ? color.text : tint} />
      </View>
      <View
        accessible
        accessibilityLabel={label}
        style={[styles.card, !lost && styles.cardBack]}
        testID={testID}
      >
        <Text style={styles.cardTitle} testID={`${testID}-title`}>
          {title}
        </Text>
        <Text style={styles.cardSub}>{sub}</Text>
        <View style={styles.chips}>
          {m.syncItems.map((item, k) => (
            <SyncChip
              key={item}
              item={item}
              done={done}
              delayMs={k * metrics.dot.stagger}
              reduce={reduce}
              testID={`${testID}-${item}`}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function SyncChip({
  item,
  done,
  delayMs,
  reduce,
  testID,
}: {
  item: SyncItem;
  done: boolean;
  delayMs: number;
  reduce: boolean;
  testID: string;
}) {
  const { t } = useTranslation('game');
  const pulse = usePulse(!done, reduce, delayMs);
  return (
    <View style={[styles.chip, done && styles.chipDone]} testID={testID}>
      {done ? (
        <Icon name="check" size={size.icon.inline - space[2]} color={color.success} />
      ) : (
        <Animated.View style={[styles.dot, pulse]} testID={`${testID}-dot`} />
      )}
      <Text style={[styles.chipText, done && styles.chipTextDone]} numberOfLines={1}>
        {t(`connection.self.item.${item}`)}
      </Text>
    </View>
  );
}

/** The bottom timer: the time left to come back, or "חזרת בזמן". */
function Timer({ model: m, testID }: { model: SelfReconnectingModel; testID: string }) {
  const { t } = useTranslation('game');
  const lost = m.phase === 'lost' && m.secondsLeft !== null;
  const remaining = lost ? (m.remainingMs ?? 0) : m.graceMs;
  const share = useDrain(remaining, m.graceMs, !lost);
  const fill = useAnimatedStyle(() => ({ width: `${share.get() * 100}%` }));
  const tint = lost ? color.accent : color.success;
  const seconds = m.secondsLeft ?? 0;
  const spoken = lost
    ? sentences([t('connection.self.timeLeft', { count: seconds, seconds }), t('connection.self.timeSub')], t)
    : sentences([t('connection.self.backInTime'), t('connection.self.backInTimeSub')], t);
  const parts = lost ? splitMarked(t('connection.self.timeLeft', { count: seconds, seconds: MARK })) : null;

  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={spoken}
      style={[styles.timer, { borderColor: tint }]}
      testID={testID}
    >
      <View style={styles.timerRow}>
        <View
          style={[styles.timerIcon, { backgroundColor: lost ? color.iconBg.warning : color.iconBg.success }]}
        >
          <Icon name={lost ? 'history' : 'check'} size={size.icon.card} color={tint} />
        </View>
        <View style={styles.timerTexts}>
          {lost ? (
            <Text style={styles.timerTitle} numberOfLines={1} testID={`${testID}-title`}>
              {parts ? parts[0] : null}
              <Text style={styles.timerSeconds} testID={`${testID}-seconds`}>
                {String(seconds)}
              </Text>
              {parts ? parts[1] : null}
            </Text>
          ) : (
            <Text style={styles.timerTitle} numberOfLines={1} testID={`${testID}-title`}>
              {t('connection.self.backInTime')}
            </Text>
          )}
          <Text style={styles.timerSub} numberOfLines={1}>
            {lost ? t('connection.self.timeSub') : t('connection.self.backInTimeSub')}
          </Text>
        </View>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: tint }, fill]} testID={`${testID}-bar`} />
      </View>
    </View>
  );
}

const gutter = tokens.layout.gutterGame;

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color.bg,
    opacity: tokens.opacity.inactivePlayer,
  },
  banner: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    height: metrics.banner.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    paddingHorizontal: space[5],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    backgroundColor: color.surface2,
  },
  bannerIcon: {
    width: metrics.banner.icon,
    height: metrics.banner.icon,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTexts: { flex: 1, minWidth: 0, gap: space[2] },
  bannerTitle: { ...text('playerName'), color: color.text },
  bannerSub: { ...text('micro'), color: color.textMuted },
  attempt: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  attemptWord: { ...text('micro'), color: color.textMuted },
  attemptNumber: { ...text('scoreSm'), color: color.accent, includeFontPadding: false },
  middle: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: gutter,
  },
  cardWrap: { width: '100%', maxWidth: metrics.cardMaxWidth, alignItems: 'center' },
  lockBadge: {
    width: metrics.lockBadge.size,
    height: metrics.lockBadge.size,
    marginBottom: -metrics.lockBadge.overlap,
    zIndex: 1,
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bg,
  },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: space[3],
    paddingTop: metrics.lockBadge.overlap + space[5],
    paddingHorizontal: space[8],
    paddingBottom: space[8],
    borderRadius: radius.xl,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  cardBack: { borderColor: color.success },
  cardTitle: { ...text('sheetTitle'), color: color.text, textAlign: 'center' },
  cardSub: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  chips: { flexDirection: 'row', alignSelf: 'stretch', gap: space[3], marginTop: space[4] },
  chip: {
    flex: 1,
    minWidth: 0,
    height: metrics.chipHeight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    borderRadius: radius.md,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  chipDone: { borderColor: color.success, backgroundColor: color.iconBg.success },
  dot: {
    width: metrics.dot.size,
    height: metrics.dot.size,
    borderRadius: radius.pill,
    backgroundColor: color.textMuted,
  },
  chipText: { ...text('micro'), color: color.textMuted },
  chipTextDone: { color: color.success },
  timerSlot: { position: 'absolute', left: gutter, right: gutter },
  timer: {
    height: metrics.timer.height,
    justifyContent: 'center',
    borderRadius: radius.xl,
    borderWidth: tokens.border.hairline,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: space[5], paddingHorizontal: space[6] },
  timerIcon: {
    width: metrics.timer.icon,
    height: metrics.timer.icon,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerTexts: { flex: 1, minWidth: 0, gap: space[2] },
  timerTitle: { ...text('rowTitle'), color: color.text },
  timerSeconds: { ...text('scoreSm'), color: color.accent },
  timerSub: { ...text('micro'), color: color.textMuted },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: metrics.timer.bar,
    backgroundColor: color.border,
  },
  fill: { position: 'absolute', top: 0, bottom: 0, start: 0 },
});
