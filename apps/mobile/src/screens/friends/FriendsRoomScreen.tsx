import { GAME_TYPES, type GameType, type PlayerId } from '@sudoku-fight/engine';
import {
  formatFriendCode,
  type FriendsLobbyError,
  type FriendsRoomClosedReason,
} from '@sudoku-fight/protocol';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { Spinner } from '../../components/ui/Spinner';
import { StateView } from '../../components/ui/StateView';
import { useToast } from '../../components/ui/toastStore';
import { FRIENDS_UI, type FriendsUiSettings } from '../../config/friends';
import { cue } from '../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { Announcer } from '../game/connection/Announcer';
import { metrics } from '../game/connection/metrics';
import { useEnter } from '../game/connection/motion';
import { ScreenHeader } from '../home/parts';
import type { CountdownStep } from '../match/matchModel';
import { FriendsCountdown } from './FriendsCountdown';
import {
  changeText,
  closedText,
  failureText,
  type FriendsFailure,
  type FriendsLobby,
  type FriendsPlayer,
  type FriendsT,
  isolateCode,
  isRetryable,
  lobbyChanges,
  lobbyRefusalText,
  maxPlayersOf,
  nameIn,
  namesIn,
  seatsOf,
  shareMessageOf,
  spellDigits,
  startModelOf,
} from './friendsModel';
import { RoomSeatRow } from './RoomSeatRow';

/** A command the server refused (`lobbyRefused`); `seq` tells a new refusal from the same one again. */
export interface LobbyRefusal {
  reason: FriendsLobbyError;
  away?: readonly PlayerId[];
  seq: number;
}

/** Where the room is, as the route reads it from the game store's online session (net/friends.ts). */
export type FriendsRoomPhase =
  /** Creating the room (POST /v1/rooms) or joining it, before the first `lobby`. */
  | { kind: 'opening'; via: 'create' | 'join' }
  /** The waiting room. `reconnecting`: the connection dropped, the seat is held, the app is coming back. */
  | {
      kind: 'lobby';
      lobby: FriendsLobby;
      myId: PlayerId | null;
      reconnecting?: boolean;
      refused?: LobbyRefusal | null;
    }
  /** The host started: 3… 2… 1… GO at the server's time (the route counts it), then the game screen. */
  | { kind: 'countdown'; lobby: FriendsLobby; myId: PlayerId | null; step: CountdownStep }
  /** The game is here: the route moves on to the game screen. */
  | { kind: 'starting' }
  /** Could not get in, or not back in (§3.6). */
  | {
      kind: 'failed';
      failure: FriendsFailure;
      code?: string | null;
      retryAfterSec?: number | null;
      /** I had a seat, and the game started while I was away [D83]: "המשחק התחיל בלעדיך". */
      startedWithout?: boolean;
    }
  /** The server put this phone out of the room (`roomClosed`). */
  | { kind: 'closed'; reason: FriendsRoomClosedReason }
  /** 409 tooManyRooms: "לסגור את החדר הקודם?" about the lobby I host already. */
  | { kind: 'replace'; openCode: string }
  /** Out of the room on purpose (or past its game): the route is on its way elsewhere. */
  | { kind: 'gone' };

export interface FriendsRoomScreenProps {
  phase: FriendsRoomPhase;
  /** The room's link, `https://<server>/r/123456` (protocol roomLink, with this app's server). */
  linkFor: (code: string) => string;
  /** The system share sheet with the message (React Native's Share on the phone). */
  onShare: (message: string) => Promise<unknown>;
  /** Copies the code (expo-clipboard on the phone). */
  onCopy: (code: string) => Promise<unknown>;
  /** The host's "התחל משחק", with the away players they agreed to start without [D83]. */
  onStart: (withoutAway: PlayerId[]) => void;
  /** The host's game type [D82]. */
  onSetGameType: (gameType: GameType) => void;
  /** The host's "הוצא מהחדר", after the confirmation [D85a]. */
  onKick: (playerId: PlayerId) => void;
  /** "יציאה מהחדר", and the header's back: no confirmation, nothing is lost before the game. */
  onLeave: () => void;
  onRetry: () => void;
  onCreateRoom: () => void;
  onJoinWithCode: () => void;
  onHome: () => void;
  /** "לסגור את החדר הקודם?": close it and open a new one, or go back to it. */
  onReplace: (choice: 'close' | 'rejoin') => void;
  settings?: FriendsUiSettings;
}

/**
 * The friends room (friends-room.md §3.2): the big code, "שתף קישור" and "העתק קוד", the game type (the host
 * picks, everyone sees it), the seats with avatar, flag and rating, and "התחל משחק · 2 שחקנים" for the host,
 * on from 2 connected players; the guests read "מחכים ש־MosheG יתחיל". Pure UI: what the room is comes in as
 * `phase`, and every press is a callback (the route sends it through net/friends.ts). A friend coming in gets
 * a short sound and a light haptic, and a screen reader hears "Dana הצטרף".
 */
export function FriendsRoomScreen({
  phase,
  linkFor,
  onShare,
  onCopy,
  onStart,
  onSetGameType,
  onKick,
  onLeave,
  onRetry,
  onCreateRoom,
  onJoinWithCode,
  onHome,
  onReplace,
  settings = FRIENDS_UI,
}: FriendsRoomScreenProps) {
  const { t } = useTranslation('friends');
  const { top, bottom } = useSafeAreaInsets();

  const body = (() => {
    switch (phase.kind) {
      case 'gone':
        return (
          <View style={styles.center} testID="friends-gone">
            <Spinner color={color.textMuted} size={size.icon.header} />
          </View>
        );
      case 'opening':
      case 'starting':
        return (
          <View style={styles.center} testID="friends-opening">
            <Spinner color={color.accent} size={size.icon.header} />
            <Text style={styles.status} accessibilityLiveRegion="polite">
              {phase.kind === 'starting'
                ? t('start.starting')
                : phase.via === 'create'
                  ? t('opening.create')
                  : t('opening.join')}
            </Text>
          </View>
        );
      case 'countdown':
        return <FriendsCountdown lobby={phase.lobby} myId={phase.myId} step={phase.step} />;
      case 'lobby':
        return (
          <Lobby
            phase={phase}
            linkFor={linkFor}
            onShare={onShare}
            onCopy={onCopy}
            onStart={onStart}
            onSetGameType={onSetGameType}
            onKick={onKick}
            onLeave={onLeave}
            settings={settings}
            bottom={bottom}
          />
        );
      case 'failed':
        return (
          <StateView
            icon={phase.failure === 'network' ? 'wifiOff' : 'alert'}
            title={phase.startedWithout ? t('startedWithout') : failureText(t, phase.failure, phase)}
            tone="danger"
            actions={[
              ...(isRetryable(phase.failure)
                ? [
                    {
                      label: t('actions.retry'),
                      onPress: onRetry,
                      icon: 'refresh' as const,
                      testID: 'friends-retry',
                    },
                  ]
                : []),
              { label: t('actions.joinWithCode'), onPress: onJoinWithCode, testID: 'friends-join-code' },
              { label: t('actions.home'), onPress: onHome, testID: 'friends-home' },
            ]}
            style={styles.center}
            testID="friends-failed"
          />
        );
      case 'closed':
        return (
          <StateView
            icon="close"
            title={closedText(t, phase.reason)}
            actions={[
              { label: t('actions.createRoom'), onPress: onCreateRoom, testID: 'friends-create' },
              { label: t('actions.home'), onPress: onHome, testID: 'friends-home' },
            ]}
            announce
            style={styles.center}
            testID="friends-closed"
          />
        );
      case 'replace':
        return (
          <ConfirmModal
            visible
            title={t('replace.title')}
            body={t('replace.body', { code: isolateCode(phase.openCode) })}
            confirmLabel={t('replace.confirm')}
            cancelLabel={t('replace.cancel')}
            onConfirm={() => onReplace('close')}
            onCancel={() => onReplace('rejoin')}
            testID="friends-replace"
          />
        );
    }
  })();

  return (
    <View style={[styles.screen, { paddingTop: top }]} testID="friends-room">
      <ScreenHeader
        title={t('title')}
        subtitle={
          phase.kind === 'lobby' || phase.kind === 'countdown' ? subtitleOf(t, phase.lobby) : undefined
        }
        onBack={
          phase.kind === 'countdown' || phase.kind === 'starting' || phase.kind === 'gone'
            ? undefined
            : phase.kind === 'lobby' || phase.kind === 'opening'
              ? onLeave
              : onHome
        }
        style={styles.header}
      />
      {body}
    </View>
  );
}

const subtitleOf = (t: FriendsT, lobby: FriendsLobby): string =>
  t('subtitle', {
    type: t(`game:type.${lobby.gameType}`),
    count: lobby.players.length,
    max: maxPlayersOf(lobby),
  });

type LobbyProps = Pick<
  FriendsRoomScreenProps,
  'linkFor' | 'onShare' | 'onCopy' | 'onStart' | 'onSetGameType' | 'onKick' | 'onLeave'
> & {
  phase: Extract<FriendsRoomPhase, { kind: 'lobby' }>;
  settings: FriendsUiSettings;
  bottom: number;
};

function Lobby({
  phase,
  linkFor,
  onShare,
  onCopy,
  onStart,
  onSetGameType,
  onKick,
  onLeave,
  settings,
  bottom,
}: LobbyProps) {
  const { t } = useTranslation('friends');
  const reduce = useReduceMotion();
  const enter = useEnter(reduce);
  const { lobby, myId } = phase;
  const seats = seatsOf(lobby, myId);
  const start = startModelOf(lobby, myId, settings);
  const isHost = start.isHost;
  const sep = t('player:listSep');
  const [copied, setCopied] = useState(false);
  const [kicking, setKicking] = useState<FriendsPlayer | null>(null);
  const [askStart, setAskStart] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  // Who came, went, stepped away or became the host: said once, and a friend coming in is heard.
  const before = useRef<FriendsLobby | null>(null);
  useEffect(() => {
    const was = before.current;
    const changes = lobbyChanges(was, lobby, myId);
    before.current = lobby;
    // A guest hears the host's new game type [D82] (the host chose it).
    const typeChanged = was !== null && was.gameType !== lobby.gameType && !isHost;
    if (changes.length === 0 && !typeChanged) return;
    if (settings.joinCue && changes.some((c) => c.kind === 'joined')) cue('matchFound');
    setAnnouncement(
      [
        ...changes.map((c) => changeText(t, c)),
        ...(typeChanged ? [t('gameType.changed', { type: t(`game:type.${lobby.gameType}`) })] : []),
      ].join(t('game:connection.sep')),
    );
  }, [lobby, myId, isHost, settings.joinCue, t]);

  // A refused command, once: a short toast ("רק המארח יכול לעשות את זה").
  const refusedSeq = useRef<number | null>(phase.refused?.seq ?? null);
  useEffect(() => {
    const refused = phase.refused;
    if (!refused || refused.seq === refusedSeq.current) return;
    refusedSeq.current = refused.seq;
    const names = (refused.away ?? []).flatMap((id) => lobby.players.find((p) => p.id === id)?.name ?? []);
    useToast.getState().show({ variant: 'error', message: lobbyRefusalText(t, refused.reason, names, sep) });
  }, [phase.refused, lobby.players, sep, t]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), settings.copiedHoldMs);
    return () => clearTimeout(id);
  }, [copied, settings.copiedHoldMs]);

  const share = () => {
    cue('toggle');
    onShare(shareMessageOf(t, lobby.code, linkFor(lobby.code))).catch(() =>
      useToast.getState().show({ variant: 'error', message: t('share.failed') }),
    );
  };
  const copy = () => {
    cue('toggle');
    onCopy(lobby.code)
      .then(() => setCopied(true))
      .catch(() => useToast.getState().show({ variant: 'error', message: t('copy.failed') }));
  };
  const pressStart = () => {
    if (!start.canStart) return;
    if (start.away.length > 0) {
      setAskStart(true);
      return;
    }
    cue('primaryPress');
    onStart([]);
  };
  const awayNames = namesIn(
    start.away.map((p) => p.name),
    sep,
  );
  const canShare = settings.shareBy === 'everyone' || start.isHost;
  const guestLine = start.hostAway
    ? t('start.hostAway')
    : start.host
      ? t('start.waitingForHost', { name: nameIn(start.host.name) })
      : null;

  return (
    <>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottom + space[9] }]}
        testID="friends-lobby"
      >
        <Animated.View style={[styles.column, enter]}>
          {phase.reconnecting ? (
            <View style={styles.reconnecting} accessibilityLiveRegion="polite" testID="friends-reconnecting">
              <Spinner color={color.textMuted} size={size.icon.inline} />
              <Text style={styles.reconnectingText}>{t('reconnecting')}</Text>
            </View>
          ) : null}

          <View style={styles.codeCard}>
            <Text style={styles.codeTitle}>{t('code.title')}</Text>
            <Text
              selectable
              accessibilityLabel={t('code.label', { spelled: spellDigits(lobby.code) })}
              style={styles.code}
              testID="friends-code"
            >
              {formatFriendCode(lobby.code)}
            </Text>
            <View style={styles.codeActions}>
              {canShare ? (
                <Button
                  label={t('share.button')}
                  icon="share"
                  onPress={share}
                  variant="secondary"
                  size="modal"
                  accessibilityHint={t('share.hint')}
                  style={styles.grow}
                  testID="friends-share"
                />
              ) : null}
              <Button
                label={t('copy.button')}
                icon={copied ? 'check' : undefined}
                onPress={copy}
                variant="secondary"
                size="modal"
                style={styles.grow}
                testID="friends-copy"
              />
            </View>
            {copied ? (
              <Text style={styles.copied} testID="friends-copied">
                {t('copy.done')}
              </Text>
            ) : (
              <Text style={styles.codeHint}>{t('code.hint')}</Text>
            )}
          </View>

          <GameTypePicker
            value={lobby.gameType}
            editable={start.isHost}
            onChange={(type) => {
              if (type === lobby.gameType) return;
              cue('toggle');
              onSetGameType(type);
            }}
          />

          <View style={styles.players}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {t('players.title', { count: lobby.players.length, max: maxPlayersOf(lobby) })}
            </Text>
            {seats.map((seat) => (
              <RoomSeatRow
                key={seat.player?.id ?? `empty-${seat.seat}`}
                seat={seat}
                reduce={reduce}
                onKick={start.isHost && settings.kick ? setKicking : undefined}
                testID={`friends-seat-${seat.seat}`}
              />
            ))}
          </View>

          {start.isHost ? (
            <View style={styles.startBox}>
              <Button
                label={t('start.button', { count: start.connected })}
                onPress={pressStart}
                disabled={!start.canStart}
                accessibilityHint={start.canStart ? undefined : t('start.needMore')}
                testID="friends-start"
              />
              {start.connected < (lobby.minPlayers ?? 2) ? (
                <Text style={styles.hint} testID="friends-start-hint">
                  {t('start.needMore')}
                </Text>
              ) : null}
            </View>
          ) : guestLine ? (
            <View style={styles.waiting} testID="friends-waiting">
              <Spinner color={color.accent} size={size.icon.inline} />
              <Text style={styles.status}>{guestLine}</Text>
            </View>
          ) : null}

          <Button label={t('leave')} onPress={onLeave} variant="ghost" icon="close" testID="friends-leave" />
        </Animated.View>
      </ScrollView>
      <Announcer line={announcement} testID="friends-live" />
      {copied ? <Announcer line={t('copy.done')} /> : null}
      <ConfirmModal
        visible={kicking !== null}
        title={t('kick.title', { name: kicking ? nameIn(kicking.name) : '' })}
        body={t('kick.body')}
        confirmLabel={t('kick.confirm')}
        tone="danger"
        onConfirm={() => {
          const who = kicking;
          setKicking(null);
          if (who) onKick(who.id);
        }}
        onCancel={() => setKicking(null)}
        testID="friends-kick-confirm"
      />
      <ConfirmModal
        visible={askStart}
        title={t('startWithout.title', { names: awayNames })}
        body={t('startWithout.body', { names: awayNames })}
        confirmLabel={t('startWithout.confirm')}
        cancelLabel={t('startWithout.cancel')}
        onConfirm={() => {
          setAskStart(false);
          cue('primaryPress');
          onStart(start.away.map((p) => p.id));
        }}
        onCancel={() => setAskStart(false)}
        testID="friends-start-confirm"
      />
    </>
  );
}

/**
 * "סוג משחק: ( מהיר | רגיל | קשה )": the host picks [D82]; the guests see the choice, the same radios read
 * only, with "המארח בוחר".
 */
function GameTypePicker({
  value,
  editable,
  onChange,
}: {
  value: GameType;
  editable: boolean;
  onChange: (type: GameType) => void;
}) {
  const { t } = useTranslation('friends');
  return (
    <View style={styles.typeBox}>
      <View style={styles.typeHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('gameType.title')}
        </Text>
        <Text style={styles.typeNote}>{editable ? t('gameType.hostPicks') : t('gameType.guestSees')}</Text>
      </View>
      <View style={styles.typeRow} accessibilityRole="radiogroup" accessibilityLabel={t('gameType.title')}>
        {GAME_TYPES.map((type) => {
          const checked = type === value;
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityLabel={t(`game:type.${type}`)}
              accessibilityState={{ checked, disabled: !editable }}
              disabled={!editable}
              onPress={() => onChange(type)}
              style={({ pressed }) => [
                styles.typeOption,
                checked && styles.typeChecked,
                pressed && styles.typePressed,
              ]}
              testID={`friends-type-${type}`}
            >
              <Text style={[styles.typeText, checked && styles.typeTextChecked]}>
                {t(`game:type.${type}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: tokens.layout.gutterGame },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[6], padding: space[9] },
  content: { flexGrow: 1, paddingHorizontal: tokens.layout.gutterGame, paddingTop: space[4] },
  column: { gap: space[8] },
  reconnecting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4] },
  reconnectingText: { ...text('caption'), color: color.textMuted },
  codeCard: {
    alignItems: 'center',
    gap: space[4],
    padding: space[8],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  codeTitle: { ...text('label'), color: color.textMuted },
  // The code is the hero: Teko, always left to right ("123 456"), as the dev rooms' (LobbyView).
  code: {
    ...text('scoreXL'),
    color: color.text,
    letterSpacing: metrics.codeLetterSpacing,
    writingDirection: 'ltr',
    textAlign: 'center',
    includeFontPadding: false,
  },
  codeActions: { flexDirection: 'row', alignSelf: 'stretch', gap: space[6], marginTop: space[2] },
  grow: { flex: 1 },
  codeHint: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  copied: { ...text('label'), color: color.success, minHeight: tokens.type.caption.lineHeight },
  typeBox: { gap: space[4] },
  typeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[4] },
  typeNote: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
  typeRow: { flexDirection: 'row', gap: space[4] },
  typeOption: {
    flex: 1,
    minHeight: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  typeChecked: { borderColor: color.accent, borderWidth: tokens.border.focus },
  typePressed: { backgroundColor: color.surface2 },
  typeText: { ...text('button'), color: color.textMuted },
  typeTextChecked: { color: color.accent },
  players: { gap: space[4] },
  sectionTitle: { ...text('label'), color: color.textMuted },
  startBox: { gap: space[4] },
  hint: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4] },
  status: { ...text('rowTitle'), color: color.text, textAlign: 'center', flexShrink: 1 },
});
