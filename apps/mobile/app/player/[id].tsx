import { type PlayerCard, PLAYER_ID_PATTERN } from '@sudoku-fight/protocol';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { isSuspended } from '../../src/api/me';
import { useAuth } from '../../src/auth/authStore';
import { ROUTES } from '../../src/auth/redirect';
import { refreshLevels, useLevelsSummary } from '../../src/levels/levelsStore';
import { currentOwner, signedInProgressApi } from '../../src/progress/appProgress';
import { useMyCard, useMyProgress } from '../../src/progress/hooks';
import { adoptCard } from '../../src/progress/progressStore';
import { goBack } from '../../src/screens/home';
import { ModerationButtons } from '../../src/screens/moderation';
import { PlayerCardScreen } from '../../src/screens/player';

const openReplay = (gameId: string) =>
  router.push({ pathname: '/replay/[id]', params: { id: gameId, source: 'ranked' } });

/**
 * "כל ההישגים": the achievements tab. Back to it when the card was opened from there, else in the card's place,
 * so the stack never loops (tab → card → tab) or grows (screens/home/navigation.ts).
 */
const openAchievements = () => router.dismissTo('/achievements');

/** Mine is saved on the phone, so it opens offline next time (and Home shows its numbers). */
const keepMine = (card: PlayerCard) => {
  const owner = currentOwner();
  if (owner && card.id === useAuth.getState().me?.id) adoptCard(owner, card, Date.now());
};

const openEditProfile = () => router.push(ROUTES.editProfile);

/**
 * Another player's card ends with "דווח על שחקן" and "חסום שחקן" (spec §3.5). Opened from a ranked game (its
 * results, its history card), a report is about that game.
 */
function moderationOf(gameId: string | null) {
  return function ModerationFooter(card: PlayerCard) {
    return <ModerationButtons player={{ id: card.id, name: card.displayName }} gameId={gameId} />;
  };
}

/** The `gameId` param when it can be a game's id (a link may carry anything): else none. */
const gameIdOf = (param: string | string[] | undefined): string | null =>
  typeof param === 'string' && PLAYER_ID_PATTERN.test(param) ? param : null;

/**
 * /player/[id]: a player's card (spec §14.3). Mine from Home's card and the other tabs; another player's from
 * the leaderboard, and from a ranked game's results and history card (with `gameId`, for a report).
 * "עריכת פרופיל" is not offered while the account is suspended (spec §3.5: it can't change). My card also says
 * my staged practice, "שלבים: 87 · ★ 214" (levels.db, read again when the card is shown; D58: mine only).
 */
export default function PlayerRoute() {
  const { id = '', gameId } = useLocalSearchParams<{ id: string; gameId?: string }>();
  const myId = useAuth((s) => s.me?.id ?? null);
  const suspended = useAuth((s) => isSuspended(s.me));
  const cached = useMyCard();
  const progress = useMyProgress();
  const levels = useLevelsSummary();
  useFocusEffect(
    useCallback(() => {
      void refreshLevels();
    }, []),
  );
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
      levels={myId !== null && id === myId ? levels : null}
      onBack={goBack}
      onEditProfile={suspended ? undefined : openEditProfile}
      onOpenReplay={openReplay}
      onOpenAchievements={openAchievements}
      onLoaded={keepMine}
      othersFooter={myId === null ? undefined : moderationOf(gameIdOf(gameId))}
    />
  );
}
