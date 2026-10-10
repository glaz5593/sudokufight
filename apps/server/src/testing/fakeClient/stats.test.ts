import type { ClientAction, GameEvent } from '@sudoku-fight/engine';

import { DEFAULT_MESSAGE_LIMITS } from '../../game/gate';
import { RateLimiter } from '../../http/rateLimiter';
import { ActionTracker, answers, ClockSync, Pacer } from './stats';

const ev = (body: Record<string, unknown>): GameEvent => ({ seq: 9, t: 0, ...body }) as GameEvent;

describe('ClockSync', () => {
  it('round trips from ping/pong, and the offset from the quickest one', () => {
    const sync = new ClockSync();
    expect(sync.synced).toBe(false);
    expect(sync.offsetMs).toBe(0);

    // The server's clock is 1000 ms ahead of ours.
    const t1 = sync.ping(100);
    const t2 = sync.ping(200);
    expect(sync.unanswered).toBe(2);
    // A slow round trip (80 ms, the answer late on the way back): a worse estimate.
    expect(sync.pong(t1, 5_000 + 1000 + 10, 180, 5_080)).toBe(80);
    expect(sync.offsetMs).toBe(5_000 + 1000 + 10 + 40 - 5_080);
    // A quick one (4 ms): kept.
    expect(sync.pong(t2, 6_000 + 1000 + 2, 204, 6_004)).toBe(4);
    expect(sync.offsetMs).toBe(1000);
    expect(sync.synced).toBe(true);
    expect(sync.rtt.summary()).toMatchObject({ count: 2, maxMs: 80 });
    expect(sync.unanswered).toBe(0);
  });

  it('ignores a pong for a ping it did not send (or already answered), and forgets pings lost with a drop', () => {
    const sync = new ClockSync();
    const t = sync.ping(10);
    expect(sync.pong(999, 1, 20, 1)).toBeNull();
    expect(sync.pong(t, 1, 20, 1)).toBe(10);
    expect(sync.pong(t, 1, 30, 1)).toBeNull(); // twice
    sync.ping(40);
    sync.forgetInFlight();
    expect(sync.unanswered).toBe(0);
    expect(sync.rtt.summary().count).toBe(1);
  });

  it('two pings in the same instant still get their own t', () => {
    const sync = new ClockSync();
    const a = sync.ping(5);
    const b = sync.ping(5);
    expect(a).not.toBe(b);
    expect(sync.pong(b, 0, 6, 0)).not.toBeNull();
    expect(sync.pong(a, 0, 6, 0)).not.toBeNull();
  });
});

describe('answers', () => {
  const me = 'ana';
  const cases: [ClientAction, GameEvent, GameEvent][] = [
    [
      { type: 'select', cell: 4 },
      ev({ type: 'cellLocked', playerId: me, cell: 4 }),
      ev({ type: 'cellLocked', playerId: 'ben', cell: 4 }),
    ],
    [
      { type: 'release' },
      ev({ type: 'cellReleased', playerId: me, cell: 4, reason: 'cancel' }),
      ev({ type: 'cellReleased', playerId: me, cell: 4, reason: 'timeout' }),
    ],
    [
      { type: 'place', cell: 4, digit: 3 },
      ev({ type: 'placedWrong', playerId: me, cell: 4 }),
      ev({ type: 'placedCorrect', playerId: me, cell: 5 }),
    ],
    [
      { type: 'interfere', targetId: 'ben', kind: 'cats' },
      ev({ type: 'interference', fromId: me, targetId: 'ben' }),
      ev({ type: 'interference', fromId: 'ben', targetId: me }),
    ],
    [
      { type: 'react', emoji: '😂' },
      ev({ type: 'reaction', playerId: me }),
      ev({ type: 'reaction', playerId: 'ben' }),
    ],
    [
      { type: 'surrender' },
      ev({ type: 'playerSurrendered', playerId: me }),
      ev({ type: 'playerAbandoned', playerId: me }),
    ],
  ];
  it.each(cases)('%o is answered by its own event only', (action, yes, no) => {
    expect(answers(action, yes, me)).toBe(true);
    expect(answers(action, no, me)).toBe(false);
  });
  it('a placedCorrect answers a place on its cell', () => {
    expect(
      answers({ type: 'place', cell: 5, digit: 1 }, ev({ type: 'placedCorrect', playerId: me, cell: 5 }), me),
    ).toBe(true);
  });
});

describe('ActionTracker', () => {
  it('times each action to its event or its refusal, oldest first', () => {
    const tracker = new ActionTracker();
    tracker.sent(1, { type: 'select', cell: 3 }, 100);
    tracker.sent(2, { type: 'react', emoji: '😂' }, 110);
    tracker.sent(3, { type: 'select', cell: 3 }, 120);
    expect(tracker.waiting).toBe(3);

    tracker.events([ev({ type: 'cellLocked', playerId: 'ana', cell: 3 })], 'ana', 130); // answers #1
    tracker.rejected(2, 140);
    tracker.rejected(77, 150); // not ours
    expect(tracker.waiting).toBe(1);
    expect(tracker.latency.summary()).toMatchObject({ count: 2, maxMs: 30 });
    expect(tracker.latency.percentile(0)).toBe(30); // nearest rank: both 30
  });

  it('counts the unanswered as lost: on a drop, and after expireMs', () => {
    const tracker = new ActionTracker(1000);
    tracker.sent(1, { type: 'release' }, 0);
    tracker.sent(2, { type: 'release' }, 0);
    tracker.reset();
    expect(tracker.lost).toBe(2);
    tracker.sent(3, { type: 'release' }, 0);
    tracker.sent(4, { type: 'surrender' }, 900);
    tracker.events([], 'ana', 1000);
    expect(tracker.lost).toBe(3);
    expect(tracker.waiting).toBe(1);
  });
});

describe('Pacer', () => {
  it('keeps under the server limit with a margin: a burst one short of it, then a slower refill', () => {
    let now = 0;
    const pacer = new Pacer(() => now);
    const { limit, windowMs } = DEFAULT_MESSAGE_LIMITS.place; // 5 a second
    for (let k = 0; k < limit - 1; k++) expect(pacer.take('place')).toBe(0);
    const wait = pacer.take('place');
    expect(wait).toBe(Math.ceil((windowMs * 1.1) / (limit - 1)));
    now += wait;
    expect(pacer.take('place')).toBe(0);
    // Another type has its own bucket.
    expect(pacer.take('select')).toBe(0);
  });

  it.each(['place', 'select', 'ping', 'react'] as const)(
    'paced %s never trips the server limit, even when the network bunches messages up',
    (type) => {
      let now = 0;
      const pacer = new Pacer(() => now);
      const sentAt: number[] = [];
      for (let step = 0; step < 4000; step++) {
        now += 7; // asked every 7 ms for 28 s
        if (pacer.take(type) === 0) sentAt.push(now);
      }
      // The server's own bucket, at arrival: in order, each one held up by 0-200 ms on the way.
      let arrival = 0;
      const server = new RateLimiter({ ...DEFAULT_MESSAGE_LIMITS[type], now: () => arrival });
      for (const [k, t] of sentAt.entries()) {
        arrival = Math.max(arrival, t + (k % 2 === 0 ? 200 : 0));
        expect(server.take('ana').ok).toBe(true);
      }
      const { limit, windowMs } = DEFAULT_MESSAGE_LIMITS[type];
      // And it does not hold back much more than it must.
      expect(sentAt.length).toBeGreaterThan((28_000 / (windowMs * 1.1)) * Math.max(1, limit - 1) * 0.9);
    },
  );
});
