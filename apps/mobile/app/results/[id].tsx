import type { GameMode, GameType } from '@sudoku-fight/engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { refreshMe } from '../../src/auth/authStore';
import { useGameStore } from '../../src/game/gameStore';
import { practiceStorageOrNull } from '../../src/game/storage';
import { DEFAULT_RANKED_PLAYERS, isOpenPlayerCount, startRankedAndOpen } from '../../src/screens/home';
import { loadOnlineResults, loadPracticeResults, ResultsScreen } from '../../src/screens/results';

/**
 * The saved game [D25]; the store's session, if it is this game, is flushed to disk first. An online game
 * (stage 7) is not saved on the phone: its results come from the store's online session.
 */
const load = (id: string) => {
  const online = useGameStore.getState().online;
  if (online?.id === id) return Promise.resolve(loadOnlineResults(id, online));
  return loadPracticeResults(id, {
    repo: practiceStorageOrNull,
    session: () => useGameStore.getState().session,
  });
};

/**
 * Leaving the results ends the game's flow: the store lets go of the finished session. After a ranked game
 * the account's ratings are read again (GET /v1/me), so Home and the modes show the new ones.
 */
const leave = () => {
  const ranked = useGameStore.getState().online?.host.game?.config.mode === 'ranked';
  useGameStore.getState().clear();
  if (ranked) void refreshMe();
};

const goHome = () => {
  leave();
  router.dismissTo('/');
};

/**
 * "משחק חדש": the game-type screen with this game's type; a practice against a bot keeps its mode. After a
 * ranked game from matchmaking (stage 9): a new search in the same queue (the same type and number of
 * players). After a dev room's game (stage 7): the dev room screen in development builds, else the modes.
 */
const newGame = (gameType: GameType, mode?: GameMode) => {
  const online = useGameStore.getState().online;
  const fromQueue = mode === 'ranked' && online?.queueKey !== null && online?.queueKey !== undefined;
  const seats = online?.host.game?.config.players.length ?? DEFAULT_RANKED_PLAYERS;
  leave();
  if (fromQueue) {
    startRankedAndOpen(
      { gameType, players: isOpenPlayerCount(seats) ? seats : DEFAULT_RANKED_PLAYERS },
      'replace',
    );
    return;
  }
  if (mode === 'ranked') router.dismissTo(__DEV__ ? '/dev/online' : '/modes');
  else router.dismissTo({ pathname: '/game-type', params: mode ? { gameType, mode } : { gameType } });
};

/**
 * /results/[id]: the results of a practice saved on this phone (spec §12), alone or against a bot, after a
 * restart too; or of the online game that just ended.
 */
export default function ResultsRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  // Just played here (the store still holds it): a full board, or a win, gets its fanfare.
  const [celebrate] = useState(() => {
    const { session, online } = useGameStore.getState();
    return session?.id === id || online?.id === id;
  });
  return <ResultsScreen gameId={id} load={load} celebrate={celebrate} onNewGame={newGame} onHome={goHome} />;
}
