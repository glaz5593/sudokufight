import {
  MAX_BATCH_BYTES,
  MAX_EVENTS_PER_BATCH,
  MAX_PROPS_BYTES,
  type TelemetryEvent,
  type TelemetryEventName,
} from '@sudoku-fight/protocol';

import {
  type BatchMeta,
  buildBatches,
  cleanAppVersion,
  isTelemetryEventName,
  jsonBytes,
  MIN_EVENT_TIME,
  platformOf,
  sanitizeEvent,
  sanitizeProps,
  utf8Length,
} from '../batching';
import { uuidV4 } from '../uuid';

/** The protocol's contract for a batch (spec §27.2), made to hold before anything is sent. */

const T = Date.UTC(2026, 9, 9, 12);
const META: BatchMeta = {
  installId: '7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11',
  platform: 'android',
  appVersion: '0.1.0',
};
const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return { id: uuidV4(), name: 'screen_view', props: { screen: '/' }, t: T, ...overrides };
}

describe('sizes', () => {
  it('utf8Length counts what Buffer counts: ASCII, Hebrew, emoji, lone surrogates', () => {
    for (const s of [
      '',
      'abc',
      'סודוקו פייט',
      '🎆🔥 fireworks',
      'a\ud83db',
      '\udc00',
      '\u0000\u007f\u0080߿ࠀ￿',
    ])
      expect(utf8Length(s)).toBe(Buffer.byteLength(s, 'utf8'));
  });

  it('jsonBytes is the size of the JSON', () => {
    const value = { screen: '/results/[id]', n: 3, ok: true, none: null, he: 'שלום' };
    expect(jsonBytes(value)).toBe(bytesOf(value));
  });
});

describe('props', () => {
  it('keeps flat values; leaves out nested ones, functions and undefined; non-finite numbers become null', () => {
    const props = sanitizeProps({
      s: 'x',
      n: 1.5,
      b: false,
      z: null,
      nested: { a: 1 },
      list: [1, 2],
      fn: () => 1,
      missing: undefined,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
    });
    expect(props).toEqual({ s: 'x', n: 1.5, b: false, z: null, nan: null, inf: null });
  });

  it('keys of 1–64 characters only', () => {
    const k64 = 'k'.repeat(64);
    expect(sanitizeProps({ [k64]: 1, ['k'.repeat(65)]: 2, '': 3 })).toEqual({ [k64]: 1 });
  });

  it('anything but an object gives empty props', () => {
    for (const input of [undefined, null, 'x', 7, [1, 2]]) expect(sanitizeProps(input)).toEqual({});
  });

  it('too big: the longest strings are cut, with an ellipsis, until the JSON fits', () => {
    const props = sanitizeProps({ kind: 'fireworks', note: 'x'.repeat(5000), he: 'ש'.repeat(3000), n: 8 })!;
    expect(bytesOf(props)).toBeLessThanOrEqual(MAX_PROPS_BYTES);
    expect(props.kind).toBe('fireworks');
    expect(props.n).toBe(8);
    expect(props.note).toMatch(/^x+…$/);
    expect(props.he).toMatch(/^ש+…$/);
  });

  it('cuts by bytes, not more than it must: Hebrew (2 bytes a letter) keeps almost all the room', () => {
    const props = sanitizeProps({ he: 'ש'.repeat(3000) })!;
    expect(bytesOf(props)).toBeLessThanOrEqual(MAX_PROPS_BYTES);
    expect(bytesOf(props)).toBeGreaterThan(MAX_PROPS_BYTES - 8);
  });

  it('strings full of escapes (bigger in JSON than as text) still end within the limit', () => {
    const props = sanitizeProps({ a: '"\n'.repeat(1500), b: '\u0001'.repeat(600) })!;
    expect(bytesOf(props)).toBeLessThanOrEqual(MAX_PROPS_BYTES);
    expect(props.a).toMatch(/…$/);
    expect(props.b).toMatch(/…$/);
  });

  it('never cuts an emoji in half', () => {
    const props = sanitizeProps({ e: '🎆'.repeat(2000) })!;
    expect(bytesOf(props)).toBeLessThanOrEqual(MAX_PROPS_BYTES);
    expect((props.e as string).replace(/…$/, '')).toMatch(/^(🎆)+$/);
  });

  it('still too big (too many keys): null, so the event is left out', () => {
    const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`key_${i}`, i]));
    expect(sanitizeProps(many)).toBeNull();
  });
});

describe('events', () => {
  it('a valid event as it is; its time rounded to whole ms', () => {
    const e = event({ t: T + 0.6 });
    expect(sanitizeEvent(e)).toEqual({ ...e, t: T + 1 });
  });

  it('left out: an id that is not a UUID, an unknown name, a time before 2024 or not a number', () => {
    expect(sanitizeEvent(event({ id: 'abc' }))).toBeNull();
    expect(sanitizeEvent(event({ name: 'screen_viewed' as TelemetryEventName }))).toBeNull();
    expect(sanitizeEvent(event({ t: MIN_EVENT_TIME - 1 }))).toBeNull();
    expect(sanitizeEvent(event({ t: Number.NaN }))).toBeNull();
    expect(sanitizeEvent({ ...event(), t: '2026' })).toBeNull();
    expect(sanitizeEvent(null)).toBeNull();
    expect(sanitizeEvent(event({ t: MIN_EVENT_TIME }))).not.toBeNull();
  });

  it('missing props are empty props', () => {
    const { props: _props, ...noProps } = event();
    expect(sanitizeEvent(noProps)?.props).toEqual({});
  });

  it('names: exactly the protocol list', () => {
    expect(isTelemetryEventName('screen_view')).toBe(true);
    expect(isTelemetryEventName('game_end')).toBe(true);
    expect(isTelemetryEventName('Screen_View')).toBe(false);
    expect(isTelemetryEventName(3)).toBe(false);
  });
});

describe('the batch header', () => {
  it('platforms the server knows; the app version as 1–32 printable characters', () => {
    expect(platformOf('ios')).toBe('ios');
    expect(platformOf('android')).toBe('android');
    expect(platformOf('web')).toBe('web');
    expect(platformOf('windows')).toBeNull();
    expect(cleanAppVersion('0.1.0')).toBe('0.1.0');
    expect(cleanAppVersion(' 1.2.3-בטא ')).toBe('1.2.3-');
    expect(cleanAppVersion('9'.repeat(40))).toBe('9'.repeat(32));
    expect(cleanAppVersion(undefined)).toBe('0.0.0');
    expect(cleanAppVersion('')).toBe('0.0.0');
  });

  it('a wrong header throws (no batch could pass)', () => {
    const events = [event()];
    expect(() => buildBatches(events, { ...META, installId: 'x' })).toThrow('install id');
    expect(() => buildBatches(events, { ...META, platform: 'windows' as 'ios' })).toThrow('platform');
    expect(() => buildBatches(events, { ...META, appVersion: '' })).toThrow('app version');
  });
});

describe('batches', () => {
  it('split by count: at most MAX_EVENTS_PER_BATCH each, in queue order', () => {
    const events = Array.from({ length: 250 }, (_, i) => event({ props: { i } }));
    const { batches, rejected } = buildBatches(events, META);
    expect(rejected).toEqual([]);
    expect(batches.map((b) => b.events.length)).toEqual([MAX_EVENTS_PER_BATCH, MAX_EVENTS_PER_BATCH, 50]);
    expect(batches.flatMap((b) => b.events.map((e) => e.props.i))).toEqual(events.map((_, i) => i));
    for (const b of batches) expect(b).toMatchObject(META);
  });

  it('split by size: no body over MAX_BATCH_BYTES, each as full as it can be', () => {
    // 100 events with props of almost 2 KB: about 210 KB in all.
    const events = Array.from({ length: 100 }, (_, i) => event({ props: { i, pad: 'ש'.repeat(1000) } }));
    const { batches } = buildBatches(events, META);
    expect(batches.length).toBeGreaterThan(3);
    expect(batches.flatMap((b) => b.events)).toEqual(events);
    batches.forEach((b, i) => {
      expect(bytesOf(b)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
      const next = batches[i + 1]?.events[0];
      if (next) expect(bytesOf({ ...b, events: [...b.events, next] })).toBeGreaterThan(MAX_BATCH_BYTES);
    });
  });

  it('counts bytes exactly: a limit of exactly one batch fits it, one byte less splits it', () => {
    const events = Array.from({ length: 5 }, () => event());
    const exact = bytesOf({ ...META, events });
    expect(buildBatches(events, META, { maxEvents: 100, maxBytes: exact }).batches).toHaveLength(1);
    expect(buildBatches(events, META, { maxEvents: 100, maxBytes: exact - 1 }).batches).toHaveLength(2);
  });

  it('one event that fills a batch exactly is one batch (no empty batch before it)', () => {
    const e = event();
    const exact = bytesOf({ ...META, events: [e] });
    expect(buildBatches([e], META, { maxEvents: 100, maxBytes: exact })).toEqual({
      batches: [{ ...META, events: [e] }],
      rejected: [],
    });
  });

  it('events that cannot be sent are rejected by id; the rest go', () => {
    const good = [event(), event()];
    const old = event({ name: 'removed_event' as TelemetryEventName });
    const early = event({ t: Date.UTC(2020, 0, 1) });
    const { batches, rejected } = buildBatches([good[0]!, old, early, good[1]!], META);
    expect(rejected).toEqual([old.id, early.id]);
    expect(batches.flatMap((b) => b.events)).toEqual(good);
  });

  it('an event bigger than a whole batch is rejected; the same id twice is sent once', () => {
    const big = event({ props: { pad: 'x'.repeat(500) } });
    const small = event();
    const { batches, rejected } = buildBatches([big, small, small], META, { maxEvents: 100, maxBytes: 400 });
    expect(rejected).toEqual([big.id]);
    expect(batches).toEqual([{ ...META, events: [small] }]);
  });

  it('nothing to send: no batches', () => {
    expect(buildBatches([], META)).toEqual({ batches: [], rejected: [] });
  });
});
