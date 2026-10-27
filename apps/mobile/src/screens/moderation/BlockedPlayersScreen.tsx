import type { BlockedPlayer } from '@sudoku-fight/protocol';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/authStore';
import { Avatar, Flag } from '../../components/player';
import { Button, SkeletonGroup, SkeletonRows, StateView } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { dateFormat } from '../../i18n/compose';
import { blocksOf, loadBlocks, useBlocks } from '../../moderation/moderation';
import { color, radius, size, space, text } from '../../theme';
import { isolateName } from '../game/hit/hitModel';
import { goBack } from '../home/navigation';
import { GUTTER, ScreenHeader } from '../home/parts';
import { useModerationFlow } from './useModerationFlow';

/** "14 באוק׳ 2026" in the app's language, with Western digits (D108). */
export function blockedSince(at: number, language: string): string {
  try {
    return dateFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/**
 * Settings → "שחקנים חסומים" (spec §3.5): the players I blocked, newest first, each with its avatar, name and
 * date and "בטל חסימה" (with a confirmation that says what changes). The list is the server's (GET /v1/me/blocks):
 * read each time the screen opens, with a skeleton while it loads, "אין שחקנים חסומים" when there are none, and
 * a plain error with "נסה שוב" when it can't be read.
 */
export function BlockedPlayersScreen() {
  const { t, i18n } = useTranslation('moderation');
  const { top, bottom } = useSafeAreaInsets();
  const owner = useAuth((s) => (s.status === 'ready' ? (s.me?.id ?? null) : null));
  const status = useBlocks((s) => (owner !== null && s.owner === owner ? s.status : 'idle'));
  const blocks = useBlocks((s) => blocksOf(s, owner));
  const max = useBlocks((s) => s.max);
  const errorCode = useBlocks((s) => s.error);
  const flow = useModerationFlow();

  useEffect(() => {
    void loadBlocks({ force: true });
  }, []);

  const retry = () => void loadBlocks({ force: true });
  const loading = status === 'idle' || status === 'loading';

  let body;
  if (owner === null) {
    body = <StateView icon="alert" title={t('blocked.signedOut')} testID="blocked-signed-out" />;
  } else if (blocks.length > 0) {
    body = (
      <View style={styles.list} testID="blocked-list">
        {max !== null ? (
          <Text style={styles.count} testID="blocked-count">
            {t('blocked.count', { count: blocks.length, max })}
          </Text>
        ) : null}
        {blocks.map((player) => (
          <BlockedRow
            key={player.id}
            player={player}
            since={blockedSince(player.blockedAt, i18n.language)}
            onUnblock={() => flow.openUnblock({ id: player.id, name: player.displayName })}
          />
        ))}
      </View>
    );
  } else if (loading) {
    body = (
      <SkeletonGroup label={t('blocked.loading')} testID="blocked-loading">
        <SkeletonRows count={3} avatar />
      </SkeletonGroup>
    );
  } else if (status === 'ready') {
    body = (
      <StateView
        icon="block"
        title={t('blocked.emptyTitle')}
        body={t('blocked.emptyBody')}
        testID="blocked-empty"
      />
    );
  } else {
    const offline = status === 'offline';
    body = (
      <StateView
        tone="danger"
        icon={offline ? 'wifiOff' : 'alert'}
        title={offline ? t('blocked.offlineTitle') : t('blocked.errorTitle')}
        body={offline ? t('blocked.offlineBody') : t('blocked.errorBody')}
        code={errorCode}
        actions={[{ label: t('blocked.retry'), icon: 'refresh', onPress: retry, testID: 'blocked-retry' }]}
        testID={offline ? 'blocked-offline' : 'blocked-error'}
      />
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: top }]} testID="blocked-players">
      <ScreenHeader title={t('blocked.title')} onBack={goBack} style={styles.header} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom + space[12] }]}>
        <Text style={styles.note}>{t('blocked.note')}</Text>
        {body}
      </ScrollView>
      {flow.view}
    </View>
  );
}

function BlockedRow({
  player,
  since,
  onUnblock,
}: {
  player: BlockedPlayer;
  since: string;
  onUnblock: () => void;
}) {
  const { t } = useTranslation('moderation');
  const name = isolateName(player.displayName);
  return (
    <View style={styles.row} testID={`blocked-row-${player.id}`}>
      <View style={styles.who} accessible accessibilityLabel={t('blocked.rowLabel', { name, date: since })}>
        <Avatar avatarId={player.avatarId} size="list" />
        <View style={styles.texts}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {player.displayName}
            </Text>
            {player.country ? <Flag country={player.country} size="home" decorative /> : null}
          </View>
          <Text style={styles.since} numberOfLines={1}>
            {t('blocked.since', { date: since })}
          </Text>
        </View>
      </View>
      <Button
        variant="ghost"
        label={t('actions.unblock')}
        accessibilityLabel={t('actions.unblockLabel', { name })}
        onPress={onUnblock}
        testID={`blocked-unblock-${player.id}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
  content: { paddingHorizontal: GUTTER.screen, paddingTop: space[6], gap: space[8] },
  note: { ...text('caption'), color: color.textMuted },
  list: { gap: space[4] },
  count: { ...text('label'), color: color.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: size.listRow,
    paddingStart: space[6],
    paddingEnd: space[2],
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space[5] },
  texts: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[1] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], maxWidth: '100%' },
  name: { ...text('rowTitle'), color: color.text, flexShrink: 1 },
  since: { ...text('caption'), color: color.textMuted },
});
