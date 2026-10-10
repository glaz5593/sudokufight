import type { GameType } from '../gameType';

/**
 * Ratings (spec §11). Pairwise Elo for V1, kept behind this module so it can become Glicko-2 or OpenSkill
 * without touching anything else (§24).
 *
 * Every pair of players in a game is a mini-match: the better place wins (S = 1), an equal place is a draw
 * (0.5), the worse place loses (0).
 *   E  = 1 / (1 + 10^((R_opp − R_me) / 400))
 *   ΔR = Σ over opponents of K_pair × (S − E),  K_pair = K / (N − 1)    (K = 32; 2 players → 32)
 * Provisional: in a player's first 10 games of a rating key, their K is doubled.
 * Example (spec): 1287 vs 1305 → E = 0.474; a win is +17, a loss −15.
 */

/** B: one rating per game type (default, the spec's preference). A: one per game type and player count [D7]. */
export type RatingOption = 'A' | 'B';

/** 'normal' (option B) or 'normal-2p' (option A). */
export function ratingKey(gameType: GameType, players: number, option: RatingOption = 'B'): string {
  return option === 'A' ? `${gameType}-${players}p` : gameType;
}

export const INITIAL_RATING = 1200; // [D23]

export interface EloOptions {
  k: number;
  provisionalGames: number;
  provisionalFactor: number;
  /** S for the winner of a 2-player game whose opponent abandoned [D8: full win = 1]. */
  abandonWinScore: number;
}

export const DEFAULT_ELO: EloOptions = {
  k: 32,
  provisionalGames: 10,
  provisionalFactor: 2,
  abandonWinScore: 1,
};

export interface EloPlayer {
  id: string;
  rating: number;
  /** Games this player had already played in this rating key. */
  games: number;
  /** 1-based final place; equal places are draws. */
  place: number;
  abandoned?: boolean;
}

export interface RatingChange {
  playerId: string;
  before: number;
  after: number;
  delta: number;
  provisional: boolean;
}

export const expectedScore = (rating: number, opponent: number): number =>
  1 / (1 + 10 ** ((opponent - rating) / 400));

export function eloChanges(players: readonly EloPlayer[], options: Partial<EloOptions> = {}): RatingChange[] {
  const o = { ...DEFAULT_ELO, ...options };
  const n = players.length;
  return players.map((me) => {
    const provisional = me.games < o.provisionalGames;
    const kPair = (o.k / Math.max(1, n - 1)) * (provisional ? o.provisionalFactor : 1);
    let sum = 0;
    for (const opp of players) {
      if (opp === me) continue;
      let s = me.place < opp.place ? 1 : me.place === opp.place ? 0.5 : 0;
      // [D8] is about a 2-player game won by abandonment.
      if (s === 1 && opp.abandoned && n === 2) s = o.abandonWinScore;
      sum += kPair * (s - expectedScore(me.rating, opp.rating));
    }
    const delta = Math.round(sum);
    return { playerId: me.id, before: me.rating, after: me.rating + delta, delta, provisional };
  });
}
