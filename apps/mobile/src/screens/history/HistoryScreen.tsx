import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AvatarId } from '../../assets/avatars';
import { BottomNav, Button, type NavTab, SkeletonGroup, SkeletonRows, StateView } from '../../components/ui';
import { color, radius, space, text, tokens } from '../../theme';
import { HistoryCard } from './HistoryCard';
import { type HistoryDeps, HistoryLoader, type HistorySnapshot } from './historyLoader';
import { HISTORY_FILTERS, type HistoryEntry, type HistoryFilter, PAGE_SIZE } from './historyModel';

/**
 * The history tab (spec §14.1; History.dc.html, History-Empty.dc.html): every game, newest first, ranked games
 * from the server merged with the practices on this phone, 20 more at a time; filters "הכל · מדורג · אימון";
 * each card opens the replay. Offline (or signed out) the practices still show, with a note. Empty: "עוד אין
 * משחקים כאן" and "שחק את המשחק הראשון".
 *
 * Stage 13 (spec §16.3, §4.1 "מצבי שגיאה"): while a page loads, the cards' skeleton (Loading.dc.html); when
 * nothing shows because a source failed (no connection, the server's error, the phone's database), that
 * failure is the screen's state, with "נסה שוב" and the small support code, never "no games yet".
 */

export interface HistoryScreenProps {
  /** Where the games come from; called once. */
  deps: () => HistoryDeps;
  onOpen: (entry: HistoryEntry) => void;
  /** A ranked game's opponent: their player card (stage 12). */
  onOpenPlayer?: (playerId: string) => void;
  /** "שחק את המשחק הראשון". */
  onPlay: () => void;
  onTab: (tab: NavTab) => void;
  myAvatar: AvatarId;
  /** For "היום" / "אתמול". */
  now?: () => number;
  testID?: string;
}

export function HistoryScreen({
  deps,
  onOpen,
  onOpenPlayer,
  onPlay,
  onTab,
  myAvatar,
  now = Date.now,
  testID = 'history',
}: HistoryScreenProps) {
  const { t } = useTranslation('history');
  const { top } = useSafeAreaInsets();
  // One loader for the screen's life: it keeps what it has read, page by page.
  const [loader] = useState(() => new HistoryLoader(deps()));
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [snap, setSnap] = useState<HistorySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  /** The latest request wins: an older answer (another filter) never replaces a newer one. */
  const run = (task: () => Promise<HistorySnapshot>) => {
    const id = ++request.current;
    setBusy(true);
    void task().then((next) => {
      if (id !== request.current) return;
      setSnap(next);
      setBusy(false);
    });
  };

  // The first page of "הכל" as the tab opens.
  useEffect(() => {
    const id = ++request.current;
    void loader.show('all').then((next) => {
      if (id === request.current) setSnap(next);
    });
  }, [loader]);

  const pick = (next: HistoryFilter) => {
    if (next === filter) return;
    setFilter(next);
    run(() => loader.show(next));
  };

  const shown = snap?.filter === filter ? snap : null;
  const more = () => {
    if (!busy && shown?.hasMore) run(() => loader.more());
  };

  const failure = shown ? failureOf(shown) : null;
  const reload = () => run(() => loader.reload());

  const notes: { key: string; text: string; retry?: boolean }[] = [];
  if (shown && filter !== 'practice') {
    if (shown.ranked === 'offline' && failure !== 'offline')
      notes.push({ key: 'offline', text: t('notes.offline'), retry: true });
    if (shown.ranked === 'signedOut') notes.push({ key: 'signedOut', text: t('notes.signedOut') });
    if (shown.ranked === 'error' && failure !== 'error')
      notes.push({ key: 'rankedError', text: t('notes.rankedError'), retry: true });
  }
  if (shown && !shown.practiceOk && filter !== 'ranked' && failure !== 'practice')
    notes.push({ key: 'practiceUnavailable', text: t('notes.practiceUnavailable'), retry: true });
  if (filter === 'practice') notes.push({ key: 'practice', text: t('notes.practice') });

  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[text('screenTitle'), styles.strong]}>
        {t('title')}
      </Text>
      <View style={styles.filters} accessibilityRole="tablist" accessibilityLabel={t('filters.label')}>
        {HISTORY_FILTERS.map((f) => (
          <Button
            key={f}
            label={t(`filters.${f}`)}
            variant="secondary"
            size="modal"
            selected={f === filter}
            onPress={() => pick(f)}
            style={styles.filter}
            testID={`history-filter-${f}`}
          />
        ))}
      </View>
      {notes.map((n) => (
        <View key={n.key} style={styles.note} testID={`history-note-${n.key}`}>
          <Text style={[text('caption'), styles.muted, styles.noteText]}>{n.text}</Text>
          {n.retry ? (
            <Button
              label={t('notes.retry')}
              variant="ghost"
              onPress={reload}
              testID={`history-retry-${n.key}`}
            />
          ) : null}
        </View>
      ))}
    </View>
  );

  let empty;
  if (!shown)
    empty = (
      <SkeletonGroup label={t('loading')} testID="history-loading">
        <SkeletonRows count={SKELETON_ROWS} />
      </SkeletonGroup>
    );
  else if (failure)
    // Spec §16.3: a plain explanation, "נסה שוב", and the small code for support.
    empty = (
      <StateView
        tone="danger"
        icon={failure === 'offline' ? 'wifiOff' : 'alert'}
        title={t(`states.${failure}Title`)}
        body={t(`states.${failure}Body`)}
        code={failure === 'practice' ? null : shown.rankedCode}
        actions={[
          {
            label: t('notes.retry'),
            icon: 'refresh',
            onPress: reload,
            loading: busy,
            testID: 'history-retry',
          },
        ]}
        testID={`history-${failure}`}
      />
    );
  else
    empty = (
      <StateView
        icon="history"
        title={t('empty.title')}
        body={t('empty.body')}
        actions={[{ label: t('empty.action'), variant: 'primary', onPress: onPlay, testID: 'history-play' }]}
        testID="history-empty"
      />
    );

  const at = now();
  return (
    <View style={[styles.screen, { paddingTop: top }]} testID={testID}>
      <FlatList
        data={shown?.entries ?? []}
        keyExtractor={(e) => `${e.source}:${e.id}`}
        renderItem={({ item }) => (
          <HistoryCard
            entry={item}
            myAvatar={myAvatar}
            now={at}
            onOpen={onOpen}
            onOpenPlayer={onOpenPlayer}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          shown?.hasMore ? (
            <Button
              label={t('more')}
              variant="secondary"
              size="md"
              loading={busy}
              onPress={more}
              testID="history-more"
            />
          ) : null
        }
        initialNumToRender={PAGE_SIZE}
        onEndReached={more}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.content}
      />
      <BottomNav active="history" onSelect={onTab} testID="nav" />
    </View>
  );
}

/** Cards in the loading skeleton: what fills a phone's screen under the filters. */
const SKELETON_ROWS = 6;

/**
 * Why a filter shows nothing because of a failure, not because there is nothing: the server's games could not
 * be read (offline, or its error) and the phone has none to show for this filter; or the phone's database
 * could not be read. Null when the list is just empty, or has cards.
 */
function failureOf(snap: HistorySnapshot): 'offline' | 'error' | 'practice' | null {
  if (snap.entries.length > 0) return null;
  if (snap.filter !== 'practice' && (snap.ranked === 'offline' || snap.ranked === 'error'))
    return snap.ranked;
  if (snap.filter !== 'ranked' && !snap.practiceOk) return 'practice';
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: {
    paddingHorizontal: tokens.layout.gutterGame,
    paddingTop: space[8],
    paddingBottom: space[12],
    gap: space[4],
  },
  header: { gap: space[6], marginBottom: space[2] },
  filters: { flexDirection: 'row', gap: space[4] },
  filter: { flex: 1 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
  },
  noteText: { flex: 1 },
  strong: { color: color.text },
  muted: { color: color.textMuted },
});
