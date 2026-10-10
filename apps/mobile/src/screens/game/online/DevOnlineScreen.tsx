import { GAME_TYPES, type GameType } from '@sudoku-fight/engine';
import { normalizeRoomCode } from '@sudoku-fight/protocol';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ltr } from '../../../components/player/format';
import { Button } from '../../../components/ui';
import type { NetIdentity } from '../../../net/onlineClient';
import type { OnlineInfo } from '../../../net/remoteGameHost';
import { color, radius, size, space, text, tokens } from '../../../theme';

export interface DevOnlineScreenProps {
  /** Where the game server is ("192.168.1.20:2567"), for the record. */
  serverAddress: string;
  /** Who this phone joins as (asked once; a token is never shown). */
  identity: () => Promise<NetIdentity>;
  /** "צור חדר": a private room of this game type for 2–4 players; the game screen shows its code. */
  onCreate: (gameType: GameType, playerCount: DevRoomPlayers) => void;
  /** "הצטרף", with the code normalized (protocol normalizeRoomCode). */
  onJoin: (code: string) => void;
  /** The online game already open, if any: its line and "חזרה למשחק". */
  current?: OnlineInfo | null;
  onBackToGame?: () => void;
  /** "מדדי רשת" (/dev/metrics). */
  onMetrics: () => void;
  onClose: () => void;
  testID?: string;
}

/** The sizes of a private room (protocol: 2–4; stage 10 adds 3 and 4). */
export const DEV_ROOM_PLAYERS = [2, 3, 4] as const;
export type DevRoomPlayers = (typeof DEV_ROOM_PLAYERS)[number];

type Who = { kind: 'loading' } | { kind: 'dev'; name: string; id: string } | { kind: 'account' } | null;

/**
 * /dev/online (development builds, work plan stage 7): the way into the game server before matchmaking
 * (stage 9). Create a private room (a game type, 2–4 players) and the game screen shows its code to share, or
 * type a code (LTR, any case, spaces and dashes are fine) and join it. It also shows which server and which
 * identity this phone uses (the dev identity until the account is wired in, stage 8), and links to the network
 * measures. The phone talks to the server only through the game store's online session.
 */
export function DevOnlineScreen({
  serverAddress,
  identity,
  onCreate,
  onJoin,
  current = null,
  onBackToGame,
  onMetrics,
  onClose,
  testID = 'dev-online',
}: DevOnlineScreenProps) {
  const { t } = useTranslation('dev');
  const { t: tGame } = useTranslation('game');
  const insets = useSafeAreaInsets();
  const [gameType, setGameType] = useState<GameType>('fast');
  const [players, setPlayers] = useState<DevRoomPlayers>(2);
  const [typed, setTyped] = useState('');
  const [badCode, setBadCode] = useState(false);
  const [who, setWho] = useState<Who>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    identity().then(
      (id) => {
        if (!alive) return;
        setWho(id.kind === 'dev' ? { kind: 'dev', name: id.name, id: id.devUserId } : { kind: 'account' });
      },
      () => alive && setWho(null),
    );
    return () => {
      alive = false;
    };
  }, [identity]);

  const join = () => {
    const code = normalizeRoomCode(typed);
    if (code === null) {
      setBadCode(true);
      return;
    }
    setBadCode(false);
    onJoin(code);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID={testID}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[12] }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {t('online.title')}
          </Text>
          <Button
            label={t('online.close')}
            variant="ghost"
            icon="close"
            onPress={onClose}
            testID="dev-online-close"
          />
        </View>
        <Text style={styles.muted}>{t('online.subtitle')}</Text>
        <View style={styles.facts}>
          <Text style={styles.fact} testID="dev-online-server">
            {t('online.server', { address: ltr(serverAddress) })}
          </Text>
          {who?.kind === 'dev' ? (
            <>
              <Text style={styles.fact} testID="dev-online-identity">
                {t('online.identity', { name: ltr(who.name) })}
              </Text>
              <Text style={styles.faint}>{t('online.identityId', { id: ltr(who.id) })}</Text>
            </>
          ) : who?.kind === 'account' ? (
            <Text style={styles.fact} testID="dev-online-identity">
              {t('online.identityAccount')}
            </Text>
          ) : null}
        </View>

        {current ? (
          <View style={styles.card} testID="dev-online-current">
            <Text style={styles.cardTitle}>{t('online.current')}</Text>
            <Text style={styles.fact}>
              {t('online.currentLine', {
                code: ltr(current.code ?? t('online.noCode')),
                status: t(`online.status.${current.status}`),
              })}
            </Text>
            {onBackToGame ? (
              <Button
                label={t('online.backToGame')}
                variant="secondary"
                size="md"
                onPress={onBackToGame}
                testID="dev-online-back"
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle} accessibilityRole="header">
            {t('online.createTitle')}
          </Text>
          <Text style={styles.label}>{t('online.gameType')}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {GAME_TYPES.map((type) => (
              <Button
                key={type}
                label={tGame(`type.${type}`)}
                variant="secondary"
                size="modal"
                selected={type === gameType}
                onPress={() => setGameType(type)}
                style={styles.chip}
                testID={`dev-online-type-${type}`}
              />
            ))}
          </View>
          <Text style={styles.label}>{t('online.players')}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {DEV_ROOM_PLAYERS.map((n) => (
              <Button
                key={n}
                label={t('online.playerCount', { n })}
                variant="secondary"
                size="modal"
                selected={n === players}
                onPress={() => setPlayers(n)}
                style={styles.chip}
                testID={`dev-online-players-${n}`}
              />
            ))}
          </View>
          <Button
            label={t('online.create')}
            size="lg"
            accessibilityHint={t('online.createHint')}
            onPress={() => onCreate(gameType, players)}
            testID="dev-online-create"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle} accessibilityRole="header">
            {t('online.joinTitle')}
          </Text>
          <Text style={styles.label} nativeID="dev-online-code-label">
            {t('online.codeLabel')}
          </Text>
          <TextInput
            value={typed}
            onChangeText={(next) => {
              setTyped(next);
              setBadCode(false);
            }}
            onSubmitEditing={join}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            returnKeyType="go"
            accessibilityLabel={t('online.codeLabel')}
            accessibilityLabelledBy="dev-online-code-label"
            accessibilityHint={badCode ? t('online.badCode') : t('online.codeHint')}
            placeholderTextColor={color.textFaint}
            style={[styles.input, badCode ? styles.inputBad : null]}
            testID="dev-online-code"
          />
          <Text style={badCode ? styles.error : styles.faint} accessibilityLiveRegion="polite">
            {badCode ? t('online.badCode') : t('online.codeHint')}
          </Text>
          <Button
            label={t('online.join')}
            variant="secondary"
            size="md"
            disabled={typed.trim() === ''}
            onPress={join}
            testID="dev-online-join"
          />
        </View>

        <Button
          label={t('online.metrics')}
          variant="ghost"
          icon="refresh"
          onPress={onMetrics}
          testID="dev-online-metrics"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: tokens.layout.gutterHome, gap: space[8] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  title: { ...text('screenTitle'), color: color.text, flexShrink: 1 },
  muted: { ...text('body'), color: color.textMuted },
  facts: { gap: space[2] },
  fact: { ...text('caption'), color: color.textMuted },
  faint: { ...text('caption'), color: color.textFaint },
  error: { ...text('caption'), color: color.danger },
  card: {
    gap: space[6],
    padding: space[8],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  cardTitle: { ...text('rowTitle'), color: color.text },
  label: { ...text('label'), color: color.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  chip: { flexGrow: 1 },
  input: {
    ...text('cellRef'),
    minHeight: size.input,
    paddingHorizontal: space[6],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
    color: color.text,
    // A room code is Latin letters and digits: typed and shown left to right in Hebrew too.
    writingDirection: 'ltr',
    textAlign: 'left',
    letterSpacing: space[2],
  },
  inputBad: { borderColor: color.danger },
});
