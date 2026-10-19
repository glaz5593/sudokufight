import { MAX_EVENTS_PER_BATCH, type TelemetryBatch, type TelemetryEvent } from '@sudoku-fight/protocol';

import type { BatchMeta } from '../batching';
import { TelemetryQueue } from '../queue';
import {
  backoffDelay,
  type FetchLike,
  type HttpRequestInit,
  MAX_RETRY_AFTER_MS,
  MIN_RETRY_AFTER_MS,
  REQUEST_TIMEOUT_MS,
  retryAfterMs,
  type SenderOptions,
  TelemetrySender,
  TOKEN_WAIT_MS,
} from '../sender';
import { uuidV4 } from '../uuid';

/**
 * Sending the queue (spec §27.1) and every answer of the contract (spec §27.2): Jest's fake timers are the
 * clock and the timers; fetch is a fake the test answers by hand.
 */

const NOW = Date.UTC(2026, 9, 9, 12);
const URL = 'http://server.test:2567/v1/events';
const META: BatchMeta = {
  installId: '7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11',
  platform: 'ios',
  appVersion: '0.1.0',
};

function event(): TelemetryEvent {
  return { id: uuidV4(), name: 'screen_view', props: { screen: '/' }, t: NOW - 1000 };
}

interface Call {
  url: string;
  init: HttpRequestInit;
  batch: TelemetryBatch;
  answer(status: number, headers?: Record<string, string>, body?: string): void;
  fail(error?: Error): void;
}

/** A fetch that waits for the test to answer each call. */
function manualFetch() {
  const calls: Call[] = [];
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(
    (url, init) =>
      new Promise((resolve, reject) => {
        calls.push({
          url,
          init,
          batch: JSON.parse(init.body) as TelemetryBatch,
          answer: (status, headers = {}, body = '') =>
            resolve({
              status,
              headers: { get: (name) => headers[name.toLowerCase()] ?? null },
              text: async () => body,
            }),
          fail: (error = new TypeError('Network request failed')) => reject(error),
        });
      }),
  );
  return { fetch, calls };
}

/** A fetch that answers every call at once with the next status ('network': it fails). */
function scriptedFetch(...script: (number | 'network')[]) {
  const sent: TelemetryBatch[] = [];
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async (_url, init) => {
    sent.push(JSON.parse(init.body) as TelemetryBatch);
    const next = script.length > 1 ? script.shift()! : (script[0] ?? 202);
    if (next === 'network') throw new TypeError('Network request failed');
    return { status: next, headers: { get: () => null } };
  });
  return { fetch, sent };
}

const timers = {
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function sender(fetch: FetchLike, queue: TelemetryQueue, options: Partial<SenderOptions> = {}) {
  return new TelemetrySender({
    url: URL,
    queue,
    meta: () => META,
    fetch,
    now: () => Date.now(),
    random: () => 0.5,
    timers,
    ...options,
  });
}

function queueOf(count: number): TelemetryQueue {
  const q = new TelemetryQueue();
  for (let i = 0; i < count; i++) q.append(event());
  return q;
}

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('backoff and Retry-After', () => {
  it('doubles from 5 s to a 5-minute cap, with jitter between half and all of it', () => {
    const low = (n: number) => backoffDelay(n, () => 0);
    const high = (n: number) => backoffDelay(n, () => 1);
    expect([1, 2, 3, 4].map(high)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect([1, 2, 3, 4].map(low)).toEqual([2_500, 5_000, 10_000, 20_000]);
    expect(high(7)).toBe(300_000);
    expect(high(50)).toBe(300_000);
    expect(low(50)).toBe(150_000);
  });

  it('Retry-After in seconds or as an HTTP date, kept between a second and an hour; unreadable: null', () => {
    expect(retryAfterMs('7', NOW)).toBe(7_000);
    expect(retryAfterMs(' 0 ', NOW)).toBe(MIN_RETRY_AFTER_MS); // no tight loop of 429s
    expect(retryAfterMs(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90_000);
    expect(retryAfterMs(new Date(NOW - 5_000).toUTCString(), NOW)).toBe(MIN_RETRY_AFTER_MS);
    expect(retryAfterMs('999999', NOW)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryAfterMs('soon', NOW)).toBeNull();
    expect(retryAfterMs('', NOW)).toBeNull();
    expect(retryAfterMs(null, NOW)).toBeNull();
  });
});

describe('TelemetrySender', () => {
  it('202: POSTs the batch as JSON to the endpoint, and the events leave the queue', async () => {
    const q = queueOf(3);
    const events = q.peek(10);
    const { fetch, calls } = manualFetch();
    const onQueueChange = jest.fn();
    const s = sender(fetch, q, { onQueueChange });
    const flushing = s.flush();
    await jest.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(URL);
    expect(calls[0]!.init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(calls[0]!.batch).toEqual({ ...META, events });
    calls[0]!.answer(202, {}, '{"accepted":3,"duplicates":0}');
    expect(await flushing).toEqual({ sent: 3, dropped: 0, waitingUntil: null });
    expect(q.size).toBe(0);
    expect(onQueueChange).toHaveBeenCalled();
  });

  it('a long queue goes in batches of 100, one after the other, oldest first', async () => {
    const q = queueOf(250);
    const ids = q.peek(250).map((e) => e.id);
    const { fetch, calls } = manualFetch();
    const s = sender(fetch, q);
    const flushing = s.flush();
    for (let i = 0; i < 3; i++) {
      await jest.advanceTimersByTimeAsync(0);
      expect(calls).toHaveLength(i + 1); // never two in flight
      calls[i]!.answer(202);
    }
    expect(await flushing).toMatchObject({ sent: 250 });
    expect(calls.map((c) => c.batch.events.length)).toEqual([MAX_EVENTS_PER_BATCH, MAX_EVENTS_PER_BATCH, 50]);
    expect(calls.flatMap((c) => c.batch.events.map((e) => e.id))).toEqual(ids);
  });

  it('no double send: a flush while one is in flight joins it', async () => {
    const q = queueOf(3);
    const { fetch, calls } = manualFetch();
    const s = sender(fetch, q);
    const first = s.flush();
    const second = s.flush();
    expect(second).toBe(first);
    await jest.advanceTimersByTimeAsync(0);
    expect(s.status.sending).toBe(true);
    void s.flush();
    expect(calls).toHaveLength(1);
    calls[0]!.answer(202);
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.status.sending).toBe(false);
  });

  it('events tracked during a request go in the next batch of the same flush', async () => {
    const q = queueOf(2);
    const { fetch, calls } = manualFetch();
    const flushing = sender(fetch, q).flush();
    await jest.advanceTimersByTimeAsync(0);
    const late = event();
    q.append(late);
    calls[0]!.answer(202);
    await jest.advanceTimersByTimeAsync(0);
    expect(calls[1]!.batch.events).toEqual([late]);
    calls[1]!.answer(202);
    expect(await flushing).toMatchObject({ sent: 3 });
  });

  it('an old server refuses a batch of level events (400): only that batch goes, the older events are sent', async () => {
    const q = new TelemetryQueue();
    const before = [event(), event()];
    const levels = [0, 1].map((i): TelemetryEvent => ({
      id: uuidV4(),
      name: 'level_end',
      props: { level: i + 1 },
      t: NOW - 500,
    }));
    const after = [event()];
    for (const e of [...before, ...levels, ...after]) q.append(e);
    // A server before 1.0.2: it knows no level event, and refuses a batch that has one.
    const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async (_url, init) => {
      const batch = JSON.parse(init.body) as TelemetryBatch;
      const status = batch.events.some((e) => e.name.startsWith('level_')) ? 400 : 202;
      return { status, headers: { get: () => null } };
    });
    const flushing = sender(fetch, q, { log: jest.fn() }).flush();
    await jest.advanceTimersByTimeAsync(0);
    expect(await flushing).toEqual({ sent: 3, dropped: 2, waitingUntil: null });
    const batches = fetch.mock.calls.map(([, init]) => (JSON.parse(init.body) as TelemetryBatch).events);
    expect(batches.map((b) => b.map((e) => e.id))).toEqual([
      before.map((e) => e.id),
      levels.map((e) => e.id),
      after.map((e) => e.id),
    ]);
    expect(q.size).toBe(0);
  });

  it.each([400, 413])(
    '%i: the batch is dropped (sending it again would not help), and the next goes',
    async (status) => {
      const q = queueOf(150);
      const { fetch, sent } = scriptedFetch(status, 202);
      const log = jest.fn();
      const result = await sender(fetch, q, { log }).flush();
      expect(result).toEqual({ sent: 50, dropped: 100, waitingUntil: null });
      expect(sent).toHaveLength(2);
      expect(q.size).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`(${status})`), '');
    },
  );

  it('429: keeps the batch, sends nothing until Retry-After is over, then by itself', async () => {
    const q = queueOf(5);
    const { fetch, calls } = manualFetch();
    const s = sender(fetch, q);
    const flushing = s.flush();
    await jest.advanceTimersByTimeAsync(0);
    calls[0]!.answer(429, { 'retry-after': '7' }, '{"error":"tooManyRequests"}');
    expect(await flushing).toEqual({ sent: 0, dropped: 0, waitingUntil: NOW + 7_000 });
    expect(q.size).toBe(5);
    expect(s.status.failures).toBe(0);

    expect(await s.flush()).toEqual({ sent: 0, dropped: 0, waitingUntil: NOW + 7_000 });
    await jest.advanceTimersByTimeAsync(6_999);
    expect(calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    calls[1]!.answer(202);
    await jest.advanceTimersByTimeAsync(0);
    expect(q.size).toBe(0);
  });

  it('429 without Retry-After backs off like a failure', async () => {
    const q = queueOf(1);
    const { fetch } = scriptedFetch(429, 202);
    const result = await sender(fetch, q).flush();
    expect(result.waitingUntil).toBe(NOW + backoffDelay(1, () => 0.5));
    expect(q.size).toBe(1);
  });

  it('500, then the network: keeps the events and backs off longer each time; then success resets it', async () => {
    const q = queueOf(4);
    const { fetch, sent } = scriptedFetch(500, 'network', 202);
    const s = sender(fetch, q);
    const first = await s.flush();
    const wait1 = backoffDelay(1, () => 0.5); // 3.75 s
    expect(first).toEqual({ sent: 0, dropped: 0, waitingUntil: NOW + wait1 });
    expect(q.size).toBe(4);

    // While it waits, triggers send nothing.
    await jest.advanceTimersByTimeAsync(wait1 - 1);
    expect(await s.flush()).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1); // the retry: the network is down
    expect(sent).toHaveLength(2);
    expect(s.status).toMatchObject({ failures: 2, waitingUntil: Date.now() + backoffDelay(2, () => 0.5) });

    await jest.advanceTimersByTimeAsync(backoffDelay(2, () => 0.5)); // back: 202
    expect(sent).toHaveLength(3);
    expect(q.size).toBe(0);
    expect(s.status).toEqual({ sending: false, failures: 0, waitingUntil: null });
  });

  it('other answers (404, 401…) keep the events and back off too', async () => {
    const q = queueOf(2);
    const { fetch } = scriptedFetch(404);
    const result = await sender(fetch, q).flush();
    expect(result.waitingUntil).not.toBeNull();
    expect(q.size).toBe(2);
  });

  it('a request without an answer is given up after the timeout (aborted), then backs off', async () => {
    const q = queueOf(2);
    const { fetch, calls } = manualFetch();
    const s = sender(fetch, q);
    const flushing = s.flush();
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(calls[0]!.init.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls[0]!.init.signal?.aborted).toBe(true);
    expect((await flushing).waitingUntil).not.toBeNull();
    expect(q.size).toBe(2);
    expect(s.status.failures).toBe(1);
  });

  it('no install id yet: nothing is sent, and it backs off', async () => {
    const q = queueOf(2);
    const { fetch } = scriptedFetch(202);
    const meta = jest.fn().mockRejectedValueOnce(new Error('kv read failed')).mockResolvedValue(META);
    const s = sender(fetch, q, { meta });
    expect((await s.flush()).waitingUntil).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(backoffDelay(1, () => 0.5));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(0);
  });

  it('malformed events in the queue are dropped, not sent; the rest go', async () => {
    const q = new TelemetryQueue();
    const good = event();
    q.append({ ...event(), name: 'gone_event' as TelemetryEvent['name'] });
    q.append(good);
    const { fetch, sent } = scriptedFetch(202);
    expect(await sender(fetch, q).flush()).toEqual({ sent: 1, dropped: 1, waitingUntil: null });
    expect(sent[0]!.events).toEqual([good]);
  });

  it('one flush sends at most maxBatchesPerFlush batches', async () => {
    const q = queueOf(350);
    const { fetch, sent } = scriptedFetch(202);
    expect(await sender(fetch, q, { maxBatchesPerFlush: 2 }).flush()).toMatchObject({ sent: 200 });
    expect(sent).toHaveLength(2);
    expect(q.size).toBe(150);
  });

  it('an empty queue sends nothing', async () => {
    const { fetch } = scriptedFetch(202);
    expect(await sender(fetch, new TelemetryQueue()).flush()).toEqual({
      sent: 0,
      dropped: 0,
      waitingUntil: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('paused (the app in the background): no timer of its own; resumed, it retries when the wait is over', async () => {
    const q = queueOf(3);
    const { fetch } = scriptedFetch(500, 'network', 202);
    const s = sender(fetch, q);
    const wait1 = backoffDelay(1, () => 0.5);
    expect(await s.flush()).toMatchObject({ waitingUntil: NOW + wait1 });
    expect(jest.getTimerCount()).toBe(1); // the retry

    s.pause();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Asked to send while paused (the trip to the background): it does, and a failure sets no timer either.
    expect(await s.flush()).toMatchObject({ sent: 0, waitingUntil: Date.now() + backoffDelay(2, () => 0.5) });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);

    // Resumed with part of the wait left: the retry comes when it is over, by itself.
    await jest.advanceTimersByTimeAsync(1_000);
    s.resume();
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(backoffDelay(2, () => 0.5) - 1_001);
    expect(fetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(q.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resumed after the wait ran out in the background: retries at once; nothing waiting: no timer', async () => {
    const q = queueOf(1);
    const { fetch } = scriptedFetch('network', 202);
    const s = sender(fetch, q);
    await s.flush();
    s.pause();
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    s.resume();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(q.size).toBe(0);

    s.pause();
    s.resume();
    s.resume(); // twice: no harm
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stopped while paused: resuming does not wake it', async () => {
    const q = queueOf(1);
    const { fetch } = scriptedFetch('network', 202);
    const s = sender(fetch, q);
    await s.flush();
    s.pause();
    s.stop();
    s.resume();
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stop: no more sending, nor retrying', async () => {
    const q = queueOf(1);
    const { fetch } = scriptedFetch(500, 202);
    const s = sender(fetch, q);
    await s.flush();
    s.stop();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await s.flush()).toMatchObject({ sent: 0 });
  });
});

describe('signed in (stage 8): the ID token goes along, and never holds a batch up', () => {
  const authOf = (init: HttpRequestInit) => init.headers.authorization;

  it('each request carries Authorization: Bearer <token>, asked for per request', async () => {
    const q = queueOf(150);
    const { fetch, sent } = scriptedFetch(202);
    const tokens = ['token-1', 'token-2'];
    const idToken = jest.fn(async () => tokens.shift() ?? null);
    expect(await sender(fetch, q, { idToken }).flush()).toMatchObject({ sent: 150 });
    expect(sent).toHaveLength(2);
    expect(fetch.mock.calls.map(([, init]) => authOf(init))).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(fetch.mock.calls[0]![1].headers['content-type']).toBe('application/json');
    expect(idToken).toHaveBeenCalledTimes(2);
  });

  it('signed out (null), no getter, or a token that fails: sent without Authorization', async () => {
    for (const idToken of [
      undefined,
      () => null,
      async () => null,
      async () => Promise.reject(new Error('auth/network-request-failed')),
      () => {
        throw new Error('sync failure');
      },
    ]) {
      const { fetch } = scriptedFetch(202);
      const log = jest.fn();
      const q = queueOf(2);
      expect(await sender(fetch, q, { idToken, log }).flush()).toMatchObject({ sent: 2 });
      expect(authOf(fetch.mock.calls[0]![1])).toBeUndefined();
      expect(q.size).toBe(0);
    }
  });

  it('a token that can not go in a header is left out (a bad header would fail every retry)', async () => {
    for (const bad of [
      'two words',
      'line' + String.fromCharCode(10) + 'break',
      '',
      'x'.repeat(5000),
      'עברית',
    ]) {
      const { fetch } = scriptedFetch(202);
      const log = jest.fn();
      expect(await sender(fetch, queueOf(1), { idToken: () => bad, log }).flush()).toMatchObject({ sent: 1 });
      expect(authOf(fetch.mock.calls[0]![1])).toBeUndefined();
    }
  });

  it('a token that takes too long: the batch goes without it after TOKEN_WAIT_MS', async () => {
    const q = queueOf(3);
    const { fetch, calls } = manualFetch();
    const s = sender(fetch, q, { idToken: () => new Promise<string>(() => undefined) });
    const flushing = s.flush();
    await jest.advanceTimersByTimeAsync(TOKEN_WAIT_MS - 1);
    expect(calls).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(authOf(calls[0]!.init)).toBeUndefined();
    calls[0]!.answer(202);
    expect(await flushing).toMatchObject({ sent: 3 });
    expect(jest.getTimerCount()).toBe(0); // the token's wait and the request's timeout are cleared
  });

  it('a token in time: no wait left behind', async () => {
    const { fetch, calls } = manualFetch();
    const flushing = sender(fetch, queueOf(1), { idToken: async () => 'tok' }).flush();
    await jest.advanceTimersByTimeAsync(0);
    expect(authOf(calls[0]!.init)).toBe('Bearer tok');
    calls[0]!.answer(202);
    await flushing;
    expect(jest.getTimerCount()).toBe(0);
  });
});
