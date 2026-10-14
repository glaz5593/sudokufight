import { router } from 'expo-router';

/**
 * The player card's route (spec §14.3): mine from Home's card, the leaderboard and the progress tab; another
 * player's from the leaderboard, and from a ranked game's results and its history card. From a game, `gameId`
 * goes with it: a report from that card is about that game (spec §3.5; the admin sees and opens the game).
 */
export const PLAYER_PATH = '/player/[id]';

export function openPlayerCard(id: string, gameId?: string | null): void {
  router.push({ pathname: PLAYER_PATH, params: gameId ? { id, gameId } : { id } });
}
