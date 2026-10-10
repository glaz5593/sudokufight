import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '../../components/Icon';
import { Avatar, type GameResultKind, ltr, scoreText } from '../../components/player';
import type { PracticeGameRecord } from '../../game/practiceRepo';
import type { PracticeHistoryState } from '../../state/practiceHistory';
import { color, radius, size, space, text, tokens } from '../../theme';
import { playerIdentity } from '../game/identity';
import { playedAtText, type RecentOutcome, recentOutcome } from './homeModel';
import { Chip } from './parts';

const OUTCOME_ICON: Record<RecentOutcome, IconName> = {
  completed: 'check',
  ended: 'surrender',
  win: 'trophy',
  loss: 'surrender',
  tie: 'check',
  interrupted: 'pause',
  playing: 'history',
};

/** The avatar's result badge (Dir-C-Home: "נ" on a won game). */
const RESULT_BADGE: Partial<Record<RecentOutcome, GameResultKind>> = {
  win: 'win',
  loss: 'loss',
  tie: 'draw',
};

export interface RecentGamesProps {
  games: readonly PracticeGameRecord[];
  status: PracticeHistoryState['status'];
  onOpen: (gameId: string) => void;
}

/**
 * "משחקים אחרונים" on Home (spec §4.3): the newest practices saved on this phone [D25], each opening its
 * results. Interrupted games are listed too, marked. A game against a bot shows the bot's avatar with the
 * result badge (Dir-C-Home), and reads "ניצחון מול Pip". Nothing shows while the first read is under way, so
 * the empty state never flashes before the games arrive.
 */
export function RecentGames({ games, status, onOpen }: RecentGamesProps) {
  const { t } = useTranslation('home');
  if (status === 'unavailable') {
    return (
      <Text style={styles.note} testID="recent-unavailable">
        {t('recent.unavailable')}
      </Text>
    );
  }
  if (!games.length) {
    if (status !== 'ready') return null;
    return (
      <View style={styles.empty} testID="recent-empty">
        <Text style={styles.emptyTitle}>{t('recent.emptyTitle')}</Text>
        <Text style={styles.note}>{t('recent.emptyBody')}</Text>
      </View>
    );
  }
  return (
    <View style={styles.list} testID="recent-list">
      {games.map((game) => (
        <RecentRow key={game.id} game={game} onPress={() => onOpen(game.id)} />
      ))}
    </View>
  );
}

function RecentRow({ game, onPress }: { game: PracticeGameRecord; onPress: () => void }) {
  const { t, i18n } = useTranslation('home');
  const outcome = recentOutcome(game);
  const title = t('recent.title', {
    mode: t(`modes.${game.mode}.name`),
    type: t(`gameTypes.${game.gameType}.name`),
  });
  const opponent = game.opponents[0] ? playerIdentity(game.opponents[0]) : null;
  const badge = RESULT_BADGE[outcome] ?? null;
  // "ניצחון מול Pip": a Latin name keeps its own order inside Hebrew.
  const outcomeText =
    opponent && badge
      ? t('recent.versus', {
          outcome: t(`recent.outcome.${outcome}`),
          name: ltr(opponent.name ?? t('player:unknownName')),
        })
      : t(`recent.outcome.${outcome}`);
  const when = playedAtText(game.startedAt, i18n.language);
  const score = game.score === null ? t('profile.none') : scoreText(game.score);
  const mistakes = game.mistakes === null ? null : t('player:mistakes.short', { count: game.mistakes });
  const label = [
    title,
    outcomeText,
    game.score === null ? null : t('player:points', { count: game.score, score: scoreText(game.score) }),
    mistakes,
    when,
  ]
    .filter(Boolean)
    .join(t('player:listSep'));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('recent.openHint')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`recent-${game.id}`}
    >
      {opponent ? (
        <Avatar avatarId={opponent.avatar} size="list" result={badge} testID={`recent-avatar-${game.id}`} />
      ) : (
        <View style={styles.iconBox}>
          <Icon name={OUTCOME_ICON[outcome]} size={size.icon.card} color={color.textMuted} />
        </View>
      )}
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.subRow}>
          {outcome === 'interrupted' ? (
            <Chip label={outcomeText} testID={`interrupted-${game.id}`} />
          ) : (
            <Text style={styles.sub} numberOfLines={1}>
              {outcomeText}
            </Text>
          )}
          <Text style={styles.sub} numberOfLines={1}>
            {when}
          </Text>
        </View>
      </View>
      <View style={styles.numbers}>
        <Text style={styles.score}>{score}</Text>
        {mistakes ? (
          <Text style={styles.sub} numberOfLines={1}>
            {mistakes}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronForward" size={size.icon.chevron} color={color.iconFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: size.listRow,
    paddingHorizontal: space[6],
    paddingVertical: space[4],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  pressed: { backgroundColor: color.surface },
  iconBox: {
    width: size.avatar.list.size,
    height: size.avatar.list.size,
    borderRadius: size.avatar.list.radius,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[3] },
  title: { ...text('rowTitle'), color: color.text },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space[4], maxWidth: '100%' },
  sub: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
  numbers: { alignItems: 'flex-end', gap: space[2] },
  score: { ...text('scoreSm'), color: color.text },
  note: { ...text('bodyLong'), color: color.textMuted },
  empty: {
    gap: space[3],
    padding: space[8],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  emptyTitle: { ...text('rowTitle'), color: color.text },
});
