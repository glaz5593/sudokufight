import { fakeClock } from '../testing/clock';
import { DEFAULT_ABUSE_LIMIT, DEFAULT_MESSAGE_LIMITS, MessageGate, parseClientMessage } from './gate';

const gate = (limits = DEFAULT_MESSAGE_LIMITS) => {
  const clock = fakeClock();
  return { clock, gate: new MessageGate({ now: clock.now, limits }) };
};

/** Limits so wide they never get in the way. */
const WIDE = Object.fromEntries(
  Object.keys(DEFAULT_MESSAGE_LIMITS).map((k) => [k, { limit: 1000, windowMs: 1000 }]),
) as typeof DEFAULT_MESSAGE_LIMITS;

describe('parseClientMessage: the shape of each message (spec §18)', () => {
  it('takes every client message in its documented shape', () => {
    expect(parseClientMessage('select', { clientSeq: 1, cell: 30 })).toEqual({
      kind: 'action',
      clientSeq: 1,
      action: { type: 'select', cell: 30 },
    });
    expect(parseClientMessage('release', { clientSeq: 2 })).toMatchObject({ action: { type: 'release' } });
    expect(parseClientMessage('place', { clientSeq: 3, cell: 30, digit: 7 })).toMatchObject({
      action: { type: 'place', cell: 30, digit: 7 },
    });
    expect(parseClientMessage('interfere', { clientSeq: 4, targetId: 'ben', kind: 'cats' })).toMatchObject({
      action: { type: 'interfere', targetId: 'ben', kind: 'cats' },
    });
    expect(parseClientMessage('react', { clientSeq: 5, emoji: '😎' })).toMatchObject({
      action: { type: 'react', emoji: '😎' },
    });
    expect(parseClientMessage('surrender', { clientSeq: 6 })).toMatchObject({
      action: { type: 'surrender' },
    });
    expect(parseClientMessage('ping', { t: 123.5 })).toEqual({ kind: 'ping', t: 123.5 });
  });

  it('accepts the whole ClientMessage as the payload (its type must agree)', () => {
    expect(parseClientMessage('place', { type: 'place', clientSeq: 3, cell: 1, digit: 2 })).not.toBeNull();
    expect(parseClientMessage('place', { type: 'select', clientSeq: 3, cell: 1, digit: 2 })).toBeNull();
    expect(parseClientMessage('ping', { type: 'ping', t: 1 })).not.toBeNull();
  });

  it.each([
    ['no payload', 'release', undefined],
    ['not an object', 'release', 'clientSeq=1'],
    ['an array', 'release', [1]],
    ['no clientSeq', 'select', { cell: 1 }],
    ['clientSeq 0', 'select', { clientSeq: 0, cell: 1 }],
    ['a negative clientSeq', 'select', { clientSeq: -1, cell: 1 }],
    ['a fractional clientSeq', 'select', { clientSeq: 1.5, cell: 1 }],
    ['a string clientSeq', 'select', { clientSeq: '1', cell: 1 }],
    ['a fractional cell', 'select', { clientSeq: 1, cell: 1.5 }],
    ['a string cell', 'select', { clientSeq: 1, cell: 'A1' }],
    ['a missing digit', 'place', { clientSeq: 1, cell: 1 }],
    ['a string digit', 'place', { clientSeq: 1, cell: 1, digit: '5' }],
    ['an extra key', 'release', { clientSeq: 1, playerId: 'ben' }],
    ['a long emoji', 'react', { clientSeq: 1, emoji: 'x'.repeat(17) }],
    ['a long target', 'interfere', { clientSeq: 1, targetId: 'x'.repeat(65), kind: 'cats' }],
    ['a ping without t', 'ping', {}],
    ['an infinite t', 'ping', { t: Infinity }],
  ] as const)('refuses %s', (_why, type, payload) => {
    expect(parseClientMessage(type, payload)).toBeNull();
  });

  it('a move made offline [D42]: strict, with a think time of 0–600 000 ms; the engine clamps it further', () => {
    expect(parseClientMessage('offlineMove', { clientSeq: 7, cell: 30, digit: 7, thinkMs: 2500 })).toEqual({
      kind: 'action',
      clientSeq: 7,
      action: { type: 'offlineMove', cell: 30, digit: 7, thinkMs: 2500 },
    });
    for (const bad of [
      { clientSeq: 7, cell: 30, digit: 7 }, // no thinkMs
      { clientSeq: 7, cell: 30, digit: 7, thinkMs: -1 },
      { clientSeq: 7, cell: 30, digit: 7, thinkMs: 600_001 },
      { clientSeq: 7, cell: 30, digit: 7, thinkMs: 1.5 },
      { clientSeq: 7, cell: 30, digit: 7, thinkMs: 1, playerId: 'ben' },
    ])
      expect(parseClientMessage('offlineMove', bad)).toBeNull();
    const { gate: g, clock } = gate();
    let seq = 0;
    const sent = Array.from({ length: 18 }, () =>
      g.admit('ana', 'offlineMove', { clientSeq: ++seq, cell: 1, digit: 1, thinkMs: 0 }),
    );
    // The burst after a return, and again after a second quick return before the answers came.
    expect(sent.filter((r) => r.kind === 'action')).toHaveLength(16);
    clock.advance(1000);
    expect(g.admit('ana', 'offlineMove', { clientSeq: 3, cell: 1, digit: 1, thinkMs: 0 })).toMatchObject({
      reason: 'duplicate',
    });
  });

  it("leaves ranges to the engine, so the client hears the engine's reason", () => {
    expect(parseClientMessage('select', { clientSeq: 1, cell: 81 })).not.toBeNull(); // engine: badCell
    expect(parseClientMessage('place', { clientSeq: 1, cell: 0, digit: 0 })).not.toBeNull(); // badDigit
    expect(parseClientMessage('interfere', { clientSeq: 1, targetId: 'x', kind: 'dragons' })).not.toBeNull();
  });
});

describe('MessageGate', () => {
  it('lets a well-formed action through with its clientSeq, and answers ping', () => {
    const { gate: g } = gate();
    expect(g.admit('ana', 'select', { clientSeq: 1, cell: 4 })).toEqual({
      kind: 'action',
      clientSeq: 1,
      action: { type: 'select', cell: 4 },
    });
    expect(g.admit('ana', 'ping', { t: 5 })).toEqual({ kind: 'ping', t: 5 });
    expect(g.lastClientSeq('ana')).toBe(1);
  });

  it('drops an unknown type and a malformed payload, keeping a readable clientSeq to answer with', () => {
    const { gate: g } = gate();
    expect(g.admit('ana', 'teleport', { clientSeq: 1 })).toEqual({
      kind: 'dropped',
      reason: 'unknownType',
      clientSeq: null,
      kick: false,
    });
    expect(g.admit('ana', 7, {})).toMatchObject({ reason: 'unknownType' });
    expect(g.admit('ana', 'place', { clientSeq: 9, cell: 'A1', digit: 2 })).toEqual({
      kind: 'dropped',
      reason: 'malformed',
      clientSeq: 9,
      kick: false,
    });
    expect(g.admit('ana', 'place', { clientSeq: -2 })).toMatchObject({
      reason: 'malformed',
      clientSeq: null,
    });
    // A malformed message does not use up its clientSeq.
    expect(g.admit('ana', 'select', { clientSeq: 9, cell: 1 })).toMatchObject({ kind: 'action' });
  });

  it('drops duplicate and old clientSeqs (spec §21); gaps are fine; each player counts alone', () => {
    const { gate: g } = gate(WIDE);
    expect(g.admit('ana', 'select', { clientSeq: 5, cell: 1 }).kind).toBe('action');
    expect(g.admit('ana', 'select', { clientSeq: 5, cell: 2 })).toEqual({
      kind: 'dropped',
      reason: 'duplicate',
      clientSeq: 5,
      kick: false,
    });
    expect(g.admit('ana', 'release', { clientSeq: 3 })).toMatchObject({ reason: 'duplicate' });
    expect(g.admit('ana', 'release', { clientSeq: 9 }).kind).toBe('action');
    expect(g.admit('ben', 'select', { clientSeq: 1, cell: 2 }).kind).toBe('action');
    // A fresh join starts the count over; a reconnection (no newSession) keeps it.
    g.newSession('ana');
    expect(g.admit('ana', 'select', { clientSeq: 1, cell: 2 }).kind).toBe('action');
  });

  it('limits each message type per player: a flood is dropped, and the bucket refills', () => {
    const { gate: g, clock } = gate();
    let seq = 0;
    const place = (player = 'ana') => g.admit(player, 'place', { clientSeq: ++seq, cell: 1, digit: 1 });
    const results = Array.from({ length: 8 }, () => place());
    expect(results.filter((r) => r.kind === 'action')).toHaveLength(5); // 5 a second
    expect(results.slice(5)).toEqual(
      Array(3).fill({ kind: 'dropped', reason: 'rateLimited', clientSeq: expect.any(Number), kick: false }),
    );
    // Other types and other players have their own buckets.
    expect(g.admit('ana', 'select', { clientSeq: ++seq, cell: 1 }).kind).toBe('action');
    expect(place('ben').kind).toBe('action');
    clock.advance(200); // one more place token
    expect(place().kind).toBe('action');
    expect(place().kind).toBe('dropped');
  });

  it('allows a burst of 5 pings, then 2 a second', () => {
    const { gate: g, clock } = gate();
    const pings = Array.from({ length: 10 }, (_, t) => g.admit('ana', 'ping', { t }));
    expect(pings.filter((p) => p.kind === 'ping')).toHaveLength(5);
    clock.advance(500);
    expect(g.admit('ana', 'ping', { t: 1 }).kind).toBe('ping');
    expect(g.admit('ana', 'ping', { t: 2 }).kind).toBe('dropped');
  });

  it('a rate-limited action does not use up its clientSeq, so it may be sent again', () => {
    const { gate: g, clock } = gate();
    for (let s = 1; s <= 5; s++) g.admit('ana', 'place', { clientSeq: s, cell: 1, digit: 1 });
    expect(g.admit('ana', 'place', { clientSeq: 6, cell: 1, digit: 1 }).kind).toBe('dropped');
    clock.advance(1000);
    expect(g.admit('ana', 'place', { clientSeq: 6, cell: 1, digit: 1 }).kind).toBe('action');
  });

  it('too many violations in the window: disconnect (duplicates are not violations)', () => {
    const { gate: g, clock } = gate();
    // One action and nine copies of it, within the rate limit: duplicates cost nothing.
    const sent = Array.from({ length: 10 }, () => g.admit('ana', 'release', { clientSeq: 1 }));
    expect(sent.filter((r) => r.kind === 'dropped' && r.reason === 'duplicate')).toHaveLength(9);
    const bad = Array.from({ length: DEFAULT_ABUSE_LIMIT.limit + 1 }, () => g.admit('ana', 'nonsense', null));
    expect(bad.slice(0, -1).every((r) => r.kind === 'dropped' && !r.kick)).toBe(true);
    expect(bad.at(-1)).toMatchObject({ kind: 'dropped', kick: true });
    // Someone else is not affected; and the budget comes back with time.
    expect(g.admit('ben', 'nonsense', null)).toMatchObject({ kick: false });
    clock.advance(DEFAULT_ABUSE_LIMIT.windowMs);
    expect(g.admit('ana', 'nonsense', null)).toMatchObject({ kick: false });
  });
});
