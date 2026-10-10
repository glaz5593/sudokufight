import type { PlayerCard } from '@sudoku-fight/protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useAuth } from '../../src/auth/authStore';
import { ROUTES } from '../../src/auth/redirect';
import { currentOwner, signedInProgressApi } from '../../src/progress/appProgress';
import { useMyCard, useMyProgress } from '../../src/progress/hooks';
import { adoptCard } from '../../src/progress/progressStore';
import { goBack } from '../../src/screens/home';
import { PlayerCardScreen } from '../../src/screens/player';

const openReplay = (gameId: string) =>
  router.push({ pathname: '/replay/[id]', params: { id: gameId, source: 'ranked' } });

/** Mine is saved on the phone, so it opens offline next time (and Home shows its numbers). */
const keepMine = (card: PlayerCard) => {
  const owner = currentOwner();
  if (owner && card.id === useAuth.getState().me?.id) adoptCard(owner, card, Date.now());
};

/**
 * /player/[id]: a player's card (spec §14.3). Mine from Home's card and the other tabs; another player's from
 * the leaderboard and a ranked game's results.
 */
export default function PlayerRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const myId = useAuth((s) => s.me?.id ?? null);
  const cached = useMyCard();
  const progress = useMyProgress();
  // One loader for the screen's life (the screen reads again when it changes).
  const [load] = useState(() => {
    const api = signedInProgressApi();
    return api ? (playerId: string) => api.player(playerId) : null;
  });
  return (
    <PlayerCardScreen
      playerId={id}
      load={load}
      myId={myId}
      cached={cached}
      myProgress={progress}
      onBack={goBack}
      onEditProfile={() => router.push(ROUTES.editProfile)}
      onOpenReplay={openReplay}
      onLoaded={keepMine}
    />
  );
}
