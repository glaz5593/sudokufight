import { LEVEL_END_REASONS } from '@sudoku-fight/engine';
import {
  type LevelEventProps,
  TELEMETRY_EVENT_GENERATION,
  TELEMETRY_EVENT_NAMES,
  type TelemetryProps,
} from '@sudoku-fight/protocol';

import {
  chapterGateProps,
  levelEndProps,
  levelMapOpenProps,
  levelQuitProps,
  levelStartProps,
  levelTutorialProps,
} from '../../levels/analyticsProps';
import { GA4_LIMITS, ga4Event, ga4Name, ga4ScreenView } from '../ga4';

/**
 * GA4's rules for what track() logs to Firebase Analytics (stage 14): valid names, at most 25 parameters,
 * values cut to 100 characters, and no personal data.
 */

describe('ga4Name', () => {
  it.each([
    ['game_start', 'game_start'],
    ['durationSec', 'duration_sec'],
    ['c2sP95', 'c2s_p95'],
    ['rttMs', 'rtt_ms'],
    ['9lives', 'lives'],
    ['with space-and.dot', 'with_space_and_dot'],
    ['a'.repeat(50), 'a'.repeat(40)],
  ])('%s → %s', (raw, expected) => {
    expect(ga4Name(raw)).toBe(expected);
  });

  it("refuses GA4's reserved prefixes, and what has no letter to start with", () => {
    for (const raw of ['firebase_x', 'google_y', 'ga_z', '123', '___']) expect(ga4Name(raw)).toBeNull();
  });
});

describe('ga4Event', () => {
  it('every event of spec §22 has a valid GA4 name, unchanged', () => {
    for (const name of TELEMETRY_EVENT_NAMES) {
      expect(ga4Event(name)?.name).toBe(name);
      expect(name.length).toBeLessThanOrEqual(GA4_LIMITS.name);
    }
  });

  it("spec §22's events as GA4 takes them: snake_case keys, booleans as text, null left out", () => {
    expect(
      ga4Event('game_end', { mode: 'ranked', result: 'won', score: 41.5, mistakes: 2, durationSec: 312 }),
    ).toEqual({
      name: 'game_end',
      params: { mode: 'ranked', result: 'won', score: 41.5, mistakes: 2, duration_sec: 312 },
    });
    expect(ga4Event('reconnect', { durationMs: 840, success: true, extra: null })).toEqual({
      name: 'reconnect',
      params: { duration_ms: 840, success: 'true' },
    });
    expect(ga4Event('game_start', { mode: 'solo', type: 'fast', players: 1 })?.params).toEqual({
      mode: 'solo',
      type: 'fast',
      players: 1,
    });
    expect(ga4Event('app_open')).toEqual({ name: 'app_open', params: {} });
  });

  it('at most 25 parameters, strings cut to 100 characters, numbers finite', () => {
    const props = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, i]));
    const event = ga4Event('latency_sample', { ...props, note: 'x'.repeat(150), bad: Number.NaN });
    expect(Object.keys(event!.params)).toHaveLength(GA4_LIMITS.params);
    expect(ga4Event('replay_open', { note: 'x'.repeat(150) })!.params.note).toBe('x'.repeat(100));
    expect(ga4Event('replay_open', { a: Number.POSITIVE_INFINITY })!.params).toEqual({});
  });

  it('never personal data: keys that name a person, a secret or an id; values that look like one', () => {
    const event = ga4Event('register_complete', {
      email: 'dana@example.com',
      displayName: 'Dana',
      userId: 'u1',
      playerId: 'p1',
      gameId: 'g1',
      installId: 'i1',
      token: 'abc',
      note: 'dana@example.com',
      auth: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ4IjoxfQ.sig',
      dev: 'dev:uid:dana@example.com',
      ref: '7c1e2f9a-0b6d-4a51-9f1e-2d3c4b5a6978',
      step: 'fighter',
    });
    expect(event).toEqual({ name: 'register_complete', params: { step: 'fighter' } });
  });
});

describe("staged practice's six events (1.0.2): nothing of theirs is dropped as personal", () => {
  const DUEL = { id: 'L037', kind: 'duel', bot: { level: 3, pace: 1 } } as const;
  /** Each event as the level screens build it (levels/analyticsProps.ts), every value set. */
  const built: { [N in keyof LevelEventProps]: TelemetryProps[] } = {
    level_map_open: [levelMapOpenProps(37, 88)],
    level_start: [levelStartProps(DUEL, { attempt: 2, bestStars: 1, quick: true })],
    level_end: LEVEL_END_REASONS.map((reason) =>
      levelEndProps(
        DUEL,
        { reason, stars: 0, metric: -4.5, elapsedMs: 21_000 },
        { prevBest: 1, mistakes: 2, attempt: 3 },
      ),
    ),
    level_quit: [levelQuitProps(DUEL, 12_000)],
    chapter_gate: [chapterGateProps(5, 17, false)],
    level_tutorial: [levelTutorialProps('boss', true)],
  };

  it('their names are valid GA4 names, unchanged', () => {
    const levelNames = TELEMETRY_EVENT_NAMES.filter((n) => TELEMETRY_EVENT_GENERATION[n] === 2);
    expect([...levelNames].sort()).toEqual(Object.keys(built).sort());
    for (const name of levelNames) expect(ga4Event(name)?.name).toBe(name);
  });

  it("level_end keeps every param (as GA4's snake_case); a `levelId` would have been dropped", () => {
    const props = built.level_end[0]!;
    expect(ga4Event('level_end', props)).toEqual({
      name: 'level_end',
      params: {
        level: 37,
        kind: 'duel',
        stars: 0,
        prev_best: 1,
        duration_ms: 21_000,
        reason: 'completed',
        mistakes: 2,
        metric: -4.5,
        bot_level: 3,
        attempt: 3,
      },
    });
    expect(ga4Event('level_end', { levelId: 'L037', level: 37 })?.params).toEqual({ level: 37 });
  });

  it.each(Object.entries(built))('%s: every prop key passes the personal-data filter', (name, list) => {
    for (const props of list) {
      const event = ga4Event(name as keyof LevelEventProps, props)!;
      const kept = Object.keys(props).filter((k) => props[k] !== null);
      expect(Object.keys(event.params).sort()).toEqual(kept.map((k) => ga4Name(k)).sort());
    }
  });
});

describe('ga4ScreenView', () => {
  it("the route's pattern as the screen's name and class", () => {
    expect(ga4ScreenView({ screen: '/results/[id]' })).toEqual({
      screen_name: '/results/[id]',
      screen_class: '/results/[id]',
    });
    expect(ga4ScreenView({ screen: '/' })).toEqual({ screen_name: '/', screen_class: '/' });
  });

  it('nothing when there is no screen, or it looks personal', () => {
    expect(ga4ScreenView({})).toBeNull();
    expect(ga4ScreenView({ screen: '' })).toBeNull();
    expect(ga4ScreenView({ screen: 42 })).toBeNull();
    expect(ga4ScreenView({ screen: '/player/7c1e2f9a-0b6d-4a51-9f1e-2d3c4b5a6978' })).toBeNull();
  });
});
