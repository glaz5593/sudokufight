import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { AvatarId } from '../../../assets/avatars';
import { Avatar } from '../../../components/player/Avatar';
import { VsBadge } from '../../../components/player/Badges';
import { barShares } from '../../../components/player/cardModel';
import { formatScore, scoreText, signedText } from '../../../components/player/format';
import { paletteAt } from '../../../components/player/metrics';
import { SeatGlyph } from '../../../components/player/SeatGlyph';
import type { Gender } from '../../../components/player/wording';
import { color, radius, space, text } from '../../../theme';
import { about, myNameOf, nameOf } from './wording';

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
  /**
   * The game is still on (Surrender): the middle says who leads and by how much ("אתה מוביל +15.5", or
   * "שוויון"), and a thin lead bar runs under the row (components.md §14.1 "a 6 dp lead bar"). Off, the
   * middle is the VS badge (Opponent-Left: the final scores).
   */
  showLead?: boolean;
  /** The opponent's grammatical gender, for "NinaVolt מובילה". */
  gender?: Gender;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The seat shape before each name (Surrender, Opponent-Left: ● for me, ▲ for the opponent). */
const GLYPH = space[4];
/** components.md §14.1: the summary's lead bar is 6 dp. */
const BAR = space[3];

/**
 * Me | VS | the opponent, with the scores in the seat colours (components.md §14.1 "Score summary": avatars,
 * Teko scores in the ring colours, `color.surface2`, radius 12, no skew). Me first, at the start of the row
 * (right in Hebrew), as on the game's cards; each name has its seat shape, so whose score is whose never
 * rests on colour alone (CLAUDE.md). One element for screen readers: "MosheG: 55, NinaVolt: 39.5".
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
  showLead = false,
  gender,
  style,
  testID,
}: ScoreLineProps) {
  const { t } = useTranslation('game');
  const me = myNameOf(myName, t);
  const them = nameOf(opponentName, t);
  const [myShare = 0.5, theirShare = 0.5] = showLead ? barShares([myScore, opponentScore]) : [];
  return (
    <View
      accessible
      accessibilityLabel={t('connection.scoreLabel', {
        me,
        myScore: scoreText(myScore),
        name: them,
        theirScore: scoreText(opponentScore),
      })}
      style={[styles.box, style]}
      testID={testID}
    >
      <View style={styles.line}>
        <View style={styles.side}>
          <Avatar avatarId={myAvatar} size="compact" colorIndex={0} backdrop={color.surface2} />
          <View style={styles.texts}>
            <View style={styles.nameRow}>
              <SeatGlyph colorIndex={0} size={GLYPH} />
              <Text style={styles.name} numberOfLines={1}>
                {me}
              </Text>
            </View>
            <Text style={[styles.score, { color: paletteAt(0).ring }]}>{formatScore(myScore)}</Text>
          </View>
        </View>
        {showLead ? (
          <Lead
            gap={myScore - opponentScore}
            opponentName={them}
            opponentColorIndex={opponentColorIndex}
            gender={gender}
            testID={testID && `${testID}-lead`}
          />
        ) : (
          <VsBadge />
        )}
        <View style={[styles.side, styles.sideEnd]}>
          <View style={[styles.texts, styles.textsEnd]}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {them}
              </Text>
              <SeatGlyph colorIndex={opponentColorIndex} size={GLYPH} />
            </View>
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
      {showLead ? (
        <View style={styles.bar} testID={testID && `${testID}-bar`}>
          <View style={{ flex: myShare, backgroundColor: paletteAt(0).ring }} />
          <View style={{ flex: theirShare, backgroundColor: paletteAt(opponentColorIndex).ring }} />
        </View>
      ) : null}
    </View>
  );
}

/** The middle of a live summary: who leads ("אתה מוביל") over the margin ("+15.5") in the leader's colour. */
function Lead({
  gap,
  opponentName,
  opponentColorIndex,
  gender,
  testID,
}: {
  gap: number;
  opponentName: string;
  opponentColorIndex: number;
  gender?: Gender;
  testID?: string;
}) {
  const { t } = useTranslation('game');
  const label =
    gap > 0
      ? t('connection.lead.mine')
      : gap < 0
        ? t('connection.lead.theirs', { name: opponentName, ...about(gender) })
        : t('connection.lead.tie');
  const tint = gap > 0 ? paletteAt(0).ring : gap < 0 ? paletteAt(opponentColorIndex).ring : color.textMuted;
  return (
    <View style={styles.lead} testID={testID}>
      <Text style={styles.leadLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.leadGap, { color: tint }]} testID={testID && `${testID}-gap`}>
        {gap === 0 ? formatScore(0) : signedText(Math.abs(gap))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignSelf: 'stretch',
    gap: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
  },
  side: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space[4] },
  sideEnd: { justifyContent: 'flex-end' },
  texts: { flexShrink: 1, minWidth: 0, gap: space[2], alignItems: 'flex-start' },
  textsEnd: { alignItems: 'flex-end' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minWidth: 0 },
  name: { ...text('micro'), color: color.textMuted, flexShrink: 1 },
  score: { ...text('scoreSm') },
  lead: { alignItems: 'center', gap: space[1], maxWidth: '34%' },
  leadLabel: { ...text('micro'), color: color.textMuted },
  leadGap: { ...text('scoreSm') },
  bar: {
    flexDirection: 'row',
    height: BAR,
    borderRadius: radius.bar,
    overflow: 'hidden',
    backgroundColor: color.border,
  },
});
