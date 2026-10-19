/**
 * Progress (spec §11.3, §15) [D38]: XP, levels and leagues. The numbers are an open decision, so they live in
 * one settings object that the server and the app both read; the rules below only apply them.
 */

export const LEAGUES = ['bronze', 'silver', 'gold', 'diamond', 'legend'] as const;
export type League = (typeof LEAGUES)[number];

/** The lowest rating of each league above bronze. */
export interface LeagueThresholds {
  silver: number;
  gold: number;
  diamond: number;
  legend: number;
}

export interface ProgressRules {
  /** §11.3: ארד to 1099 · כסף 1100–1249 · זהב 1250–1399 · יהלום 1400–1599 · אגדה 1600+. */
  leagues: LeagueThresholds;
  /** §11.3: a league shows only once some rating key has finished its provisional games. */
  provisionalGames: number;
  xp: {
    /** First place in a ranked game, or a win against a bot. */
    win: number;
    /** Any other result in a ranked game or against a bot. */
    played: number;
    /** A solo practice. */
    solo: number;
    /** Per correct move, in ranked games and against a bot only. */
    perCorrect: number;
    /** Staged practice: each new best star of a level (plan §5.1) [D55]. */
    levelStar: number;
    /** Staged practice: each gate between chapters that opens [D55]. */
    levelGate: number;
  };
  /** From level n to n + 1 takes `levelStep × n` XP (level 1 → 2: 200; 2 → 3: 400). */
  levelStep: number;
}

export const DEFAULT_PROGRESS_RULES: ProgressRules = {
  leagues: { silver: 1100, gold: 1250, diamond: 1400, legend: 1600 },
  provisionalGames: 10,
  xp: { win: 50, played: 20, solo: 10, perCorrect: 1, levelStar: 10, levelGate: 50 },
  levelStep: 200,
};

export function leagueFor(
  rating: number,
  thresholds: LeagueThresholds = DEFAULT_PROGRESS_RULES.leagues,
): League {
  if (rating >= thresholds.legend) return 'legend';
  if (rating >= thresholds.diamond) return 'diamond';
  if (rating >= thresholds.gold) return 'gold';
  if (rating >= thresholds.silver) return 'silver';
  return 'bronze';
}

export interface RatingForLeague {
  rating: number;
  games: number;
}

/**
 * The player's league [D9]: from the highest of their ratings, among the keys that finished their provisional
 * games; null while every key is still provisional (§11.3).
 */
export function playerLeague(
  ratings: readonly RatingForLeague[],
  rules: ProgressRules = DEFAULT_PROGRESS_RULES,
): League | null {
  const settled = ratings.filter((r) => r.games >= rules.provisionalGames);
  if (!settled.length) return null;
  return leagueFor(Math.max(...settled.map((r) => r.rating)), rules.leagues);
}

/** One finished game, as far as XP is concerned. */
export type XpGame = { mode: 'solo' } | { mode: 'bot' | 'ranked'; won: boolean; correct: number };

/** §15: 50 for first place (ranked) or a win against a bot, 20 otherwise, 10 for solo; +1 per correct move. */
export function xpForGame(game: XpGame, rules: ProgressRules = DEFAULT_PROGRESS_RULES): number {
  if (game.mode === 'solo') return rules.xp.solo;
  const base = game.won ? rules.xp.win : rules.xp.played;
  return base + Math.max(0, Math.floor(game.correct)) * rules.xp.perCorrect;
}

export interface LevelProgress {
  /** 1 and up. */
  level: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP the current level needs in all (levelStep × level). */
  xpForNext: number;
}

/** The level a total XP reaches: level n needs levelStep × n more XP to reach n + 1. */
export function levelFor(totalXp: number, rules: ProgressRules = DEFAULT_PROGRESS_RULES): LevelProgress {
  let level = 1;
  let left = Math.max(0, Math.floor(totalXp));
  while (left >= rules.levelStep * level) {
    left -= rules.levelStep * level;
    level += 1;
  }
  return { level, xpIntoLevel: left, xpForNext: rules.levelStep * level };
}
