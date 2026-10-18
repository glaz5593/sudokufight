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
 *
 * Leave guards (spec §11.2, Moshe 2026-10-15): a pair may be guarded for one of its players. 'noLoss' keeps
 * that player's part of the pair from going below 0, 'noGain' from going above 0 (a clamp: a gain under
 * 'noLoss' or a loss under 'noGain' is kept). A pair the guard actually held is exactly 0, says why, and is
 * never moved when the change is split into tenths. Which pairs are guarded is the game's business
 * (game/results.ts); this module only applies them.
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

/**
 * Why a leave guard held a pair at 0 (spec §11.2). For the leaver (guard a): he left before his first move,
 * or he was not behind that opponent when he left. For the one who stayed (guard b): the opponent left before
 * his first move, or the opponent was ahead of him when leaving.
 */
export type LeaveGuardReason =
  'leftBeforeMoving' | 'leftNotBehind' | 'opponentLeftBeforeMyMove' | 'opponentLeftAhead';

/** A guard on one of a player's pairs: no loss (part ≥ 0) or no gain (part ≤ 0) against `opponentId`. */
export interface PairGuard {
  opponentId: string;
  kind: 'noLoss' | 'noGain';
  reason: LeaveGuardReason;
}

export interface EloPlayer {
  id: string;
  rating: number;
  /** Games this player had already played in this rating key. */
  games: number;
  /** 1-based final place; equal places are draws. */
  place: number;
  abandoned?: boolean;
  /** Leave guards on this player's pairs (spec §11.2); none by default. */
  guards?: readonly PairGuard[];
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

interface PairPart {
  /** The exact (unrounded) part; a literal 0 when a guard held it. */
  part: number;
  /** The guard that held this pair at 0, if one did. */
  held: LeaveGuardReason | null;
  /** The guard on this pair, held or not: it bounds the pair when the change is split into tenths. */
  kind: PairGuard['kind'] | null;
}

/**
 * One pair's exact (unrounded) part of `me`'s change: K_pair × (S − E) against `opp`, then `me`'s leave guard
 * against `opp`, if any (spec §11.2).
 */
function pairPart(me: EloPlayer, opp: EloPlayer, n: number, o: EloOptions): PairPart {
  const provisional = me.games < o.provisionalGames;
  const kPair = (o.k / Math.max(1, n - 1)) * (provisional ? o.provisionalFactor : 1);
  let s = me.place < opp.place ? 1 : me.place === opp.place ? 0.5 : 0;
  // [D8] is about a 2-player game won by abandonment.
  if (s === 1 && opp.abandoned && n === 2) s = o.abandonWinScore;
  const raw = kPair * (s - expectedScore(me.rating, opp.rating));
  const guard = me.guards?.find((g) => g.opponentId === opp.id);
  if (!guard) return { part: raw, held: null, kind: null };
  const holds = guard.kind === 'noLoss' ? raw < 0 : raw > 0;
  return holds
    ? { part: 0, held: guard.reason, kind: guard.kind }
    : { part: raw, held: null, kind: guard.kind };
}

export function eloChanges(players: readonly EloPlayer[], options: Partial<EloOptions> = {}): RatingChange[] {
  const o = { ...DEFAULT_ELO, ...options };
  const n = players.length;
  return players.map((me) => {
    const provisional = me.games < o.provisionalGames;
    let sum = 0;
    for (const opp of players) if (opp !== me) sum += pairPart(me, opp, n, o).part;
    // `|| 0`: never −0 (Math.round(−0.4) is −0).
    const delta = Math.round(sum) || 0;
    return { playerId: me.id, before: me.rating, after: me.rating + delta, delta, provisional };
  });
}

/** One opponent's share of a player's rating change (Results-4P: "מחושב מול כל יריב בנפרד"). */
export interface RatingPair {
  opponentId: string;
  /** In tenths of a point; a player's pairs add up to their (whole) Elo change exactly. */
  delta: number;
  /** Only on a pair a leave guard held at exactly 0 (spec §11.2): why. */
  guard?: LeaveGuardReason;
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
 * equal claims go to the earlier pair. `bounds` (per pair, optional) keep a guarded pair on its side of 0: a
 * 'noLoss' pair never goes below 0 and a 'noGain' pair never above it, as long as another pair can take the
 * tenth instead (always the case for the totals eloPairs asks for).
 */
function apportionTenths(
  exact: readonly number[],
  total: number,
  bounds: readonly (PairGuard['kind'] | null)[] = [],
): number[] {
  const tenths = exact.map((x) => Math.floor(x));
  let sum = tenths.reduce((a, b) => a + b, 0);
  const pick = (better: (owed: number, best: number) => boolean, may: (i: number) => boolean): number => {
    let at = -1;
    for (let i = 0; i < tenths.length; i++) {
      if (!may(i)) continue;
      if (at < 0 || better(exact[i]! - tenths[i]!, exact[at]! - tenths[at]!)) at = i;
    }
    return at;
  };
  const mayAdd = (i: number) => bounds[i] !== 'noGain' || tenths[i]! < 0;
  const mayTake = (i: number) => bounds[i] !== 'noLoss' || tenths[i]! > 0;
  while (sum < total) {
    const more = (owed: number, best: number) => owed > best + 1e-9;
    const at = pick(more, mayAdd);
    tenths[at >= 0 ? at : pick(more, () => true)]! += 1;
    sum++;
  }
  while (sum > total) {
    const less = (owed: number, best: number) => owed < best - 1e-9;
    const at = pick(less, mayTake);
    tenths[at >= 0 ? at : pick(less, () => true)]! -= 1;
    sum--;
  }
  return tenths;
}

/**
 * Each player's change split by opponent (spec §11.2: every pair is a mini-match), consistent with
 * eloChanges for the same input: K_pair × (S − E) per opponent, in tenths, apportioned so that a player's
 * pairs add up exactly to their eloChanges delta (the exact parts add up to the delta before rounding; a pair
 * moves at most a few tenths from its own exact part). Two players: the one pair is the whole change.
 * A pair a leave guard held is exactly 0, carries the guard's reason, and takes no part in the apportioning;
 * a guarded pair the guard did not hold stays on its side of 0.
 */
export function eloPairs(players: readonly EloPlayer[], options: Partial<EloOptions> = {}): RatingPairs[] {
  const o = { ...DEFAULT_ELO, ...options };
  const n = players.length;
  return players.map((me) => {
    const opponents = players.filter((opp) => opp !== me);
    const parts = opponents.map((opp) => pairPart(me, opp, n, o));
    const delta = Math.round(parts.reduce((a, b) => a + b.part, 0)) || 0;
    const free = parts.filter((p) => p.held === null);
    const tenths = apportionTenths(
      free.map((p) => p.part * 10),
      delta * 10,
      free.map((p) => p.kind),
    );
    let k = 0;
    return {
      playerId: me.id,
      pairs: opponents.map((opp, i): RatingPair => {
        const held = parts[i]!.held;
        if (held !== null) return { opponentId: opp.id, delta: 0, guard: held };
        return { opponentId: opp.id, delta: (tenths[k++] || 0) / 10 };
      }),
      penalty: 0,
    };
  });
}
