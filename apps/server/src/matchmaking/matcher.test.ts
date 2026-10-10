import { createRng } from '@sudoku-fight/engine';
import { type QueueKey } from '@sudoku-fight/protocol';

import {
  inMutualRange,
  matchTick,
  MatchQueue,
  type NewTicket,
  type OpponentRecord,
  rangeOf,
  recentOpponents,
  type Ticket,
} from './matcher';

/**
 * The matcher's rules (spec §10, original §7, D6), with time passed by hand: no clock, no timers.
 */

const T0 = Date.UTC(2026, 9, 9, 12);
const S = 1000;
const DAY = 24 * 60 * 60 * S;

/** A queue of `size` players with tickets added at the times given (default T0). */
function queueOf(size = 2, key: QueueKey = `fast-${size as 2 | 3 | 4}p`) {
  const queue = new MatchQueue(key, size);
  const add = (userId: string, rating: number, extra: Partial<NewTicket> & { at?: number } = {}) => {
    const { at = T0, ...rest } = extra;
    return queue.add({ userId, rating, opponents: [], ...rest }, at);
  };
  /** The groups of a round at `t`, as lists of ids. */
  const round = (t: number) => {
    const result = queue.tick(t);
    return {
      groups: result.groups.map((g) => g.tickets.map((x) => x.userId)),
      rematch: result.groups.map((g) => g.rematch),
      timedOut: result.timedOut.map((x) => x.userId),
    };
  };
  return { queue, add, round };
}

/** Met `ids` at the given times (most recent last by default: a day apart, ending a day ago). */
const met = (...ids: string[]): OpponentRecord[] =>
  ids.map((opponentId, i) => ({ opponentId, playedAt: T0 - (ids.length - i) * DAY }));

describe('the range [D6]', () => {
  it('widens by 25 every 5 s from ±50 and reaches the cap of ±300 at 50 s', () => {
    const { add } = queueOf();
    const t = add('ana', 1200);
    const at = (ms: number) => rangeOf(t, T0 + ms);
    expect([0, 4999, 5000, 9999, 10_000, 14_000].map(at)).toEqual([50, 50, 75, 75, 100, 100]);
    expect([45_000, 49_999, 50_000, 55_000, 59_999].map(at)).toEqual([275, 275, 300, 300, 300]);
    for (let s = 0; s <= 60; s++) expect(at(s * S)).toBe(Math.min(300, 50 + 25 * Math.floor(s / 5)));
  });

  it('has no cap for "keep searching"', () => {
    const { add } = queueOf();
    const t = add('ana', 1200, { extended: true });
    expect(rangeOf(t, T0 + 50 * S)).toBe(300);
    expect(rangeOf(t, T0 + 60 * S)).toBe(350);
    expect(rangeOf(t, T0 + 100 * S)).toBe(550);
  });
});

describe('mutual range', () => {
  it('two far players match once their ranges overlap', () => {
    const { add, round } = queueOf();
    add('ana', 1200);
    add('ben', 1400); // 200 apart: both need ±200, at 30 s
    expect(round(T0 + 29_999).groups).toEqual([]);
    expect(round(T0 + 30_000).groups).toEqual([['ana', 'ben']]);
  });

  it("each must be within the other's range: a newcomer's narrow range counts too", () => {
    const { add, round } = queueOf();
    const ana = add('ana', 1200);
    const ben = add('ben', 1300, { at: T0 + 30 * S }); // ana is at ±200 by then, ben at ±50
    expect(inMutualRange(ana, ben, T0 + 30 * S)).toBe(false);
    expect(round(T0 + 30 * S).groups).toEqual([]);
    expect(round(T0 + 39_999).groups).toEqual([]);
    // Ben reaches ±100 after 10 s of his own.
    expect(round(T0 + 40 * S).groups).toEqual([['ana', 'ben']]);
  });
});

describe('repeat opponents (original §7: avoided as much as possible)', () => {
  it('a new opponent is preferred over a closer-rated repeat', () => {
    const { add, round } = queueOf();
    add('ana', 1200, { opponents: met('ben') });
    add('ben', 1205, { opponents: met('ana') });
    add('cy', 1240);
    const r = round(T0);
    expect(r.groups).toEqual([['ana', 'cy']]);
    expect(r.rematch).toEqual([false]);
  });

  it('either side remembering the game is enough', () => {
    const { add, round } = queueOf();
    add('ana', 1200);
    add('ben', 1205, { opponents: met('ana') });
    add('cy', 1240);
    expect(round(T0).groups).toEqual([['ana', 'cy']]);
  });

  it('a player waits for a new opponent to come into range rather than replay a recent one', () => {
    const { add, round } = queueOf();
    add('ana', 1200, { opponents: met('ben') });
    add('ben', 1210, { opponents: met('ana') });
    add('cy', 1450); // 250 from ana: in reach (±300), in range at 40 s
    for (let t = 0; t < 40 * S; t += 500) expect(round(T0 + t).groups).toEqual([]);
    expect(round(T0 + 40 * S).groups).toEqual([['ana', 'cy']]);
  });

  it('players out of reach (beyond ±300) are not available: with only a previous opponent around, they replay', () => {
    const { add, round } = queueOf();
    add('ana', 1200, { opponents: met('ben') });
    add('ben', 1210, { opponents: met('ana') });
    add('cy', 1600); // 400 from both: can't be met in this search
    const r = round(T0);
    expect(r.groups).toEqual([['ana', 'ben']]);
    expect(r.rematch).toEqual([true]);
  });

  describe('the 80% reset', () => {
    // Ana is served first; five others she could meet, all in range, Q5 the farthest in rating.
    const others: [string, number][] = [
      ['q1', 1201],
      ['q2', 1202],
      ['q3', 1203],
      ['q4', 1204],
      ['q5', 1240],
    ];

    it('having met 4 of the 5 available opponents (80%, not more), only the new one is possible', () => {
      const { add, round } = queueOf();
      add('ana', 1200, { opponents: met('q1', 'q2', 'q3', 'q4') });
      for (const [id, rating] of others) add(id, rating, { at: T0 + S });
      const r = round(T0 + S);
      expect(r.groups[0]).toEqual(['ana', 'q5']);
    });

    it('having met all 5, the history starts over: the one met longest ago first, before closer ratings', () => {
      const { add, round, queue } = queueOf();
      // q3 is the oldest game, q4 the latest.
      const opponents: OpponentRecord[] = [
        { opponentId: 'q3', playedAt: T0 - 5 * DAY },
        { opponentId: 'q5', playedAt: T0 - 4 * DAY },
        { opponentId: 'q1', playedAt: T0 - 3 * DAY },
        { opponentId: 'q2', playedAt: T0 - 2 * DAY },
        { opponentId: 'q4', playedAt: T0 - 1 * DAY },
      ];
      const ana = add('ana', 1200, { opponents });
      for (const [id, rating] of others) add(id, rating, { at: T0 + S });
      expect(recentOpponents(ana, queue.list())).toEqual(new Set());
      const r = round(T0 + S);
      expect(r.groups[0]).toEqual(['ana', 'q3']);
      expect(r.rematch[0]).toBe(true);
    });

    it('counts only the opponents available now: met 1 of 2 → no reset; the other one gone → reset', () => {
      const { add, round, queue } = queueOf();
      const ana = add('ana', 1200, { opponents: met('ben') });
      add('ben', 1210, { opponents: met('ana') });
      add('cy', 1490); // 290 away: in reach, out of range for a while
      expect(recentOpponents(ana, queue.list())).toEqual(new Set(['ben']));
      expect(round(T0).groups).toEqual([]);
      queue.remove('cy'); // matched elsewhere, or left
      expect(recentOpponents(ana, queue.list())).toEqual(new Set());
      expect(round(T0 + 500).groups).toEqual([['ana', 'ben']]);
    });
  });
});

describe('timeout (spec §10: 60 s)', () => {
  it('ends the search exactly at 60 s', () => {
    const { add, round, queue } = queueOf();
    add('ana', 1200);
    expect(round(T0 + 59_999).timedOut).toEqual([]);
    expect(queue.size).toBe(1);
    expect(round(T0 + 60_000).timedOut).toEqual(['ana']);
    expect(queue.size).toBe(0);
  });

  it('a ticket that can match at its deadline matches instead', () => {
    const { add, round } = queueOf();
    add('ana', 1200);
    add('ben', 1250, { at: T0 + 60 * S });
    expect(round(T0 + 60 * S)).toEqual({ groups: [['ana', 'ben']], rematch: [false], timedOut: [] });
  });

  it('"keep searching": the deadline moves and the cap is gone, for both players', () => {
    const { add, round } = queueOf();
    const later = { searchStart: T0, deadline: T0 + 120 * S, extended: true };
    add('ana', 1200, later);
    add('ben', 1550, later); // 350 apart
    expect(round(T0 + 55 * S).groups).toEqual([]);
    expect(round(T0 + 60 * S).groups).toEqual([['ana', 'ben']]);
  });

  it('an extended search still needs the other side in range: a capped player stays at ±300', () => {
    const { add, round } = queueOf();
    add('ana', 1200, { searchStart: T0, deadline: T0 + 120 * S, extended: true });
    add('ben', 1550, { at: T0 + 30 * S });
    expect(round(T0 + 89_999).groups).toEqual([]);
    expect(round(T0 + 90 * S).timedOut).toEqual(['ben']);
  });
});

describe('fairness', () => {
  it('serves the oldest ticket first', () => {
    const { add, round, queue } = queueOf();
    add('cy', 1200, { at: T0 + 2 * S });
    add('ana', 1200, { at: T0 });
    add('ben', 1200, { at: T0 + S });
    expect(round(T0 + 2 * S).groups).toEqual([['ana', 'ben']]);
    expect(queue.list().map((t) => t.userId)).toEqual(['cy']);
  });

  it('the one served takes the closest rating; equal ratings go to the longest waiting', () => {
    const { add, round } = queueOf();
    add('ana', 1200, { at: T0 });
    add('ben', 1230, { at: T0 + S });
    add('cy', 1210, { at: T0 + 2 * S });
    add('dan', 1210, { at: T0 + 3 * S });
    expect(round(T0 + 3 * S).groups).toEqual([
      ['ana', 'cy'],
      ['ben', 'dan'],
    ]);
  });

  it('a ticket back from a failed ready check is served before everyone (spec §10: head of the queue)', () => {
    const { add, round } = queueOf();
    add('ana', 1200, { at: T0 });
    add('ben', 1200, { at: T0 + S });
    add('zoe', 1200, { at: T0 + 2 * S, enqueuedAt: T0 + 500, priority: true });
    expect(round(T0 + 2 * S).groups).toEqual([['zoe', 'ana']]);
  });

  it('never matches a player with themselves', () => {
    const tickets: Ticket[] = [];
    const { add } = queueOf();
    tickets.push(add('ana', 1200), { ...add('ben', 1200), userId: 'ana' });
    expect(matchTick(tickets, 2, T0).groups).toEqual([]);
  });
});

describe('3 and 4 players (stage 10 opens the queues; the matcher is general)', () => {
  it('four players in range form one group; a fifth too far waits', () => {
    const { add, round, queue } = queueOf(4);
    add('ana', 1200);
    add('ben', 1210);
    add('cy', 1220);
    add('dan', 1230);
    add('eve', 1290);
    expect(round(T0).groups).toEqual([['ana', 'ben', 'cy', 'dan']]);
    expect(queue.list().map((t) => t.userId)).toEqual(['eve']);
  });

  it('every pair of a group must be in range', () => {
    const { add, round } = queueOf(3);
    add('ana', 1200);
    add('ben', 1260);
    add('cy', 1320); // ana–cy: 120
    expect(round(T0 + 5 * S).groups).toEqual([]); // ±75: ana–ben and ben–cy, not ana–cy
    expect(round(T0 + 14_999).groups).toEqual([]);
    expect(round(T0 + 15 * S).groups).toEqual([['ana', 'ben', 'cy']]); // ±125
  });

  it('a pair of recent opponents keeps a group from forming; another one forms', () => {
    const { add, round, queue } = queueOf(3);
    add('ana', 1200, { opponents: met('ben') });
    add('ben', 1205, { opponents: met('ana') });
    add('cy', 1210);
    add('dan', 1215);
    expect(round(T0).groups).toEqual([['ana', 'cy', 'dan']]);
    expect(queue.list().map((t) => t.userId)).toEqual(['ben']);
  });

  it('the one served takes the group with the closest ratings', () => {
    const { add, round } = queueOf(4);
    add('ana', 1200);
    add('ben', 1240);
    add('cy', 1205);
    add('dan', 1210);
    add('eve', 1215);
    expect(round(T0).groups).toEqual([['ana', 'cy', 'dan', 'eve']]);
  });

  it('too few players: no group', () => {
    const { add, round } = queueOf(3);
    add('ana', 1200);
    add('ben', 1200);
    expect(round(T0).groups).toEqual([]);
  });
});

describe('MatchQueue', () => {
  it('keeps one ticket per player, and a round takes out the matched and the timed out', () => {
    const { add, queue, round } = queueOf();
    add('ana', 1200);
    add('ana', 1250); // replaces
    expect(queue.size).toBe(1);
    expect(queue.get('ana')?.rating).toBe(1250);
    add('ben', 1250);
    add('cy', 2000, { at: T0 - 60 * S });
    const r = round(T0);
    expect(r.groups).toEqual([['ana', 'ben']]);
    expect(r.timedOut).toEqual(['cy']);
    expect(queue.size).toBe(0);
  });

  it('fills in the defaults: deadline 60 s after the search starts', () => {
    const { add } = queueOf();
    expect(add('ana', 1200)).toMatchObject({
      queueKey: 'fast-2p',
      enqueuedAt: T0,
      searchStart: T0,
      deadline: T0 + 60 * S,
      extended: false,
      priority: false,
    });
  });
});

describe('a ticket is matched once (stage 9 review: two matches never pull the same ticket)', () => {
  it('random busy queues, round after round: groups are disjoint, full, mutually in range, and leave the queue', () => {
    const rng = createRng(20261010);
    const pick = (n: number) => Math.floor(rng.next() * n);
    for (let trial = 0; trial < 40; trial++) {
      const size = 2 + (trial % 3);
      const { queue, add } = queueOf(size);
      const players = 6 + pick(30);
      for (let i = 0; i < players; i++) {
        // Some history between neighbours, some keep-searching tickets, some back from a failed match.
        const opponents = pick(3) === 0 ? met(`p${(i + 1) % players}`, `p${(i + 2) % players}`) : [];
        add(`p${i}`, 1000 + pick(700), {
          at: T0 - pick(70) * S,
          opponents,
          extended: pick(5) === 0,
          priority: pick(8) === 0,
        });
      }
      const seen = new Set<string>();
      for (let r = 0; r < 12 && queue.size > 0; r++) {
        const now = T0 + r * 5 * S;
        const before = queue.list();
        const { groups, timedOut } = queue.tick(now);
        for (const g of groups) {
          expect(g.tickets).toHaveLength(size);
          for (const [i, a] of g.tickets.entries())
            for (const b of g.tickets.slice(i + 1)) expect(inMutualRange(a, b, now)).toBe(true);
        }
        const out = [...groups.flatMap((g) => g.tickets), ...timedOut].map((x) => x.userId);
        expect(new Set(out).size).toBe(out.length); // nobody twice in a round
        for (const id of out) {
          expect(seen.has(id)).toBe(false); // nor in two rounds
          seen.add(id);
          expect(queue.get(id)).toBeUndefined();
          expect(before.some((x) => x.userId === id)).toBe(true);
        }
        expect(queue.size).toBe(before.length - out.length);
      }
    }
  });
});
