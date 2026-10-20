import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef } from 'react';

import { friendsRooms } from '../../src/net/friendsDevice';
import { JoinCodeScreen, type JoinOutcome } from '../../src/screens/friends';
import { goBack } from '../../src/screens/home/navigation';

/** The clipboard's text for "הדבק"; null when there is none (or it can't be read). */
const readClipboard = async (): Promise<string | null> => {
  const text = await Clipboard.getStringAsync();
  return text || null;
};

/**
 * /friends/join: "הצטרף עם קוד" (friends-room.md §3.3), from "משחק חדש" or a room that closed. `?code=`: prefilled.
 * POST /v1/rooms/join with the typed code (net/friends.ts joinByCode); in, the room replaces this screen. A
 * refusal stays here, said under the boxes. Leaving the screen before the server answered calls the join off
 * (friendsRooms().cancel()): a late ticket enters nothing.
 */
export default function FriendsJoinRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  /** A join is waiting for the server. */
  const pending = useRef(false);
  const focused = useRef(true);

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

  const join = useCallback(async (code: string): Promise<JoinOutcome> => {
    pending.current = true;
    const out = await friendsRooms().joinByCode(code, 'code');
    pending.current = false;
    if (out.ok) {
      if (focused.current) router.replace('/friends/room');
      return { ok: true };
    }
    // Called off: this screen is gone (or going); nothing to say.
    if (out.cancelled) return { ok: true };
    return {
      ok: false,
      failure: out.problem,
      retryAfterSec: out.retryAfterMs === null ? null : Math.max(1, Math.ceil(out.retryAfterMs / 1000)),
    };
  }, []);

  return (
    <JoinCodeScreen
      onJoin={join}
      readClipboard={readClipboard}
      onBack={goBack}
      initialCode={typeof code === 'string' && /^[0-9]{6}$/.test(code) ? code : null}
    />
  );
}
