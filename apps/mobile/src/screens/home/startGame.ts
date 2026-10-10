import { router } from 'expo-router';

import { useGameStore } from '../../game/gameStore';
import { type LastPlay, useProfile } from '../../state/profile';
import { DEFAULT_BOT_LEVEL, isStartableMode } from './homeModel';

/**
 * Starts a game and opens the game screen: the game-type screen's "התחל אימון", the bot selection's start, and
 * Home's "עוד סיבוב". A practice against a bot plays the level in `play` (the last one chosen, or the default,
 * when it has none). The choice is remembered for the next "עוד סיבוב" and for the bot selection. Resolves
 * false when the game could not start (the screen says so); a start overtaken by a newer one resolves true and
 * opens nothing, because the newer one does.
 */
export async function startAndOpen(play: LastPlay, how: 'push' | 'replace'): Promise<boolean> {
  if (!isStartableMode(play.mode)) return false;
  const { gameType } = play;
  const store = useGameStore.getState();
  const level =
    play.mode === 'bot' ? (play.botLevel ?? useProfile.getState().botLevel ?? DEFAULT_BOT_LEVEL) : null;
  try {
    const session =
      level === null
        ? await store.startPractice({ gameType })
        : await store.startBotPractice({ gameType, level });
    if (!session) return true;
    useProfile
      .getState()
      .rememberPlay(
        level === null ? { mode: play.mode, gameType } : { mode: 'bot', gameType, botLevel: level },
      );
    if (how === 'push') router.push('/game');
    else router.replace('/game');
    return true;
  } catch (error) {
    console.warn('[practice] could not start a practice', error);
    return false;
  }
}
