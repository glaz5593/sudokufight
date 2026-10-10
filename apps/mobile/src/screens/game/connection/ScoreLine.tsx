import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { AvatarId } from '../../../assets/avatars';
import { Avatar } from '../../../components/player/Avatar';
import { VsBadge } from '../../../components/player/Badges';
import { formatScore, scoreText } from '../../../components/player/format';
import { paletteAt } from '../../../components/player/metrics';
import { color, radius, space, text } from '../../../theme';
import { myNameOf, nameOf } from './wording';

/** Two players' scores side by side. */
export interface ScoreLineData {
  myName: string | null;
  myScore: number;
  myAvatar?: AvatarId | null;
  opponentName: string | null;
  opponentScore: number;
  opponentAvatar?: AvatarId | null;
  /** The opponent's colour on this phone (P2 in a 2-player game). */
  opponentColorIndex: number;
}

export interface ScoreLineProps extends ScoreLineData {
  /** The opponent is out (left the game): their avatar is grey. */
  opponentOut?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Me | VS | the opponent, with the scores in the seat colours (components.md §14.1 "Score summary": avatars,
 * Teko scores in the ring colours, `color.surface2`, radius 12, no skew). Me first, at the start of the row
 * (right in Hebrew), as on the game's cards. One element for screen readers: "MosheG: 55, NinaVolt: 39.5".
 */
export function ScoreLine({
  myName,
  myScore,
  myAvatar,
  opponentName,
  opponentScore,
  opponentAvatar,
  opponentColorIndex,
  opponentOut = false,
  style,
  testID,
}: ScoreLineProps) {
  const { t } = useTranslation('game');
  const me = myNameOf(myName, t);
  const them = nameOf(opponentName, t);
  return (
    <View
      accessible
      accessibilityLabel={t('connection.scoreLabel', {
        me,
        myScore: scoreText(myScore),
        name: them,
        theirScore: scoreText(opponentScore),
      })}
      style={[styles.line, style]}
      testID={testID}
    >
      <View style={styles.side}>
        <Avatar avatarId={myAvatar} size="compact" colorIndex={0} backdrop={color.surface2} />
        <View style={styles.texts}>
          <Text style={styles.name} numberOfLines={1}>
            {me}
          </Text>
          <Text style={[styles.score, { color: paletteAt(0).ring }]}>{formatScore(myScore)}</Text>
        </View>
      </View>
      <VsBadge />
      <View style={[styles.side, styles.sideEnd]}>
        <View style={[styles.texts, styles.textsEnd]}>
          <Text style={styles.name} numberOfLines={1}>
            {them}
          </Text>
          <Text style={[styles.score, { color: paletteAt(opponentColorIndex).ring }]}>
            {formatScore(opponentScore)}
          </Text>
        </View>
        <Avatar
          avatarId={opponentAvatar}
          size="compact"
          colorIndex={opponentColorIndex}
          backdrop={color.surface2}
          inactive={opponentOut}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
  },
  side: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space[4] },
  sideEnd: { justifyContent: 'flex-end' },
  texts: { flexShrink: 1, minWidth: 0, gap: space[2], alignItems: 'flex-start' },
  textsEnd: { alignItems: 'flex-end' },
  name: { ...text('micro'), color: color.textMuted },
  score: { ...text('scoreSm') },
});
