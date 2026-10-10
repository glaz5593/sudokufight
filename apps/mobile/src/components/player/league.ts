/**
 * Leagues (spec §11.3) [D38]: ארד to 1099 · כסף 1100–1249 · זהב 1250–1399 · יהלום 1400–1599 · אגדה 1600+.
 * The thresholds are an open decision, so they are a setting here, not a rule in the code. The league follows
 * the highest of the player's ratings [D9]; the caller passes that one.
 */

export const LEAGUES = ['bronze', 'silver', 'gold', 'diamond', 'legend'] as const;
export type League = (typeof LEAGUES)[number];

/** The lowest rating of each league above bronze [D38]. */
export interface LeagueThresholds {
  silver: number;
  gold: number;
  diamond: number;
  legend: number;
}

export const LEAGUE_THRESHOLDS: LeagueThresholds = { silver: 1100, gold: 1250, diamond: 1400, legend: 1600 };

export function leagueFor(rating: number, thresholds: LeagueThresholds = LEAGUE_THRESHOLDS): League {
  if (rating >= thresholds.legend) return 'legend';
  if (rating >= thresholds.diamond) return 'diamond';
  if (rating >= thresholds.gold) return 'gold';
  if (rating >= thresholds.silver) return 'silver';
  return 'bronze';
}
