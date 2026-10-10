import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../../components/player/Avatar';
import { easing, NEVER_REDUCE } from '../../components/player/anim';
import { paletteAt } from '../../components/player/metrics';
import { SeatGlyph } from '../../components/player/SeatGlyph';
import { color, radius, space, text, tokens } from '../../theme';
import { motion } from '../../theme/motion';
import { Announcer } from '../game/connection/Announcer';
import { useEnter, useSlam } from '../game/connection/motion';
import type { CountdownStep, MatchScreenModel, SeatModel } from './matchModel';
import { metrics } from './metrics';
import { HeaderChip } from './parts';

type CountdownModel = Extract<MatchScreenModel, { kind: 'countdown' }>;

export interface CountdownViewProps {
  model: CountdownModel;
  reduce: boolean;
  testID?: string;
}

/**
 * 3… 2… 1… GO! (spec §10; Match-Countdown in C's look), at the server's time: the players across the top, the
 * board hidden behind the count (it appears for everyone at once at GO), and each digit slamming in with a
 * thin P1 ring growing out of it (motion.md `countdown.digit`; reduced motion: the digits cross-fade, no
 * ring). After GO, "GO!" holds until the board is here. A screen reader hears each step once. Two players
 * stand across a "VS"; a table of 3–4 (stage 10) is a row of small columns in the game's order (me first, then
 * the others by seat), so four names fit on a phone.
 */
export function CountdownView({ model: m, reduce, testID = 'match-countdown' }: CountdownViewProps) {
  const { t } = useTranslation('match');
  const { t: tp } = useTranslation('player');
  const insets = useSafeAreaInsets();
  const enter = useEnter(reduce);
  const others = m.seats.filter((s) => !s.isMe);
  const me = m.seats.find((s) => s.isMe);
  const group = m.seats.length > 2;
  // Two: the opponent, VS, me. Three or four: the game's order, me first.
  const strip = me ? (group ? [me, ...others] : [...others, me]) : others;
  const go = m.step === 'go';
  const line = go
    ? t('countdown.goLabel')
    : t('countdown.stepLabel', { time: tp('seconds', { count: m.step }) });

  return (
    <View
      style={[styles.root, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] }]}
      testID={testID}
    >
      <Animated.View style={[styles.column, enter]}>
        <HeaderChip header={m.header} testID={`${testID}-header`} />
        <View style={[styles.strip, group && styles.stripGroup]} testID={`${testID}-players`}>
          {strip.map((seat, k) =>
            group ? (
              <MiniSeat key={seat.id} seat={seat} compact />
            ) : (
              <View key={seat.id} style={styles.stripItem}>
                {k > 0 ? <Text style={styles.vs}>{tp('vs')}</Text> : null}
                <MiniSeat seat={seat} />
              </View>
            ),
          )}
        </View>

        <View style={styles.stage}>
          <GhostBoard label={t('countdown.boardLabel')} />
          <View style={styles.overlay} pointerEvents="none">
            <Step key={String(m.step)} step={m.step} reduce={reduce} testID={`${testID}-step`} />
          </View>
        </View>

        <View style={styles.texts}>
          <Text style={styles.ready}>{go ? t('countdown.starting') : t('countdown.getReady')}</Text>
          <Text style={styles.note}>{t('countdown.reveal', { count: m.seats.length - 1 })}</Text>
        </View>
      </Animated.View>
      <Announcer line={line} testID={`${testID}-live`} />
    </View>
  );
}

/** One step: the digit (or GO!) slams in, and a P1 ring grows out of a digit and fades. */
function Step({ step, reduce, testID }: { step: CountdownStep; reduce: boolean; testID: string }) {
  const { t } = useTranslation('match');
  const slam = useSlam(reduce);
  const grow = useSharedValue(0);
  const ring = step !== 'go' && !reduce;

  useEffect(() => {
    if (!ring) return;
    grow.set(
      withTiming(1, {
        duration: motion.duration.countdownStep,
        easing: easing.standard,
        reduceMotion: NEVER_REDUCE,
      }),
    );
  }, [ring, grow]);

  const ringStyle = useAnimatedStyle(() => {
    const v = grow.get();
    return {
      opacity: (1 - v) * 0.8,
      transform: [{ scale: metrics.ring.from + (metrics.ring.to - metrics.ring.from) * v }],
    };
  });

  return (
    <View style={styles.step} testID={testID}>
      {ring ? <Animated.View style={[styles.ring, ringStyle]} testID={`${testID}-ring`} /> : null}
      <Animated.Text style={[step === 'go' ? styles.go : styles.digit, slam]} testID={`${testID}-text`}>
        {step === 'go' ? t('countdown.go') : String(step)}
      </Animated.Text>
    </View>
  );
}

/**
 * A player across the top: avatar in the seat's colour, the shape, the name and the rating. Side by side for
 * two players; `compact` (3–4 players) stacks them in a narrow column.
 */
function MiniSeat({ seat, compact = false }: { seat: SeatModel; compact?: boolean }) {
  const { t } = useTranslation('match');
  return (
    <View style={compact ? styles.miniCompact : styles.mini} testID={`mini-${seat.id}`}>
      <Avatar avatarId={seat.avatarId} size="card" colorIndex={seat.colorIndex} />
      <View style={[styles.miniTexts, compact && styles.miniTextsCompact]}>
        <View style={styles.miniName}>
          <SeatGlyph colorIndex={seat.colorIndex} size={metrics.slot.glyph} />
          <Text style={styles.name} numberOfLines={1}>
            {seat.isMe ? t('me') : seat.name}
          </Text>
        </View>
        <Text style={styles.rating}>{seat.rating}</Text>
      </View>
    </View>
  );
}

const CELLS = Array.from({ length: 9 }, (_, k) => k);

/** The board, hidden: 9 × 9 empty cells, dimmed; always left to right like the real one. */
function GhostBoard({ label }: { label: string }) {
  return (
    <View style={styles.board} accessible accessibilityLabel={label} testID="ghost-board">
      {CELLS.map((r) => (
        <View key={r} style={[styles.boardRow, r % 3 === 2 && r < 8 && styles.boxGap]}>
          {CELLS.map((c) => (
            <View key={c} style={[styles.cell, c % 3 === 2 && c < 8 && styles.boxGapColumn]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const CELL = Math.floor((metrics.ghostBoard.size - space[3] * 2) / 9) - 1;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg, paddingHorizontal: tokens.layout.gutterGame },
  column: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[10] },
  strip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4] },
  stripGroup: { alignSelf: 'stretch', alignItems: 'flex-start' },
  stripItem: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexShrink: 1 },
  vs: { ...text('vsBadge'), color: color.vsBadge.text },
  mini: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexShrink: 1 },
  miniCompact: { flex: 1, minWidth: 0, alignItems: 'center', gap: space[3] },
  miniTextsCompact: { alignItems: 'center', maxWidth: '100%' },
  miniTexts: { alignItems: 'flex-start', gap: space[2], flexShrink: 1 },
  miniName: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 },
  name: { ...text('playerName'), color: color.text, flexShrink: 1 },
  rating: { ...text('ratingCompact'), color: color.accent },
  stage: {
    width: metrics.ghostBoard.size,
    height: metrics.ghostBoard.size,
    alignItems: 'center',
    justifyContent: 'center',
  },
  board: {
    direction: 'ltr',
    padding: space[3],
    gap: 1,
    borderRadius: radius.board,
    backgroundColor: color.surface,
    opacity: metrics.ghostBoard.opacity,
  },
  boardRow: { flexDirection: 'row', gap: 1 },
  boxGap: { marginBottom: space[1] },
  boxGapColumn: { marginEnd: space[1] },
  cell: { width: CELL, height: CELL, borderRadius: radius.bar, backgroundColor: color.surface2 },
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  step: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: metrics.ring.size,
    height: metrics.ring.size,
    borderRadius: radius.pill,
    borderWidth: metrics.ring.stroke,
    borderColor: paletteAt(0).ring,
  },
  digit: {
    ...text('scoreXL'),
    fontSize: metrics.digit.fontSize,
    lineHeight: metrics.digit.lineHeight,
    paddingTop: metrics.digit.paddingTop,
    color: color.text,
  },
  go: {
    ...text('scoreXL'),
    fontSize: metrics.digit.fontSize * 0.75,
    lineHeight: metrics.digit.lineHeight * 0.75,
    paddingTop: metrics.digit.paddingTop * 0.75,
    color: color.accent,
  },
  texts: { alignItems: 'center', gap: space[4] },
  ready: { ...text('h1'), color: color.text, textAlign: 'center' },
  note: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
});
