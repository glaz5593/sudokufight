import type { GameType } from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { AvatarId } from '../../assets/avatars';
import { Icon, type IconName } from '../../components/Icon';
import {
  Avatar,
  displayName,
  formatScore,
  ltr,
  mistakesShort,
  paletteAt,
  scoreText,
  signedText,
} from '../../components/player';
import { useCountUp } from '../../components/player/anim';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { formatSeconds } from '../game/model';
import type { AwardResult, OpponentResult, RankingRow, RatingResult } from './resultsModel';

/**
 * The parts of the results that only a game with opponents has (spec §12; Results-Victory, Results-Defeat and
 * Results-4P in direction C): each opponent's row (avatar, name, score, mistakes, and in a ranked game the
 * rating change), the full ranking of a 3–4 player game (a podium and 4th place), my rating change counting
 * from the old rating to the new one, and the game's awards with what each one means. Each row and each
 * award is one summary for screen readers.
 */

type GameT = TFunction<'game'>;

/**
 * A player's row: one summary for screen readers; with `onPress` (another player of a ranked game, stage 12)
 * a button that opens their card.
 */
function PlayerRow({
  label,
  onPress,
  style,
  testID,
  children,
}: {
  label: string;
  onPress?: () => void;
  style: StyleProp<ViewStyle>;
  testID: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('progress');
  if (!onPress)
    return (
      <View style={style} accessible accessibilityRole="text" accessibilityLabel={label} testID={testID}>
        {children}
      </View>
    );
  return (
    <Pressable
      style={({ pressed }) => [style, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('leaderboard.openHint')}
      onPress={onPress}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

export function OpponentsSection({
  opponents,
  onOpenPlayer,
}: {
  opponents: readonly OpponentResult[];
  /** A ranked game: another player's row opens their card (spec §14.3). */
  onOpenPlayer?: (playerId: string) => void;
}) {
  const { t } = useTranslation('game');
  const { t: tp } = useTranslation('player');
  const { t: th } = useTranslation('history');
  return (
    <Card
      title={t('results.opponents.title')}
      icon={opponents.every((o) => o.isBot) ? 'bot' : 'leaderboard'}
      testID="results-opponents"
    >
      {opponents.map((o) => {
        const name = displayName(o, tp);
        const mistakes = mistakesShort(o.mistakes, tp);
        const label = o.rating
          ? th('results.opponentLabel', {
              name,
              score: scoreText(o.score),
              mistakes,
              delta: signedText(o.rating.delta),
            })
          : t('results.opponents.label', { name, score: scoreText(o.score), mistakes });
        return (
          <PlayerRow
            key={o.playerId}
            style={styles.row}
            label={label}
            onPress={onOpenPlayer && !o.isBot ? () => onOpenPlayer(o.playerId) : undefined}
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
            <View style={styles.numbers}>
              <Text
                style={[text('rating'), styles.score, { color: paletteAt(o.colorIndex).ring }]}
                testID={`results-opponent-${o.playerId}-score`}
              >
                {scoreText(o.score)}
              </Text>
              {o.rating ? (
                <Text
                  style={[text('caption'), styles.muted]}
                  testID={`results-opponent-${o.playerId}-rating`}
                >
                  {`${signedText(o.rating.delta)} · ${ltr(
                    th('results.ratingOf', {
                      before: Math.round(o.rating.before),
                      after: Math.round(o.rating.after),
                    }),
                  )}`}
                </Text>
              ) : null}
            </View>
          </PlayerRow>
        );
      })}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------
// 3–4 players: the full ranking (spec §12), a podium for the first three and a row for the 4th

/** The podium's columns in screen order: 2nd, 1st, 3rd (the winner in the middle). */
const PODIUM_ORDER = [1, 0, 2] as const;
/** Heights of the podium steps by position (1st highest), from the spacing scale: the design has no token. */
const STEP_HEIGHT = [space[15], space[13], space[11]] as const;

export function RankingSection({
  ranking,
  myAvatar,
  onOpenPlayer,
}: {
  ranking: readonly RankingRow[];
  myAvatar: AvatarId;
  /** A ranked game: another player opens their card (spec §14.3). */
  onOpenPlayer?: (playerId: string) => void;
}) {
  const { t } = useTranslation('history');
  const { t: tg } = useTranslation('game');
  const { t: tp } = useTranslation('player');
  const podium = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  const nameOf = (r: RankingRow) => (r.isMe ? tg('me') : displayName(r, tp));
  const detailOf = (r: RankingRow) => (r.left ? t('results.ranking.left') : mistakesShort(r.mistakes, tp));
  const labelOf = (r: RankingRow) => {
    const base = { place: r.place, name: nameOf(r), score: scoreText(r.score), mistakes: detailOf(r) };
    return r.rating
      ? t('results.ranking.labelRating', { ...base, delta: signedText(r.rating.delta) })
      : t('results.ranking.label', base);
  };
  const avatarOf = (r: RankingRow) => (r.isMe ? myAvatar : r.avatar);
  const openOf = (r: RankingRow) =>
    onOpenPlayer && !r.isMe && !r.isBot ? () => onOpenPlayer(r.playerId) : undefined;
  const delta = (r: RankingRow) =>
    r.rating ? (
      <Text style={[text('caption'), r.rating.delta < 0 ? styles.danger : styles.success]}>
        {signedText(r.rating.delta)}
      </Text>
    ) : null;

  return (
    <Card title={t('results.ranking.title')} icon="leaderboard" testID="results-ranking">
      <View style={styles.podium}>
        {PODIUM_ORDER.map((k) => {
          const r = podium[k];
          if (!r) return null;
          const palette = paletteAt(r.colorIndex);
          return (
            <PlayerRow
              key={r.playerId}
              style={styles.podiumColumn}
              label={labelOf(r)}
              onPress={openOf(r)}
              testID={`results-podium-${r.place}-${r.playerId}`}
            >
              <Avatar
                avatarId={avatarOf(r)}
                size="compact"
                colorIndex={r.colorIndex}
                bot={r.isBot}
                inactive={r.left}
              />
              <Text style={[text('label'), styles.strong]} numberOfLines={1}>
                {nameOf(r)}
              </Text>
              <Text style={[text('rating'), { color: palette.ring }]}>{scoreText(r.score)}</Text>
              {delta(r)}
              <View
                style={[
                  styles.podiumStep,
                  { height: STEP_HEIGHT[k], borderColor: r.isMe ? palette.ring : color.border },
                ]}
              >
                <Text style={[text('h1'), r.place === 1 ? styles.accent : styles.strong]}>{r.place}</Text>
              </View>
            </PlayerRow>
          );
        })}
      </View>
      {rest.map((r) => (
        <PlayerRow
          key={r.playerId}
          style={[styles.row, styles.restRow, r.isMe ? { borderColor: paletteAt(0).ring } : null]}
          label={labelOf(r)}
          onPress={openOf(r)}
          testID={`results-ranking-${r.place}-${r.playerId}`}
        >
          <Text style={[text('h1'), styles.muted]}>{r.place}</Text>
          <Avatar
            avatarId={avatarOf(r)}
            size="compact"
            colorIndex={r.colorIndex}
            bot={r.isBot}
            inactive={r.left}
          />
          <View style={styles.who}>
            <Text style={[text('playerName'), styles.strong]} numberOfLines={1}>
              {nameOf(r)}
            </Text>
            <Text style={[text('caption'), styles.muted]} numberOfLines={1}>
              {detailOf(r)}
            </Text>
          </View>
          <View style={styles.numbers}>
            <Text style={[text('rating'), { color: paletteAt(r.colorIndex).ring }]}>
              {scoreText(r.score)}
            </Text>
            {delta(r)}
          </View>
        </PlayerRow>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------
// My rating change (spec §12: "שינוי דירוג מונפש")

/**
 * The new rating counts from the old one as the sections land (motion.md §4.7 `ratingCountAt`). Reduced
 * motion: the new rating at once.
 */
export function RatingSection({ rating, gameType }: { rating: RatingResult; gameType: GameType }) {
  const { t } = useTranslation('history');
  const { t: tg } = useTranslation('game');
  const reduce = useReduceMotion();
  const before = Math.round(rating.before);
  const after = Math.round(rating.after);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (reduce) return;
    const id = setTimeout(() => setStarted(true), motion.sequence.victory.ratingCountAt);
    return () => clearTimeout(id);
  }, [reduce]);
  const target = reduce || started ? after : before;
  const shown = Math.round(useCountUp(target, reduce, motion.duration.rewardMax));
  const delta = signedText(rating.delta);
  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('results.rating.label', { delta, before, after })}
      testID="results-rating"
    >
      <View style={styles.head}>
        <Icon name="leaderboard" size={size.icon.inline} color={color.textMuted} />
        <Text style={[text('label'), styles.muted]}>
          {t('results.rating.title', { type: tg(`type.${gameType}`) })}
        </Text>
      </View>
      <View style={styles.ratingRow}>
        <Text style={[text('scoreXL'), styles.strong]} testID="results-rating-value">
          {shown}
        </Text>
        <View style={styles.numbers}>
          <Text
            style={[text('rating'), rating.delta < 0 ? styles.danger : styles.success]}
            testID="results-rating-delta"
          >
            {delta}
          </Text>
          <Text style={[text('caption'), styles.muted]}>{t('results.rating.from', { before })}</Text>
        </View>
      </View>
      {rating.provisional ? (
        <Text style={[text('caption'), styles.muted]}>{t('results.rating.provisional')}</Text>
      ) : null}
    </View>
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
  const { t: th } = useTranslation('history');
  return (
    <Card title={t('results.awards.title')} icon="trophy" testID="results-awards">
      {awards.map((a) => {
        const title = t(`results.awards.${a.kind}`);
        const who = a.winners
          .map((w) => (w.mine ? t('me') : (w.name ?? tp('unknownName'))))
          .join(t('listSep'));
        const value = awardValue(a, t);
        const definition = th(`results.awardDefinitions.${a.kind}`);
        const mine = a.winners.some((w) => w.mine);
        return (
          <View
            key={a.kind}
            style={styles.row}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${t('results.awards.label', { title, who, value })}. ${definition}`}
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
              <Text style={[text('micro'), styles.faint]} testID={`results-award-${a.kind}-definition`}>
                {definition}
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
  pressed: { opacity: 0.85 },
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
  faint: { color: color.textFaint },
  accent: { color: color.accent },
  success: { color: color.success },
  danger: { color: color.danger },
  score: { includeFontPadding: false },
  numbers: { alignItems: 'flex-end', gap: space[1] },
  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space[4] },
  podiumColumn: { flex: 1, minWidth: 0, alignItems: 'center', gap: space[2] },
  podiumStep: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space[2],
    borderTopStartRadius: radius.lg,
    borderTopEndRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    backgroundColor: color.surface2,
  },
  restRow: {
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
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
