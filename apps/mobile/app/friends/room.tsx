import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Share } from 'react-native';

import { useGameStore } from '../../src/game/gameStore';
import { useNow } from '../../src/game/useNow';
import type { FriendsRoomView } from '../../src/net/friends';
import { friendsRoomLink, friendsRooms, useFriendsRoom } from '../../src/net/friendsDevice';
import {
  entryFailure,
  type FriendsEntryState,
  FriendsRoomScreen,
  roomScreenPhase,
} from '../../src/screens/friends';
import { goBack } from '../../src/screens/home/navigation';
import { cue } from '../../src/services/feedback';
import { useProfile } from '../../src/state/profile';

/** The system share sheet, with the message (the code, then the link on its own line: §6.7). */
const shareSheet = (message: string) => Share.share({ message });

/**
 * /friends/room: the friends room the game store holds (friends-room.md §3.2), from "צור חדר" (`?create=1`:
 * the room opens at once, with my last game type [D82]) or a join (/friends/join, /room/[code]) to the
 * 3… 2… 1…; then the game screen takes its place. Everything goes through net/friends.ts (friendsRooms,
 * useFriendsRoom); the screen only draws. Leaving the screen any way but into the game leaves the room
 * ("יציאה מהחדר" frees the seat; nothing is lost before the game), and calls off a way in still waiting for the
 * server (a late ticket enters nothing). Once the host started (3… 2… 1…, then the board coming), there is no
 * way back: Android's back does nothing, as the header has no back and iOS no swipe, so the game is never left
 * without a screen.
 */
export default function FriendsRoomRoute() {
  const { create } = useLocalSearchParams<{ create?: string }>();
  const current = useFriendsRoom();
  const [entry, setEntry] = useState<FriendsEntryState | null>(
    create === '1' ? { kind: 'opening', via: 'create' } : null,
  );
  const lastType = useProfile((s) => s.lastPlay?.gameType);
  const toGame = useRef(false);
  const left = useRef(false);
  /** Ways in (create, rejoin) still waiting for the server. */
  const pending = useRef(0);
  const room = current?.room ?? null;
  const counting = room?.phase === 'countdown';
  const now = useNow(COUNTDOWN_TICK_MS, { enabled: counting, clock: current?.session.clock });

  const openRoom = useCallback(
    async (replace = false) => {
      setEntry({ kind: 'opening', via: 'create' });
      pending.current++;
      const out = await friendsRooms().createRoom({ gameType: lastType, replace });
      pending.current--;
      // Called off: the screen is gone (or going).
      if (!out.ok && out.cancelled) return;
      setEntry(out.ok ? null : entryFailure(out));
    },
    [lastType],
  );

  /** Back into a room I have a seat in (the lobby I host already, or a refused try again). */
  const rejoin = async (code: string) => {
    setEntry({ kind: 'opening', via: 'join' });
    pending.current++;
    const out = await friendsRooms().joinByCode(code, 'resume');
    pending.current--;
    if (!out.ok && out.cancelled) return;
    setEntry(out.ok ? null : entryFailure(out, code));
  };

  // "צור חדר": once, as the screen opens.
  const opened = useRef(false);
  useEffect(() => {
    if (create !== '1' || opened.current) return;
    opened.current = true;
    void openRoom();
  }, [create, openRoom]);

  // The 3… 2… 1…: a beat for each step, GO, then the board (the game screen).
  const beat = useRef<string | null>(null);
  const phase = roomScreenPhase(room, entry, now);
  useEffect(() => {
    const step = phase.kind === 'countdown' ? String(phase.step) : null;
    if (step === null || step === beat.current) return;
    beat.current = step;
    cue(step === 'go' ? 'go' : 'countdownBeat');
  }, [phase]);
  useEffect(() => {
    if (room?.phase !== 'game' || toGame.current) return;
    toGame.current = true;
    router.replace('/game');
  }, [room?.phase]);

  // No room any more (left on purpose, the game ended, or none to begin with): nothing more to show here.
  useEffect(() => {
    if (entry || left.current) return;
    if (room && (room.phase !== 'closed' || room.closed?.problem || room.closed?.reason)) return;
    left.current = true;
    goBack();
  }, [entry, room]);

  // Leaving the screen (back, a swipe, Android's back) leaves the room, unless the game takes its place, and
  // calls off a way in still waiting for the server.
  useEffect(
    () => () => {
      if (pending.current > 0) {
        pending.current = 0;
        friendsRooms().cancel();
      }
      if (!toGame.current) leaveRoom(friendsRooms().room());
    },
    [],
  );

  // The host started: Android's back is held until the game screen takes over (MatchScreen does the same).
  const holdsBack = phase.kind === 'countdown' || phase.kind === 'starting';
  useEffect(() => {
    if (!holdsBack) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [holdsBack]);

  const leave = () => {
    left.current = true;
    friendsRooms().leave();
    goBack();
  };
  const home = () => {
    left.current = true;
    friendsRooms().leave();
    router.dismissTo('/');
  };

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !holdsBack }} />
      <FriendsRoomScreen
        phase={phase}
        linkFor={friendsRoomLink}
        onShare={async (message) => {
          await shareSheet(message);
          friendsRooms().shared();
        }}
        onCopy={(code) => Clipboard.setStringAsync(code)}
        onStart={(withoutAway) => friendsRooms().start(withoutAway)}
        onSetGameType={(gameType) => friendsRooms().setGameType(gameType)}
        onKick={(playerId) => friendsRooms().kick(playerId)}
        onLeave={leave}
        onRetry={() => {
          if (entry?.kind !== 'failed') {
            // The room's own connection gave up: back in by its code (my own seat).
            useGameStore.getState().retryOnline();
            return;
          }
          if (entry.retry === 'create' || entry.code === null) void openRoom();
          else void rejoin(entry.code);
        }}
        onCreateRoom={() => void openRoom()}
        onJoinWithCode={() => {
          left.current = true;
          friendsRooms().leave();
          router.replace('/friends/join');
        }}
        onHome={home}
        onReplace={(choice) => {
          if (entry?.kind !== 'replace') return;
          if (choice === 'close') {
            void openRoom(true);
            return;
          }
          void rejoin(entry.openCode);
        }}
      />
    </>
  );
}

/** The count's own clock tick: each step lands within a tenth of a second of the server's. */
const COUNTDOWN_TICK_MS = 100;

/** The room as the screen goes: still waiting (or getting in), its seat is freed. */
function leaveRoom(room: FriendsRoomView | null): void {
  if (room && (room.phase === 'lobby' || room.phase === 'connecting' || room.phase === 'reconnecting'))
    friendsRooms().leave();
}
