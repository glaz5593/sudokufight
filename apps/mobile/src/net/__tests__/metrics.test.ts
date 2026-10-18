import type { ClientAction, GameEvent } from '@sudoku-fight/engine';

import { answers, NetMetrics } from '../metrics';

const ME = 'me';
const locked = (cell: number, t: number, seq = 1, playerId = ME): GameEvent => ({
  type: 'cellLocked',
  playerId,
  cell,
  expiresAt: t + 8000,
  remainingMs: 8000,
  seq,
  t,
});

describe('answers(): which event answers which action', () => {
  const ev = (e: Partial<GameEvent> & Pick<GameEvent, 'type'>) => ({ seq: 1, t: 0, ...e }) as GameEvent;
  it.each<[ClientAction, GameEvent, boolean]>([
    [{ type: 'select', cell: 4 }, locked(4, 0), true],
    [{ type: 'select', cell: 4 }, locked(5, 0), false],
    [{ type: 'select', cell: 4 }, locked(4, 0, 1, 'opp'), false],
    [{ type: 'release' }, ev({ type: 'cellReleased', playerId: ME, cell: 4, reason: 'cancel' }), true],
    [{ type: 'release' }, ev({ type: 'cellReleased', playerId: ME, cell: 4, reason: 'timeout' }), false],
    [{ type: 'place', cell: 4, digit: 3 }, ev({ type: 'placedWrong', playerId: ME, cell: 4 } as never), true],
    [
      { type: 'place', cell: 4, digit: 3 },
      ev({ type: 'placedCorrect', playerId: ME, cell: 4 } as never),
      true,
    ],
    [
      { type: 'interfere', targetId: 'opp', kind: 'cats' },
      ev({ type: 'interference', fromId: ME, targetId: 'opp' } as never),
      true,
    ],
    [{ type: 'react', emoji: '🔥' }, ev({ type: 'reaction', playerId: ME, emoji: '🔥' }), true],
    [{ type: 'surrender' }, ev({ type: 'playerSurrendered', playerId: ME }), true],
    [{ type: 'surrender' }, ev({ type: 'playerSurrendered', playerId: 'opp' }), false],
    // A move made offline [D42]: its digit answers it, not the cellLocked before it.
    [
      { type: 'offlineMove', cell: 4, digit: 3, thinkMs: 900 },
      ev({ type: 'placedCorrect', playerId: ME, cell: 4, offline: true } as never),
      true,
    ],
    [{ type: 'offlineMove', cell: 4, digit: 3, thinkMs: 900 }, locked(4, 0), false],
  ])('%j answered by %j: %s', (action, event, expected) => {
    expect(answers(action, event, ME)).toBe(expected);
  });
});

describe('NetMetrics (spec §18: the five measures)', () => {
  it('c2s, s2c and the action time, through the clock offset', () => {
    const m = new NetMetrics();
    // Phone time 1000 = server time 6000 (offset 5000). Sent at 1000, applied at server 6030, here at 1065.
    m.sent(1, { type: 'select', cell: 4 }, 1000);
    m.events([locked(4, 6030)], ME, 1065, 5000);
    expect(m.c2s.values()).toEqual([30]);
    expect(m.s2c.values()).toEqual([35]);
    expect(m.action.values()).toEqual([65]);
    expect(m.waiting).toBe(0);
  });

  it('without a synced clock only the action time is taken', () => {
    const m = new NetMetrics();
    m.sent(1, { type: 'select', cell: 4 }, 1000);
    m.events([locked(4, 999_999)], ME, 1050, null);
    expect(m.c2s.count).toBe(0);
    expect(m.s2c.count).toBe(0);
    expect(m.action.values()).toEqual([50]);
  });

  it('one s2c sample per message, from its newest event; others’ events count too', () => {
    const m = new NetMetrics();
    m.events([locked(1, 100, 1, 'opp'), locked(2, 120, 2, 'opp')], ME, 130, 0);
    expect(m.s2c.values()).toEqual([10]);
    expect(m.action.count).toBe(0);
    m.events([], ME, 200, 0);
    expect(m.s2c.count).toBe(1);
  });

  it('a refusal answers its action; a drop and a long silence count as lost', () => {
    const m = new NetMetrics({ answerExpireMs: 1000 });
    m.sent(1, { type: 'select', cell: 4 }, 0);
    m.rejected(1, 40);
    m.rejected(99, 50);
    expect(m.action.values()).toEqual([40]);
    m.sent(2, { type: 'place', cell: 4, digit: 1 }, 100);
    m.dropped();
    expect(m.lost).toBe(1);
    m.sent(3, { type: 'react', emoji: '🔥' }, 200);
    m.sent(4, { type: 'react', emoji: '🔥' }, 1500); // the first is 1300 ms old: lost
    expect(m.lost).toBe(2);
    expect(m.waiting).toBe(1);
  });

  it('unanswered(): what is on its way, in send order, until the drop forgets it [D42]', () => {
    const m = new NetMetrics();
    m.sent(1, { type: 'select', cell: 4 }, 100);
    m.sent(2, { type: 'place', cell: 4, digit: 7 }, 300);
    m.sent(3, { type: 'react', emoji: '🔥' }, 400);
    m.events([locked(4, 150)], ME, 160, 0);
    const waiting = m.unanswered();
    expect(waiting).toEqual([
      { clientSeq: 2, action: { type: 'place', cell: 4, digit: 7 }, at: 300 },
      { clientSeq: 3, action: { type: 'react', emoji: '🔥' }, at: 400 },
    ]);
    // A copy: changing it changes nothing here.
    waiting.pop();
    expect(m.waiting).toBe(2);
    m.dropped();
    expect(m.unanswered()).toEqual([]);
  });

  it('reconnect and sync times', () => {
    const m = new NetMetrics();
    m.cameBack(800, 120);
    expect(m.summary()).toMatchObject({ reconnect: { count: 1, p50: 800 }, sync: { count: 1, p50: 120 } });
  });

  it('reports latency_sample every N samples, never more than once a minute (spec §22 shape)', () => {
    const track = jest.fn();
    const m = new NetMetrics({ reportEvery: 3, reportMinIntervalMs: 60_000, track });
    // Each answered select adds 3 samples (c2s, s2c, action).
    const answer = (seq: number, at: number) => {
      m.sent(seq, { type: 'select', cell: seq }, at);
      m.events([locked(seq, at + 20, seq)], ME, at + 40, 0);
    };
    answer(1, 0);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenLastCalledWith('latency_sample', { c2sP95: 20, s2cP95: 20, actionP95: 40 });
    for (let k = 2; k < 10; k++) answer(k, k * 1000);
    expect(track).toHaveBeenCalledTimes(1);
    answer(10, 61_000);
    expect(track).toHaveBeenCalledTimes(2);
    expect(m.reports).toBe(2);
    expect(Object.keys(track.mock.calls[1]![1] as object).sort()).toEqual(['actionP95', 'c2sP95', 's2cP95']);
  });

  it('flush on close reports what is left, within the throttle; a throwing track is harmless', () => {
    const track = jest.fn(() => {
      throw new Error('analytics down');
    });
    const m = new NetMetrics({ reportEvery: 100, flushMin: 2, track });
    m.flush(0);
    expect(track).not.toHaveBeenCalled();
    m.sent(1, { type: 'select', cell: 1 }, 0);
    m.events([locked(1, 10)], ME, 20, 0);
    m.flush(100);
    expect(track).toHaveBeenCalledTimes(1);
    expect(m.latencyProps()).toEqual({ c2sP95: 10, s2cP95: 10, actionP95: 20 });
  });

  it('reports nulls for measures without samples', () => {
    expect(new NetMetrics().latencyProps()).toEqual({ c2sP95: null, s2cP95: null, actionP95: null });
  });
});
