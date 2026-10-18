import { ConnectionStats, GameMetrics, LatencyStats } from './metrics';

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
      connections: { soft: 0, backInSoft: 0, hard: 0, backHard: 0 },
      offlineMoves: { applied: 0, lost: {} },
    });
  });

  it('counts lost connections, returns and moves made offline [D42]', () => {
    const m = new GameMetrics();
    m.connection('soft');
    m.connection('soft');
    m.connection('backInSoft');
    m.connection('hard'); // the second one's soft phase ran out
    m.connection('backHard');
    m.connection('hard'); // a deliberate leave
    m.offlineMove();
    m.offlineMove();
    m.offlineMove('cellTaken');
    m.offlineMove('cellTaken');
    m.offlineMove('offlineClosed');
    const report = m.report();
    expect(report.connections).toEqual({ soft: 2, backInSoft: 1, hard: 2, backHard: 1 });
    expect(report.offlineMoves).toEqual({ applied: 2, lost: { cellTaken: 2, offlineClosed: 1 } });
    // A copy: the report does not move on with the counts.
    m.offlineMove('digitTried');
    expect(report.offlineMoves.lost).toEqual({ cellTaken: 2, offlineClosed: 1 });
  });
});

describe('ConnectionStats (one game: its summary line)', () => {
  it('says nothing when nobody lost the connection and no move was made offline', () => {
    expect(new ConnectionStats().summary()).toBe('');
  });

  it('sums up the connections and the moves made offline, with the reasons for the lost ones', () => {
    const s = new ConnectionStats();
    s.connection('soft');
    s.connection('backInSoft');
    s.connection('soft');
    s.connection('hard');
    expect(s.summary()).toBe('lost connections 2 (back in the soft phase 1), hard disconnects 1 (back 0)');
    s.offlineMove();
    s.offlineMove('cellTaken');
    s.offlineMove('cellFilled');
    expect(s.summary()).toBe(
      'lost connections 2 (back in the soft phase 1), hard disconnects 1 (back 0); ' +
        'offline moves 1 applied, 2 lost (cellTaken 1, cellFilled 1)',
    );
    expect(s.connections).toEqual({ soft: 2, backInSoft: 1, hard: 1, backHard: 0 });
    expect(s.offlineMoves).toEqual({ applied: 1, lost: { cellTaken: 1, cellFilled: 1 } });
  });
});
