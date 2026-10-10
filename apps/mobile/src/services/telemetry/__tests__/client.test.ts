import type { TelemetryBatch, TelemetryEventName } from '@sudoku-fight/protocol';

import { memoryDb, type SqlJsDb } from '../../../game/testing/sqlJsDb';
import type { BatchMeta } from '../batching';
import {
  type AppStateLike,
  createTelemetryClient,
  FLUSH_INTERVAL_MS,
  FLUSH_THRESHOLD,
  SAVE_DELAY_MS,
  type TelemetryClientDeps,
} from '../client';
import type { FetchLike } from '../sender';
import { openTelemetryStore, type TelemetryStore } from '../storage';
import { uuidV4 } from '../uuid';

/**
 * The telemetry client (spec §27.1): track() → the queue → disk and server. When it sends (start, every 30 s
 * in the foreground, going to the background, 50 waiting) and when it writes (batched, and at once going to
 * the background). SQLite runs for real (sql.js); Jest's fake timers are the clock; fetch and AppState are
 * fakes. A "run" is a client; a new run over the same database is the app started again.
 */

const NOW = Date.UTC(2026, 9, 9, 12);
const META: BatchMeta = {
  installId: '7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11',
  platform: 'android',
  appVersion: '0.1.0',
};

/** Answers every POST at once: 202, or what `status()` says. */
function server(status: () => number | 'network' = () => 202) {
  const batches: TelemetryBatch[] = [];
  const fetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async (_url, init) => {
    const answer = status();
    if (answer === 'network') throw new TypeError('Network request failed');
    batches.push(JSON.parse(init.body) as TelemetryBatch);
    return { status: answer, headers: { get: () => null } };
  });
  const names = () => batches.flatMap((b) => b.events.map((e) => e.name));
  const screens = () => batches.flatMap((b) => b.events.map((e) => e.props.screen));
  return { fetch, batches, names, screens };
}

/** React Native's AppState, moved by the test with set(). */
function fakeAppState(initial = 'active'): AppStateLike & { set(state: string): void } {
  const listeners = new Set<(state: string) => void>();
  let current = initial;
  return {
    get currentState() {
      return current;
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    set(state) {
      current = state;
      listeners.forEach((l) => l(state));
    },
  };
}

const timers = {
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let db: SqlJsDb;
function run(fetch: FetchLike, overrides: Partial<TelemetryClientDeps> = {}) {
  const appState = fakeAppState();
  const client = createTelemetryClient({
    openStore: () => openTelemetryStore(db),
    url: 'http://server.test/v1/events',
    meta: () => META,
    fetch,
    now: () => Date.now(),
    random: () => 0.5,
    timers,
    appState,
    newId: () => uuidV4(),
    ...overrides,
  });
  return { client, appState };
}

const screen = (n: number) => ({ screen: `/s${n}` });
const settle = () => jest.advanceTimersByTimeAsync(0);
const rows = async () => (await db.getAllAsync<{ id: string }>('SELECT id FROM telemetry_queue', [])).length;

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW });
  db = await memoryDb();
});
afterEach(() => {
  jest.useRealTimers();
  db.close();
});

describe('the telemetry client', () => {
  it('the queue survives the app being killed: the next run sends it first, then its own events', async () => {
    // Run 1: offline. Two screens, saved to disk a moment later; then the app is killed.
    const offline = server(() => 'network');
    const first = run(offline.fetch);
    first.client.start();
    first.client.track('screen_view', screen(1));
    first.client.track('screen_view', screen(2));
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(await rows()).toBe(2);
    first.client.stop(); // killed: nothing more is written or sent

    // Run 2: online. An event before start waits in memory; start loads the disk's in front of it.
    const online = server();
    const second = run(online.fetch);
    second.client.track('app_open');
    expect(online.fetch).not.toHaveBeenCalled();
    second.client.start();
    await settle();
    expect(online.names()).toEqual(['screen_view', 'screen_view', 'app_open']);
    expect(online.screens().slice(0, 2)).toEqual(['/s1', '/s2']);
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(await rows()).toBe(0);
  });

  it('writes to disk are batched: one write for a burst of taps, a couple of seconds later', async () => {
    let store!: TelemetryStore;
    const save = jest.fn();
    const { client } = run(server(() => 'network').fetch, {
      openStore: async () => {
        store = await openTelemetryStore(db);
        const real = store.save;
        save.mockImplementation((changes: Parameters<TelemetryStore['save']>[0]) => real(changes));
        return { load: () => store.load(), save };
      },
    });
    client.start();
    await settle();
    for (let i = 0; i < 20; i++) client.track('screen_view', screen(i));
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].added).toHaveLength(20);
    expect(await rows()).toBe(20);
  });

  it('sends every 30 s in the foreground, none in the background; going to the background sends and saves at once', async () => {
    const online = server();
    const { client, appState } = run(online.fetch);
    client.start();
    await settle();
    expect(online.fetch).not.toHaveBeenCalled(); // nothing to send at start

    client.track('screen_view', screen(1));
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS - 1);
    expect(online.batches).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(online.batches).toHaveLength(1);

    client.track('screen_view', screen(2));
    appState.set('background');
    await settle();
    expect(online.batches).toHaveLength(2);
    expect(online.screens()).toEqual(['/s1', '/s2']);

    // In the background: no 30 s ticks.
    client.track('screen_view', screen(3));
    await jest.advanceTimersByTimeAsync(5 * FLUSH_INTERVAL_MS);
    expect(online.batches).toHaveLength(2);

    // 'inactive' (iOS, on the way) changes nothing; back in the foreground, the ticks again.
    appState.set('inactive');
    appState.set('active');
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(online.batches).toHaveLength(3);
  });

  it('going to the background writes the queue at once (the app may be killed there)', async () => {
    const { client, appState } = run(server(() => 'network').fetch);
    client.start();
    await settle();
    client.track('screen_view', screen(1));
    appState.set('background');
    await settle();
    expect(await rows()).toBe(1);
  });

  it(`sends as soon as ${FLUSH_THRESHOLD} events wait`, async () => {
    const online = server();
    const { client } = run(online.fetch);
    client.start();
    await settle();
    for (let i = 1; i < FLUSH_THRESHOLD; i++) client.track('screen_view', screen(i));
    await settle();
    expect(online.fetch).not.toHaveBeenCalled();
    client.track('screen_view', screen(FLUSH_THRESHOLD));
    await settle();
    expect(online.batches).toHaveLength(1);
    expect(online.batches[0]!.events).toHaveLength(FLUSH_THRESHOLD);
  });

  it('offline: after a failure, the triggers send nothing until the backoff is over', async () => {
    let answer: number | 'network' = 'network';
    const net = server(() => answer);
    const { client, appState } = run(net.fetch);
    client.track('screen_view', screen(0));
    client.start();
    await settle();
    expect(net.fetch).toHaveBeenCalledTimes(1); // the start's flush failed: backs off 3.75 s

    for (let i = 1; i <= 2 * FLUSH_THRESHOLD; i++) client.track('screen_view', screen(i));
    appState.set('background');
    appState.set('active');
    await settle();
    expect(net.fetch).toHaveBeenCalledTimes(1);

    answer = 202;
    await jest.advanceTimersByTimeAsync(3_750);
    expect(net.fetch).toHaveBeenCalledTimes(3); // 101 events: 100 + 1
    expect(client.queue.size).toBe(0);
  });

  it('offline in the background: no timer runs there, not even the retry; back in the foreground, it retries', async () => {
    let answer: number | 'network' = 'network';
    const net = server(() => answer);
    const { client, appState } = run(net.fetch);
    client.start();
    await settle();
    client.track('screen_view', screen(1));
    appState.set('background'); // the last send fails: the network is down
    await settle();
    expect(net.fetch).toHaveBeenCalledTimes(1);
    expect(await rows()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);

    // Hours there: nothing tried, nothing woken. (A tap there, 50 waiting, would send at most once.)
    await jest.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(net.fetch).toHaveBeenCalledTimes(1);

    // Back: the wait ran out long ago, so it retries at once; then the 30 s ticks again.
    answer = 202;
    appState.set('active');
    await settle();
    expect(net.fetch).toHaveBeenCalledTimes(2);
    expect(client.queue.size).toBe(0);
    client.track('screen_view', screen(2));
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(net.fetch).toHaveBeenCalledTimes(3);
  });

  it('started in the background (a launch the user did not see): the triggers wait for the foreground', async () => {
    const net = server(() => 'network');
    const { client } = run(net.fetch, { appState: fakeAppState('background') });
    client.track('app_open');
    client.start();
    await settle();
    expect(net.fetch).toHaveBeenCalledTimes(1); // the start's send
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(net.fetch).toHaveBeenCalledTimes(1);
  });

  it('before start: memory only (no disk, no network), however many events', async () => {
    const online = server();
    const openStore = jest.fn(() => openTelemetryStore(db));
    const { client } = run(online.fetch, { openStore });
    for (let i = 0; i < 2 * FLUSH_THRESHOLD; i++) client.track('screen_view', screen(i));
    await jest.advanceTimersByTimeAsync(2 * FLUSH_INTERVAL_MS);
    expect(openStore).not.toHaveBeenCalled();
    expect(online.fetch).not.toHaveBeenCalled();
    expect(client.queue.size).toBe(2 * FLUSH_THRESHOLD);
    expect(await client.flush()).toBeNull();

    client.start();
    client.start(); // once
    await settle();
    expect(openStore).toHaveBeenCalledTimes(1);
    expect(online.batches.flatMap((b) => b.events)).toHaveLength(2 * FLUSH_THRESHOLD);
  });

  it('events keep their time and get a fresh UUID each', async () => {
    const online = server();
    const { client } = run(online.fetch);
    client.start();
    await settle();
    client.track('game_start', { mode: 'solo', type: 'fast', players: 1 });
    await jest.advanceTimersByTimeAsync(1_500);
    client.track('game_end', { mode: 'solo', result: 'finished', score: 12.5, mistakes: 0, durationSec: 1 });
    await client.flush();
    const [start, end] = online.batches[0]!.events;
    expect(start).toMatchObject({ name: 'game_start', t: NOW, props: { mode: 'solo', players: 1 } });
    expect(end).toMatchObject({ name: 'game_end', t: NOW + 1_500 });
    expect(start!.id).not.toBe(end!.id);
  });

  describe('never throws, never breaks the app', () => {
    it('storage that can not open: events wait in memory and are still sent', async () => {
      const log = jest.fn();
      const online = server();
      const { client } = run(online.fetch, { openStore: () => Promise.reject(new Error('disk full')), log });
      client.start();
      expect(() => client.track('app_open')).not.toThrow();
      await settle();
      expect(online.names()).toEqual(['app_open']);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('memory'), expect.any(Error));
      await expect(client.persist()).resolves.toBeUndefined();
    });

    it('a failed write is retried with the next one, nothing lost', async () => {
      const { client } = run(server(() => 'network').fetch);
      client.start();
      await settle();
      client.track('screen_view', screen(1));
      db.failOnce('INSERT');
      await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);
      expect(await rows()).toBe(0);
      client.track('screen_view', screen(2));
      await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);
      expect(await rows()).toBe(2);
    });

    it('bad input or a failing id source: the event is left out, quietly', () => {
      const log = jest.fn();
      const { client } = run(server().fetch, {
        newId: () => {
          throw new Error('no ids');
        },
        log,
      });
      expect(() => client.track('app_open')).not.toThrow();
      const { client: other } = run(server().fetch, { log });
      expect(() => other.track('not_an_event' as TelemetryEventName)).not.toThrow();
      const hostile = Object.defineProperty({}, 'boom', {
        enumerable: true,
        get: () => {
          throw new Error('getter');
        },
      });
      expect(() => other.track('app_open', hostile as Record<string, string>)).not.toThrow();
      expect(other.queue.size).toBe(0);
      expect(log).toHaveBeenCalledTimes(3);
    });

    it('a log that throws changes nothing', () => {
      const { client } = run(server().fetch, {
        log: () => {
          throw new Error('console gone');
        },
      });
      expect(() => client.track('nope' as TelemetryEventName)).not.toThrow();
    });
  });
});

describe('signed in (stage 8)', () => {
  it("the batches carry the sign-in's ID token; signed out, they go without it", async () => {
    const { fetch } = server();
    let token: string | null = 'dev:abc:player@example.com';
    const { client } = run(fetch, { idToken: async () => token });
    client.start();
    client.track('app_open');
    await client.flush();
    expect(fetch.mock.calls.at(-1)![1].headers.authorization).toBe('Bearer dev:abc:player@example.com');

    token = null;
    client.track('screen_view', screen(1));
    await client.flush();
    expect(fetch.mock.calls.at(-1)![1].headers.authorization).toBeUndefined();
    client.stop();
  });
});
