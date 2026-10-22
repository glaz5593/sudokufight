import { createRng } from '@sudoku-fight/engine';
import { type QueueKey } from '@sudoku-fight/protocol';

import {
  blockedPair,
  inMutualRange,
  matchTick,
  MatchQueue,
  type NewTicket,
  nextRanges,
  type OpponentRecord,
  queueStanding,
  rangeOf,
  reachable,
  recentMap,
  recentOpponents,
  type Ticket,
  type TickResult,
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

/** A round's groups as lists of ids. */
const idsOf = (result: TickResult) => result.groups.map((g) => g.tickets.map((t) => t.userId));

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

describe('a repeat when no new game is possible (rule 2, pass 2: since 23.10.2026)', () => {
  /** Moshe's four test accounts on 23.10.2026 (fast, 1200 ± 3): only Momo and Uri had met. */
  function moshesQueue(size: 3 | 4) {
    const q = queueOf(size);
    q.add('momo', 1203, { opponents: met('uri') });
    q.add('uri', 1200, { opponents: met('momo'), at: T0 + 200 });
    q.add('noam', 1201, { at: T0 + 400 });
    if (size === 4) q.add('ahva', 1199, { at: T0 + 600 });
    return q;
  }

  it('four players, one pair met: the only group they can make forms on the first round, as a rematch', () => {
    const { queue } = moshesQueue(4);
    // Momo met 1 of the 3 he could meet (not over 80%): Uri is still a recent opponent of his.
    expect(recentMap(queue.list()).get('momo')).toEqual(new Set(['uri']));
    // Nobody is told "not enough players": they are all there, and each can be matched with the other three.
    for (const id of ['momo', 'uri', 'noam', 'ahva']) expect(queue.nextRange(id)).toBe(50);
    expect(queueStanding(queue.get('momo')!, queue.list())).toEqual({ others: 3, available: 3, recent: 1 });
    const r = queue.tick(T0 + S);
    expect(idsOf(r)).toEqual([['momo', 'uri', 'noam', 'ahva']]);
    expect(r.groups.map((g) => [g.rematch, g.recentPair])).toEqual([[true, true]]);
    expect(queue.size).toBe(0);
  });

  it('three players, one pair met: the same', () => {
    const { queue } = moshesQueue(3);
    expect(recentMap(queue.list()).get('momo')).toEqual(new Set(['uri']));
    for (const id of ['momo', 'uri', 'noam']) expect(queue.nextRange(id)).toBe(50);
    const r = queue.tick(T0 + S);
    expect(idsOf(r)).toEqual([['momo', 'uri', 'noam']]);
    expect(r.groups.map((g) => [g.rematch, g.recentPair])).toEqual([[true, true]]);
  });

  it('two players: no repeat while one of the two could still meet someone new', () => {
    const { add, round, queue } = queueOf(2);
    // Ana is a recent opponent of both Ben and Cy (each met 1 of the 2 they could meet); they never met.
    add('ana', 1200);
    add('ben', 1200, { opponents: met('ana'), at: T0 + 100 });
    add('cy', 1200, { opponents: met('ana'), at: T0 + 200 });
    expect(queue.nextRange('ana')).toBe(50); // recent opponents only, but someone to meet
    // Ana is served first, but Ben and Cy can meet someone new: each other.
    const r = round(T0 + S);
    expect(r.groups).toEqual([['ben', 'cy']]);
    expect(r.rematch).toEqual([false]);
    expect(queue.list().map((t) => t.userId)).toEqual(['ana']);
    expect(queue.nextRange('ana')).toBeNull();
  });

  it('two players: the repeat waits while a new pair comes into range, and that pair meets', () => {
    const { add, round, queue } = queueOf(2);
    add('ana', 1200);
    add('ben', 1200, { opponents: met('ana') });
    add('cy', 1450, { opponents: met('ana') }); // 250 from both: in reach, in range at 40 s
    // Ana and Ben are in range from the start, but Ben could still meet Cy, someone new.
    for (let t = 0; t < 40 * S; t += 500) expect(round(T0 + t).groups).toEqual([]);
    expect(round(T0 + 40 * S).groups).toEqual([['ben', 'cy']]);
    expect(queue.list().map((t) => t.userId)).toEqual(['ana']);
  });

  it('four players: no repeat at once when a fresh group comes within range later; it forms then', () => {
    const { add, round, queue } = queueOf(4);
    add('ana', 1200, { opponents: met('ben') });
    add('ben', 1200, { opponents: met('ana') });
    add('cy', 1200);
    add('dee', 1200);
    add('eve', 1400); // 200 from everyone: in reach, in range at 30 s
    // Ana and Ben each could still meet three who are new to them (with Eve): their next range says so.
    expect([queue.nextRange('ana'), queue.nextRange('ben'), queue.nextRange('cy')]).toEqual([200, 200, 50]);
    for (let t = 0; t < 30 * S; t += 500) expect(round(T0 + t).groups).toEqual([]);
    const r = queue.tick(T0 + 30 * S);
    expect(idsOf(r)).toEqual([['ana', 'cy', 'dee', 'eve']]);
    expect(r.groups.map((g) => [g.rematch, g.recentPair])).toEqual([[false, false]]);
    expect(queue.list().map((t) => t.userId)).toEqual(['ben']);
  });

  it('four players: a fresh group only a late joiner could complete, after the others time out, holds no repeat back', () => {
    const { add, round, queue } = queueOf(4);
    // Ana and Ben met; Cy is new to both. Eve (1460, new to all) comes at 20 s, Dee (1200, new to all) at
    // 20.5 s. {Ana or Ben, Cy, Dee, Eve} would be new to everyone, but Eve's range covers 260 only at her 45 s
    // (T0 + 65 s), after Ana's, Ben's and Cy's searches end (T0 + 60 s): no fresh option for anyone.
    add('ana', 1200, { opponents: met('ben') });
    add('ben', 1200, { opponents: met('ana') });
    add('cy', 1200);
    for (let t = 0; t < 20 * S; t += 500) expect(round(T0 + t).groups).toEqual([]);
    add('eve', 1460, { at: T0 + 20 * S });
    expect(round(T0 + 20 * S).groups).toEqual([]);
    add('dee', 1200, { at: T0 + 20.5 * S });
    // The four in range form at once, as a rematch (before this, all five timed out: Ana, Ben, Cy at 60 s).
    const r = queue.tick(T0 + 20.5 * S);
    expect(idsOf(r)).toEqual([['ana', 'ben', 'cy', 'dee']]);
    expect(r.groups.map((g) => [g.rematch, g.recentPair])).toEqual([[true, true]]);
    expect(queue.list().map((t) => t.userId)).toEqual(['eve']);
  });

  it('four players: the fresh group is checked whole, at its earliest deadline, not pair by pair', () => {
    const { add, round, queue } = queueOf(4);
    // Ana and Ben met. Eve (1400) comes at 10 s, Dee (1130) at 20 s. Each pair of {Ana, Cy, Dee, Eve} could meet
    // before the earlier of its two deadlines (Dee and Eve, 270 apart, at T0 + 65 s: before Eve's end at 70 s),
    // but the four together only after Ana's and Cy's searches end at 60 s: no fresh option.
    add('ana', 1200, { opponents: met('ben') });
    add('ben', 1200, { opponents: met('ana') });
    add('cy', 1200);
    add('eve', 1400, { at: T0 + 10 * S });
    add('dee', 1130, { at: T0 + 20 * S });
    // Dee is 70 from the three: in range at his 5 s.
    for (let t = 20 * S; t < 25 * S; t += 500) expect(round(T0 + t).groups).toEqual([]);
    const r = queue.tick(T0 + 25 * S);
    expect(idsOf(r)).toEqual([['ana', 'ben', 'cy', 'dee']]);
    expect(r.groups.map((g) => [g.rematch, g.recentPair])).toEqual([[true, true]]);
    expect(queue.list().map((t) => t.userId)).toEqual(['eve']);
  });

  it('two players: a new opponent who comes into range only after the search ends holds no repeat back', () => {
    const { add, round, queue } = queueOf(2);
    add('ana', 1000, { opponents: met('ben') });
    add('ben', 1250, { opponents: met('ana') });
    for (let t = 0; t < 30 * S; t += 500) expect(round(T0 + t).groups).toEqual([]);
    // Cy (new to both) comes at 30 s: Ana is now a recent opponent of Ben (1 of the 2 he could meet). Cy is 250
    // from Ben, and her range covers it only at her 40 s (T0 + 70 s), after Ben's search ends at 60 s; she is
    // 500 from Ana, out of reach.
    add('cy', 1500, { at: T0 + 30 * S });
    expect(recentMap(queue.list()).get('ben')).toEqual(new Set(['ana']));
    for (let t = 30 * S; t < 40 * S; t += 500) expect(round(T0 + t).groups).toEqual([]);
    // Ana and Ben are in range at 40 s: they meet, as a rematch, rather than both time out at 60 s.
    const r = round(T0 + 40 * S);
    expect(r.groups).toEqual([['ana', 'ben']]);
    expect(r.rematch).toEqual([true]);
    expect(queue.list().map((t) => t.userId)).toEqual(['cy']);
  });

  it('three players, all three pairs recent: the pair met longest ago, before closer ratings', () => {
    const { add, round } = queueOf(2);
    // Each met one of the two others (1 of 2: recent), around the circle; Ana–Cy the oldest game.
    add('ana', 1200, { opponents: [{ opponentId: 'ben', playedAt: T0 - DAY }] });
    add('ben', 1201, { opponents: [{ opponentId: 'cy', playedAt: T0 - 2 * DAY }] });
    add('cy', 1240, { opponents: [{ opponentId: 'ana', playedAt: T0 - 3 * DAY }] });
    const r = round(T0);
    expect(r.groups).toEqual([['ana', 'cy']]);
    expect(r.rematch).toEqual([true]);
  });

  it('a blocked pair never forms, even when nothing else can (spec §3.5)', () => {
    // Moshe's four, but Noam and Ahva blocked each other: the only group is never made; all time out.
    const four = queueOf(4);
    four.add('momo', 1203, { opponents: met('uri') });
    four.add('uri', 1200, { opponents: met('momo') });
    four.add('noam', 1201, { blocked: ['ahva'] });
    four.add('ahva', 1199);
    for (let t = 0; t < 60 * S; t += 500) expect(four.round(T0 + t).groups).toEqual([]);
    expect(four.round(T0 + 60 * S).timedOut).toEqual(['momo', 'uri', 'noam', 'ahva']);

    // Three, a recent pair and a blocked one: the same.
    const three = queueOf(3);
    three.add('ana', 1200, { opponents: met('ben') });
    three.add('ben', 1200, { opponents: met('ana'), blocked: ['cy'] });
    three.add('cy', 1200);
    for (let t = 0; t < 60 * S; t += 500) expect(three.round(T0 + t).groups).toEqual([]);
    expect([three.queue.nextRange('ben'), three.queue.nextRange('cy')]).toEqual([null, null]);
  });

  it('random busy queues: a group with a recent pair forms only when none of its players had a fresh option', () => {
    const rng = createRng(20261023);
    const pick = (n: number) => Math.floor(rng.next() * n);
    let repeats = 0;
    for (let trial = 0; trial < 60; trial++) {
      const size = 2 + (trial % 3);
      const { queue, add } = queueOf(size);
      const players = 3 + pick(10);
      for (let i = 0; i < players; i++) {
        const opponents = Array.from({ length: pick(3) }, () => `p${pick(players)}`);
        const blocked = pick(6) === 0 ? [`p${pick(players)}`] : [];
        add(`p${i}`, 1100 + pick(400), { at: T0 - pick(40) * S, opponents: met(...opponents), blocked });
      }
      for (let r = 0; r < 8 && queue.size > 0; r++) {
        const before = queue.list();
        const recent = recentMap(before);
        const isRecent = (a: Ticket, b: Ticket) =>
          recent.get(a.userId)!.has(b.userId) || recent.get(b.userId)!.has(a.userId);
        const freshPair = (a: Ticket, b: Ticket) =>
          a.userId !== b.userId && !isRecent(a, b) && !blockedPair(a, b) && reachable(a, b);
        /** Every two in mutual range at the group's earliest deadline: the group could still form then. */
        const inTime = (group: Ticket[]) => {
          const end = Math.min(...group.map((t) => t.deadline));
          return group.every((a, i) => group.slice(i + 1).every((b) => inMutualRange(a, b, end)));
        };
        /**
         * By brute force: some group of `size` from `pool`, with `member`, all fresh to each other, that could
         * still form before any of its searches ends.
         */
        const freshGroup = (member: Ticket, pool: Ticket[]) => {
          const mates = pool.filter((o) => freshPair(member, o));
          const extend = (from: number, chosen: Ticket[]): boolean =>
            chosen.length === size
              ? inTime(chosen)
              : mates
                  .slice(from)
                  .some(
                    (o, i) => chosen.every((c) => freshPair(c, o)) && extend(from + i + 1, [...chosen, o]),
                  );
          return extend(0, [member]);
        };
        const { groups } = queue.tick(T0 + r * 5 * S);
        for (const g of groups) {
          const hasRecentPair = g.tickets.some((a, i) => g.tickets.slice(i + 1).some((b) => isRecent(a, b)));
          expect(g.recentPair).toBe(hasRecentPair);
          for (const [i, a] of g.tickets.entries())
            for (const b of g.tickets.slice(i + 1)) expect(blockedPair(a, b)).toBe(false);
        }
        // What pass 1 left: no player of a group with a recent pair could have had a group without one.
        const pass1 = new Set(
          groups.filter((g) => !g.recentPair).flatMap((g) => g.tickets.map((t) => t.userId)),
        );
        const open = before.filter((t) => !pass1.has(t.userId));
        for (const g of groups.filter((x) => x.recentPair)) {
          repeats++;
          expect(g.rematch).toBe(true);
          for (const member of g.tickets) expect(freshGroup(member, open)).toBe(false);
        }
      }
    }
    expect(repeats).toBeGreaterThan(0);
  });

  it('a 60-ticket queue of 4 stays cheap, even when every group must be a repeat', () => {
    // Two halves; everyone met everyone in their own half (29 of 59: no reset). Pairs across the halves are
    // fresh, but no three players are all fresh to each other: pass 1 finds nothing, every round's work is
    // pass 2's (the fresh options, then the groups).
    const { add, queue } = queueOf(4);
    const half = (i: number) => i % 2;
    for (let i = 0; i < 60; i++) {
      const mates = Array.from({ length: 60 }, (_, j) => j).filter((j) => j !== i && half(j) === half(i));
      add(`p${i}`, 1180 + (i % 40), { opponents: met(...mates.map((j) => `p${j}`)) });
    }
    const started = performance.now();
    const r = queue.tick(T0);
    const ms = performance.now() - started;
    expect(r.groups).toHaveLength(15);
    expect(r.groups.every((g) => g.recentPair && g.rematch)).toBe(true);
    // A generous bound: about 100 ms on a busy development machine (the same as one round of 60 players who
    // never met, all in range, before pass 2 came: pass 1's search is the same and got cheaper).
    expect(ms).toBeLessThan(2000);
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

describe('blocks (spec §3.5): never in one game, either way, and no search starves for it', () => {
  it('two players of whom one blocked the other never meet, however long they wait; both meet others', () => {
    const { add, round } = queueOf();
    const ana = add('ana', 1200, { blocked: ['ben'] });
    const ben = add('ben', 1200);
    expect([blockedPair(ana, ben), blockedPair(ben, ana)]).toEqual([true, true]);
    for (let s = 0; s < 30; s += 5) expect(round(T0 + s * S).groups).toEqual([]);
    add('cy', 1210, { at: T0 + 30 * S });
    expect(round(T0 + 30 * S).groups).toEqual([['ana', 'cy']]);
    add('dee', 1190, { at: T0 + 31 * S });
    expect(round(T0 + 31 * S).groups).toEqual([['ben', 'dee']]);
  });

  it('the block counts from either side: the one who was blocked does not meet the blocker', () => {
    const { add, round } = queueOf();
    add('ana', 1200);
    add('ben', 1200, { blocked: ['ana'] });
    expect(round(T0).groups).toEqual([]);
  });

  it('3 and 4 players: a group never has a blocked pair, and forms around it when it can', () => {
    const three = queueOf(3);
    three.add('ana', 1200, { blocked: ['ben'] });
    three.add('ben', 1200);
    three.add('cy', 1200);
    expect(three.round(T0).groups).toEqual([]);
    three.add('dee', 1200);
    // Ana is served first: with Cy and Dee, not Ben.
    expect(three.round(T0).groups).toEqual([['ana', 'cy', 'dee']]);

    const four = queueOf(4);
    for (const id of ['p1', 'p2', 'p3', 'p4']) four.add(id, 1200, id === 'p4' ? { blocked: ['p2'] } : {});
    expect(four.round(T0).groups).toEqual([]);
    four.add('p5', 1200);
    expect(four.round(T0).groups).toEqual([['p1', 'p2', 'p3', 'p5']]);
  });

  it('a blocked player is not an available opponent: the 80% reset still comes (no starvation)', () => {
    const { add, round, queue } = queueOf();
    // Ana and Cy met; Ana blocked Ben, who is in Ana's reach (200 away) but not in Cy's (400 away). Were Ben
    // an available opponent of Ana's, she would have met only half of hers, Cy would stay "recent", and Ana
    // could meet nobody while Ben waits. Without him, Cy is all she could meet: the history starts over.
    const ana = add('ana', 1200, { opponents: met('cy'), blocked: ['ben'] });
    add('ben', 1400);
    const cy = add('cy', 1000, { opponents: met('ana') });
    expect(recentOpponents(ana, queue.list())).toEqual(new Set());
    expect(recentOpponents(cy, queue.list())).toEqual(new Set());
    expect(round(T0 + 25 * S).groups).toEqual([]); // 200 apart: both ranges reach it at 30 s
    const r = round(T0 + 30 * S);
    expect(r.groups).toEqual([['ana', 'cy']]);
    expect(r.rematch).toEqual([true]);
  });

  it('random busy queues with blocks: no group ever holds a blocked pair', () => {
    const rng = createRng(20261014);
    const pick = (n: number) => Math.floor(rng.next() * n);
    for (let trial = 0; trial < 30; trial++) {
      const size = 2 + (trial % 3);
      const { queue, add } = queueOf(size);
      const players = 6 + pick(20);
      const blocks = new Map<string, string[]>();
      for (let i = 0; i < players; i++) {
        const blocked = pick(3) === 0 ? [`p${pick(players)}`, `p${pick(players)}`] : [];
        blocks.set(`p${i}`, blocked);
        add(`p${i}`, 1100 + pick(300), { at: T0 - pick(30) * S, blocked });
      }
      const isBlocked = (a: string, b: string) =>
        (blocks.get(a) ?? []).includes(b) || (blocks.get(b) ?? []).includes(a);
      for (let r = 0; r < 12 && queue.size > 0; r++) {
        for (const g of queue.tick(T0 + r * 5 * S).groups) {
          const ids = g.tickets.map((x) => x.userId);
          for (const [i, a] of ids.entries())
            for (const b of ids.slice(i + 1)) expect(isBlocked(a, b)).toBe(false);
        }
      }
    }
  });
});

describe('next range (rule 7: who else is searching, for the app; never a rule of matching)', () => {
  it('alone in the queue: null (nobody to meet)', () => {
    const { add, queue } = queueOf();
    add('ana', 1200);
    expect(queue.nextRange('ana')).toBeNull();
    // Not in the queue at all: null too.
    expect(queue.nextRange('nobody')).toBeNull();
  });

  it('the narrowest D6 range that covers the nearest player, for both', () => {
    const { add, queue } = queueOf();
    add('ana', 1200);
    add('ben', 1330);
    expect([queue.nextRange('ana'), queue.nextRange('ben')]).toEqual([150, 150]);
    add('ben', 1351); // replaces: 151 away
    expect([queue.nextRange('ana'), queue.nextRange('ben')]).toEqual([175, 175]);
  });

  it('a player already within the range: the range they are covered at (≤ the current one)', () => {
    const { add, queue } = queueOf();
    add('ana', 1200, { at: T0 - 20 * S });
    add('ben', 1220);
    expect(queue.nextRange('ana')).toBe(50);
    expect(queue.nextRange('ana')).toBeLessThanOrEqual(rangeOf(queue.get('ana')!, T0));
  });

  it('a block, either way, hides the two from each other (and says nothing of it)', () => {
    for (const blocks of [{ ana: ['ben'] }, { ben: ['ana'] }] as Record<string, string[]>[]) {
      const { add, queue } = queueOf();
      add('ana', 1200, { blocked: blocks.ana ?? [] });
      add('ben', 1210, { blocked: blocks.ben ?? [] });
      expect([queue.nextRange('ana'), queue.nextRange('ben')]).toEqual([null, null]);
      add('cy', 1300);
      expect([queue.nextRange('ana'), queue.nextRange('ben'), queue.nextRange('cy')]).toEqual([
        100, 100, 100,
      ]);
    }
  });

  it('a recent opponent does not count while a new one is around; alone with them, the 80% reset lets them in', () => {
    const { add, queue } = queueOf();
    add('ana', 1200, { opponents: met('rex') });
    add('rex', 1205);
    add('neo', 1450);
    // As the matcher sees it: Rex is recent for Ana (1 of the 2 she could meet), Neo is new.
    expect(recentMap(queue.list()).get('ana')).toEqual(new Set(['rex']));
    expect(queue.nextRange('ana')).toBe(250);
    expect(queue.nextRange('rex')).toBe(250); // Neo, 245 away
    queue.remove('neo');
    // Rex is all Ana could meet now: the history starts over, and he is 5 away.
    expect(queue.nextRange('ana')).toBe(50);
    expect(queue.nextRange('rex')).toBe(50);
  });

  it('out of reach (beyond ±300 for either): null, until both lift the cap with "keep searching"', () => {
    const both = queueOf();
    both.add('ana', 1200);
    both.add('ben', 1600);
    expect(both.queue.nextRange('ana')).toBeNull();

    const extended = queueOf();
    extended.add('ana', 1200, { extended: true });
    extended.add('ben', 1600, { extended: true });
    expect([extended.queue.nextRange('ana'), extended.queue.nextRange('ben')]).toEqual([400, 400]);

    // Only Ana kept searching: Ben's cap still keeps them apart.
    const one = queueOf();
    one.add('ana', 1200, { extended: true });
    one.add('ben', 1600);
    expect([one.queue.nextRange('ana'), one.queue.nextRange('ben')]).toEqual([null, null]);
  });

  it('is clamped to the cap: a player 290 away needs ±300', () => {
    const { add, queue } = queueOf();
    add('ana', 1200);
    add('ben', 1490);
    expect(queue.nextRange('ana')).toBe(300);
  });

  it('a table of 3: two others needed (the farther one counts); 4: three', () => {
    const three = queueOf(3);
    three.add('ana', 1200);
    three.add('ben', 1230);
    expect(three.queue.nextRange('ana')).toBeNull();
    three.add('cy', 1320);
    expect(three.queue.nextRange('ana')).toBe(125);

    const four = queueOf(4);
    four.add('ana', 1200);
    four.add('ben', 1200);
    four.add('cy', 1200);
    expect(four.queue.nextRange('ana')).toBeNull();
    four.add('dee', 1260);
    expect(four.queue.nextRange('ana')).toBe(75);
  });

  it('MatchQueue: follows every change of the queue (add, remove, a match), and not the time', () => {
    const { add, queue, round } = queueOf();
    add('ana', 1200);
    expect(queue.nextRange('ana')).toBeNull();
    add('far', 1600);
    expect(queue.nextRange('ana')).toBeNull();
    add('ben', 1400);
    expect(queue.nextRange('ana')).toBe(200);
    expect(round(T0 + 10 * S).groups).toEqual([]); // nothing changed: the same answer later
    expect(queue.nextRange('ana')).toBe(200);
    queue.remove('ben');
    expect(queue.nextRange('ana')).toBeNull();
    add('cy', 1210);
    add('dee', 1395);
    expect(queue.nextRange('dee')).toBe(200); // Ana, 195 away (Cy, 185 away, is nearer for her)
    expect(round(T0 + 10 * S).groups).toEqual([['ana', 'cy']]);
    // Ana and Cy left with their match: Dee has only Far (205 away) now.
    expect(queue.nextRange('dee')).toBe(225);
    expect(queue.nextRange('ana')).toBeNull();
  });

  it('nextRangeOf: a ticket that just timed out, against the tickets still waiting', () => {
    const { add, queue } = queueOf();
    add('ana', 1200, { at: T0 - 60 * S });
    add('ben', 1550);
    const r = queue.tick(T0);
    expect(r.timedOut.map((t) => t.userId)).toEqual(['ana']);
    const ana = r.timedOut[0]!;
    expect(queue.nextRangeOf(ana)).toBeNull(); // Ben is 350 away
    add('cy', 1290);
    expect(queue.nextRangeOf(ana)).toBe(100);
    // Ana is not back in the queue for it.
    expect(queue.get('ana')).toBeUndefined();
  });

  it('null is exact: a ticket told "nobody" is never in a group, whatever the time (random queues)', () => {
    const rng = createRng(20261015);
    const pick = (n: number) => Math.floor(rng.next() * n);
    let nulls = 0;
    let numbers = 0;
    for (let trial = 0; trial < 60; trial++) {
      const size = 2 + (trial % 3);
      const { queue, add } = queueOf(size);
      const players = 2 + pick(12);
      for (let i = 0; i < players; i++) {
        const opponents = pick(3) === 0 ? met(`p${pick(players)}`) : [];
        const blocked = pick(4) === 0 ? [`p${pick(players)}`] : [];
        add(`p${i}`, 900 + pick(900), {
          at: T0 - pick(60) * S,
          opponents,
          blocked,
          extended: pick(6) === 0,
        });
      }
      const tickets = queue.list();
      const ranges = nextRanges(tickets, size);
      for (const t of tickets) expect(queue.nextRange(t.userId)).toBe(ranges.get(t.userId));
      // Far in the future every range is at its widest.
      for (const later of [T0, T0 + 30 * S, T0 + 600 * S]) {
        for (const g of matchTick(tickets, size, later).groups)
          for (const t of g.tickets) expect(ranges.get(t.userId)).not.toBeNull();
      }
      for (const v of ranges.values())
        if (v === null) nulls++;
        else numbers++;
    }
    expect(nulls).toBeGreaterThan(0);
    expect(numbers).toBeGreaterThan(0);
  });
});
