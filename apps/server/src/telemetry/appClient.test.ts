import { MAX_BATCH_BYTES, TELEMETRY_PATH, type TelemetryEvent } from '@sudoku-fight/protocol';
import { asc } from 'drizzle-orm';

// The app's own telemetry code (pure TypeScript, no React Native): the very modules the phone runs.
import {
  type BatchMeta,
  buildBatches,
  MAX_PROP_KEY_LENGTH as APP_MAX_PROP_KEY_LENGTH,
  MIN_EVENT_TIME as APP_MIN_EVENT_TIME,
  sanitizeEvent,
} from '../../../mobile/src/services/telemetry/batching';
import { TelemetryQueue } from '../../../mobile/src/services/telemetry/queue';
import { type FetchLike, TelemetrySender } from '../../../mobile/src/services/telemetry/sender';
import { uuidV4 } from '../../../mobile/src/services/telemetry/uuid';
import { appEvents } from '../db/schema';
import { createTestDb, fakeClock, startHttp, type TestDb, type TestHttp, testConfig } from '../testing';
import { DEFAULT_TELEMETRY_LIMITS, type TelemetryLimits } from './router';
import { MAX_PROP_KEY_LENGTH, MIN_EVENT_TIME, parseBatch } from './schema';

/**
 * The app's side of `POST /v1/events` (spec §27.1) against this server: what the app builds always passes the
 * schema, and the app's sender handles the real answers. If the two sides drift apart, this fails.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 9, 12);
const META: BatchMeta = { installId: uuidV4(), platform: 'android', appVersion: '0.1.0' };

/** An event as the app's track() makes it. */
function tracked(name: TelemetryEvent['name'], props: unknown, t = NOW - HOUR): TelemetryEvent {
  const event = sanitizeEvent({ id: uuidV4(), name, props, t });
  if (!event) throw new Error(`the app would leave out ${name}`);
  return event;
}

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("the app's batches and the server's schema", () => {
  it('agree on the limits the protocol does not carry', () => {
    expect(APP_MIN_EVENT_TIME).toBe(MIN_EVENT_TIME);
    expect(APP_MAX_PROP_KEY_LENGTH).toBe(MAX_PROP_KEY_LENGTH);
  });

  it("the app's UUIDs are UUIDs to the server", () => {
    const events = Array.from({ length: 50 }, () => tracked('app_open', {}));
    for (let i = 0; i < 20; i++) {
      const batch = { ...META, installId: uuidV4(), events };
      expect(parseBatch(wire(batch), NOW)).toMatchObject({ ok: true });
    }
  });

  it('every batch the app builds passes, within the size limit, whatever the props were', () => {
    const k64 = 'k'.repeat(64);
    const events = [
      ...Array.from({ length: 120 }, (_, i) => tracked('screen_view', { screen: `/s${i}` })),
      tracked('game_end', { mode: 'solo', result: 'finished', score: 12.5, mistakes: 0, durationSec: 301 }),
      tracked('interference_sent', { kind: 'fireworks', cost: 8, note: 'ש'.repeat(5000) }),
      tracked('reaction_sent', { emoji: '🎆'.repeat(3000), [k64]: true, ['x'.repeat(65)]: 1 }),
      tracked('latency_sample', { c2sP95: Number.NaN, s2cP95: 40, nested: { no: 1 } }),
      tracked('register_step', { step: '"\n\u0001'.repeat(1000) }),
      ...Array.from({ length: 60 }, (_, i) => tracked('replay_open', { i, pad: 'ש'.repeat(1000) })),
    ];
    const { batches, rejected } = buildBatches(events, META);
    expect(rejected).toEqual([]);
    expect(batches.flatMap((b) => b.events)).toHaveLength(events.length);
    for (const batch of batches) {
      expect(Buffer.byteLength(JSON.stringify(batch), 'utf8')).toBeLessThanOrEqual(MAX_BATCH_BYTES);
      expect(parseBatch(wire(batch), NOW)).toMatchObject({ ok: true });
    }
  });

  it('what the server would refuse (an unknown name, a time before 2024), the app leaves out', () => {
    const good = tracked('app_open', {});
    const unknown = { ...tracked('app_open', {}), name: 'app_closed' as TelemetryEvent['name'] };
    const early = { ...tracked('app_open', {}), t: MIN_EVENT_TIME - 1 };
    for (const bad of [unknown, early])
      expect(parseBatch(wire({ ...META, events: [bad] }), NOW).ok).toBe(false);

    const { batches, rejected } = buildBatches([unknown, good, early], META);
    expect(rejected).toEqual([unknown.id, early.id]);
    expect(batches).toHaveLength(1);
    expect(parseBatch(wire(batches[0]), NOW)).toMatchObject({ ok: true });
  });
});

describe("the app's sender against POST /v1/events", () => {
  let t: TestDb;
  let http: TestHttp;
  let sender: TelemetrySender | null = null;

  beforeAll(async () => {
    t = await createTestDb();
  }, 30_000); // a cold PGlite takes seconds when many suites start at once
  afterAll(() => t.close());
  afterEach(async () => {
    sender?.stop();
    sender = null;
    await http.close();
  });

  async function start(telemetryLimits: TelemetryLimits = DEFAULT_TELEMETRY_LIMITS) {
    await t.reset();
    http = await startHttp({ config: testConfig(), db: t.db, now: fakeClock(NOW).now, telemetryLimits });
  }

  function appSender(queue: TelemetryQueue): TelemetrySender {
    const fetchJson: FetchLike = (url, init) => fetch(url, init);
    sender = new TelemetrySender({
      url: http.url + TELEMETRY_PATH,
      queue,
      meta: () => META,
      fetch: fetchJson,
      now: () => NOW,
      random: () => 0.5,
      timers: {
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
      },
    });
    return sender;
  }

  function queueOf(count: number): { queue: TelemetryQueue; events: TelemetryEvent[] } {
    const queue = new TelemetryQueue();
    const events = Array.from({ length: count }, (_, i) =>
      tracked('screen_view', { screen: `/s${i}` }, NOW - HOUR + i),
    );
    events.forEach((e) => queue.append(e));
    return { queue, events };
  }

  it('sends a long queue in batches; the server stores every event once; the queue is empty', async () => {
    await start();
    const { queue, events } = queueOf(250);
    expect(await appSender(queue).flush()).toEqual({ sent: 250, dropped: 0, waitingUntil: null });
    expect(queue.size).toBe(0);
    const rows = await t.db.select({ id: appEvents.id }).from(appEvents).orderBy(asc(appEvents.tClient));
    expect(rows.map((r) => r.id)).toEqual(events.map((e) => e.id));
  });

  it('429 from the per-install limit: keeps the rest and waits the Retry-After the server gave', async () => {
    await start({ ...DEFAULT_TELEMETRY_LIMITS, perInstall: { limit: 1, windowMs: 60_000 } });
    const { queue } = queueOf(150);
    const result = await appSender(queue).flush();
    expect(result).toEqual({ sent: 100, dropped: 0, waitingUntil: NOW + 60_000 });
    expect(queue.size).toBe(50);
  });
});
