import { type Href, router, Stack } from 'expo-router';
import { useEffect, useRef } from 'react';

import { normalizeAvatarId } from '../../src/avatars';
import { refreshMe, useAuth } from '../../src/auth/authStore';
import { ROUTES } from '../../src/auth/redirect';
import { useGameStore } from '../../src/game/gameStore';
import { FlowFallback } from '../../src/screens/FlowFallback';
import { goBack, startAndOpen } from '../../src/screens/home';
import { headerOf, MatchScreen } from '../../src/screens/match';
import { useProfile } from '../../src/state/profile';

/**
 * /match: the ranked search the game store holds (work plan stage 9, spec §10), from searching to GO; then
 * the game replaces it (motion.md `flow.fade`). Started from the game type's "מצא יריב", Home's "עוד סיבוב"
 * or the results' "משחק חדש" (screens/home/startGame.ts). No search, nothing to show: back to the modes (a
 * spinner meanwhile, and a way out should they not come: never an empty screen).
 * The back swipe is off; Android's back cancels a search, and nothing from "found" on [D32].
 */
export default function MatchRoute() {
  const match = useGameStore((s) => s.match);
  const me = useAuth((s) => s.me);
  const localName = useProfile((s) => s.name);
  const localAvatar = useProfile((s) => s.avatarId);
  const leaving = useRef(false);

  useEffect(() => {
    if (!match && !leaving.current) router.replace('/modes');
  }, [match]);

  if (!match) {
    // The modes are on their way (the effect above), or this screen is going: only reported should it stay.
    return (
      <FlowFallback
        reason="match: no search"
        report={() => !leaving.current}
        onHome={() => router.replace('/modes')}
      />
    );
  }
  const gameType = headerOf(match.queueKey).gameType;

  /** Out of the flow: the search (or its failure) goes, then the screen. */
  const leaveTo = (go: () => void) => {
    leaving.current = true;
    useGameStore.getState().clear();
    go();
  };
  const dismissTo = (href: Href) => leaveTo(() => router.dismissTo(href));

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <MatchScreen
        match={match}
        self={{
          name: me?.displayName ?? localName,
          avatarId: me ? normalizeAvatarId(me.avatarId) : localAvatar,
        }}
        onPlay={() => {
          leaving.current = true;
          router.replace('/game');
        }}
        onLeave={() => leaveTo(goBack)}
        onBot={() => {
          leaving.current = true;
          void startAndOpen({ mode: 'bot', gameType }, 'replace');
        }}
        onPractice={() =>
          leaveTo(() => router.replace({ pathname: '/game-type', params: { mode: 'solo', gameType } }))
        }
        onVerifyEmail={() => leaveTo(() => router.replace(ROUTES.verifyEmail))}
        onHome={() => dismissTo('/')}
        onSuspended={() => void refreshMe()}
      />
    </>
  );
}
