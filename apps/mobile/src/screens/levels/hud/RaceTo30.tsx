import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { formatScore, SeatGlyph } from '../../../components/player';
import { timing } from '../../../components/ui/motion';
import { Text } from '../../../components/ui/Text';
import { decimalSeparator } from '../../../i18n/compose';
import { color, radius, space, text } from '../../../theme';
import { motion, useReduceMotion } from '../../../theme/motion';

/**
 * "מרוץ ל־30" (components.md §19.7, the Lv-Sprint board): the duel's two tracks to its target, mine in P1 with
 * ●, the bot's in P2 with ▲ (shape and colour both), and the flag of the target between them. A track fills
 * with its player's score.
 *
 * Motion (`level.race.fill`): a new score slides the fill over 240 ms; Reduced Motion: it jumps there.
 */

export interface RaceTo30Props {
  mine: number;
  theirs: number;
  /** The duel's target (30). */
  target: number;
  myName: string;
  botName: string;
  /** The bot's level (1–5), for its label. */
  botLevel: number | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function RaceTo30({
  mine,
  theirs,
  target,
  myName,
  botName,
  botLevel,
  style,
  testID = 'race-to-30',
}: RaceTo30Props) {
  const { t } = useTranslation('levels');
  const decimal = decimalSeparator(t);
  const me = t('hud.duel.meLabel', {
    name: myName,
    score: formatScore(mine, decimal),
    target,
    count: target,
  });
  const bot = t('hud.duel.botLabel', {
    name: botName,
    n: botLevel ?? '',
    score: formatScore(theirs, decimal),
    target,
    count: target,
  });
  return (
    <View
      style={[styles.race, style]}
      accessible
      accessibilityLabel={t('hud.duel.raceLabel', { target, me, bot })}
      testID={testID}
    >
      <Track share={mine / target} colorIndex={0} testID={`${testID}-me`} />
      <View style={styles.flag}>
        <Text style={styles.target}>{target}</Text>
      </View>
      <Track share={theirs / target} colorIndex={1} testID={`${testID}-bot`} />
    </View>
  );
}

function Track({ share, colorIndex, testID }: { share: number; colorIndex: number; testID: string }) {
  const reduce = useReduceMotion();
  const fill = Math.max(0, Math.min(1, share));
  const width = useSharedValue(fill);
  useEffect(() => {
    width.set(reduce ? fill : withTiming(fill, timing(motion.duration.stateChange, 'standard', reduce)));
  }, [fill, reduce, width]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${width.get() * 100}%` }));
  const p = color.players[colorIndex]!;
  return (
    <View style={styles.trackRow} testID={testID}>
      <SeatGlyph colorIndex={colorIndex} size={GLYPH} />
      <View style={styles.track}>
        <Animated.View
          style={[styles.fill, { backgroundColor: p.ring }, fillStyle]}
          testID={`${testID}-fill`}
        />
      </View>
    </View>
  );
}

const GLYPH = 10;

const styles = StyleSheet.create({
  // The tracks run left to right in both languages: a score grows toward the target.
  race: { direction: 'ltr', gap: space[2] },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  track: {
    flex: 1,
    height: 6,
    borderRadius: radius.bar,
    backgroundColor: color.surface2,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  fill: { height: '100%', borderRadius: radius.bar },
  flag: { alignSelf: 'flex-end' },
  target: { ...text('caption'), color: color.textMuted },
});
