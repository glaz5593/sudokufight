import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '../../components/Icon';
import {
  Avatar,
  displayName,
  formatScore,
  ltr,
  mistakesShort,
  paletteAt,
  scoreText,
} from '../../components/player';
import { color, radius, size, space, text, tokens } from '../../theme';
import { formatSeconds } from '../game/model';
import type { AwardResult, OpponentResult } from './resultsModel';

/**
 * The parts of the results that only a game with opponents has (spec §12; Results-Victory / Results-Defeat in
 * direction C, basic): each opponent's row (avatar, name, score, mistakes; a practice has no rating change) and
 * the game's awards. Each row and each award is one summary for screen readers.
 */

type GameT = TFunction<'game'>;

export function OpponentsSection({ opponents }: { opponents: readonly OpponentResult[] }) {
  const { t } = useTranslation('game');
  const { t: tp } = useTranslation('player');
  return (
    <Card
      title={t('results.opponents.title')}
      icon={opponents.every((o) => o.isBot) ? 'bot' : 'leaderboard'}
      testID="results-opponents"
    >
      {opponents.map((o) => {
        const name = displayName(o, tp);
        const mistakes = mistakesShort(o.mistakes, tp);
        return (
          <View
            key={o.playerId}
            style={styles.row}
            accessible
            accessibilityRole="text"
            accessibilityLabel={t('results.opponents.label', {
              name,
              score: scoreText(o.score),
              mistakes,
            })}
            testID={`results-opponent-${o.playerId}`}
          >
            <Avatar avatarId={o.avatar} size="compact" colorIndex={o.colorIndex} bot={o.isBot} />
            <View style={styles.who}>
              <Text style={[text('playerName'), styles.strong]} numberOfLines={1}>
                {name}
              </Text>
              <Text style={[text('caption'), styles.muted]} numberOfLines={1}>
                {o.left ? t('results.opponents.left') : mistakes}
              </Text>
            </View>
            <Text
              style={[text('rating'), styles.score, { color: paletteAt(o.colorIndex).ring }]}
              testID={`results-opponent-${o.playerId}-score`}
            >
              {scoreText(o.score)}
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

const AWARD_ICONS: Readonly<Record<AwardResult['kind'], IconName>> = {
  bestMove: 'trophy',
  fewestMistakes: 'check',
  fastest: 'bolt',
  comeback: 'refresh',
  mostPoints: 'leaderboard',
};

/** An award's value in its own unit: points, mistakes, seconds per move. */
function awardValue(a: AwardResult, t: GameT): string {
  switch (a.kind) {
    case 'bestMove':
    case 'comeback':
    case 'mostPoints':
      return t(`results.awards.value.${a.kind}`, { value: ltr(formatScore(a.value)) });
    case 'fewestMistakes':
      return t('results.awards.value.fewestMistakes', { value: a.value });
    case 'fastest':
      return t('results.awards.value.fastest', { value: formatSeconds(a.value) });
  }
}

export function AwardsSection({ awards }: { awards: readonly AwardResult[] }) {
  const { t } = useTranslation('game');
  const { t: tp } = useTranslation('player');
  return (
    <Card title={t('results.awards.title')} icon="trophy" testID="results-awards">
      {awards.map((a) => {
        const title = t(`results.awards.${a.kind}`);
        const who = a.winners
          .map((w) => (w.mine ? t('me') : (w.name ?? tp('unknownName'))))
          .join(t('listSep'));
        const value = awardValue(a, t);
        const mine = a.winners.some((w) => w.mine);
        return (
          <View
            key={a.kind}
            style={styles.row}
            accessible
            accessibilityRole="text"
            accessibilityLabel={t('results.awards.label', { title, who, value })}
            testID={`results-award-${a.kind}`}
          >
            <View style={[styles.badge, mine ? styles.badgeMine : null]}>
              <Icon
                name={AWARD_ICONS[a.kind]}
                size={size.icon.inline}
                color={mine ? color.accent : color.textMuted}
              />
            </View>
            <View style={styles.who}>
              <Text style={[text('label'), styles.strong]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[text('caption'), styles.muted]} numberOfLines={1}>
                {who}
              </Text>
            </View>
            <Text style={[text('cellRef'), styles.strong]}>{value}</Text>
          </View>
        );
      })}
    </Card>
  );
}

function Card({
  title,
  icon,
  children,
  testID,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
  testID: string;
}) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <Icon name={icon} size={size.icon.inline} color={color.textMuted} />
        <Text style={[text('label'), styles.muted]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[6],
    padding: space[8],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[6], minHeight: size.touch },
  who: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  score: { includeFontPadding: false },
  badge: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.button,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMine: { borderWidth: tokens.border.hairline, borderColor: color.accent },
});
