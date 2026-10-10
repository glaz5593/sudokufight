import {
  DEFAULT_PROGRESS_RULES,
  type League,
  leagueFor,
  type LeagueThresholds,
  LEAGUES,
} from '@sudoku-fight/engine';

/**
 * Leagues (spec §11.3) [D38]: ארד to 1099 · כסף 1100–1249 · זהב 1250–1399 · יהלום 1400–1599 · אגדה 1600+.
 * One source of truth: the engine's progress rules, which the server applies too. The league follows the
 * highest of the player's settled ratings [D9]; the caller passes that one (or the server's league).
 */
export { type League, LEAGUES, type LeagueThresholds, leagueFor, playerLeague } from '@sudoku-fight/engine';

/** The thresholds the app shows (the engine's defaults, which the server applies). */
export const LEAGUE_THRESHOLDS: LeagueThresholds = DEFAULT_PROGRESS_RULES.leagues;

/** The lowest rating of a league (bronze: 0). */
export function leagueFloor(league: League, thresholds: LeagueThresholds = LEAGUE_THRESHOLDS): number {
  return league === 'bronze' ? 0 : thresholds[league];
}

/** The league after `league`, or null at the top. */
export function nextLeague(league: League): League | null {
  return LEAGUES[LEAGUES.indexOf(league) + 1] ?? null;
}

export interface LeagueProgress {
  league: League;
  next: League | null;
  /** Points to the next league; null at the top. */
  toNext: number | null;
  /** 0–1 of the way from this league's floor to the next one's (1 at the top). */
  share: number;
}

/** Where a rating stands in its league, and how far the next one is (the progress tab, the leaderboard). */
export function leagueProgress(
  rating: number,
  thresholds: LeagueThresholds = LEAGUE_THRESHOLDS,
): LeagueProgress {
  const league = leagueFor(rating, thresholds);
  const next = nextLeague(league);
  if (next === null) return { league, next, toNext: null, share: 1 };
  const floor = leagueFloor(league, thresholds);
  const top = leagueFloor(next, thresholds);
  const toNext = Math.max(1, Math.ceil(top - rating));
  return { league, next, toNext, share: Math.min(1, Math.max(0, (rating - floor) / (top - floor))) };
}
