import { router } from 'expo-router';

/**
 * The player card's route (spec §14.3): mine from Home's card, the leaderboard and the progress tab; another
 * player's from the leaderboard and the results of a ranked game.
 */
export const PLAYER_PATH = '/player/[id]';

export function openPlayerCard(id: string): void {
  router.push({ pathname: PLAYER_PATH, params: { id } });
}
