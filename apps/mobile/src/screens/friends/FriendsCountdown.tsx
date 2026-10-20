import type { PlayerId } from '@sudoku-fight/engine';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { AVATAR_REACTIONS, AVATAR_STAGES } from '../../avatars/reactions';
import { Avatar } from '../../components/player/Avatar';
import { SeatGlyph } from '../../components/player/SeatGlyph';
import { color, space, text } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { Announcer } from '../game/connection/Announcer';
import { useEnter, useSlam } from '../game/connection/motion';
import type { CountdownStep } from '../match/matchModel';
import { type FriendsLobby, seatsOf } from './friendsModel';

export interface FriendsCountdownProps {
  lobby: FriendsLobby;
  myId: PlayerId | null;
  step: CountdownStep;
}

/**
 * 3… 2… 1… GO! after the host's "התחל" (§3.5), at the server's time, before the board: the players who are in
 * the game (the seats not away), each in their colour and shape, me in P1's. Each step slams in (motion.md
 * `countdown.digit`); reduced motion: a fade only. A screen reader hears each step once. The ranked game's
 * own count (screens/match CountdownView) says "מדורג" in its header, so the room has this one, which doesn't.
 */
export function FriendsCountdown({ lobby, myId, step }: FriendsCountdownProps) {
  const { t } = useTranslation('match');
  const { t: tp } = useTranslation('player');
  const reduce = useReduceMotion();
  const enter = useEnter(reduce);
  const playing = seatsOf(lobby, myId).filter((s) => s.player && !s.player.away);
  const go = step === 'go';
  const line = go
    ? t('countdown.goLabel')
    : t('countdown.stepLabel', { time: tp('seconds', { count: step }) });
  return (
    <View style={styles.root} testID="friends-countdown">
      <Animated.View style={[styles.column, enter]}>
        <View style={styles.strip}>
          {playing.map((s) => (
            <View key={s.player!.id} style={styles.seat} testID={`friends-countdown-${s.player!.id}`}>
              <Avatar
                avatarId={s.player!.avatarId}
                size="card"
                colorIndex={s.colorIndex}
                idle={AVATAR_STAGES.countdown}
                expression={AVATAR_REACTIONS.moods.ready}
              />
              <View style={styles.name}>
                <SeatGlyph colorIndex={s.colorIndex} size={GLYPH} />
                <Text style={styles.nameText} numberOfLines={1}>
                  {s.player!.isMe ? t('me') : s.player!.name}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Step key={String(step)} step={step} reduce={reduce} />
        <Text style={styles.ready}>{go ? t('countdown.starting') : t('countdown.getReady')}</Text>
      </Animated.View>
      <Announcer line={line} testID="friends-countdown-live" />
    </View>
  );
}

function Step({ step, reduce }: { step: CountdownStep; reduce: boolean }) {
  const { t } = useTranslation('match');
  const slam = useSlam(reduce);
  return (
    <Animated.Text style={[step === 'go' ? styles.go : styles.digit, slam]} testID="friends-countdown-step">
      {step === 'go' ? t('countdown.go') : String(step)}
    </Animated.Text>
  );
}

/** The seat shape under each avatar. */
const GLYPH = 10;
/** Four avatars of the card size side by side fit a 360 dp phone. */
const SEAT_WIDTH = 72;

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[8] },
  column: { alignItems: 'center', gap: space[10] },
  strip: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space[6] },
  seat: { width: SEAT_WIDTH, alignItems: 'center', gap: space[3] },
  name: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: SEAT_WIDTH },
  nameText: { ...text('label'), color: color.text, flexShrink: 1 },
  digit: { ...text('scoreXL'), color: color.text },
  go: { ...text('scoreXL'), color: color.accent },
  ready: { ...text('h1'), color: color.text, textAlign: 'center' },
});
