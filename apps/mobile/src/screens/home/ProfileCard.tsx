import { GAME_TYPES } from '@sudoku-fight/engine';
import type { MyProgress, RatingEntry } from '@sudoku-fight/protocol';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { leagueRating, ratingsByType } from '../../api/me';
import type { AvatarId } from '../../assets/avatars';
import { Icon } from '../../components/Icon';
import { Avatar, countryName, Flag, LeagueBadge, leagueFor, ltr, Rating } from '../../components/player';
import { color, radius, size, space, text, tokens } from '../../theme';
import { type ProgressT, xpText } from '../player/playerCardModel';
import { ProgressBar } from '../progress/parts';
import { levelView } from '../progress/progressModel';
import { percentOf } from './homeModel';

const HOME = tokens.layout.home;

export interface ProfileCardProps {
  /** The name to show (the default name already filled in). */
  name: string;
  avatarId: AvatarId;
  country: string | null;
  /** Practices saved on this phone; null while unknown. */
  gamesPlayed: number | null;
  /** Share of games won, 0–1 (practices against a bot, for now); null without any decided game. */
  winRate?: number | null;
  /** Wins in a row [D28]; null without any decided game. */
  streak?: number | null;
  /** The account's ratings (GET /v1/me); null without an account profile: "no rating yet". */
  ratings?: readonly RatingEntry[] | null;
  /**
   * My progress (stage 12: GET /v1/me/progress, saved on the phone): the level, the XP bar and the server's
   * league. Null before the first answer: the league then comes from the ratings, and no level shows.
   */
  progress?: Pick<MyProgress, 'level' | 'xpIntoLevel' | 'xpForNext' | 'league' | 'leagueRating'> | null;
  /** Opens my player card (stage 12). Without it the card is not a button. */
  onPress?: () => void;
}

/**
 * The player card at the top of Home (spec §4.3, Dir-C-Home): avatar in my P1 frame, name and flag, the league
 * line, the three ratings and the main numbers: games, win rate and win streak (the Home board's row).
 * The ratings come from the account [D23: 1200, provisional for the first 10 games of a key]; the league
 * shows once a key is settled [D9]. Without an account profile they show their "no rating yet" state. Stage
 * 12: my level and XP bar, and the server's league, from my progress; the numbers from my player card (the
 * ranked games), or from the games saved on this phone before it came. Pressing the card opens my player
 * card.
 */
export function ProfileCard({
  name,
  avatarId,
  country,
  gamesPlayed,
  winRate = null,
  streak = null,
  ratings = null,
  progress = null,
  onPress,
}: ProfileCardProps) {
  const { t, i18n } = useTranslation('home');
  const { t: tProgress } = useTranslation('progress');
  const byType = ratings ? ratingsByType(ratings) : null;
  // The server's league when its progress came [D9]; else the one the ratings give.
  const league = progress ? progress.leagueRating : ratings ? leagueRating(ratings) : null;
  const level = progress ? levelView(progress) : null;
  const xp = level ? xpText(level.into, level.total, tProgress as ProgressT) : null;
  const sep = t('player:listSep');
  const none = t('profile.none');
  const percent = winRate === null ? null : percentOf(winRate);
  const stats = [
    {
      key: 'games',
      value: gamesPlayed === null ? none : String(gamesPlayed),
      label: t('profile.gamesLabel', { count: gamesPlayed ?? 0 }),
    },
    { key: 'wins', value: percent === null ? none : ltr(`${percent}%`), label: t('profile.winsLabel') },
    { key: 'streak', value: streak === null ? none : String(streak), label: t('profile.streakLabel') },
  ];
  const ratingWords = byType
    ? GAME_TYPES.flatMap((type) => {
        const r = byType[type];
        if (!r) return [];
        const base = t('player:rating.labelWithKey', { key: t(`gameTypes.${type}.name`), value: r.rating });
        return [r.provisional ? t('player:rating.provisionalLabel', { label: base }) : base];
      })
    : [];
  // No league yet: provisional ratings (an account), or no rating at all (no account profile).
  const leagueLine =
    league !== null
      ? null
      : progress
        ? tProgress('common.provisional')
        : byType
          ? t('account:home.provisional')
          : t('profile.noRating');
  const leagueWords =
    league !== null
      ? t('player:league.name', { league: t(`player:league.${progress?.league ?? leagueFor(league)}`) })
      : leagueLine;
  const label = [
    t('profile.label', { name }),
    country ? countryName(country, i18n.language) : null,
    leagueWords,
    level ? tProgress('home.levelXp', { level: level.level, xp }) : null,
    ...ratingWords,
    gamesPlayed === null ? null : t('profile.games', { count: gamesPlayed }),
    percent === null ? null : t('profile.winRate', { percent }),
    streak === null ? null : t('profile.streak', { count: streak }),
  ]
    .filter(Boolean)
    .join(sep);

  const content: ReactNode = (
    <>
      <View style={styles.identity}>
        <Avatar avatarId={avatarId} size="home" colorIndex={0} backdrop={color.surface} />
        <View style={styles.names}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1} testID="profile-name">
              {name}
            </Text>
            <Flag country={country} size="home" decorative />
          </View>
          {league !== null ? (
            <LeagueBadge
              rating={league}
              league={progress?.league ?? undefined}
              level={level?.level ?? null}
            />
          ) : (
            <Text style={styles.league} testID="profile-league">
              {level
                ? `${leagueLine}${t('player:sep')}${tProgress('common.level', { level: level.level })}`
                : leagueLine}
            </Text>
          )}
          {level ? (
            <View style={styles.xp} testID="profile-xp">
              <ProgressBar share={level.share} style={styles.xpBar} />
              <Text style={styles.xpText} numberOfLines={1}>
                {xp}
              </Text>
            </View>
          ) : null}
        </View>
        {onPress ? <Icon name="chevronForward" size={size.icon.chevron} color={color.textMuted} /> : null}
      </View>

      <View style={styles.divider}>
        <Text style={styles.dividerLabel}>{t('profile.ratingTitle')}</Text>
        <View style={styles.rule} />
      </View>
      <View style={styles.columns}>
        {GAME_TYPES.map((type, i) => {
          const r = byType?.[type];
          return (
            <Fragment key={type}>
              {i > 0 ? <View style={styles.columnRule} /> : null}
              <View style={styles.column} testID={`rating-${type}`}>
                <Text style={styles.columnLabel}>{t(`gameTypes.${type}.name`)}</Text>
                {r ? (
                  <Rating value={r.rating} size="home" provisional={r.provisional} decorative />
                ) : (
                  <Text style={styles.noRating}>{t('profile.none')}</Text>
                )}
              </View>
            </Fragment>
          );
        })}
      </View>

      <View style={styles.stats}>
        {stats.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 ? <View style={styles.statRule} /> : null}
            <View style={styles.stat} testID={`stat-${s.key}`}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel} numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          </Fragment>
        ))}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={tProgress('leaderboard.openHint')}
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        testID="profile-card"
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={label}
      style={styles.card}
      testID="profile-card"
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: HOME.profileCardPadding,
    backgroundColor: color.surface,
    borderRadius: radius.card,
  },
  pressed: { backgroundColor: color.surface2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: HOME.profileCardGap },
  names: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[4] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[4], maxWidth: '100%' },
  name: { ...text('h1'), color: color.text, flexShrink: 1 },
  league: { ...text('body'), color: color.textMuted },
  xp: { flexDirection: 'row', alignItems: 'center', gap: space[4], alignSelf: 'stretch' },
  xpBar: { flex: 1, width: undefined },
  xpText: { ...text('micro'), color: color.textMuted },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    marginTop: HOME.ratingDividerTop,
  },
  dividerLabel: { ...text('label'), color: color.textMuted },
  rule: { flex: 1, height: tokens.border.hairline, backgroundColor: color.border },
  columns: { flexDirection: 'row', alignItems: 'center', marginTop: HOME.ratingRowTop },
  column: { flex: 1, alignItems: 'center', gap: space[4] },
  columnLabel: { ...text('label'), color: color.textMuted },
  columnRule: {
    width: tokens.border.hairline,
    height: size.dividerVertical.rating,
    backgroundColor: color.border,
  },
  noRating: { ...text('rating'), color: color.textMuted },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: HOME.ratingRowTop,
    paddingTop: space[7],
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.border,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: space[3],
  },
  statRule: {
    width: tokens.border.hairline,
    height: size.dividerVertical.rating,
    backgroundColor: color.border,
  },
  statValue: { ...text('scoreSm'), color: color.text },
  statLabel: { ...text('caption'), color: color.textMuted },
});
