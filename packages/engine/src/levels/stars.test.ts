import { levelStars } from './progress';
import type { GapStars, SpotStars, StarRule, TimeStars } from './spec';
import { POINT_SHARES, pointStars, pointThresholds, starRuleIsOrdered, starsFor } from './stars';

/* Stars (plan §2, §3.1, §4.4) [D52]: every threshold at its exact edge (dev-plan §1.4, §3.1). */

const time = (three: number, two: number, one: number): TimeStars => ({ by: 'timeMs', three, two, one });

describe('find (plan §2.1): ★★★ 5 s · ★★ 10 s · ★ 20 s, inclusive', () => {
  const find = time(5000, 10000, 20000);

  it.each([
    [5000, 3],
    [5010, 2],
    [10000, 2],
    [10010, 1],
    [20000, 1],
    [20010, 0],
  ])('%i ms → %i stars', (ms, stars) => {
    expect(starsFor(find, ms)).toBe(stars);
  });

  it('★★★ comes down to 4 s from chapter 11, to 3 s from chapter 26', () => {
    expect([starsFor(time(4000, 10000, 20000), 4000), starsFor(time(4000, 10000, 20000), 4010)]).toEqual([
      3, 2,
    ]);
    expect([starsFor(time(3000, 10000, 20000), 3000), starsFor(time(3000, 10000, 20000), 3010)]).toEqual([
      3, 2,
    ]);
  });

  it('time up: 0, however the clock stood', () => {
    expect(levelStars(find, 'timeUp', 20000, 20000)).toBe(0);
    expect(levelStars(find, 'failed', 3000, 3000)).toBe(0);
    expect(levelStars(find, 'completed', 3000, 3000)).toBe(3);
  });
});

describe('fillBox, chapter 1 (plan §2.3): 10 / 15 / 20 s', () => {
  const box = time(10000, 15000, 20000);

  it.each([
    [10000, 3],
    [10001, 2],
    [15000, 2],
    [15001, 1],
  ])('%i ms → %i stars', (ms, stars) => {
    expect(starsFor(box, ms)).toBe(stars);
  });

  it('time up: 0', () => {
    expect(levelStars(box, 'timeUp', 20000, 20000)).toBe(0);
  });
});

describe('duel (plan §2.4): my lead at the end, 15 / 8 / any', () => {
  const gap: GapStars = { by: 'gap', three: 15, two: 8 };

  it.each([
    [15, 3],
    [14.5, 2],
    [8, 2],
    [7.5, 1],
    [0.5, 1],
    [0, 0], // a tie
    [-3, 0], // the bot ahead
  ])('a lead of %d → %i stars', (lead, stars) => {
    expect(starsFor(gap, lead)).toBe(stars);
  });

  it('by the lead when time runs out; none when the bot got to 30 first', () => {
    expect(levelStars(gap, 'timeUp', 9, 30000)).toBe(2);
    expect(levelStars(gap, 'botWon', 20, 12000)).toBe(0);
  });
});

describe('findDuel (plan §2.2): my spots of 5', () => {
  const spots: SpotStars = { by: 'spots', three: 4, two: 3, one: 2 };

  it.each([
    [5, 3],
    [4, 3],
    [3, 2],
    [2, 1],
    [1, 0],
    [0, 0],
  ])('%i spots → %i stars', (n, stars) => {
    expect(starsFor(spots, n)).toBe(stars);
  });
});

describe('pointHunter (plan Idea-2): a share of the board’s best, rounded up to a half point', () => {
  it('pointThresholds(18) = 13 / 15.5 / 17.5 (70%, 85%, 95%)', () => {
    expect(pointThresholds(18)).toEqual([13, 15.5, 17.5]);
    expect(POINT_SHARES).toEqual({ one: 0.7, two: 0.85, three: 0.95 });
  });

  it('with ★★★ from 98% (chapter 27 on), ★★★ of 18 is 18', () => {
    expect(pointThresholds(18, { ...POINT_SHARES, three: 0.98 })[2]).toBe(18);
  });

  it('the rule of a board, at its edges', () => {
    const rule = pointStars(18);
    expect(rule).toEqual({ by: 'points', max: 18, three: 17.5, two: 15.5, one: 13 });
    expect([17.5, 17, 15.5, 15, 13, 12.5].map((p) => starsFor(rule, p))).toEqual([3, 2, 2, 1, 1, 0]);
  });

  it('a board needs a positive best', () => {
    expect(() => pointThresholds(0)).toThrow(RangeError);
  });
});

describe('spotError and chain (plan §3.1): by time, every edge', () => {
  it.each([
    ['spotError, 1 error', time(6000, 12000, 20000)],
    ['spotError, 2 errors', time(12000, 20000, 30000)],
    ['spotError, 3 errors', time(15000, 22000, 30000)],
    ['chain, 3 steps', time(10000, 16000, 24000)],
    ['chain, 4 steps', time(13000, 20000, 30000)],
    ['chain, 5 steps', time(16000, 23000, 30000)],
    ['chain from chapter 29', time(12000, 23000, 30000)],
  ])('%s', (_, rule) => {
    const { three, two, one } = rule;
    expect([three, three + 1, two, two + 1, one, one + 1].map((ms) => starsFor(rule, ms))).toEqual([
      3, 2, 2, 1, 1, 0,
    ]);
  });
});

describe('every rule: ★★★ is harder than ★★, ★★ harder than ★', () => {
  const rules: StarRule[] = [
    time(5000, 10000, 20000),
    time(10000, 15000, 20000),
    time(16000, 23000, 30000),
    { by: 'gap', three: 15, two: 8 },
    { by: 'spots', three: 4, two: 3, one: 2 },
    pointStars(18),
    pointStars(17.6, { ...POINT_SHARES, three: 0.98 }),
  ];

  it.each(rules.map((r) => [JSON.stringify(r), r] as const))('%s', (_, rule) => {
    expect(starRuleIsOrdered(rule)).toBe(true);
  });

  it('a rule out of order is caught', () => {
    expect(starRuleIsOrdered(time(10000, 5000, 20000))).toBe(false);
    expect(starRuleIsOrdered({ by: 'gap', three: 8, two: 15 })).toBe(false);
    expect(starRuleIsOrdered({ by: 'points', max: 10, three: 12, two: 9, one: 7 })).toBe(false);
  });
});
