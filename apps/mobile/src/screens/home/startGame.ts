import { router } from 'expo-router';

import { useAuth } from '../../auth/authStore';
import { ROUTES } from '../../auth/redirect';
import { canPlayRanked } from '../../auth/verification';
import { useToast } from '../../components/ui/toastStore';
import { type RankedDeps, type RankedRequest, useGameStore } from '../../game/gameStore';
import i18n from '../../i18n';
import { type LastPlay, useProfile } from '../../state/profile';
import { DEFAULT_BOT_LEVEL, DEFAULT_RANKED_PLAYERS, isOpenPlayerCount, isStartableMode } from './homeModel';

/** The ranked search's screen (stage 9): searching, found, 3-2-1-GO, the timeout. */
export const MATCH_PATH = '/match';

/**
 * The phone's matchmaking wiring (net/matchmakingDevice.ts), loaded when a search starts: it brings the
 * network SDK, which the home screens (and their tests) don't need.
 */
type DeviceMatchmaking = typeof import('../../net/matchmakingDevice');
/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see above */
const deviceRankedDeps = (): RankedDeps =>
  (require('../../net/matchmakingDevice') as DeviceMatchmaking).deviceMatchmakingDeps();
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Starts a game and opens its screen: the game-type screen's start, the bot selection's start, Home's "עוד
 * סיבוב" and the results' "משחק חדש". A practice against a bot plays the level in `play` (the last one
 * chosen, or the default, when it has none); a ranked game searches its queue (startRankedAndOpen). The
 * choice is remembered for the next "עוד סיבוב" and for the bot selection. Resolves false when the game
 * could not start (the screen says so); a start overtaken by a newer one resolves true and opens nothing,
 * because the newer one does.
 */
export async function startAndOpen(play: LastPlay, how: 'push' | 'replace'): Promise<boolean> {
  if (!isStartableMode(play.mode)) return false;
  const { gameType } = play;
  if (play.mode === 'ranked') {
    const players = play.players ?? DEFAULT_RANKED_PLAYERS;
    if (!isOpenPlayerCount(players)) return false;
    startRankedAndOpen({ gameType, players }, how);
    return true;
  }
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

/**
 * Searches for a ranked game (stage 9, spec §10) and opens the match screen. Ranked play is for a verified
 * address while config/account.ts `verification.requiredForRanked` is on [D22]: an unverified player gets
 * the verification screen instead, with a line that says why. Returns whether the search started.
 */
export function startRankedAndOpen(request: RankedRequest, how: 'push' | 'replace'): boolean {
  const user = useAuth.getState().user;
  if (!canPlayRanked(user)) {
    useToast.getState().show({ variant: 'info', message: i18n.t('match:verify.required') });
    if (how === 'push') router.push(ROUTES.verifyEmail);
    else router.replace(ROUTES.verifyEmail);
    return false;
  }
  useGameStore.getState().startRanked(request, deviceRankedDeps);
  useProfile
    .getState()
    .rememberPlay({ mode: 'ranked', gameType: request.gameType, players: request.players });
  if (how === 'push') router.push(MATCH_PATH);
  else router.replace(MATCH_PATH);
  return true;
}
