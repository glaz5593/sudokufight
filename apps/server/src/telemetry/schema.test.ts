import { randomUUID } from 'node:crypto';

import { LEVEL_KINDS } from '@sudoku-fight/engine';
import {
  type LevelEventProps,
  type TelemetryBatch,
  type TelemetryEvent,
  type TelemetryProps,
} from '@sudoku-fight/protocol';

import { parseBatch } from './schema';

/**
 * The level events' props after 1.0.3 (levels-content.md §7, §11) [D73]: the three new kinds and `rev` are
 * taken, and the change is additive: a 1.0.2 app's batch (the old kinds, no `rev`) is still taken as it was.
 * parseBatch alone, no database (events.test.ts covers the route).
 */

const NOW = Date.UTC(2026, 9, 20, 12);

/** A level_start and a level_end exactly as a 1.0.2 app builds them (no rev). */
const V102: Pick<LevelEventProps, 'level_start' | 'level_end'> = {
  level_start: { level: 3, chapter: 1, kind: 'find', attempt: 2, bestStars: 1, quick: false },
  level_end: {
    level: 3,
    kind: 'find',
    stars: 2,
    prevBest: 1,
    durationMs: 7400,
    reason: 'completed',
    mistakes: 0,
    metric: 7400,
    botLevel: null,
    attempt: 2,
  },
};

const event = (name: TelemetryEvent['name'], props: TelemetryProps): TelemetryEvent => ({
  id: randomUUID(),
  name,
  props,
  t: NOW - 60_000,
});

const levelEvent = (name: keyof typeof V102, props: TelemetryProps = {}) =>
  event(name, { ...(V102[name] as unknown as TelemetryProps), ...props });

const batch = (events: TelemetryEvent[], appVersion = '1.0.3'): TelemetryBatch => ({
  installId: '7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11',
  platform: 'android',
  appVersion,
  events,
});

describe('level events after 1.0.3 (additive: old apps still valid)', () => {
  it('a 1.0.2 app’s batch, exactly as it sends it (old kinds, no rev): taken, as it was', () => {
    const events = [levelEvent('level_start'), levelEvent('level_end')];
    const parsed = parseBatch(batch(events, '1.0.2'), NOW);
    expect(parsed).toEqual({ ok: true, batch: batch(events, '1.0.2'), ignored: 0 });
  });

  it('the new kinds (puzzle, fillRow, fillCol) on level_start, level_end and level_tutorial', () => {
    expect(LEVEL_KINDS).toEqual(expect.arrayContaining(['puzzle', 'fillRow', 'fillCol']));
    expect(LEVEL_KINDS).toHaveLength(10);
    const events = LEVEL_KINDS.flatMap((kind) => [
      levelEvent('level_start', { kind, rev: 2 }),
      levelEvent('level_end', { kind, rev: 2, metric: kind === 'puzzle' ? 30_000 : 7400 }),
      event('level_tutorial', { kind, skipped: false }),
    ]);
    const parsed = parseBatch(batch(events), NOW);
    expect(parsed).toMatchObject({ ok: true, ignored: 0 });
    expect(parsed.ok && parsed.batch.events).toHaveLength(events.length);
  });

  it('rev: a whole number from 1, kept as sent; on level_start, level_end and level_quit', () => {
    const events = [
      levelEvent('level_start', { rev: 1 }),
      levelEvent('level_end', { rev: 2 }),
      levelEvent('level_end', { rev: 17, kind: 'puzzle', mistakes: 3 }),
      event('level_quit', { level: 3, atMs: 5000, rev: 2 }),
      event('level_quit', { level: 3, atMs: 5000 }), // a 1.0.2 app's
    ];
    const parsed = parseBatch(batch(events), NOW);
    expect(parsed.ok && parsed.batch.events.map((e) => e.props.rev)).toEqual([1, 2, 17, 2, undefined]);
  });

  it('rev on another level event passes as an extra key (the next app may add one)', () => {
    const parsed = parseBatch(batch([event('level_map_open', { level: 3, stars: 9, rev: 2 })]), NOW);
    expect(parsed).toMatchObject({ ok: true });
  });

  const bad: [string, TelemetryEvent][] = [
    ['rev 0', levelEvent('level_start', { rev: 0 })],
    ['a negative rev', levelEvent('level_end', { rev: -1 })],
    ['a fractional rev', levelEvent('level_end', { rev: 1.5 })],
    ['rev as text', levelEvent('level_start', { rev: '2' })],
    ['rev null', levelEvent('level_end', { rev: null })],
    ['a quit’s rev 0', event('level_quit', { level: 3, atMs: 5000, rev: 0 })],
    ['a kind that is none', levelEvent('level_end', { kind: 'fillDiagonal' })],
  ];

  it.each(bad)('%s: refused, saying which prop', (_name, e) => {
    const parsed = parseBatch(batch([e]), NOW);
    expect(parsed).toEqual({ ok: false, message: expect.stringMatching(/^events\.0\.props\.(rev|kind): /) });
  });
});
