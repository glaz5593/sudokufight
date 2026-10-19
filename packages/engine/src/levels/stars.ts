import type { PointStars, StarRule, Stars } from './spec';

/**
 * Stars (plan §2, §3.1, §4.4) [D52]: from a level's measure to 0–3, by its star rule. Pure, and the only
 * place the comparisons live: the engine's results, the tap engine, the view's provisional stars and
 * levelOutcome() all come here.
 *
 * Times are inclusive ("עד 5 ש׳" includes 5.000 s; 5.01 s is ★★, dev-plan §1.4), counts and points are
 * "at least", and a duel's ★ is any lead at all.
 */

/** The stars `value` earns under `rule`; whether the level was finished at all is the caller's (levelStars). */
export function starsFor(rule: StarRule, value: number): Stars {
  switch (rule.by) {
    case 'timeMs':
      return value <= rule.three ? 3 : value <= rule.two ? 2 : value <= rule.one ? 1 : 0;
    case 'gap':
      return value >= rule.three ? 3 : value >= rule.two ? 2 : value > 0 ? 1 : 0;
    case 'spots':
    case 'points':
      return value >= rule.three ? 3 : value >= rule.two ? 2 : value >= rule.one ? 1 : 0;
  }
}

/** pointHunter's shares of the board's best (plan Idea-2): ★ 70%, ★★ 85%, ★★★ 95% (98% from chapter 27). */
export const POINT_SHARES = { one: 0.7, two: 0.85, three: 0.95 } as const;

export interface PointShares {
  one: number;
  two: number;
  three: number;
}

/** A share of `max`, rounded UP to the half point a score can be (plan §3.2: 70% of 18 is 12.6 → 13). */
const upToHalf = (x: number): number => Math.ceil(x * 2 - 1e-9) / 2;

/** pointHunter's thresholds [★, ★★, ★★★] of a board whose best is `max`: 18 → [13, 15.5, 17.5]. */
export function pointThresholds(
  max: number,
  shares: PointShares = POINT_SHARES,
): [one: number, two: number, three: number] {
  if (!(Number.isFinite(max) && max > 0)) throw new RangeError(`A board's best is positive, got ${max}`);
  return [upToHalf(max * shares.one), upToHalf(max * shares.two), upToHalf(max * shares.three)];
}

/** pointHunter's rule for a board whose best is `max`. */
export function pointStars(max: number, shares: PointShares = POINT_SHARES): PointStars {
  const [one, two, three] = pointThresholds(max, shares);
  return { by: 'points', max, three, two, one };
}

/**
 * ★★★ is harder than ★★, and ★★ harder than ★, and each can be reached: positive times, rising counts, a
 * points rule within its `max` (the builder's check, plan §5.6).
 */
export function starRuleIsOrdered(rule: StarRule): boolean {
  switch (rule.by) {
    case 'timeMs':
      return rule.three > 0 && rule.three < rule.two && rule.two < rule.one;
    case 'gap':
      return rule.two > 0 && rule.two < rule.three;
    case 'spots':
      return rule.one > 0 && rule.one < rule.two && rule.two < rule.three;
    case 'points':
      return rule.one > 0 && rule.one < rule.two && rule.two < rule.three && rule.three <= rule.max;
  }
}
