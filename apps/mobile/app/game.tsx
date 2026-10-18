import { type Href, router, Stack } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useGameStore } from '../src/game/gameStore';
import { FlowFallback } from '../src/screens/FlowFallback';
import { GameScreen, OnlineGame } from '../src/screens/game';

/** The game is over: its results replace the game (motion.md `flow.fade`: states of one flow). */
const openResults = (id: string) => router.replace({ pathname: '/results/[id]', params: { id } });

const retry = () => useGameStore.getState().retryOnline();

/**
 * /game: the game the game store holds. A practice, alone or against a bot (started from the game-type screen,
 * the bot selection or Home's "עוד סיבוב"), or an online game (work plan stage 7, from /dev/online): its
 * connecting, its private room's lobby, the game with its connection screens, and its end. No game, nothing to
 * play: back to Home. The back swipe is off; Android back and "סיום אימון" / "כניעה" ask first (spec §6.6).
 *
 * Leaving an online game on purpose (home, practice, the lobby's "יציאה מהחדר") navigates first and closes the
 * session as this screen goes, so the game stays drawn under the transition.
 *
 * Never an empty screen (Moshe's black screens of 1.0.0): with no game to draw, a spinner while Home comes, and a
 * way out should it not (FlowFallback); the game screen offers "לבית" too should its results not open.
 */
export default function GameRoute() {
  const session = useGameStore((s) => s.session);
  const online = useGameStore((s) => s.online);
  const leaving = useRef(false);

  useEffect(() => {
    if (!session && !online && !leaving.current) router.replace('/');
  }, [session, online]);

  // Left on purpose: the session goes with the screen (an online one leaves its room).
  useEffect(
    () => () => {
      if (leaving.current) useGameStore.getState().clear();
    },
    [],
  );

  const leaveTo = (href: Href) => {
    leaving.current = true;
    router.dismissTo(href);
  };
  const leaveBack = () => {
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (online) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: false }} />
        <OnlineGame
          key={online.key}
          session={online}
          onEnded={openResults}
          onHome={() => leaveTo('/')}
          onRetry={retry}
          onLeave={leaveBack}
          onPractice={() => leaveTo('/game-type')}
          devMetrics={__DEV__}
        />
      </>
    );
  }
  if (!session) {
    // Home is on its way (the effect above), or this screen is going: only reported should it stay.
    return (
      <FlowFallback
        reason="game: no game in the store"
        report={() => !leaving.current}
        onHome={() => router.replace('/')}
      />
    );
  }
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <GameScreen key={session.id} session={session} onEnded={openResults} onHome={() => leaveTo('/')} />
    </>
  );
}
