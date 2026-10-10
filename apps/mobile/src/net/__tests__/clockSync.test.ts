import { ClockSync, robustOffset, TokenBucket } from '../clockSync';
import { percentile, RollingStats } from '../rollingStats';

describe('ClockSync (spec §18: offset from ping/pong)', () => {
  it('works out offset = serverTime − (t + rtt/2) and the round trip', () => {
    const sync = new ClockSync();
    expect(sync.synced).toBe(false);
    expect(sync.offsetMs).toBe(0);
    const t = sync.ping(1000);
    // Out at 1000, the server read 6040 on its clock, back at 1080: rtt 80, so the server answered at 1040.
    const sample = sync.pong(t, 6040, 1080);
    expect(sample).toEqual({ rttMs: 80, offsetMs: 5000, at: 1080 });
    expect(sync.synced).toBe(true);
    expect(sync.offsetMs).toBe(5000);
    expect(sync.rtt.summary()).toMatchObject({ count: 1, p50: 80, p95: 80 });
  });

  it('ignores pongs that answer no ping of ours, and pings forgotten with a drop', () => {
    const sync = new ClockSync();
    expect(sync.pong(123, 5000, 200)).toBeNull();
    const t = sync.ping(100);
    sync.forgetInFlight();
    expect(sync.pong(t, 5000, 200)).toBeNull();
    expect(sync.synced).toBe(false);
    const again = sync.ping(300);
    expect(sync.pong(again, 5000, 340)).not.toBeNull();
    // Answered once only.
    expect(sync.pong(again, 5000, 350)).toBeNull();
  });

  it('tells apart two pings sent in the same millisecond', () => {
    const sync = new ClockSync();
    const a = sync.ping(500);
    const b = sync.ping(500);
    expect(a).not.toBe(b);
    expect(sync.unanswered).toBe(2);
    expect(sync.pong(b, 1000, 520)).not.toBeNull();
    expect(sync.pong(a, 1000, 530)).not.toBeNull();
  });

  it('takes the median offset of the shortest round trips, so a slow one-way trip does not skew it', () => {
    const sync = new ClockSync({ offsetBest: 3 });
    // True offset 1000, rtt 40, symmetric: serverTime = t + 20 + 1000.
    for (let k = 0; k < 4; k++) {
      const t = sync.ping(k * 1000);
      sync.pong(t, t + 20 + 1000, t + 40);
    }
    // A round trip slow on the way back only (rtt 400): its offset alone would be 180 ms off.
    const slow = sync.ping(10_000);
    sync.pong(slow, slow + 20 + 1000, slow + 400);
    expect(sync.offsetMs).toBe(1000);
    expect(sync.rtt.count).toBe(5);
  });

  it('follows a clock that drifts: only the recent samples count', () => {
    const sync = new ClockSync({ offsetWindow: 3, offsetBest: 3 });
    for (let k = 0; k < 3; k++) {
      const t = sync.ping(k * 100);
      sync.pong(t, t + 10 + 1000, t + 20);
    }
    expect(sync.offsetMs).toBe(1000);
    for (let k = 3; k < 6; k++) {
      const t = sync.ping(k * 100);
      sync.pong(t, t + 10 + 1200, t + 20);
    }
    expect(sync.offsetMs).toBe(1200);
  });

  it('keeps the last 200 round trips', () => {
    const sync = new ClockSync();
    for (let k = 0; k < 250; k++) {
      const t = sync.ping(k * 10);
      sync.pong(t, t, t + (k % 10));
    }
    expect(sync.rtt.count).toBe(200);
    expect(sync.rtt.total).toBe(250);
  });

  it('robustOffset: the median, even or odd', () => {
    const s = (rttMs: number, offsetMs: number) => ({ rttMs, offsetMs, at: 0 });
    expect(robustOffset([], 5)).toBeNull();
    expect(robustOffset([s(10, 5), s(20, 7), s(30, 100)], 2)).toBe(6);
    expect(robustOffset([s(10, 5), s(20, 7), s(15, 6)], 3)).toBe(6);
  });
});

describe('TokenBucket (the server limits pings to 5 per 2.5 s)', () => {
  it('lets a burst through, then refills evenly', () => {
    const bucket = new TokenBucket(5, 2500, 0);
    for (let k = 0; k < 5; k++) expect(bucket.take(0)).toBe(true);
    expect(bucket.take(0)).toBe(false);
    expect(bucket.take(499)).toBe(false);
    expect(bucket.take(500)).toBe(true);
    // A clock that goes back does not take tokens away.
    expect(bucket.take(100)).toBe(false);
  });
});

describe('RollingStats', () => {
  it('nearest-rank percentiles over the window', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    const stats = new RollingStats(3);
    [10, 20, 30, 40].forEach((v) => stats.add(v));
    stats.add(Number.NaN);
    expect(stats.values()).toEqual([20, 30, 40]);
    expect(stats.summary()).toEqual({ count: 3, total: 4, p50: 30, p95: 40, max: 40, last: 40 });
    stats.clear();
    expect(stats.summary()).toMatchObject({ count: 0, p50: null, p95: null, max: null, last: null });
    expect(() => new RollingStats(0)).toThrow(RangeError);
  });
});
