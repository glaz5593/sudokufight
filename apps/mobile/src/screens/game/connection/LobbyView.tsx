import type { PlayerId } from '@sudoku-fight/engine';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AvatarIdOrNone } from '../../../avatars';
import { AVATAR_REACTIONS } from '../../../avatars/reactions';
import { Avatar } from '../../../components/player/Avatar';
import { Button } from '../../../components/ui/Button';
import { Spinner } from '../../../components/ui/Spinner';
import { Text } from '../../../components/ui/Text';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import { Announcer } from './Announcer';
import type { LobbyModel, LobbySeat } from './connectionModel';
import { metrics } from './metrics';
import { useEnter, usePulse } from './motion';
import { nameOf, sentences, spellCode } from './wording';

/** How long "הקוד הועתק" stays after a copy (the success toast's hold, components.md §15.1). */
export const COPIED_HOLD_MS = 2500;

export interface LobbyViewProps {
  model: LobbyModel;
  /** "יציאה מהחדר". */
  onLeave: () => void;
  /** Copies the code. Left out, there is no copy button; the code itself can still be selected and copied. */
  onCopy?: (code: string) => void | Promise<void>;
  /** Shares the invitation. Default: the system share sheet (React Native's Share; its sheet can copy too). */
  onShare?: (message: string) => void | Promise<void>;
  /** The seated players' avatars, when known. */
  avatars?: Partial<Record<PlayerId, AvatarIdOrNone>>;
  testID?: string;
}

const systemShare = async (message: string): Promise<void> => {
  await Share.share({ message });
};

/**
 * A dev room before its game (work plan stage 7: private rooms with a code, outside production; the game
 * starts as soon as every seat is taken, D37). The code is the hero: big Teko, always left to right, spelled
 * out for screen readers, selectable, with "שיתוף הקוד" (and "העתקה" when the app can copy). Then the seats:
 * who is in (me marked "אני", in my P1 colour), and the empty ones blinking "ממתין לשחקן…" (a functional
 * loop; static with reduced motion), and the line "מחכים לעוד שחקן אחד" or "כולם כאן! המשחק מתחיל…".
 * A screen reader hears who came in and how many are still missing, as it changes.
 */
export function LobbyView({
  model: m,
  onLeave,
  onCopy,
  onShare = systemShare,
  avatars,
  testID = 'lobby',
}: LobbyViewProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const enter = useEnter(reduce);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const share = () => {
    Promise.resolve(onShare(t('connection.lobby.shareMessage', { code: m.code }))).catch(() => undefined);
  };
  const copy = onCopy
    ? () => {
        Promise.resolve(onCopy(m.code))
          .then(() => setCopied(true))
          .catch(() => undefined);
      }
    : undefined;

  const full = m.waitingFor === 0;
  const waiting = full
    ? t('connection.lobby.starting')
    : t('connection.lobby.waiting', { count: m.waitingFor });
  const newest = [...m.seats].reverse().find((s) => s.player && !s.player.isMe)?.player ?? null;
  const announcement = sentences(
    [newest && t('connection.lobby.joined', { name: nameOf(newest.name, t) }), waiting],
    t,
  );

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[10], paddingBottom: insets.bottom + space[9] },
        ]}
      >
        <Animated.View style={[styles.column, enter]}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {t('connection.lobby.title')}
            </Text>
            <Text style={styles.subtitle}>
              {t('connection.lobby.subtitle', {
                type: t(`type.${m.gameType}`),
                count: m.playerCount,
                players: m.playerCount,
              })}
            </Text>
          </View>

          <View style={styles.codeCard}>
            <Text style={styles.codeTitle}>{t('connection.lobby.codeTitle')}</Text>
            <Text
              selectable
              accessibilityLabel={t('connection.lobby.codeLabel', { spelled: spellCode(m.code) })}
              style={styles.code}
              testID={`${testID}-code`}
            >
              {m.code}
            </Text>
            <Text style={styles.codeHint}>{t('connection.lobby.codeHint')}</Text>
            <View style={styles.codeActions}>
              <Button
                label={t('connection.lobby.share')}
                onPress={share}
                variant="secondary"
                size="modal"
                style={styles.grow}
                testID={`${testID}-share`}
              />
              {copy ? (
                <Button
                  label={t('connection.lobby.copy')}
                  onPress={copy}
                  variant="secondary"
                  size="modal"
                  icon={copied ? 'check' : undefined}
                  style={styles.grow}
                  testID={`${testID}-copy`}
                />
              ) : null}
            </View>
            {copied ? (
              <Text style={styles.copied} testID={`${testID}-copied`}>
                {t('connection.lobby.copied')}
              </Text>
            ) : null}
          </View>

          <View style={styles.players}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {t('connection.lobby.playersTitle')}
            </Text>
            {m.seats.map((seat) => (
              <SeatRow
                key={seat.seat}
                seat={seat}
                avatar={seat.player ? avatars?.[seat.player.id] : undefined}
                reduce={reduce}
                testID={`${testID}-seat-${seat.seat}`}
              />
            ))}
          </View>

          <View style={styles.status} testID={`${testID}-status`}>
            <Spinner color={full ? color.success : color.accent} size={size.icon.inline} />
            <Text style={[styles.statusText, full && styles.statusFull]}>{waiting}</Text>
          </View>
          <Text style={styles.hint}>{t('connection.lobby.hint')}</Text>

          <Button
            label={t('connection.lobby.leave')}
            onPress={onLeave}
            variant="ghost"
            icon="close"
            testID={`${testID}-leave`}
          />
        </Animated.View>
      </ScrollView>
      <Announcer line={announcement} testID={`${testID}-live`} />
      {copied ? <Announcer line={t('connection.lobby.copied')} /> : null}
    </View>
  );
}

function SeatRow({
  seat,
  avatar,
  reduce,
  testID,
}: {
  seat: LobbySeat;
  avatar: AvatarIdOrNone | undefined;
  reduce: boolean;
  testID: string;
}) {
  const { t } = useTranslation('game');
  const p = seat.player;
  const pulse = usePulse(!p, reduce);
  if (!p) {
    return (
      <View
        accessible
        accessibilityLabel={t('connection.lobby.seatEmptyLabel')}
        style={[styles.seat, styles.seatEmpty]}
        testID={testID}
      >
        <View style={styles.emptyAvatar}>
          <Animated.View style={[styles.emptyDot, pulse]} testID={`${testID}-dot`} />
        </View>
        <Text style={styles.emptyText}>{t('connection.lobby.emptySeat')}</Text>
      </View>
    );
  }
  const name = nameOf(p.name, t);
  return (
    <View
      accessible
      accessibilityLabel={p.isMe ? t('connection.lobby.seatMeLabel', { name }) : name}
      style={styles.seat}
      testID={testID}
    >
      {/* In the room: the ready face (a smile). */}
      <Avatar
        avatarId={avatar}
        size="compact"
        colorIndex={seat.colorIndex}
        backdrop={color.surface}
        expression={AVATAR_REACTIONS.moods.ready}
      />
      <Text style={styles.seatName} numberOfLines={1}>
        {p.name}
      </Text>
      {p.isMe ? (
        <View style={styles.meTag}>
          <Text style={styles.meText}>{t('connection.lobby.you')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, paddingHorizontal: tokens.layout.gutterHome },
  column: { gap: space[9] },
  header: { gap: space[3] },
  title: { ...text('screenTitle'), color: color.text },
  subtitle: { ...text('caption'), color: color.textMuted },
  codeCard: {
    alignItems: 'center',
    gap: space[4],
    padding: space[9],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  codeTitle: { ...text('label'), color: color.textMuted },
  code: {
    ...text('scoreXL'),
    color: color.text,
    letterSpacing: metrics.codeLetterSpacing,
    writingDirection: 'ltr',
    textAlign: 'center',
    includeFontPadding: false,
  },
  codeHint: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  codeActions: { flexDirection: 'row', alignSelf: 'stretch', gap: space[6], marginTop: space[4] },
  grow: { flex: 1 },
  copied: { ...text('label'), color: color.success },
  players: { gap: space[4] },
  sectionTitle: { ...text('label'), color: color.textMuted },
  seat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: size.recentRow,
    paddingHorizontal: space[6],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  seatEmpty: { borderStyle: 'dashed', backgroundColor: color.bg },
  emptyAvatar: {
    width: tokens.size.avatar.compact.frame,
    height: tokens.size.avatar.compact.frame,
    borderRadius: radius.md,
    borderWidth: tokens.border.hairline,
    borderStyle: 'dashed',
    borderColor: color.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyDot: {
    width: metrics.dot.size,
    height: metrics.dot.size,
    borderRadius: radius.pill,
    backgroundColor: color.textMuted,
  },
  emptyText: { ...text('rowTitle'), color: color.textMuted },
  seatName: { ...text('playerName'), color: color.text, flexShrink: 1 },
  meTag: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.pill,
    backgroundColor: color.players[0].ring,
  },
  meText: { ...text('badge'), color: color.players[0].onRing },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4] },
  statusText: { ...text('rowTitle'), color: color.text },
  statusFull: { color: color.success },
  hint: { ...text('caption'), color: color.textMuted, textAlign: 'center', marginTop: -space[6] },
});
