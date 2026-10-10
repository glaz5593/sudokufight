import type { TelemetryEventName, TelemetryProps } from '@sudoku-fight/protocol';

import { type BatchMeta, isTelemetryEventName, sanitizeEvent } from './batching';
import { QUEUE_CAP, TelemetryQueue, type TelemetryStore } from './queue';
import { type FetchLike, type FlushResult, type SenderOptions, TelemetrySender, type Timers } from './sender';

/**
 * Usage reports to our server (spec §27.1): track() puts an event in the queue, the queue is kept on disk,
 * and the sender sends it in batches. Everything from the outside world comes in (storage, fetch, clock,
 * timers, the app's foreground state), so tests drive it; index.ts wires the real ones. Pure: no React Native
 * or Expo imports, so the server's contract test runs this very client against the real endpoint.
 *
 * When it sends: on start (with what the last runs left), every 30 s while the app is in the foreground,
 * when the app goes to the background, and as soon as 50 events wait. Never while the sender backs off.
 * In the background no timer of its own runs (no ticks, no retries): only that last send.
 * When it writes to disk: a couple of seconds after a change (all the changes since, in one transaction),
 * and at once when the app goes to the background (it may be killed there without notice).
 */

export const FLUSH_INTERVAL_MS = 30_000;
export const FLUSH_THRESHOLD = 50;
export const SAVE_DELAY_MS = 2_000;

/** React Native's AppState, as far as it is used here. */
export interface AppStateLike {
  readonly currentState: string | null | undefined;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

export interface TelemetryClientDeps {
  /** Opens the queue's storage; a rejection keeps the events in memory for this run. */
  openStore: () => Promise<TelemetryStore>;
  /** `${httpBase}${TELEMETRY_PATH}`. */
  url: string;
  meta: () => BatchMeta | Promise<BatchMeta>;
  /** The signed-in player's ID token, or null (stage 8): the sender adds it when it can, never waits on it. */
  idToken?: SenderOptions['idToken'];
  fetch: FetchLike;
  now: () => number;
  random: () => number;
  timers: Timers;
  appState: AppStateLike;
  newId: () => string;
  log?: (message: string, detail?: unknown) => void;
  flushIntervalMs?: number;
  flushThreshold?: number;
  saveDelayMs?: number;
  queueCap?: number;
}

export interface TelemetryClient {
  /** Queues an event. Never throws, never waits: safe from any tap or render. */
  track(name: TelemetryEventName, props?: TelemetryProps): void;
  /** Loads the saved queue, sends it, and starts the triggers. Once; later calls do nothing. */
  start(): void;
  /** Sends now (after start; joins a flush already running). Never rejects. */
  flush(): Promise<FlushResult | null>;
  /** Writes the unsaved changes now. Never rejects. */
  persist(): Promise<void>;
  /** Stops the triggers and the sender (tests). */
  stop(): void;
  readonly queue: TelemetryQueue;
  readonly sender: TelemetrySender;
}

export function createTelemetryClient(deps: TelemetryClientDeps): TelemetryClient {
  const { timers } = deps;
  const log = (message: string, detail?: unknown) => {
    try {
      deps.log?.(message, detail);
    } catch {
      // logging must not break anything
    }
  };
  const flushIntervalMs = deps.flushIntervalMs ?? FLUSH_INTERVAL_MS;
  const flushThreshold = deps.flushThreshold ?? FLUSH_THRESHOLD;
  const saveDelayMs = deps.saveDelayMs ?? SAVE_DELAY_MS;

  const queue = new TelemetryQueue(deps.queueCap ?? QUEUE_CAP);
  let store: TelemetryStore | null = null;
  let ready: Promise<void> | null = null;
  let saveTimer: unknown = null;
  let tickTimer: unknown = null;
  let subscription: { remove(): void } | null = null;
  let writing: Promise<void> = Promise.resolve();
  let stopped = false;

  const sender = new TelemetrySender({
    url: deps.url,
    queue,
    meta: deps.meta,
    idToken: deps.idToken,
    fetch: deps.fetch,
    now: deps.now,
    random: deps.random,
    timers,
    onQueueChange: () => scheduleSave(),
    log,
  });

  function scheduleSave(): void {
    if (store === null || saveTimer !== null || stopped) return;
    saveTimer = timers.setTimeout(() => {
      saveTimer = null;
      void persist();
    }, saveDelayMs);
  }

  function persist(): Promise<void> {
    if (saveTimer !== null) {
      timers.clearTimeout(saveTimer);
      saveTimer = null;
    }
    // One write at a time, in order; a failed one gives its changes back for the next.
    writing = writing
      .then(async () => {
        const target = store;
        if (target === null) return;
        const changes = queue.takeChanges();
        if (changes === null) return;
        try {
          await target.save(changes);
        } catch (error) {
          queue.returnChanges(changes);
          log('could not save the queue; will try again', error);
        }
      })
      .catch((error: unknown) => log('saving the queue failed', error));
    return writing;
  }

  async function flush(): Promise<FlushResult | null> {
    if (ready === null || stopped) return null;
    await ready;
    return sender.flush();
  }

  function tick(): void {
    tickTimer = timers.setTimeout(() => {
      tickTimer = null;
      void flush();
      tick();
    }, flushIntervalMs);
  }

  function stopTicking(): void {
    if (tickTimer === null) return;
    timers.clearTimeout(tickTimer);
    tickTimer = null;
  }

  function onAppState(state: string): void {
    try {
      if (state === 'active') {
        if (stopped) return;
        sender.resume();
        if (tickTimer === null) tick();
      } else if (state === 'background') {
        // No timers in the background, not even the sender's retry: one last send, and the disk at once.
        stopTicking();
        sender.pause();
        void persist();
        void flush();
      }
    } catch (error) {
      log('app state handling failed', error);
    }
  }

  return {
    queue,
    sender,
    persist,
    flush,

    track(name, props = {}) {
      try {
        if (!isTelemetryEventName(name)) {
          log(`unknown event "${String(name)}" left out`);
          return;
        }
        const event = sanitizeEvent({ id: deps.newId(), name, props, t: deps.now() });
        if (event === null) {
          log(`event "${name}" left out: it can't be sent as it is (props too big, or the clock is wrong)`);
          return;
        }
        queue.append(event);
        if (ready === null) return; // before start: kept in memory, saved and sent once started
        scheduleSave();
        if (queue.size >= flushThreshold) void flush();
      } catch (error) {
        log(`could not record "${String(name)}"`, error);
      }
    },

    start() {
      if (ready !== null || stopped) return;
      ready = (async () => {
        try {
          const opened = await deps.openStore();
          queue.restore(await opened.load());
          store = opened;
        } catch (error) {
          log('the queue can not be kept on this phone; events wait in memory for this run', error);
        }
      })();
      void ready.then(() => {
        scheduleSave();
        return flush();
      });
      try {
        subscription = deps.appState.addEventListener('change', onAppState);
        if (deps.appState.currentState === 'background') sender.pause();
        else tick();
      } catch (error) {
        log('could not follow the app state', error);
        tick();
      }
    },

    stop() {
      stopped = true;
      stopTicking();
      if (saveTimer !== null) timers.clearTimeout(saveTimer);
      saveTimer = null;
      subscription?.remove();
      subscription = null;
      sender.stop();
    },
  };
}
