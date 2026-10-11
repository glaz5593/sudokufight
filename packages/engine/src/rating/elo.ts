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

/** One pair's exact (unrounded) part of `me`'s change: K_pair × (S − E) against `opp`. */
function pairPart(me: EloPlayer, opp: EloPlayer, n: number, o: EloOptions): number {
  const provisional = me.games < o.provisionalGames;
  const kPair = (o.k / Math.max(1, n - 1)) * (provisional ? o.provisionalFactor : 1);
  let s = me.place < opp.place ? 1 : me.place === opp.place ? 0.5 : 0;
  // [D8] is about a 2-player game won by abandonment.
  if (s === 1 && opp.abandoned && n === 2) s = o.abandonWinScore;
  return kPair * (s - expectedScore(me.rating, opp.rating));
}

export function eloChanges(players: readonly EloPlayer[], options: Partial<EloOptions> = {}): RatingChange[] {
  const o = { ...DEFAULT_ELO, ...options };
  const n = players.length;
  return players.map((me) => {
    const provisional = me.games < o.provisionalGames;
    let sum = 0;
    for (const opp of players) if (opp !== me) sum += pairPart(me, opp, n, o);
    const delta = Math.round(sum);
    return { playerId: me.id, before: me.rating, after: me.rating + delta, delta, provisional };
  });
}

/** One opponent's share of a player's rating change (Results-4P: "מחושב מול כל יריב בנפרד"). */
export interface RatingPair {
  opponentId: string;
  /** In tenths of a point; a player's pairs add up to their (whole) Elo change exactly. */
  delta: number;
}

/** A player's rating change split by opponent. */
export interface RatingPairs {
  playerId: string;
  /** Every opponent, in the order the players were given. */
  pairs: RatingPair[];
  /**
   * Rating points lost on top of the pairs (rules.rating.abandonPenalty for an abandoning player; else 0):
   * Σ pairs − penalty = the RatingChange's delta.
   */
  penalty: number;
}

/**
 * Tenths that add up to `total` tenths, each as close as it can be to its exact value: start from each exact
 * value rounded down, then hand out (or take back) one tenth at a time where it is most owed. Deterministic:
 * equal claims go to the earlier pair.
 */
function apportionTenths(exact: readonly number[], total: number): number[] {
  const tenths = exact.map((x) => Math.floor(x));
  let sum = tenths.reduce((a, b) => a + b, 0);
  const pick = (better: (owed: number, best: number) => boolean): number => {
    let at = 0;
    for (let i = 1; i < tenths.length; i++)
      if (better(exact[i]! - tenths[i]!, exact[at]! - tenths[at]!)) at = i;
    return at;
  };
  while (sum < total) {
    tenths[pick((owed, best) => owed > best + 1e-9)]! += 1;
    sum++;
  }
  while (sum > total) {
    tenths[pick((owed, best) => owed < best - 1e-9)]! -= 1;
    sum--;
  }
  return tenths;
}

/**
 * Each player's change split by opponent (spec §11.2: every pair is a mini-match), consistent with
 * eloChanges for the same input: K_pair × (S − E) per opponent, in tenths, apportioned so that a player's
 * pairs add up exactly to their eloChanges delta (the exact parts add up to the delta before rounding; a pair
 * moves at most a few tenths from its own exact part). Two players: the one pair is the whole change.
 */
export function eloPairs(players: readonly EloPlayer[], options: Partial<EloOptions> = {}): RatingPairs[] {
  const o = { ...DEFAULT_ELO, ...options };
  const n = players.length;
  return players.map((me) => {
    const opponents = players.filter((opp) => opp !== me);
    const parts = opponents.map((opp) => pairPart(me, opp, n, o));
    const delta = Math.round(parts.reduce((a, b) => a + b, 0));
    const tenths = apportionTenths(
      parts.map((x) => x * 10),
      delta * 10,
    );
    return {
      playerId: me.id,
      pairs: opponents.map((opp, k) => ({ opponentId: opp.id, delta: (tenths[k] || 0) / 10 })),
      penalty: 0,
    };
  });
}
