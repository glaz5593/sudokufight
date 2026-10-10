import { GameMetrics, LatencyStats } from './metrics';

describe('LatencyStats', () => {
  it('gives nearest-rank percentiles and the max', () => {
    const s = new LatencyStats();
    expect(s.summary()).toEqual({ count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
    for (let ms = 1; ms <= 100; ms++) s.add(ms);
    expect(s.percentile(50)).toBe(50);
    expect(s.percentile(95)).toBe(95);
    expect(s.percentile(100)).toBe(100);
    expect(s.summary()).toEqual({ count: 100, p50Ms: 50, p95Ms: 95, maxMs: 100 });
  });

  it('keeps only the last samples for percentiles, but counts all and remembers the max', () => {
    const s = new LatencyStats(10);
    s.add(500);
    for (let k = 0; k < 10; k++) s.add(1);
    expect(s.percentile(95)).toBe(1);
    expect(s.summary()).toMatchObject({ count: 11, maxMs: 500 });
  });
});

describe('GameMetrics', () => {
  it('reports rooms, games, action times by type, pings, drops and kicks', () => {
    const m = new GameMetrics();
    m.roomOpened();
    m.roomOpened();
    m.roomClosed();
    m.gameStarted();
    m.gameOver();
    m.action('select', 0.4);
    m.action('place', 1.2);
    m.action('place', 0.8);
    m.ping();
    m.drop('rateLimited');
    m.drop('duplicate');
    m.kick();
    expect(m.report()).toEqual({
      rooms: { open: 1, created: 2 },
      games: { started: 1, over: 1 },
      actions: { count: 3, p50Ms: 0.8, p95Ms: 1.2, maxMs: 1.2, byType: { select: 1, place: 2 } },
      pings: 1,
      dropped: { unknownType: 0, malformed: 0, rateLimited: 1, duplicate: 1 },
      kicks: 1,
    });
  });
});
