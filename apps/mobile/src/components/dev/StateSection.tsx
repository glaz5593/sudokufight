import type { LeaderboardEntry } from '@sudoku-fight/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Field, PasswordField } from '../../screens/account/Field';
import { HistoryCard } from '../../screens/history/HistoryCard';
import type { HistoryEntry } from '../../screens/history/historyModel';
import { LeaderboardRow } from '../../screens/leaderboard/LeaderboardParts';
import { space } from '../../theme';
import { SkeletonCard, SkeletonGroup, SkeletonRows, StateView } from '../ui';
import { noop } from './ButtonSection';
import { DsNote, Specimen } from './Primitives';

/**
 * DS-Components "מצב ריק", "שורות וניווט" and "שדות", in direction C: the empty state, the no-connection and
 * connection-error states with their support code (spec §16.3, §4.1 "מצבים ריקים", "מצבי שגיאה"), the
 * loading skeleton (motion.md `skeleton`; still under Reduced Motion), the list rows (a history card, a
 * leaderboard row, my pinned row), and the form fields of the account screens in their states (focus by
 * tapping one). Example data is the boards'.
 */

/** Empty, no connection, connection error, and the loading skeleton. */
export function StateSection() {
  const { t } = useTranslation('dev');
  const retry = { label: t('screenStates.retry'), icon: 'refresh' as const, onPress: noop };
  return (
    <>
      <Specimen label={t('screenStates.emptyCaption')} align="stretch">
        <StateView
          icon="history"
          title={t('screenStates.emptyTitle')}
          body={t('screenStates.emptyBody')}
          actions={[{ label: t('screenStates.play'), variant: 'primary', onPress: noop }]}
          testID="ds-state-empty"
        />
      </Specimen>
      <Specimen label={t('screenStates.offlineCaption')} align="stretch">
        <StateView
          tone="danger"
          icon="wifiOff"
          title={t('screenStates.offlineTitle')}
          body={t('screenStates.offlineBody')}
          code="offline"
          actions={[retry, { label: t('screenStates.practice'), onPress: noop }]}
          announce={false}
          testID="ds-state-offline"
        />
      </Specimen>
      <Specimen label={t('screenStates.errorCaption')} align="stretch">
        <StateView
          tone="danger"
          icon="alert"
          title={t('screenStates.errorTitle')}
          body={t('screenStates.errorBody')}
          code="unavailable-503"
          actions={[retry]}
          announce={false}
          testID="ds-state-error"
        />
      </Specimen>
      <Specimen label={t('screenStates.skeletonCaption')} align="stretch">
        <SkeletonGroup label={t('screenStates.loading')} style={styles.skeleton} testID="ds-skeleton">
          <SkeletonRows count={2} />
          <SkeletonCard lines={2} bar />
        </SkeletonGroup>
      </Specimen>
      <DsNote>{t('screenStates.rules')}</DsNote>
    </>
  );
}

/** The boards' example day: a game started at noon, seen an hour later ("היום"). */
const NOON = Date.UTC(2026, 9, 7, 12);

/** "הפסד מול NinaVolt" (row.history). */
const HISTORY_ROW: HistoryEntry = {
  id: 'ds-history',
  source: 'ranked',
  mode: 'ranked',
  gameType: 'normal',
  startedAt: NOON,
  outcome: 'loss',
  place: 2,
  playerCount: 2,
  opponents: [{ id: 'nina', name: 'NinaVolt', avatar: 'maya', isBot: false, country: 'DE', colorIndex: 1 }],
  myScore: 41.5,
  opponentScore: 96.5,
  ratingDelta: -15,
};

const leader = (over: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, 'id'>): LeaderboardEntry => ({
  displayName: over.id,
  avatarId: 'lava-lamp',
  country: 'IL',
  league: 'gold',
  level: 14,
  rank: 1,
  rating: 1300,
  provisional: false,
  games: 40,
  ...over,
});
/** "#2 Elif.T 1356" (row.leader) and "#8 MosheG 1287" (row.me). */
const LEADER_ROW = leader({
  id: 'elif',
  displayName: 'Elif.T',
  avatarId: 'omer',
  country: 'TR',
  rank: 2,
  rating: 1356,
});
const MY_ROW = leader({ id: 'me', displayName: 'MosheG', rank: 8, rating: 1287 });

/** The list rows: a history card, a leaderboard row, my pinned row (P1, with its ●), and their skeleton. */
export function RowSection() {
  const { t } = useTranslation('dev');
  return (
    <>
      <Specimen label={t('rows.history')} align="stretch">
        <HistoryCard entry={HISTORY_ROW} myAvatar="lava-lamp" now={NOON + 3_600_000} onOpen={noop} />
      </Specimen>
      <Specimen label={t('rows.leader')} align="stretch">
        <LeaderboardRow entry={LEADER_ROW} mine={false} onOpen={noop} testID="ds-row-leader" />
      </Specimen>
      <Specimen label={t('rows.me')} align="stretch">
        <LeaderboardRow entry={MY_ROW} mine onOpen={noop} testID="ds-row-me" />
      </Specimen>
      <Specimen label={t('rows.skeleton')} align="stretch">
        <SkeletonGroup label={t('screenStates.loading')} testID="ds-row-skeleton">
          <SkeletonRows count={1} />
        </SkeletonGroup>
      </Specimen>
    </>
  );
}

/** The account screens' fields: plain, email (LTR), password with its eye, an error, and disabled. */
export function FieldSection() {
  const { t } = useTranslation('dev');
  const [name, setName] = useState('MosheG');
  const [email, setEmail] = useState('player@mail.com');
  const [password, setPassword] = useState('fight4ever');
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.fields}>
      <Field label={t('fields.name')} value={name} onChangeText={setName} testID="ds-field-name" />
      <Field
        label={t('fields.email')}
        icon="mail"
        ltr
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        testID="ds-field-email"
      />
      <PasswordField
        label={t('fields.password')}
        value={password}
        onChangeText={setPassword}
        shown={shown}
        onToggleShown={() => setShown((s) => !s)}
        testID="ds-field-password"
      />
      <Field
        label={t('fields.nameError')}
        value="NinaVolt"
        error={t('fields.taken')}
        testID="ds-field-error"
      />
      <Field label={t('fields.disabled')} value="MosheG" editable={false} testID="ds-field-disabled" />
      <DsNote>{t('fields.note')}</DsNote>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: space[6] },
  fields: { gap: space[8] },
});
