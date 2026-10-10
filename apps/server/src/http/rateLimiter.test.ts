import { fakeClock } from '../testing/clock';
import { RateLimiter } from './rateLimiter';

const MINUTE = 60_000;

function setup(limit = 3, windowMs = MINUTE, maxKeys?: number) {
  const clock = fakeClock();
  const limiter = new RateLimiter({ limit, windowMs, now: clock.now, maxKeys });
  return { clock, limiter };
}

describe('RateLimiter', () => {
  it('allows `limit` requests at once, then says when the next one fits', () => {
    const { limiter } = setup(3);
    expect(limiter.take('a')).toEqual({ ok: true, remaining: 2 });
    expect(limiter.take('a')).toEqual({ ok: true, remaining: 1 });
    expect(limiter.take('a')).toEqual({ ok: true, remaining: 0 });
    // 3 per minute: a token every 20 s.
    expect(limiter.take('a')).toEqual({ ok: false, retryAfterMs: 20_000 });
  });

  it('refills evenly over the window', () => {
    const { clock, limiter } = setup(3);
    for (let i = 0; i < 3; i++) limiter.take('a');
    clock.advance(10_000);
    expect(limiter.take('a')).toEqual({ ok: false, retryAfterMs: 10_000 });
    clock.advance(10_000);
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
  });

  it('never holds more than `limit`, however long it waits', () => {
    const { clock, limiter } = setup(3);
    limiter.take('a');
    clock.advance(10 * MINUTE);
    expect(limiter.take('a')).toEqual({ ok: true, remaining: 2 });
  });

  it('keeps a bucket per key', () => {
    const { limiter } = setup(1);
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
    expect(limiter.take('b').ok).toBe(true);
  });

  it('takes a cost of more than one', () => {
    const { limiter } = setup(5);
    expect(limiter.take('a', 4)).toEqual({ ok: true, remaining: 1 });
    // 1 token left, 3 needed, a token every 12 s.
    expect(limiter.take('a', 3)).toEqual({ ok: false, retryAfterMs: 24_000 });
    expect(() => limiter.take('a', 6)).toThrow(RangeError);
    expect(() => limiter.take('a', 0)).toThrow(RangeError);
  });

  it('refuses a refused request without spending tokens', () => {
    const { clock, limiter } = setup(2);
    limiter.take('a');
    limiter.take('a');
    for (let i = 0; i < 5; i++) expect(limiter.take('a').ok).toBe(false);
    clock.advance(30_000); // one token
    expect(limiter.take('a').ok).toBe(true);
  });

  it('a clock that steps back refills nothing and breaks nothing', () => {
    const { clock, limiter } = setup(1);
    limiter.take('a');
    clock.advance(-5 * MINUTE);
    expect(limiter.take('a')).toEqual({ ok: false, retryAfterMs: MINUTE });
    clock.advance(MINUTE);
    expect(limiter.take('a').ok).toBe(true);
  });

  it('rejects bad settings', () => {
    const now = () => 0;
    expect(() => new RateLimiter({ limit: 0, windowMs: MINUTE, now })).toThrow(RangeError);
    expect(() => new RateLimiter({ limit: 1, windowMs: 0, now })).toThrow(RangeError);
    expect(() => new RateLimiter({ limit: 1, windowMs: MINUTE, now, maxKeys: 0 })).toThrow(RangeError);
  });

  describe('memory', () => {
    it('sweep() drops the buckets that have refilled completely, and only those', () => {
      const { clock, limiter } = setup(2);
      limiter.take('idle');
      clock.advance(40_000);
      limiter.take('busy');
      limiter.take('busy');
      clock.advance(30_000); // a token every 30 s. idle: full again; busy: one of two
      expect(limiter.sweep()).toBe(1);
      expect(limiter.size).toBe(1);
      expect(limiter.take('busy')).toEqual({ ok: true, remaining: 0 });
    });

    it('sweeps by itself, at most once a window', () => {
      const { clock, limiter } = setup(1);
      for (let i = 0; i < 100; i++) limiter.take(`k${i}`);
      expect(limiter.size).toBe(100);
      clock.advance(MINUTE);
      limiter.take('new');
      expect(limiter.size).toBe(1);
    });

    it('past maxKeys, the least recently used key goes first', () => {
      const { limiter } = setup(1, MINUTE, 3);
      limiter.take('a');
      limiter.take('b');
      limiter.take('c');
      expect(limiter.take('a').ok).toBe(false); // a is now the most recent
      limiter.take('d'); // evicts b
      expect(limiter.size).toBe(3);
      expect(limiter.take('b').ok).toBe(true); // forgotten, so a fresh bucket (and c goes)
      expect(limiter.take('a').ok).toBe(false); // still remembered
    });
  });
});
