import { randomUUID } from 'node:crypto';

import {
  MAX_BATCH_BYTES,
  MAX_EVENTS_PER_BATCH,
  MAX_PROPS_BYTES,
  TELEMETRY_PATH,
  type TelemetryBatch,
  type TelemetryEvent,
} from '@sudoku-fight/protocol';
import { asc } from 'drizzle-orm';

import { appEvents, installs } from '../db/schema';
import {
  createTestDb,
  fakeClock,
  type FakeClock,
  startHttp,
  type TestDb,
  type TestHttp,
  testConfig,
} from '../testing';
import { DEFAULT_TELEMETRY_LIMITS, type TelemetryLimits } from './router';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 9, 12);

let t: TestDb;
let clock: FakeClock;
let http: TestHttp;

beforeAll(async () => {
  t = await createTestDb();
}, 30_000); // a cold PGlite takes seconds when many suites start at once
afterAll(() => t.close());

async function start(telemetryLimits: TelemetryLimits = DEFAULT_TELEMETRY_LIMITS) {
  await t.reset();
  clock = fakeClock(NOW);
  http = await startHttp({ config: testConfig(), db: t.db, now: clock.now, telemetryLimits });
}
afterEach(() => http.close());

function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return { id: randomUUID(), name: 'screen_view', props: { screen: 'Home' }, t: NOW - HOUR, ...overrides };
}

function batch(overrides: Partial<TelemetryBatch> = {}): TelemetryBatch {
  return {
    installId: '7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11',
    platform: 'android',
    appVersion: '0.1.0',
    events: [event(), event({ name: 'app_open', props: {} })],
    ...overrides,
  };
}

function post(body: unknown, init: { raw?: string; contentType?: string } = {}) {
  return fetch(http.url + TELEMETRY_PATH, {
    method: 'POST',
    headers: { 'content-type': init.contentType ?? 'application/json' },
    body: init.raw ?? JSON.stringify(body),
  });
}

async function answer(res: Response) {
  return { status: res.status, body: await res.json() };
}

describe('POST /v1/events', () => {
  describe('storing', () => {
    beforeEach(() => start());

    it('stores a batch: 202 with the count, the events and the install', async () => {
      const b = batch();
      expect(await answer(await post(b))).toEqual({ status: 202, body: { accepted: 2, duplicates: 0 } });

      const rows = await t.db.select().from(appEvents).orderBy(asc(appEvents.name));
      expect(rows).toEqual(
        [...b.events]
          .sort((x, y) => x.name.localeCompare(y.name))
          .map((e) => ({
            id: e.id,
            installId: b.installId,
            userId: null,
            name: e.name,
            props: e.props,
            tClient: new Date(e.t),
            tServer: new Date(NOW),
          })),
      );
      expect(await t.db.select().from(installs)).toEqual([
        {
          id: b.installId,
          platform: 'android',
          appVersion: '0.1.0',
          firstSeen: new Date(NOW - HOUR),
          lastSeen: new Date(NOW - HOUR),
          userId: null,
        },
      ]);
    });

    it('stores a batch sent twice once: the second answer counts duplicates', async () => {
      const b = batch();
      await post(b);
      expect(await answer(await post(b))).toEqual({ status: 202, body: { accepted: 0, duplicates: 2 } });
      // A retry with one new event: only that one is new.
      const more = { ...b, events: [...b.events, event()] };
      expect(await answer(await post(more))).toEqual({ status: 202, body: { accepted: 1, duplicates: 2 } });
      expect(await t.db.$count(appEvents)).toBe(3);
    });

    it('counts the same id twice in one batch as a duplicate', async () => {
      const e = event();
      const res = await post(batch({ events: [e, e, event()] }));
      expect(await answer(res)).toEqual({ status: 202, body: { accepted: 2, duplicates: 1 } });
    });

    it('stores UUIDs in lower case, so two spellings are one id', async () => {
      const id = randomUUID();
      const installId = randomUUID().toUpperCase();
      await post(batch({ installId, events: [event({ id: id.toUpperCase() })] }));
      const res = await post(batch({ installId: installId.toLowerCase(), events: [event({ id })] }));
      expect(await answer(res)).toEqual({ status: 202, body: { accepted: 0, duplicates: 1 } });
      expect(await t.db.select({ id: installs.id }).from(installs)).toEqual([
        { id: installId.toLowerCase() },
      ]);
    });

    it('never takes the user from the body', async () => {
      const body = { ...batch(), userId: 'u1', events: [{ ...event(), userId: 'u1' }] };
      expect((await post(body)).status).toBe(202);
      const [row] = await t.db.select().from(appEvents);
      expect(row?.userId).toBeNull();
      const [install] = await t.db.select().from(installs);
      expect(install?.userId).toBeNull();
    });

    it('moves first_seen back and last_seen forward, never the other way', async () => {
      const seen = async () => {
        const [row] = await t.db.select().from(installs);
        return { first: row?.firstSeen.getTime(), last: row?.lastSeen.getTime(), version: row?.appVersion };
      };

      await post(batch({ events: [event({ t: NOW - 5 * HOUR }), event({ t: NOW - 2 * HOUR })] }));
      expect(await seen()).toEqual({ first: NOW - 5 * HOUR, last: NOW - 2 * HOUR, version: '0.1.0' });

      // Newer events, a newer version.
      clock.advance(HOUR);
      await post(batch({ appVersion: '0.2.0', events: [event({ t: NOW + HOUR })] }));
      expect(await seen()).toEqual({ first: NOW - 5 * HOUR, last: NOW + HOUR, version: '0.2.0' });

      // A late batch from an old queue: older events move first_seen back, but don't roll back the version.
      await post(batch({ appVersion: '0.1.0', events: [event({ t: NOW - 3 * DAY })] }));
      expect(await seen()).toEqual({ first: NOW - 3 * DAY, last: NOW + HOUR, version: '0.2.0' });
      expect(await t.db.$count(installs)).toBe(1);
    });

    it("a phone clock ahead of the server's counts as seen now, not later", async () => {
      await post(batch({ events: [event({ t: NOW + 5 * HOUR })] }));
      const [row] = await t.db.select().from(installs);
      expect(row?.lastSeen).toEqual(new Date(NOW));
      expect(row?.firstSeen).toEqual(new Date(NOW));
      // The event keeps the phone's own time.
      const [e] = await t.db.select().from(appEvents);
      expect(e?.tClient).toEqual(new Date(NOW + 5 * HOUR));
    });

    it('takes times from 2024 to exactly a day ahead', async () => {
      const res = await post(
        batch({ events: [event({ t: Date.UTC(2024, 0, 1) }), event({ t: NOW + DAY })] }),
      );
      expect(res.status).toBe(202);
    });

    it('takes a full batch: 100 events with props at the limit, under the body limit', async () => {
      const props = { screen: 'x'.repeat(MAX_PROPS_BYTES - '{"screen":""}'.length) };
      expect(Buffer.byteLength(JSON.stringify(props))).toBe(MAX_PROPS_BYTES);
      const events = Array.from({ length: MAX_EVENTS_PER_BATCH }, () => event({ props: { n: 1, ok: true } }));
      events[0] = event({ props });
      const res = await post(batch({ events }));
      expect(await answer(res)).toEqual({ status: 202, body: { accepted: 100, duplicates: 0 } });
    });
  });

  describe('refusing a bad batch: 400 with a short reason', () => {
    beforeEach(() => start());
    afterEach(async () => {
      // Nothing of a refused batch is stored.
      expect(await t.db.$count(appEvents)).toBe(0);
      expect(await t.db.$count(installs)).toBe(0);
    });

    const bad: [string, unknown, RegExp][] = [
      ['a body that is not an object', [batch()], /expected object/],
      ['no installId', { ...batch(), installId: undefined }, /^installId: /],
      ['an installId that is not a UUID', batch({ installId: 'phone-1' }), /^installId: not a UUID/],
      [
        'an unknown platform',
        { ...batch(), platform: 'symbian' },
        /^platform: expected one of ios, android, web/,
      ],
      ['an empty appVersion', batch({ appVersion: '' }), /^appVersion: /],
      ['an appVersion over 32 characters', batch({ appVersion: '1'.repeat(33) }), /^appVersion: /],
      ['an appVersion with a newline', batch({ appVersion: '1.0\n' }), /^appVersion: /],
      ['no events', batch({ events: [] }), /^events: /],
      [
        `more than ${MAX_EVENTS_PER_BATCH} events`,
        batch({ events: Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => event({ props: {} })) }),
        /^events: /,
      ],
      [
        'an unknown event name',
        { ...batch(), events: [{ ...event(), name: 'screen_veiw' }] },
        /events\.0\.name: unknown event name/,
      ],
      [
        'an event id that is not a UUID',
        batch({ events: [event({ id: '42' })] }),
        /^events\.0\.id: not a UUID/,
      ],
      ['nested props', { ...batch(), events: [{ ...event(), props: { a: { b: 1 } } }] }, /^events\.0\.props/],
      [
        'props that are an array',
        { ...batch(), events: [{ ...event(), props: ['a'] }] },
        /^events\.0\.props/,
      ],
      ['missing props', { ...batch(), events: [{ ...event(), props: undefined }] }, /^events\.0\.props/],
      [
        `props over ${MAX_PROPS_BYTES} bytes`,
        batch({ events: [event({ props: { s: 'x'.repeat(MAX_PROPS_BYTES) } })] }),
        /^events\.0\.props: more than 2048 bytes/,
      ],
      [
        'a prop key over 64 characters',
        batch({ events: [event({ props: { ['k'.repeat(65)]: 1 } })] }),
        /^events\.0\.props/,
      ],
      [
        'a time that is not a number',
        { ...batch(), events: [{ ...event(), t: '2026-10-09' }] },
        /^events\.0\.t: /,
      ],
      ['a time that is not whole ms', batch({ events: [event({ t: NOW + 0.5 })] }), /^events\.0\.t: /],
      [
        'a time before 2024',
        batch({ events: [event(), event({ t: Date.UTC(2023, 11, 31) })] }),
        /^events\.1\.t: not between 2024/,
      ],
      [
        'a time over a day ahead',
        batch({ events: [event({ t: NOW + DAY + 1 })] }),
        /^events\.0\.t: not between 2024/,
      ],
    ];

    it.each(bad)('%s', async (_name, body, reason) => {
      const res = await post(body);
      const { status, body: json } = await answer(res);
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'badRequest', message: expect.stringMatching(reason) });
    });

    it('JSON that does not parse', async () => {
      const res = await post(null, { raw: '{"installId": ' });
      expect(await answer(res)).toEqual({
        status: 400,
        body: { error: 'badRequest', message: 'invalid JSON' },
      });
    });

    it('a body that is not JSON', async () => {
      const res = await post(null, { raw: JSON.stringify(batch()), contentType: 'text/plain' });
      expect(res.status).toBe(400);
    });

    it(`a body over ${MAX_BATCH_BYTES / 1024} KB: 413`, async () => {
      const raw = JSON.stringify({ ...batch(), pad: 'x'.repeat(MAX_BATCH_BYTES) });
      const res = await post(null, { raw });
      expect(await answer(res)).toEqual({ status: 413, body: { error: 'tooLarge' } });
    });
  });

  describe('rate limits: 429 with Retry-After, then recovery', () => {
    const MINUTE = 60_000;

    it('per install', async () => {
      await start({ perIp: { limit: 100, windowMs: MINUTE }, perInstall: { limit: 2, windowMs: MINUTE } });
      expect((await post(batch())).status).toBe(202);
      expect((await post(batch())).status).toBe(202);
      const res = await post(batch());
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('30'); // 2 a minute: one every 30 s
      expect(await res.json()).toEqual({ error: 'tooManyRequests' });

      // Another install is not held back.
      expect((await post(batch({ installId: randomUUID() }))).status).toBe(202);

      clock.advance(29_000);
      expect((await post(batch())).status).toBe(429);
      clock.advance(1_000);
      expect((await post(batch())).status).toBe(202);
    });

    it('per IP, before the body is read', async () => {
      await start({ perIp: { limit: 3, windowMs: MINUTE }, perInstall: { limit: 100, windowMs: MINUTE } });
      for (let i = 0; i < 3; i++) {
        expect((await post(batch({ installId: randomUUID() }))).status).toBe(202);
      }
      // Different installs, the same address.
      const res = await post(batch({ installId: randomUUID() }));
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('20');
      // Even a malformed or oversized body is refused by the limit first.
      expect((await post(null, { raw: '{' })).status).toBe(429);
      expect((await post(null, { raw: 'x'.repeat(MAX_BATCH_BYTES * 2) })).status).toBe(429);

      clock.advance(MINUTE);
      expect((await post(batch({ installId: randomUUID() }))).status).toBe(202);
    });

    it('a refused batch is not stored', async () => {
      await start({ perIp: { limit: 100, windowMs: MINUTE }, perInstall: { limit: 1, windowMs: MINUTE } });
      await post(batch());
      expect((await post(batch())).status).toBe(429);
      expect(await t.db.$count(appEvents)).toBe(2);
    });
  });

  describe('other paths', () => {
    beforeEach(() => start());

    it('answers JSON 404 for an unknown /v1 path or method', async () => {
      const res = await fetch(`${http.url}/v1/nothing`);
      expect(await answer(res)).toEqual({ status: 404, body: { error: 'notFound' } });
      expect((await fetch(http.url + TELEMETRY_PATH)).status).toBe(404);
    });
  });
});
