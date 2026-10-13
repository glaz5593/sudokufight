import type { MyProgress, PlayerCard, RecentResult } from '@sudoku-fight/protocol';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isProgressApiError, isProgressOffline } from '../../api/progressApi';
import { AVATAR_STAGES } from '../../avatars/reactions';
import { Icon } from '../../components/Icon';
import {
  Avatar,
  countryName,
  Flag,
  LeagueBadge,
  paletteAt,
  SeatGlyph,
  signedText,
} from '../../components/player';
import {
  Button,
  IconButton,
  SkeletonCard,
  SkeletonGroup,
  SkeletonTiles,
  StateView,
  supportCodeOf,
} from '../../components/ui';
import { color, radius, size, space, text, tokens } from '../../theme';
import { TokenArt } from '../game/arsenal/TokenArt';
import { ScreenHeader, SectionLabel } from '../home/parts';
import { Note, Panel, ProgressBar } from '../progress/parts';
import {
  dateText,
  deltaText,
  levelProgressOf,
  monthYearText,
  type ProgressT,
  type RatingTile,
  ratingLayout,
  recentWords,
  statCells,
  tileLabel,
  tileWords,
  xpText,
} from './playerCardModel';
import { Sparkline } from './Sparkline';

/**
 * A player's card (spec §14.3; Profile.dc.html in direction C): avatar in its frame (mine: P1), name, flag and
 * country, league and level (mine: the XP bar too); every rating the player has (3 under option B, 9 under
 * option A) with its trend line and peak; the stats (games, wins, losses, win %, current and best streak
 * [D28], best move, mistakes per game); the last 10 results; the achievements (none until the list is
 * approved, stage 12). Mine opens at once on the card saved on the phone, offline too; another player's
 * needs the server.
 */

export type CardLoadStatus = 'loading' | 'ok' | 'offline' | 'error' | 'notFound' | 'signedOut';

export interface PlayerCardScreenProps {
  playerId: string;
  /** GET /v1/players/:id (throws ProgressApiError); null when nobody is signed in. */
  load: ((id: string) => Promise<PlayerCard>) | null;
  /** My public id (me.id): my card has the P1 frame, the XP bar and "עריכת פרופיל". */
  myId: string | null;
  /** My card saved on the phone, shown at once when this is me. */
  cached?: PlayerCard | null;
  /** My progress (the level's XP), when this is me. */
  myProgress?: MyProgress | null;
  onBack: () => void;
  onEditProfile?: () => void;
  /** A result of mine opens its replay (another player's games are not mine to replay). */
  onOpenReplay?: (gameId: string) => void;
  /** Mine: "כל ההישגים" next to the achievements opens the achievements screen (the Profile board). */
  onOpenAchievements?: () => void;
  /** A card came from the server (mine is saved for offline). */
  onLoaded?: (card: PlayerCard) => void;
  testID?: string;
}

const ME = paletteAt(0);
const TILE_SPARK = { width: space[15] + space[12], height: space[10] };

function statusOf(error: unknown): CardLoadStatus {
  if (isProgressApiError(error) && error.code === 'notFound') return 'notFound';
  if (isProgressApiError(error) && (error.code === 'signedOut' || error.code === 'notRegistered'))
    return 'signedOut';
  return isProgressOffline(error) ? 'offline' : 'error';
}

export function PlayerCardScreen({
  playerId,
  load,
  myId,
  cached = null,
  myProgress = null,
  onBack,
  onEditProfile,
  onOpenReplay,
  onOpenAchievements,
  onLoaded,
  testID = 'player-card',
}: PlayerCardScreenProps) {
  const { t, i18n } = useTranslation('progress');
  const tp = t as ProgressT;
  const insets = useSafeAreaInsets();
  const mine = myId !== null && playerId === myId;
  const [card, setCard] = useState<PlayerCard | null>(mine ? cached : null);
  const [status, setStatus] = useState<CardLoadStatus>(load ? 'loading' : 'signedOut');
  /** The last failure's support code (spec §16.3). */
  const [code, setCode] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  });

  useEffect(() => {
    if (!load) return;
    let live = true;
    load(playerId).then(
      (next) => {
        if (!live) return;
        setCard(next);
        setStatus('ok');
        loaded.current?.(next);
      },
      (error: unknown) => {
        if (!live) return;
        setStatus(statusOf(error));
        setCode(supportCodeOf(error));
      },
    );
    return () => {
      live = false;
    };
  }, [load, playerId, attempt]);

  const retry = () => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  };

  const header = (
    <ScreenHeader
      title={t('card.title')}
      onBack={onBack}
      end={
        mine && onEditProfile ? (
          <IconButton
            icon="edit"
            iconSize="header"
            accessibilityLabel={t('card.edit')}
            onPress={onEditProfile}
            testID="player-card-edit"
          />
        ) : undefined
      }
    />
  );

  if (!card) {
    let body;
    if (status === 'loading') body = <CardSkeleton label={t('common.loading')} />;
    else if (status === 'notFound')
      body = <StateView icon="alert" title={t('card.notFound')} testID="player-card-not-found" />;
    else if (status === 'signedOut')
      body = <StateView icon="alert" title={t('common.signedOut')} testID="player-card-signed-out" />;
    else
      // Spec §16.3: a plain explanation, "נסה שוב", and the small code for support.
      body = (
        <StateView
          tone="danger"
          icon={status === 'offline' ? 'wifiOff' : 'alert'}
          title={status === 'offline' ? t('common.offlineTitle') : t('common.errorTitle')}
          body={status === 'offline' ? t('card.offlineBody') : t('common.errorBody')}
          code={code}
          actions={[
            { label: t('common.retry'), icon: 'refresh', onPress: retry, testID: 'player-card-retry' },
          ]}
          testID={status === 'offline' ? 'player-card-offline' : 'player-card-error'}
        />
      );
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]} testID={testID}>
        <View style={styles.content}>
          {header}
          {body}
        </View>
      </View>
    );
  }

  const layout = ratingLayout(card.ratings);
  const cells = statCells(card.stats, tp);
  const level = levelProgressOf(card, mine ? myProgress : null);
  const sep = t('player:listSep');
  const country = card.country ? countryName(card.country, i18n.language) : null;
  const leagueWords = card.league
    ? t('player:league.name', { league: t(`player:league.${card.league}`) })
    : t('common.provisional');
  const joined =
    card.joinedAt === null
      ? null
      : t('card.joinedSince', { date: monthYearText(card.joinedAt, i18n.language) });
  const favorite = card.favoriteInterference;
  const identityLabel = [
    mine ? t('card.meLabel', { name: card.displayName }) : card.displayName,
    country,
    joined,
    leagueWords,
    t('common.level', { level: card.level }),
  ]
    .filter(Boolean)
    .join(sep);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID={testID}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[12] }]}>
        {header}
        {status === 'offline' || status === 'error' ? (
          <Note retry={{ label: t('common.retry'), onPress: retry }} testID="player-card-note">
            {t('card.savedNote')}
          </Note>
        ) : null}

        <Panel style={styles.identity} testID="player-card-identity">
          <View style={styles.identityRow} accessible accessibilityLabel={identityLabel}>
            <Avatar
              avatarId={card.avatarId}
              size="profile"
              colorIndex={mine ? 0 : null}
              backdrop={color.surface}
              idle={AVATAR_STAGES.profile}
            />
            <View style={styles.identityText}>
              <View style={styles.nameRow}>
                {mine ? <SeatGlyph colorIndex={0} size={space[6]} /> : null}
                <Text style={[text('h1'), mine ? styles.me : styles.strong, styles.shrink]} numberOfLines={1}>
                  {card.displayName}
                </Text>
              </View>
              {card.country ? (
                <View style={styles.countryRow}>
                  <Flag country={card.country} size="home" decorative />
                  <Text style={[text('body'), styles.muted]} numberOfLines={1}>
                    {country}
                  </Text>
                </View>
              ) : null}
              {joined ? (
                <Text style={[text('caption'), styles.muted]} numberOfLines={1} testID="player-card-joined">
                  {joined}
                </Text>
              ) : null}
              {card.league ? (
                <LeagueBadge league={card.league} level={card.level} variant="icon" />
              ) : (
                <Text style={[text('micro'), styles.muted]} testID="player-card-provisional">
                  {`${t('common.provisional')}${t('player:sep')}${t('common.level', { level: card.level })}`}
                </Text>
              )}
            </View>
          </View>
          {mine ? (
            <View style={styles.xp} testID="player-card-xp">
              <ProgressBar
                share={level.xpIntoLevel / level.xpForNext}
                label={t('common.xpToNext', {
                  xp: xpText(level.xpIntoLevel, level.xpForNext, tp),
                  level: level.level + 1,
                })}
              />
              <Text style={[text('label'), styles.muted]}>
                {xpText(level.xpIntoLevel, level.xpForNext, tp)}
              </Text>
            </View>
          ) : null}
        </Panel>

        <SectionLabel
          title={t('card.ratingsTitle')}
          note={t('card.ratingsNote', { n: card.ratings.length })}
        />
        {card.ratings.length === 0 ? (
          <Text style={[text('body'), styles.muted]}>{t('card.noRatings')}</Text>
        ) : (
          layout.groups.map((group) => (
            <View key={group.gameType ?? 'other'} style={styles.group}>
              {layout.option === 'A' && group.gameType ? (
                <Text style={[text('label'), styles.muted]}>
                  {t(`home:gameTypes.${group.gameType}.name`)}
                </Text>
              ) : null}
              <View style={styles.tiles}>
                {group.tiles.map((tile) => (
                  <RatingTileView key={tile.key} tile={tile} inGroup={layout.option === 'A'} />
                ))}
              </View>
            </View>
          ))
        )}

        <SectionLabel title={t('card.statsTitle')} />
        <View style={styles.stats} testID="player-card-stats">
          {cells.map((cell) => (
            <View
              key={cell.key}
              style={styles.stat}
              accessible
              accessibilityLabel={`${cell.label}: ${cell.value}`}
              testID={`player-card-stat-${cell.key}`}
            >
              <Text style={[text('scoreCompact'), styles.strong]}>{cell.value}</Text>
              <Text style={[text('micro'), styles.muted]} numberOfLines={2}>
                {cell.label}
              </Text>
            </View>
          ))}
        </View>
        {favorite ? (
          <View
            style={styles.favorite}
            accessible
            accessibilityLabel={t('card.favorite.label', {
              kind: t(`game:arsenal.kind.${favorite.kind}`),
              count: favorite.count,
            })}
            testID="player-card-favorite"
          >
            <View style={styles.favoriteArt}>
              <TokenArt kind={favorite.kind} size={FAVORITE_ART} still testID="player-card-favorite-art" />
            </View>
            <View style={styles.grow}>
              <Text style={[text('micro'), styles.muted]} numberOfLines={1}>
                {t('card.favorite.title')}
              </Text>
              <Text style={[text('h2'), styles.strong]} numberOfLines={1}>
                {t(`game:arsenal.kind.${favorite.kind}`)}
              </Text>
            </View>
            <View style={styles.favoriteCount}>
              <Text style={[text('scoreCompact'), styles.strong]}>{favorite.count}</Text>
              <Text style={[text('micro'), styles.muted]}>
                {t('card.favorite.uses', { count: favorite.count })}
              </Text>
            </View>
          </View>
        ) : null}

        <SectionLabel
          title={t('card.recentTitleSection')}
          note={t('card.recentNote', { n: card.recent.length })}
        />
        <RecentResults
          recent={card.recent}
          mine={mine}
          onOpenReplay={onOpenReplay}
          language={i18n.language}
        />

        <View style={styles.sectionRow}>
          <View style={styles.grow}>
            <SectionLabel title={t('card.achievementsTitle')} />
          </View>
          {mine && onOpenAchievements ? (
            <Button
              variant="ghost"
              label={t('card.allAchievements')}
              onPress={onOpenAchievements}
              testID="player-card-all-achievements"
            />
          ) : null}
        </View>
        {card.achievements.length === 0 ? (
          <View style={styles.soon} testID="player-card-achievements-empty">
            <Icon name="trophy" size={size.icon.card} color={color.textMuted} />
            <Text style={[text('body'), styles.muted, styles.grow]}>{t('achievements.soonShort')}</Text>
          </View>
        ) : (
          <View style={styles.achievements} testID="player-card-achievements">
            {card.achievements.map((a) => (
              <View
                key={a.key}
                style={styles.achievement}
                accessible
                accessibilityLabel={t('achievements.earned', {
                  name: a.key,
                  date: dateText(a.earnedAt, i18n.language),
                })}
              >
                <Icon name="trophy" size={size.icon.card} color={color.accent} />
                <Text style={[text('label'), styles.strong]} numberOfLines={2}>
                  {a.key}
                </Text>
                <Text style={[text('micro'), styles.muted]}>{dateText(a.earnedAt, i18n.language)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Another player's card while it loads (Loading.dc.html; motion.md `skeleton`): the identity panel, the
 * rating tiles and the stats, pulsing; still under reduced motion.
 */
function CardSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} style={styles.skeleton} testID="player-card-loading">
      <SkeletonCard lines={3} />
      <SkeletonTiles count={3} />
      <SkeletonTiles count={4} height={space[15]} />
      <SkeletonTiles count={4} height={space[15]} />
    </SkeletonGroup>
  );
}

function RatingTileView({ tile, inGroup }: { tile: RatingTile; inGroup: boolean }) {
  const { t } = useTranslation('progress');
  const tp = t as ProgressT;
  const tint =
    tile.delta === null || tile.delta === 0 ? color.textMuted : tile.delta > 0 ? color.success : color.danger;
  return (
    <View
      style={styles.tile}
      accessible
      accessibilityLabel={tileWords(tile, tp)}
      testID={`player-card-rating-${tile.key}`}
    >
      <View style={styles.tileHead}>
        <Text style={[text('label'), styles.muted, styles.shrink]} numberOfLines={1}>
          {tileLabel(tile, tp, inGroup)}
        </Text>
        {tile.delta !== null && tile.delta !== 0 ? (
          <Text style={[text('micro'), { color: tint }]}>{deltaText(tile.delta)}</Text>
        ) : null}
      </View>
      <Text style={[text('scoreCompact'), styles.gold]}>{Math.round(tile.rating)}</Text>
      <Sparkline
        trend={tile.trend}
        width={TILE_SPARK.width}
        height={TILE_SPARK.height}
        color={tint}
        testID={`player-card-spark-${tile.key}`}
      />
      <Text style={[text('micro'), tile.atPeak ? styles.gold : styles.muted]} numberOfLines={1}>
        {tile.provisional
          ? t('player:rating.provisional')
          : tile.atPeak
            ? t('card.atPeakShort')
            : t('card.peakShort', { value: Math.round(tile.peak) })}
      </Text>
    </View>
  );
}

function RecentResults({
  recent,
  mine,
  onOpenReplay,
  language,
}: {
  recent: readonly RecentResult[];
  mine: boolean;
  onOpenReplay?: (gameId: string) => void;
  language: string;
}) {
  const { t } = useTranslation('progress');
  const tp = t as ProgressT;
  if (recent.length === 0)
    return (
      <Text style={[text('body'), styles.muted]} testID="player-card-recent-empty">
        {t('card.recentEmpty')}
      </Text>
    );
  const sep = t('player:listSep');
  return (
    <View style={styles.recent}>
      <View
        style={styles.form}
        accessible
        accessibilityLabel={t('card.formLabel', {
          list: recent.map((r) => t(`card.outcome.${r.outcome}`)).join(sep),
        })}
        testID="player-card-form"
      >
        {recent.map((r) => (
          <View key={r.gameId} style={[styles.formChip, FORM_STYLE[r.outcome]]}>
            <Text style={[text('micro'), r.outcome === 'win' ? styles.onWin : styles.strong]}>
              {t(`card.outcomeShort.${r.outcome}`)}
            </Text>
          </View>
        ))}
      </View>
      {recent.map((r) => {
        const date = dateText(r.endedAt, language);
        const words = recentWords(r, tp, date);
        const content = (
          <Fragment>
            <View style={[styles.stripe, { backgroundColor: OUTCOME_COLOR[r.outcome] }]} />
            <View style={styles.grow}>
              <Text style={[text('rowTitle'), styles.strong]} numberOfLines={1}>
                {t('card.recentTitle', {
                  type: t(`home:gameTypes.${r.gameType}.name`),
                  players: t('common.players', { count: r.players }),
                })}
              </Text>
              <Text style={[text('caption'), styles.muted]} numberOfLines={1}>
                {`${t(`card.outcome.${r.outcome}`)}${t('player:sep')}${t('card.place', { place: r.place })}${t('player:sep')}${date}`}
              </Text>
            </View>
            {r.ratingDelta !== null ? (
              <Text style={[text('label'), { color: r.ratingDelta >= 0 ? color.success : color.danger }]}>
                {signedText(Math.round(r.ratingDelta))}
              </Text>
            ) : null}
          </Fragment>
        );
        return mine && onOpenReplay ? (
          <Pressable
            key={r.gameId}
            accessibilityRole="button"
            accessibilityLabel={words}
            accessibilityHint={t('card.replayHint')}
            onPress={() => onOpenReplay(r.gameId)}
            style={({ pressed }) => [styles.result, pressed && styles.pressed]}
            testID={`player-card-recent-${r.gameId}`}
          >
            {content}
          </Pressable>
        ) : (
          <View
            key={r.gameId}
            style={styles.result}
            accessible
            accessibilityLabel={words}
            testID={`player-card-recent-${r.gameId}`}
          >
            {content}
          </View>
        );
      })}
    </View>
  );
}

const OUTCOME_COLOR = { win: color.success, loss: color.danger, tie: color.textMuted } as const;
/** The favourite interference's picture (Profile.dc.html: 40 in its tile), from the spacing scale. */
const FAVORITE_ART = space[12];
const FORM = space[10];
const STRIPE = space[2];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: tokens.layout.gutterGame, paddingTop: space[4], gap: space[8] },
  identity: { gap: space[8] },
  skeleton: { gap: space[8] },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  identityText: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[4] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], maxWidth: '100%' },
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  xp: { gap: space[3], alignItems: 'flex-start' },
  group: { gap: space[3] },
  tiles: { flexDirection: 'row', gap: space[4] },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: space[3],
    padding: space[5],
    borderRadius: radius.card,
    backgroundColor: color.surface,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  stat: {
    width: '22%',
    flexGrow: 1,
    minHeight: size.listRow,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    padding: space[3],
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  favorite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: size.listRow,
    paddingHorizontal: space[6],
    paddingVertical: space[3],
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  favoriteArt: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: color.surface2,
    padding: space[2],
  },
  favoriteCount: { alignItems: 'center', gap: space[1] },
  recent: { gap: space[4] },
  form: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  formChip: {
    width: FORM,
    height: FORM,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: tokens.border.hairline,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    minHeight: size.recentRow,
    paddingEnd: space[6],
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  stripe: { width: STRIPE, alignSelf: 'stretch' },
  pressed: { opacity: 0.85 },
  soon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  achievements: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  achievement: {
    width: '30%',
    flexGrow: 1,
    alignItems: 'center',
    gap: space[2],
    padding: space[5],
    borderRadius: radius.card,
    backgroundColor: color.surface,
  },
  grow: { flex: 1, minWidth: 0 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  shrink: { flexShrink: 1 },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  gold: { color: color.accent },
  me: { color: ME.ring },
  onWin: { color: color.onDanger },
});

const FORM_STYLE = StyleSheet.create({
  win: { backgroundColor: color.success, borderColor: color.success },
  loss: { backgroundColor: color.dangerSubtle, borderColor: color.danger },
  tie: { backgroundColor: color.surface2, borderColor: color.border },
});
