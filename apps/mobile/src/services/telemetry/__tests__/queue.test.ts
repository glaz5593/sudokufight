import type { TelemetryEvent } from '@sudoku-fight/protocol';

import { QUEUE_CAP, TelemetryQueue } from '../queue';

/** The in-memory queue (spec §27.1): order, no repeats, a cap, and what storage has to write. */

let n = 0;
function event(): TelemetryEvent {
  n++;
  return { id: `id-${n}`, name: 'screen_view', props: { n }, t: Date.UTC(2026, 9, 9) + n };
}
const ids = (events: readonly TelemetryEvent[]) => events.map((e) => e.id);

describe('TelemetryQueue', () => {
  it('appends in order; peek gives the oldest without removing them', () => {
    const q = new TelemetryQueue();
    const [a, b, c] = [event(), event(), event()];
    for (const e of [a, b, c]) expect(q.append(e)).toBe(true);
    expect(q.size).toBe(3);
    expect(q.peek(2)).toEqual([a, b]);
    expect(q.peek(10)).toEqual([a, b, c]);
    expect(q.size).toBe(3);
  });

  it('the same id is queued once', () => {
    const q = new TelemetryQueue();
    const a = event();
    expect(q.append(a)).toBe(true);
    expect(q.append({ ...a, props: { other: true } })).toBe(false);
    expect(q.peek(10)).toEqual([a]);
  });

  it('ack and drop remove by id, and say how many were queued', () => {
    const q = new TelemetryQueue();
    const [a, b, c] = [event(), event(), event()];
    [a, b, c].forEach((e) => q.append(e));
    expect(q.ack([a.id, 'unknown'])).toBe(1);
    expect(q.drop([c.id])).toBe(1);
    expect(q.peek(10)).toEqual([b]);
    expect(q.has(a.id)).toBe(false);
  });

  it(`keeps at most the cap (${QUEUE_CAP} by default): the oldest go`, () => {
    expect(new TelemetryQueue().cap).toBe(QUEUE_CAP);
    const q = new TelemetryQueue(3);
    const events = Array.from({ length: 5 }, event);
    events.forEach((e) => q.append(e));
    expect(q.peek(10)).toEqual(events.slice(2));
  });

  it('restore puts what the disk had in front of what this run appended, without repeats', () => {
    const q = new TelemetryQueue();
    const [saved1, saved2, now1] = [event(), event(), event()];
    q.append(now1);
    q.restore([saved1, saved2, saved1]);
    expect(q.peek(10)).toEqual([saved1, saved2, now1]);
    // The restored ones are on disk already; only this run's event needs writing.
    expect(q.takeChanges()).toEqual({ added: [now1], removed: [] });
  });

  it('restore applies the cap too (the newest stay)', () => {
    const q = new TelemetryQueue(2);
    const [s1, s2, mine] = [event(), event(), event()];
    q.append(mine);
    q.restore([s1, s2]);
    expect(ids(q.peek(10))).toEqual([s2.id, mine.id]);
    expect(q.takeChanges()).toEqual({ added: [mine], removed: [s1.id] });
  });

  describe('changes for the disk', () => {
    it('collects adds and removes until taken; nothing changed: null', () => {
      const q = new TelemetryQueue();
      expect(q.takeChanges()).toBeNull();
      const [a, b] = [event(), event()];
      q.append(a);
      q.append(b);
      expect(q.hasUnsavedChanges).toBe(true);
      expect(q.takeChanges()).toEqual({ added: [a, b], removed: [] });
      expect(q.hasUnsavedChanges).toBe(false);
      q.ack([a.id]);
      expect(q.takeChanges()).toEqual({ added: [], removed: [a.id] });
    });

    it('an event added and removed before any write is never written nor deleted', () => {
      const q = new TelemetryQueue();
      const a = event();
      q.append(a);
      q.drop([a.id]);
      expect(q.takeChanges()).toBeNull();
    });

    it('a failed write gives its changes back, in order, as far as they still apply', () => {
      const q = new TelemetryQueue();
      const [a, b, c, d] = [event(), event(), event(), event()];
      q.restore([a]);
      q.append(b);
      q.append(c);
      q.ack([a.id]);
      const taken = q.takeChanges()!;
      expect(taken).toEqual({ added: [b, c], removed: [a.id] });
      // While it was being written: c was sent, d was tracked.
      q.ack([c.id]);
      q.append(d);
      q.returnChanges(taken);
      // c never reached the disk: no delete for it. a is still on disk: its delete is due again.
      expect(q.takeChanges()).toEqual({ added: [b, d], removed: [a.id] });
    });
  });
});
