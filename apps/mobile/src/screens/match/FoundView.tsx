import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, space, text, tokens } from '../../theme';
import { Announcer } from '../game/connection/Announcer';
import { useEnter, useSlam } from '../game/connection/motion';
import { isolateName } from '../game/hit/hitModel';
import type { MatchScreenModel } from './matchModel';
import { metrics } from './metrics';
import { HeaderChip, joinSentences, SeatTile } from './parts';

type FoundModel = Extract<MatchScreenModel, { kind: 'found' }>;

export interface FoundViewProps {
  model: FoundModel;
  reduce: boolean;
  testID?: string;
}

/**
 * "נמצא יריב!" (spec §10, original §8; Match-Found in C's look): the VS, every player with avatar, name, flag
 * and rating ("זמני" in the first 10 games), and whether each is ready. D37: a player is ready as soon as
 * their phone is in the match's room, so there is nothing to press; the badges pop in 800 ms after the VS
 * slams (motion.md `vs.slam`; reduced motion: the VS fades in and the badges are there at once). Then "כל
 * השחקנים מוכנים · המשחק מתחיל", whether we met lately, and that there is no cancelling from here [D32]. A
 * screen reader hears who was found.
 *
 * Two players face each other across the VS, me at the start edge (right in Hebrew, left in English) as on
 * Match-Found and as my card sits in the game (spec §6.8, components.md §3.1). A table of 3–4 (stage 10,
 * "נמצאו יריבים!") is a grid of two columns in the game's order (me first, then the others by seat, as their
 * cards will sit), each in their colour and shape, the last one centred when there are three.
 */
export function FoundView({ model: m, reduce, testID = 'match-found' }: FoundViewProps) {
  const { t } = useTranslation('match');
  const insets = useSafeAreaInsets();
  const enter = useEnter(reduce);
  const slam = useSlam(reduce);
  // The "מוכן" badges pop 800 ms after the VS; with reduced motion they are there at once.
  const [popped, setPopped] = useState(false);
  const badges = reduce || popped;

  useEffect(() => {
    if (reduce) return;
    const id = setTimeout(() => setPopped(true), metrics.vs.badgesAtMs);
    return () => clearTimeout(id);
  }, [reduce]);

  const me = m.seats.find((s) => s.isMe);
  const others = m.seats.filter((s) => !s.isMe);
  // The game's order (screens/game seatOrder): me first, then the others by seat.
  const ordered = me ? [me, ...others] : others;
  const names = others.map((s) => isolateName(s.name)).join(t('player:listSep'));
  const total = m.seats.length;
  const opponent = others[0];
  const pair = total === 2 && me && opponent ? { me, opponent } : null;

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] },
        ]}
      >
        <Animated.View style={[styles.column, enter]}>
          <HeaderChip header={m.header} testID={`${testID}-header`} />
          <Animated.Text style={[styles.title, slam]} accessibilityRole="header" testID={`${testID}-title`}>
            {t('found.title', { count: others.length })}
          </Animated.Text>

          {pair ? (
            <View style={styles.versus} testID={`${testID}-pair`}>
              <SeatTile seat={pair.me} showReady={badges} reduce={reduce} />
              <Animated.View style={slam} testID={`${testID}-vs`}>
                <View style={styles.vs}>
                  <Text style={styles.vsText}>{t('player:vs')}</Text>
                </View>
              </Animated.View>
              <SeatTile seat={pair.opponent} showReady={badges} reduce={reduce} />
            </View>
          ) : (
            <View style={styles.grid} testID={`${testID}-grid`}>
              {ordered.map((seat) => (
                <SeatTile
                  key={seat.id}
                  seat={seat}
                  showReady={badges}
                  reduce={reduce}
                  style={styles.gridTile}
                />
              ))}
            </View>
          )}

          <View
            style={styles.status}
            accessible
            accessibilityLabel={joinSentences(
              [
                m.allReady ? t('found.allReady') : t('found.waiting'),
                t('found.readyCountLabel', { ready: m.readyCount, total }),
              ],
              t,
            )}
            testID={`${testID}-status`}
          >
            <Text style={[styles.statusText, m.allReady && styles.statusReady]}>
              {m.allReady ? t('found.allReady') : t('found.waiting')}
            </Text>
            <View style={styles.countRow}>
              <Text style={styles.countLabel}>{t('found.readyCount')}</Text>
              <Text style={styles.count} testID={`${testID}-count`}>{`${m.readyCount}/${total}`}</Text>
            </View>
          </View>

          <Text style={styles.note} testID={`${testID}-rematch`}>
            {m.rematch ? t('found.rematch') : t('found.fresh')}
          </Text>
          <Text style={styles.noCancel}>{t('found.noCancel')}</Text>
        </Animated.View>
      </ScrollView>
      <Announcer
        line={names ? t('found.announce', { names, count: others.length }) : null}
        testID={`${testID}-live`}
      />
    </View>
  );
}

const SKEW = `${tokens.effects.skewXDeg}deg`;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: tokens.layout.gutterGame },
  column: { alignItems: 'center', gap: space[9] },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  versus: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space[4] },
  vs: {
    width: tokens.size.vsBadge.width,
    height: tokens.size.vsBadge.height,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: color.vsBadge.border,
    backgroundColor: color.vsBadge.bg,
    transform: [{ skewX: SKEW }],
  },
  vsText: { ...text('vsBadge'), color: color.vsBadge.text },
  grid: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space[6],
  },
  /** Two to a row, the same width each (a third one alone is centred, not stretched). */
  gridTile: { flexGrow: 0, flexBasis: '46%' },
  status: { alignItems: 'center', gap: space[4] },
  statusText: { ...text('status'), color: color.textMuted, textAlign: 'center' },
  statusReady: { color: color.success },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  countLabel: { ...text('micro'), color: color.textMuted },
  count: { ...text('scoreCompact'), color: color.text },
  note: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  noCancel: { ...text('caption'), color: color.textFaint, textAlign: 'center' },
});
