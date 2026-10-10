import type { League } from '@sudoku-fight/engine';
import type { LeaderboardEntry } from '@sudoku-fight/protocol';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Platform, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ProgressApi } from '../../api/progressApi';
import type { AvatarId } from '../../assets/avatars';
import { Avatar, leagueProgress } from '../../components/player';
import { BottomNav, Button, type NavTab, Spinner } from '../../components/ui';
import { color, radius, space, text, tokens } from '../../theme';
import { Note, ProgressBar, Segmented, StateMessage } from '../progress/parts';
import { provisionalGames } from '../progress/progressModel';
import { type FeedSnapshot, LeaderboardFeed } from './leaderboardFeed';
import {
  captionOf,
  LEADERBOARD_TABS,
  type LeaderboardTab,
  type ProgressT,
  showsPlayersPicker,
  splitPodium,
  TABLE_SIZES,
  type TableSize,
} from './leaderboardModel';
import { LeaderboardRow, PinnedMe, Podium } from './LeaderboardParts';

/**
 * The leaderboard tab (spec §14.2; Leaderboard.dc.html in direction C): a game's leaderboard, not a business
 * table. My league and how far the next one is; the tabs General · Fast · Normal · Hard · Friends; under
 * option A a 2 / 3 / 4 picker on the game-type tabs (the server says which option by its answer); a podium for
 * the first three and a row for everyone after, more as the list scrolls (the server's cursor), and pull to
 * refresh; my row pinned at the bottom. Friends [D27]: the recent opponents and "הזמן חברים" (the share sheet
 * with the server's invite link; hidden without one), or the empty state. Offline: what was read stays, with a
 * note; nothing read yet, the offline state. Every player opens their card.
 */

export interface LeaderboardScreenProps {
  /** The progress API of the signed-in player (null: nobody); called once. */
  api: () => ProgressApi | null;
  /** My public id (me.id): my rows are P1. */
  myId: string | null;
  myAvatar: AvatarId;
  /** My league and the rating it comes from [D9], from my progress; null while not known. */
  myLeague: { league: League | null; rating: number | null } | null;
  onOpenPlayer: (id: string) => void;
  /** "שחק": a new game. */
  onPlay: () => void;
  onTab: (tab: NavTab) => void;
  /** The share sheet ("הזמן חברים"); the phone's by default. */
  share?: (url: string, message: string) => Promise<unknown>;
  testID?: string;
}

const shareInvite = (url: string, message: string) =>
  Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` });

export function LeaderboardScreen({
  api,
  myId,
  myAvatar,
  myLeague,
  onOpenPlayer,
  onPlay,
  onTab,
  share = shareInvite,
  testID = 'leaderboard',
}: LeaderboardScreenProps) {
  const { t } = useTranslation('progress');
  const tp = t as ProgressT;
  const { top } = useSafeAreaInsets();
  // One feed for the screen's life: it keeps what each tab has read.
  const [feed] = useState(() => new LeaderboardFeed(api()));
  const [tab, setTab] = useState<LeaderboardTab>('general');
  const [players, setPlayers] = useState<TableSize | null>(null);
  const [snap, setSnap] = useState<FeedSnapshot>(() => feed.peek('general', null));
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);

  /** The latest request wins: an older answer (another tab) never replaces a newer one. */
  const run = (task: () => Promise<FeedSnapshot>, done?: () => void) => {
    const id = ++request.current;
    void task().then((next) => {
      if (id !== request.current) return;
      setSnap(next);
      done?.();
    });
  };

  // The first page of "כללי" as the tab opens.
  useEffect(() => {
    const id = ++request.current;
    void feed.first('general', null).then((next) => {
      if (id === request.current) setSnap(next);
    });
  }, [feed]);

  const show = (nextTab: LeaderboardTab, nextPlayers: TableSize | null) => {
    setTab(nextTab);
    setPlayers(nextPlayers);
    setLoadingMore(false);
    setSnap(feed.peek(nextTab, nextPlayers));
    run(() => feed.first(nextTab, nextPlayers));
  };

  const refresh = () => {
    setRefreshing(true);
    run(
      () => feed.first(tab, players),
      () => setRefreshing(false),
    );
  };

  const board = snap.tab === tab && snap.players === players ? snap.board : null;
  const status = snap.tab === tab && snap.players === players ? snap.status : 'loading';

  const more = () => {
    if (loadingMore || refreshing || !board?.nextCursor || tab === 'friends') return;
    setLoadingMore(true);
    run(
      () => feed.more(tab, players),
      () => setLoadingMore(false),
    );
  };

  const open = (entry: LeaderboardEntry) => onOpenPlayer(entry.id);
  const friends = tab === 'friends';
  const { podium, rows } = board && !friends ? splitPodium(board.entries) : { podium: [], rows: [] };
  const data = friends ? (board?.friends?.recentOpponents ?? []) : rows;
  const inviteUrl = board?.friends?.inviteUrl ?? null;
  const invite = () => {
    if (inviteUrl) void share(inviteUrl, t('friends.inviteMessage')).catch(() => undefined);
  };
  const retry = () => show(tab, players);

  const notes =
    board && status === 'offline' ? (
      <Note retry={{ label: t('common.retry'), onPress: retry }} testID="leaderboard-note-offline">
        {t('common.offlineNote')}
      </Note>
    ) : board && status === 'error' ? (
      <Note retry={{ label: t('common.retry'), onPress: retry }} testID="leaderboard-note-error">
        {t('common.errorNote')}
      </Note>
    ) : null;

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[text('screenTitle'), styles.strong]} numberOfLines={1}>
          {t('leaderboard.title')}
        </Text>
        {myId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.myCard')}
            onPress={() => onOpenPlayer(myId)}
            hitSlop={space[2]}
            testID="leaderboard-my-card"
          >
            <Avatar avatarId={myAvatar} size="card" colorIndex={0} backdrop={color.bg} />
          </Pressable>
        ) : null}
      </View>
      <MyLeagueCard myLeague={myLeague} />
      <Segmented
        role="tab"
        label={t('leaderboard.tabs.label')}
        items={LEADERBOARD_TABS.map((key) => ({
          key,
          label: t(`leaderboard.tabs.${key}`),
          testID: `leaderboard-tab-${key}`,
        }))}
        value={tab}
        onChange={(key) => show(key, null)}
      />
      <Text style={[text('caption'), styles.muted]} testID="leaderboard-caption">
        {captionOf(tab, board, tp)}
      </Text>
      {showsPlayersPicker(tab, board) ? (
        <Segmented
          role="radio"
          label={t('leaderboard.players')}
          items={TABLE_SIZES.map((n) => ({
            key: n,
            label: t('common.players', { count: n }),
            testID: `leaderboard-players-${n}`,
          }))}
          value={players ?? board?.players ?? null}
          onChange={(n) => show(tab, n)}
          testID="leaderboard-players"
        />
      ) : null}
      {notes}
      {podium.length > 0 ? <Podium podium={podium} myId={myId} onOpen={open} /> : null}
    </View>
  );

  let empty: ReactElement | null = null;
  if (data.length === 0 && podium.length === 0) {
    if (!board && status === 'loading')
      empty = <StateMessage loading title={t('common.loading')} testID="leaderboard-loading" />;
    else if (!board && status === 'offline')
      empty = (
        <StateMessage
          icon="wifiOff"
          title={t('common.offlineTitle')}
          body={t('common.offlineBody')}
          action={{ label: t('common.retry'), onPress: retry, testID: 'leaderboard-retry' }}
          testID="leaderboard-offline"
        />
      );
    else if (!board && status === 'signedOut')
      empty = (
        <StateMessage icon="leaderboard" title={t('common.signedOut')} testID="leaderboard-signed-out" />
      );
    else if (!board)
      empty = (
        <StateMessage
          icon="alert"
          title={t('common.errorTitle')}
          action={{ label: t('common.retry'), onPress: retry, testID: 'leaderboard-retry' }}
          testID="leaderboard-error"
        />
      );
    else if (friends)
      empty = (
        <StateMessage
          icon="leaderboard"
          title={t('friends.emptyTitle')}
          body={t('friends.emptyBody')}
          action={
            inviteUrl
              ? { label: t('friends.invite'), icon: 'share', onPress: invite, testID: 'leaderboard-invite' }
              : { label: t('leaderboard.play'), onPress: onPlay, testID: 'leaderboard-empty-play' }
          }
          testID="leaderboard-friends-empty"
        />
      );
    else
      empty = (
        <StateMessage
          icon="leaderboard"
          title={t('leaderboard.emptyTitle')}
          body={t('leaderboard.emptyBody')}
          action={{ label: t('leaderboard.play'), onPress: onPlay, testID: 'leaderboard-empty-play' }}
          testID="leaderboard-empty"
        />
      );
  }

  const footer = loadingMore ? (
    <View style={styles.more} testID="leaderboard-loading-more">
      <Spinner color={color.textMuted} />
    </View>
  ) : friends && data.length > 0 && inviteUrl ? (
    <View style={styles.inviteCard} testID="leaderboard-invite-card">
      <Text style={[text('caption'), styles.muted, styles.grow]}>{t('friends.inviteNote')}</Text>
      <Button
        label={t('friends.invite')}
        icon="share"
        variant="secondary"
        size="modal"
        onPress={invite}
        testID="leaderboard-invite"
      />
    </View>
  ) : null;

  const showMe = board !== null && (!friends || board.me !== null);

  return (
    <View style={[styles.screen, { paddingTop: top }]} testID={testID}>
      <FlatList
        data={data}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <LeaderboardRow entry={item} mine={item.id === myId} onOpen={open} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={more}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={color.textMuted}
            colors={[color.accent]}
            progressBackgroundColor={color.surface}
          />
        }
        contentContainerStyle={styles.content}
        testID={`${testID}-list`}
      />
      {showMe ? <PinnedMe me={board.me} onOpen={open} onPlay={onPlay} /> : null}
      <BottomNav active="leaderboard" onSelect={onTab} testID="nav" />
    </View>
  );
}

/** My league, and the way to the next one (spec §11.3); "בדירוג זמני" until a key is settled. */
function MyLeagueCard({ myLeague }: { myLeague: LeaderboardScreenProps['myLeague'] }) {
  const { t } = useTranslation('progress');
  if (!myLeague) return null;
  if (myLeague.league === null || myLeague.rating === null) {
    return (
      <View style={styles.league} testID="leaderboard-league-provisional">
        <Text style={[text('rowTitle'), styles.strong]}>{t('common.provisional')}</Text>
        <Text style={[text('caption'), styles.muted]}>
          {t('common.provisionalNote', { games: provisionalGames() })}
        </Text>
      </View>
    );
  }
  const step = leagueProgress(myLeague.rating);
  const name = t('player:league.name', { league: t(`player:league.${myLeague.league}`) });
  const next =
    step.next && step.toNext !== null
      ? t('league.toNext', { points: step.toNext, league: t(`player:league.${step.next}`) })
      : t('league.top');
  return (
    <View style={styles.league} testID="leaderboard-league">
      <View style={styles.leagueLine}>
        <View style={[styles.leagueDot, { backgroundColor: color.league[myLeague.league] }]} />
        <Text style={[text('rowTitle'), { color: color.league[myLeague.league] }]}>{name}</Text>
        <Text style={[text('caption'), styles.muted, styles.grow]} numberOfLines={1}>
          {next}
        </Text>
      </View>
      <ProgressBar
        share={step.share}
        fill={color.league[myLeague.league]}
        label={`${name}${t('player:listSep')}${next}`}
      />
    </View>
  );
}

const DOT = space[5];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: {
    paddingHorizontal: tokens.layout.gutterGame,
    paddingTop: space[8],
    paddingBottom: space[12],
    gap: space[4],
  },
  header: { gap: space[6], marginBottom: space[4] },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[4] },
  league: {
    gap: space[4],
    padding: space[6],
    borderRadius: radius.card,
    backgroundColor: color.surface,
  },
  leagueLine: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  leagueDot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  more: { paddingVertical: space[8], alignItems: 'center' },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    marginTop: space[4],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  grow: { flex: 1 },
  strong: { color: color.text },
  muted: { color: color.textMuted },
});
