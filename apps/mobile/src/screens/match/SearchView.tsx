import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AVATAR_STAGES } from '../../avatars/reactions';
import { Avatar } from '../../components/player/Avatar';
import { NEVER_REDUCE } from '../../components/player/anim';
import { paletteAt } from '../../components/player/metrics';
import { SeatGlyph } from '../../components/player/SeatGlyph';
import { Button } from '../../components/ui/Button';
import { color, radius, space, text, tokens } from '../../theme';
import { motion } from '../../theme/motion';
import { Announcer } from '../game/connection/Announcer';
import { useEnter, usePulse } from '../game/connection/motion';
import { clockText, type MatchScreenModel } from './matchModel';
import { metrics } from './metrics';
import { HeaderChip, joinSentences, RangeBar, rangeText } from './parts';

type SearchModel = Extract<MatchScreenModel, { kind: 'search' }>;

export interface SearchViewProps {
  model: SearchModel;
  reduce: boolean;
  /** "ביטול חיפוש". */
  onCancel: () => void;
  testID?: string;
}

/**
 * Searching (spec §10; Match-Search in C's look): what is being played, "מחפש יריב…" with the search time
 * (m:ss, left to right, every second), my avatar on a radar whose thin P1 arc sweeps around it (motion.md
 * `search.sweep`, 2400 ms; reduced motion: it stands still, the time still runs), my rating, the rating
 * range as numbers and as a bar that widens as the server widens it (every 5 s, up to ±300; "keep searching"
 * lifts the cap), the empty seats blinking "מחפש…", "נמנעים מיריבים ששיחקת מולם לאחרונה", and "ביטול חיפוש".
 * A screen reader hears the range once the search runs, and why the search started over when a match fell
 * through; never the seconds.
 */
export function SearchView({ model: m, reduce, onCancel, testID = 'match-search' }: SearchViewProps) {
  const { t } = useTranslation('match');
  const insets = useSafeAreaInsets();
  const enter = useEnter(reduce);
  const time = clockText(m.elapsedMs);
  // Said once, as the search starts (not at every widening): the range it starts with.
  const [rangeLine, setRangeLine] = useState<string | null>(null);
  if (m.range && rangeLine === null) {
    setRangeLine(t('search.announce', { low: m.range.low, high: m.range.high, count: m.openSeats }));
  }
  // At a table of 3–4 the one who did not come is one of several (spec §10).
  const requeued = t('search.requeued', { count: m.openSeats });
  const announcement = rangeLine ? joinSentences([m.requeued && requeued, rangeLine], t) : null;

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[8], paddingBottom: space[8] },
        ]}
      >
        <Animated.View style={[styles.column, enter]}>
          <HeaderChip header={m.header} testID={`${testID}-header`} />
          <View style={styles.titleBlock}>
            <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
              {m.connecting ? t('search.connecting') : t('search.title', { count: m.openSeats })}
            </Text>
            <Text
              style={styles.elapsed}
              accessibilityLabel={t('search.elapsedLabel', { time })}
              testID={`${testID}-elapsed`}
            >
              {time}
            </Text>
          </View>

          <Radar me={m.me} reduce={reduce} active={!m.connecting} testID={`${testID}-radar`} />

          {m.range ? (
            <View style={styles.range} testID={`${testID}-range`}>
              <View
                style={styles.rangeCard}
                accessible
                accessibilityLabel={t('search.rangeLabel', { low: m.range.low, high: m.range.high })}
              >
                <Text style={styles.rangeTitle}>{t('search.rangeTitle')}</Text>
                {/* Isolated (Match-Search: dir=ltr), so the lower rating stays first in a Hebrew line. */}
                <Text style={styles.rangeValue} testID={`${testID}-range-value`}>
                  {rangeText(m.range)}
                </Text>
              </View>
              <RangeBar range={m.range} />
              <Text style={styles.note}>{m.range.extended ? t('search.noCap') : t('search.widening')}</Text>
            </View>
          ) : null}

          {m.requeued ? (
            <Text style={styles.requeued} testID={`${testID}-requeued`}>
              {requeued}
            </Text>
          ) : null}

          <View style={styles.opponents}>
            <View style={styles.opponentsHeader}>
              <Text style={styles.sectionLabel}>{t('search.opponents')}</Text>
              <Text style={styles.count}>{`0/${m.openSeats}`}</Text>
            </View>
            <View style={styles.slots}>
              {Array.from({ length: m.openSeats }, (_, k) => (
                <EmptySeat key={k} colorIndex={k + 1} reduce={reduce} delayMs={k * 500} />
              ))}
            </View>
          </View>

          <Text style={styles.note}>{t('search.avoidRecent')}</Text>
        </Animated.View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + space[8] }]}>
        <Button
          label={t('search.cancel')}
          onPress={onCancel}
          variant="secondary"
          size="md"
          icon="close"
          accessibilityHint={t('search.cancelHint')}
          style={styles.cancel}
          testID={`${testID}-cancel`}
        />
      </View>
      <Announcer line={announcement} testID={`${testID}-live`} />
    </View>
  );
}

/** My avatar in the middle of the radar, the sweeping P1 arc, and my rating under it. */
function Radar({
  me,
  reduce,
  active,
  testID,
}: {
  me: SearchModel['me'];
  reduce: boolean;
  active: boolean;
  testID: string;
}) {
  const { t } = useTranslation('match');
  const turn = useSharedValue(0);
  const sweeping = active && !reduce;

  useEffect(() => {
    if (!sweeping) {
      cancelAnimation(turn);
      turn.set(0);
      return;
    }
    turn.set(
      withRepeat(
        withTiming(1, {
          duration: motion.loop.searchSweep,
          easing: Easing.linear,
          reduceMotion: NEVER_REDUCE,
        }),
        -1,
      ),
    );
    return () => cancelAnimation(turn);
  }, [sweeping, turn]);

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  const r = metrics.radar.size;

  return (
    <View
      style={[styles.radar, { width: r, height: r }]}
      accessible
      accessibilityLabel={me.rating === null ? t('me') : t('search.myRating', { rating: me.rating })}
      testID={testID}
    >
      <View style={[styles.ring, { width: r, height: r }]} />
      {metrics.radar.inner.map((share) => (
        <View key={share} style={[styles.ring, styles.innerRing, { width: r * share, height: r * share }]} />
      ))}
      <Animated.View
        style={[styles.ring, styles.arc, { width: r, height: r }, spin]}
        testID={`${testID}-arc`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Avatar avatarId={me.avatarId} size="home" colorIndex={0} idle={AVATAR_STAGES.search} />
      <View style={styles.meChip}>
        <Text style={[styles.meText, { color: paletteAt(0).ring }]}>{t('me')}</Text>
        {me.rating !== null ? (
          <Text style={styles.meRating} testID={`${testID}-rating`}>
            {me.rating}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** An open seat: "?" and "מחפש…", blinking while the search runs (static with reduced motion). */
function EmptySeat({
  colorIndex,
  reduce,
  delayMs,
}: {
  colorIndex: number;
  reduce: boolean;
  delayMs: number;
}) {
  const { t } = useTranslation('match');
  const pulse = usePulse(true, reduce, delayMs);
  return (
    <View style={styles.slot} accessible accessibilityLabel={t('search.slotLabel')} testID="empty-seat">
      <View style={styles.slotGlyph}>
        <SeatGlyph colorIndex={colorIndex} size={metrics.slot.glyph} color={color.iconFaint} />
      </View>
      <Animated.View style={[styles.slotFace, pulse]}>
        <Text style={styles.slotMark}>{t('search.slotMark')}</Text>
      </Animated.View>
      <Animated.Text style={[styles.slotText, pulse]}>{t('search.slot')}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, paddingHorizontal: tokens.layout.gutterGame },
  column: { alignItems: 'center', gap: space[9] },
  titleBlock: { alignItems: 'center', gap: space[3] },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  elapsed: { ...text('scoreCompact'), color: color.textMuted },
  radar: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  innerRing: { borderColor: color.surface2 },
  arc: {
    borderWidth: metrics.radar.arc,
    borderColor: 'transparent',
    borderTopColor: paletteAt(0).ring,
  },
  meChip: {
    position: 'absolute',
    bottom: space[8],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    height: metrics.meChipHeight,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: paletteAt(0).ring,
    backgroundColor: color.bg,
  },
  meText: { ...text('micro') },
  meRating: { ...text('ratingCompact'), color: color.accent },
  range: { alignItems: 'center', gap: space[5] },
  rangeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    paddingHorizontal: space[7],
    paddingVertical: space[3],
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  rangeTitle: { ...text('micro'), color: color.textMuted },
  rangeValue: { ...text('scoreCompact'), color: color.accent },
  note: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  requeued: { ...text('caption'), color: color.warning, textAlign: 'center' },
  opponents: { alignSelf: 'stretch', gap: space[6] },
  opponentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
  },
  sectionLabel: { ...text('micro'), color: color.textMuted },
  count: { ...text('ratingCompact'), color: color.textMuted },
  slots: { flexDirection: 'row', justifyContent: 'center', gap: space[6] },
  slot: {
    flex: 1,
    maxWidth: metrics.slot.maxWidth,
    height: metrics.slot.height,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
    borderRadius: radius.card,
    borderWidth: tokens.border.focus,
    borderStyle: 'dashed',
    borderColor: color.border,
  },
  slotGlyph: { position: 'absolute', top: space[4], start: space[5] },
  slotFace: {
    width: tokens.size.avatar.card.frame,
    height: tokens.size.avatar.card.frame,
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotMark: { ...text('scoreCompact'), color: color.textMuted },
  slotText: { ...text('caption'), color: color.textMuted },
  footer: {
    paddingHorizontal: tokens.layout.gutterHome,
    paddingTop: space[6],
    alignItems: 'center',
  },
  cancel: { alignSelf: 'stretch', maxWidth: metrics.actionsMaxWidth, width: '100%' },
});
