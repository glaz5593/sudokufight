import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AvatarId } from '../../assets/avatars';
import { Icon } from '../../components/Icon';
import { Avatar, displayName, Flag, formatScore, ltr, scoreText, signedText } from '../../components/player';
import { color, radius, size, space, text, tokens } from '../../theme';
import { dayOf, type HistoryEntry, type HistoryOutcome, shortDate } from './historyModel';

/**
 * One game in the history (spec §14.1; History.dc.html): a result stripe, the opponents' avatars, the mode and
 * the type, the final score, the rating change and the date. The whole card opens the replay.
 */

const STRIPE: Record<HistoryOutcome, string> = {
  win: color.success,
  loss: color.danger,
  tie: color.info,
  completed: color.accent,
  ended: color.textFaint,
  interrupted: color.textFaint,
};

/** At most this many opponents' avatars side by side (a 4-player game has 3). */
const AVATARS_SHOWN = 3;

export interface HistoryCardProps {
  entry: HistoryEntry;
  /** My avatar, for a solo practice (no opponent to show). */
  myAvatar: AvatarId;
  now: number;
  onOpen: (entry: HistoryEntry) => void;
}

export function HistoryCard({ entry: e, myAvatar, now, onOpen }: HistoryCardProps) {
  const { t, i18n } = useTranslation('history');
  const { t: tg } = useTranslation('game');
  const { t: tp } = useTranslation('player');
  const day = dayOf(e.startedAt, now);
  const date = day ? t(`card.${day}`) : shortDate(e.startedAt, i18n.language);
  const opponent = e.opponents.length === 1 ? e.opponents[0]! : null;
  const who = opponent
    ? displayName(opponent, tp)
    : e.opponents.length > 1
      ? [
          e.place === null ? null : t('card.place', { place: e.place }),
          t('card.against', { count: e.opponents.length }),
        ]
          .filter(Boolean)
          .join(' · ')
      : t('card.alone');
  const score =
    e.myScore === null
      ? '—'
      : opponent && e.opponentScore !== null
        ? ltr(`${formatScore(e.myScore)} : ${formatScore(e.opponentScore)}`)
        : t('card.points', { score: scoreText(e.myScore) });
  const rating =
    e.source === 'practice' ? t('card.unrated') : e.ratingDelta === null ? null : signedText(e.ratingDelta);
  const mode = t(`card.mode.${e.mode}`);
  const type = tg(`type.${e.gameType}`);
  const outcome = t(`card.outcome.${e.outcome}`);
  const label = t('card.label', {
    outcome,
    who,
    mode,
    type,
    score,
    rating: rating === null ? '' : e.source === 'practice' ? rating : t('card.rating', { delta: rating }),
    date,
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('card.hint')}
      onPress={() => onOpen(e)}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`history-card-${e.id}`}
    >
      <View
        style={[styles.stripe, { backgroundColor: STRIPE[e.outcome] }]}
        testID={`history-card-${e.id}-stripe-${e.outcome}`}
      />
      <View style={styles.avatars}>
        {e.opponents.length === 0 ? (
          <Avatar avatarId={myAvatar} size="compact" colorIndex={0} />
        ) : (
          e.opponents
            .slice(0, AVATARS_SHOWN)
            .map((o, k) => (
              <Avatar
                key={o.id}
                avatarId={o.avatar}
                size="compact"
                colorIndex={o.colorIndex}
                bot={o.isBot}
                style={k === 0 ? null : styles.overlap}
              />
            ))
        )}
      </View>
      <View style={styles.middle}>
        <View style={styles.row}>
          <Text style={[text('rowTitle'), styles.strong, styles.shrink]} numberOfLines={1}>
            {who}
          </Text>
          {opponent?.country ? <Flag country={opponent.country} size="compact" decorative /> : null}
        </View>
        <Text style={[text('caption'), styles.muted]} numberOfLines={1}>
          {`${outcome} · ${mode} · ${type}`}
        </Text>
      </View>
      <View style={styles.end}>
        <Text style={[text('scoreSm'), styles.strong]} testID={`history-card-${e.id}-score`}>
          {score}
        </Text>
        {rating === null ? null : (
          <Text
            style={[
              text('caption'),
              e.ratingDelta === null ? styles.muted : e.ratingDelta < 0 ? styles.danger : styles.success,
            ]}
            testID={`history-card-${e.id}-rating`}
          >
            {rating}
          </Text>
        )}
        <Text style={[text('micro'), styles.muted]}>{date}</Text>
      </View>
      <View style={styles.open}>
        <Text style={[text('micro'), styles.accent]}>{t('card.replay')}</Text>
        <Icon name="chevronForward" size={size.icon.chevron} color={color.accent} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    minHeight: size.listRow,
    paddingVertical: space[4],
    paddingEnd: space[4],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: color.surface2 },
  stripe: { alignSelf: 'stretch', width: space[2] },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginStart: -space[5] },
  middle: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: '100%' },
  shrink: { flexShrink: 1 },
  end: { alignItems: 'flex-end', gap: space[1] },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  success: { color: color.success },
  accent: { color: color.accent },
  open: { alignItems: 'center', gap: space[1] },
  danger: { color: color.danger },
});
