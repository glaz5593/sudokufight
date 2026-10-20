import { randomUUID } from 'node:crypto';

import { GAME_TYPES, LEVEL_KINDS } from '@sudoku-fight/engine';
import {
  FRIENDS_CLOSE_REASONS,
  FRIENDS_JOIN_RESULTS,
  FRIENDS_JOIN_VIAS,
  FRIENDS_OPEN_VIAS,
  FRIENDS_SHARE_BY,
  type FriendsEventProps,
  type LevelEventProps,
  MAX_EVENTS_PER_BATCH,
  TELEMETRY_EVENT_GENERATION,
  TELEMETRY_EVENT_NAMES,
  type TelemetryBatch,
  type TelemetryEvent,
  type TelemetryProps,
} from '@sudoku-fight/protocol';

import { parseBatch } from './schema';

/**
 * The level events' props after 1.0.3 (levels-content.md §7, §11) [D73]: the three new kinds and `rev` are
 * taken, and the change is additive: a 1.0.2 app's batch (the old kinds, no `rev`) is still taken as it was.
 * And the friends events (1.0.4, generation 3). parseBatch alone, no database (events.test.ts covers the
 * route).
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

/**
 * Playing with friends' six events (1.0.4, generation 3; friends-room.md §7.4): every value checked against the
 * protocol's lists and ranges, an extra key let through, never a code or an id among the props the app sends.
 */
describe('friends events (1.0.4, generation 3)', () => {
  const VALID: FriendsEventProps = {
    friends_room_open: { gameType: 'fast', via: 'create' },
    friends_room_join: { via: 'link', result: 'ok' },
    friends_invite_share: { by: 'guest' },
    friends_link_open: { signedIn: false },
    friends_room_start: { players: 2, waitedSec: 95 },
    friends_room_close: { reason: 'left', players: 1, waitedSec: 0 },
  };
  const friendsEvent = (name: keyof FriendsEventProps, props: TelemetryProps = {}) =>
    event(name, { ...(VALID[name] as unknown as TelemetryProps), ...props });
  const NAMES = Object.keys(VALID) as (keyof FriendsEventProps)[];

  it('are the generation-3 names, and each with valid props is taken as sent', () => {
    expect(TELEMETRY_EVENT_NAMES.filter((n) => TELEMETRY_EVENT_GENERATION[n] === 3)).toEqual(NAMES);
    const events = NAMES.map((name) => friendsEvent(name));
    expect(parseBatch(batch(events, '1.0.4'), NOW)).toEqual({
      ok: true,
      batch: batch(events, '1.0.4'),
      ignored: 0,
    });
  });

  it('every value on the lists: game types, vias, join results, sharers, close reasons; 2–4 players at a start', () => {
    const events = [
      ...GAME_TYPES.flatMap((gameType) =>
        FRIENDS_OPEN_VIAS.map((via) => friendsEvent('friends_room_open', { gameType, via })),
      ),
      ...FRIENDS_JOIN_VIAS.flatMap((via) =>
        FRIENDS_JOIN_RESULTS.map((result) => friendsEvent('friends_room_join', { via, result })),
      ),
      ...FRIENDS_SHARE_BY.map((by) => friendsEvent('friends_invite_share', { by })),
      friendsEvent('friends_link_open', { signedIn: true }),
      ...[2, 3, 4].map((players) => friendsEvent('friends_room_start', { players, waitedSec: 21_600 })),
      ...FRIENDS_CLOSE_REASONS.map((reason) =>
        friendsEvent('friends_room_close', { reason, players: 4, waitedSec: 3 }),
      ),
    ];
    expect(events.length).toBeLessThanOrEqual(MAX_EVENTS_PER_BATCH);
    const parsed = parseBatch(batch(events, '1.0.4'), NOW);
    expect(parsed).toMatchObject({ ok: true, ignored: 0 });
    expect(parsed.ok && parsed.batch.events).toHaveLength(events.length);
  });

  it('an extra key passes (the next app may add one); game_start and game_end may carry friends: true', () => {
    const events = [
      friendsEvent('friends_room_start', { gameType: 'hard' }),
      event('game_start', { mode: 'ranked', gameType: 'fast', players: 3, friends: true }),
      event('game_end', { mode: 'ranked', gameType: 'fast', place: 1, friends: true }),
    ];
    expect(parseBatch(batch(events, '1.0.4'), NOW)).toEqual({
      ok: true,
      batch: batch(events, '1.0.4'),
      ignored: 0,
    });
  });

  it('an older app’s batch (generations 1 and 2) is taken exactly as before', () => {
    const events = [event('app_open', {}), levelEvent('level_start'), levelEvent('level_end')];
    expect(parseBatch(batch(events, '1.0.3'), NOW)).toEqual({
      ok: true,
      batch: batch(events, '1.0.3'),
      ignored: 0,
    });
  });

  const bad: [string, TelemetryEvent][] = [
    ['an unknown game type', friendsEvent('friends_room_open', { gameType: 'easy' })],
    ['an unknown way to open', friendsEvent('friends_room_open', { via: 'invite' })],
    ['no via', event('friends_room_join', { result: 'ok' })],
    ['a join result that is none', friendsEvent('friends_room_join', { result: 'notHost' })],
    ['a code as the result', friendsEvent('friends_room_join', { result: '123456' })],
    ['a sharer that is none', friendsEvent('friends_invite_share', { by: 'everyone' })],
    ['signedIn as text', friendsEvent('friends_link_open', { signedIn: 'yes' })],
    ['a start with 1 player', friendsEvent('friends_room_start', { players: 1 })],
    ['a start with 5 players', friendsEvent('friends_room_start', { players: 5 })],
    ['a negative wait', friendsEvent('friends_room_start', { waitedSec: -1 })],
    ['a fractional wait', friendsEvent('friends_room_close', { waitedSec: 1.5 })],
    ['a wait over a week', friendsEvent('friends_room_close', { waitedSec: 7 * 24 * 3600 + 1 })],
    ['a close with 0 players', friendsEvent('friends_room_close', { players: 0 })],
    ['a close reason that is none', friendsEvent('friends_room_close', { reason: 'blocked' })],
  ];

  it.each(bad)('%s: refused, saying which prop', (_name, e) => {
    const parsed = parseBatch(batch([e, event('app_open', {})], '1.0.4'), NOW);
    expect(parsed).toEqual({ ok: false, message: expect.stringMatching(/^events\.0\.props\.\w+: /) });
  });
});
