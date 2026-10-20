import { isFriendCode } from '@sudoku-fight/protocol';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { needsNewName } from '../../src/api/me';
import { useAuth } from '../../src/auth/authStore';
import { forgetRoom } from '../../src/auth/pendingInvite';
import { useToast } from '../../src/components/ui/toastStore';
import { friendsRoomLink, friendsRooms } from '../../src/net/friendsDevice';
import {
  entryFailure,
  type FriendsEntryState,
  FriendsRoomScreen,
  isRetryable,
  roomScreenPhase,
} from '../../src/screens/friends';

const noop = () => undefined;
const notInRoom = () => Promise.reject(new Error('not in a room'));

/**
 * /room/[code]: straight into a room by its code [D88 א] (POST /v1/rooms/join), then the room replaces this
 * screen. It is a room link's way in (app/+native-intent.tsx when the app starts from one; auth/
 * InviteLinkPrompt.tsx once whatever was under way is answered for and gone, §6.6) and the way back to the room
 * the app was in when it was closed (`?resume=1`, §6.5: my own seat, no new friends_room_join). A refusal is
 * said here, in the words of §3.6 (a block reads exactly as a wrong code, D85c), with "הצטרף עם קוד" and "לבית".
 *
 * - The join waits for the sign-in to be restored (a link that starts the app mounts this screen under the
 *   Splash, before the auth store knows the player): only a ready player goes in. Signed out, mid-registration
 *   or before a new name, the auth gate takes the invite through the sign-in and brings the player back here.
 * - Leaving the screen before the server answered calls the join off (friendsRooms().cancel()): a late ticket
 *   enters nothing.
 * - `?resume=1` refused for good (the room closed, the game started without me, …): the room is forgotten, so
 *   the next start stays on Home; and `gameStarted` there reads "המשחק התחיל בלעדיך" [D83].
 */
export default function RoomByCodeRoute() {
  const { t } = useTranslation('friends');
  const params = useLocalSearchParams<{ code?: string; resume?: string }>();
  const code = typeof params.code === 'string' && isFriendCode(params.code) ? params.code : null;
  const resume = params.resume === '1';
  const ready = useAuth((s) => s.status === 'ready' && !needsNewName(s.me));
  const [entry, setEntry] = useState<FriendsEntryState | null>({ kind: 'opening', via: 'join' });
  /** A join is waiting for the server. */
  const pending = useRef(false);
  const focused = useRef(true);

  /** POST /v1/rooms/join, then the room (or the refusal, said here). */
  const join = useCallback(
    (code: string) => {
      pending.current = true;
      return friendsRooms()
        .joinByCode(code, resume ? 'resume' : 'link')
        .then((out) => {
          pending.current = false;
          if (out.ok) {
            if (focused.current) router.replace('/friends/room');
            return;
          }
          // Called off: this screen is gone (or going).
          if (out.cancelled) return;
          if (resume && !isRetryable(out.problem)) forgetRoom();
          setEntry(entryFailure(out, code, { resume }));
        });
    },
    [resume],
  );

  // Leaving the screen (back, another screen on top) calls off a join still waiting for the server.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        if (pending.current) {
          pending.current = false;
          friendsRooms().cancel();
        }
      };
    }, []),
  );

  // In at once, as the screen opens (it starts as "מצטרף לחדר…"), once the sign-in is restored.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (!code) {
      started.current = true;
      useToast.getState().show({ variant: 'warning', message: t('link.badCode') });
      router.replace('/');
      return;
    }
    if (!ready) return;
    started.current = true;
    void join(code);
  }, [code, join, ready, t]);

  const retry = () => {
    if (!code) return;
    setEntry({ kind: 'opening', via: 'join' });
    void join(code);
  };

  const home = () => router.dismissTo('/');
  return (
    <FriendsRoomScreen
      phase={roomScreenPhase(null, entry, 0)}
      linkFor={friendsRoomLink}
      onShare={notInRoom}
      onCopy={notInRoom}
      onStart={noop}
      onSetGameType={noop}
      onKick={noop}
      onLeave={home}
      onRetry={retry}
      onCreateRoom={() => router.replace({ pathname: '/friends/room', params: { create: '1' } })}
      onJoinWithCode={() => router.replace({ pathname: '/friends/join', params: code ? { code } : {} })}
      onHome={home}
      onReplace={noop}
    />
  );
}
