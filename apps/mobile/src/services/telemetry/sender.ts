import type { TelemetryBatch } from '@sudoku-fight/protocol';

import { type BatchLimits, type BatchMeta, buildBatches, DEFAULT_BATCH_LIMITS } from './batching';
import type { TelemetryQueue } from './queue';

/**
 * Sends the queue to `POST /v1/events` (spec §27.1, §27.2): the oldest events first, one batch in flight at a
 * time, and each answer handled as the protocol says (TelemetryResponse in @sudoku-fight/protocol):
 * - 2xx: stored; the batch leaves the queue.
 * - 400 / 413: malformed or too big; sending it again won't help, so it leaves the queue too.
 * - 429: keep it, and wait the Retry-After seconds.
 * - anything else (5xx, no answer, a timeout): keep it, and back off: 5 s, 10 s, 20 s… up to 5 minutes,
 *   with jitter, so phones that lost the server together don't come back together. While it waits, flush()
 *   sends nothing (an offline phone doesn't try on every trigger); when the wait is over it tries by itself,
 *   but not while paused (the app in the background): then once resumed.
 *
 * Signed in (stage 8), each request carries `Authorization: Bearer <ID token>` (`idToken`), so the server
 * links the events to the account. The token is never waited on for long, and never kept: asked for per
 * request, and left out when it can't be had.
 *
 * Pure: fetch, the clock, the timers and the randomness come in, so tests drive it (and the server's tests
 * run it against the real endpoint).
 */

export interface HttpResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  /** Read when present (for the 400 message, and to free the connection). */
  text?: () => Promise<string>;
}

export interface HttpRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 5_000, maxMs: 5 * 60_000 };
/**
 * Retry-After is kept within these: at least a second ("0" must not make a tight loop of 429s), at most an
 * hour (a wrong header must not silence the app for the day).
 */
export const MIN_RETRY_AFTER_MS = 1_000;
export const MAX_RETRY_AFTER_MS = 60 * 60_000;
export const REQUEST_TIMEOUT_MS = 20_000;
/**
 * How long a batch waits for the sign-in's ID token (Firebase may refresh it over the network) before it goes
 * without one. Usage data never waits on the sign-in, and the server stores a batch without a token too.
 */
export const TOKEN_WAIT_MS = 2_000;
/** What may go in an Authorization header: visible ASCII, no spaces (a JWT, or a "dev:<uid>" token). */
const HEADER_SAFE_TOKEN = /^[\x21-\x7e]{1,4096}$/;
/** The server takes ~30 batches a minute from one install; a flush every 30 s sends at most this many. */
export const MAX_BATCHES_PER_FLUSH = 10;

/**
 * The wait after the `failures`-th failure in a row: base, doubled each time up to the cap, then with "equal
 * jitter": between half of that and all of it.
 */
export function backoffDelay(
  failures: number,
  random: () => number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): number {
  const full = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, failures - 1));
  return Math.round(full / 2 + random() * (full / 2));
}

/**
 * Retry-After in ms, between MIN_RETRY_AFTER_MS and MAX_RETRY_AFTER_MS: delta-seconds or an HTTP date
 * (RFC 9110 §10.2.3); null when missing or unreadable.
 */
export function retryAfterMs(header: string | null, now: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  if (Number.isNaN(ms)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, ms));
}

export interface SenderOptions {
  /** `${httpBase}${TELEMETRY_PATH}`. */
  url: string;
  queue: TelemetryQueue;
  /** The batches' header. May reject (no install id yet): handled like a request that failed. */
  meta: () => BatchMeta | Promise<BatchMeta>;
  /**
   * The signed-in player's ID token, or null when nobody is signed in (stage 8): sent as
   * `Authorization: Bearer`, so the server links the batch to the account. Never blocks a batch: a token that
   * fails, is unusable or takes longer than TOKEN_WAIT_MS is left out, and the batch goes anonymous.
   */
  idToken?: () => string | null | Promise<string | null>;
  /** Default TOKEN_WAIT_MS. */
  tokenWaitMs?: number;
  fetch: FetchLike;
  now: () => number;
  /** In [0, 1): the jitter. */
  random: () => number;
  timers: Timers;
  /** Called after the queue changed (events sent or dropped), so it can be saved. */
  onQueueChange?: () => void;
  log?: (message: string, detail?: unknown) => void;
  backoff?: BackoffPolicy;
  limits?: BatchLimits;
  /** fetch has no timeout of its own: a request without an answer by then counts as failed. */
  requestTimeoutMs?: number;
  maxBatchesPerFlush?: number;
}

export interface FlushResult {
  /** Events the server took in this flush. */
  sent: number;
  /** Events that left the queue unsent: refused by the server (400, 413), or malformed. */
  dropped: number;
  /** When the sender is waiting (backoff or Retry-After): until then. It tries again by itself. */
  waitingUntil: number | null;
}

type Attempt =
  | { kind: 'answered'; status: number; retryAfter: string | null; body: string }
  | { kind: 'failed'; reason: string };

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class TelemetrySender {
  private inFlight: Promise<FlushResult> | null = null;
  private failures = 0;
  private blockedUntil = 0;
  private wake: unknown = null;
  private stopped = false;
  private paused = false;

  constructor(private readonly options: SenderOptions) {}

  /** For tests and debugging. */
  get status(): { sending: boolean; failures: number; waitingUntil: number | null } {
    return { sending: this.inFlight !== null, failures: this.failures, waitingUntil: this.waitingUntil() };
  }

  /**
   * Sends what is queued, batch after batch, until the queue is empty, a request fails, or
   * MAX_BATCHES_PER_FLUSH. A flush while one runs joins it (one batch in flight at a time); while waiting
   * (backoff, Retry-After) it sends nothing. Never rejects.
   */
  flush(): Promise<FlushResult> {
    if (this.inFlight) return this.inFlight;
    const waitingUntil = this.waitingUntil();
    if (this.stopped || waitingUntil !== null) return Promise.resolve({ sent: 0, dropped: 0, waitingUntil });
    const run = this.run()
      .catch((error: unknown): FlushResult => {
        this.log('flush failed', error);
        return { sent: 0, dropped: 0, waitingUntil: this.waitingUntil() };
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }

  /** No more sending, nor waking up to retry. */
  stop(): void {
    this.stopped = true;
    this.clearWake();
  }

  /**
   * The app went to the background: no timer of its own (an offline phone must not wake up there every few
   * minutes to retry). A wait that is running still counts, and flush() still sends when asked.
   */
  pause(): void {
    this.paused = true;
    this.clearWake();
  }

  /** Back in the foreground: retries by itself again, when the wait is over (at once if it already is). */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // blockedUntil stays set from a wait until its wake runs: the wake that pause() cleared, or never set.
    if (this.blockedUntil > 0 && !this.stopped)
      this.scheduleWake(Math.max(0, this.blockedUntil - this.options.now()));
  }

  private async run(): Promise<FlushResult> {
    const { queue } = this.options;
    const limits = this.options.limits ?? DEFAULT_BATCH_LIMITS;
    const maxBatches = this.options.maxBatchesPerFlush ?? MAX_BATCHES_PER_FLUSH;
    const result: FlushResult = { sent: 0, dropped: 0, waitingUntil: null };

    for (let i = 0; i < maxBatches && !this.stopped; i++) {
      const events = queue.peek(limits.maxEvents);
      if (events.length === 0) break;

      let batch: TelemetryBatch | undefined;
      try {
        const built = buildBatches(events, await this.options.meta(), limits);
        if (built.rejected.length > 0) {
          result.dropped += queue.drop(built.rejected);
          this.log(`left out ${built.rejected.length} malformed event(s)`);
          this.changed();
        }
        batch = built.batches[0];
      } catch (error) {
        result.waitingUntil = this.fail('could not build a batch', error);
        break;
      }
      if (!batch) continue; // every one of them was malformed: on to the next

      const ids = batch.events.map((e) => e.id);
      const attempt = await this.post(batch);
      if (attempt.kind === 'failed') {
        result.waitingUntil = this.fail(attempt.reason);
        break;
      }
      const { status } = attempt;
      if (status >= 200 && status < 300) {
        this.failures = 0;
        result.sent += queue.ack(ids);
        this.changed();
      } else if (status === 400 || status === 413) {
        this.failures = 0;
        result.dropped += queue.drop(ids);
        this.log(`the server refused a batch of ${ids.length} (${status})`, attempt.body);
        this.changed();
      } else if (status === 429) {
        const wait = retryAfterMs(attempt.retryAfter, this.options.now());
        result.waitingUntil = wait === null ? this.fail('429 without Retry-After') : this.waitFor(wait);
        break;
      } else {
        result.waitingUntil = this.fail(`HTTP ${status}`);
        break;
      }
    }
    return result;
  }

  /** The sign-in's token for this request, or null: never throws, never waits longer than tokenWaitMs. */
  private async bearer(get: NonNullable<SenderOptions['idToken']>): Promise<string | null> {
    const { timers } = this.options;
    let timer: unknown = null;
    const giveUp = new Promise<null>((resolve) => {
      timer = timers.setTimeout(() => resolve(null), this.options.tokenWaitMs ?? TOKEN_WAIT_MS);
    });
    try {
      const token = await Promise.race([Promise.resolve().then(get), giveUp]);
      if (token === null) return null;
      if (typeof token === 'string' && HEADER_SAFE_TOKEN.test(token)) return token;
      this.log('the sign-in token is not usable in a header; sent without it');
      return null;
    } catch (error) {
      this.log('no sign-in token; sent without it', error);
      return null;
    } finally {
      timers.clearTimeout(timer);
    }
  }

  private async post(batch: TelemetryBatch): Promise<Attempt> {
    const { timers } = this.options;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.idToken) {
      const token = await this.bearer(this.options.idToken);
      if (token !== null) headers.authorization = `Bearer ${token}`;
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer: unknown = null;
    const timeout = new Promise<Attempt>((resolve) => {
      timer = timers.setTimeout(() => {
        controller?.abort();
        resolve({ kind: 'failed', reason: 'timeout' });
      }, this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
    });
    const request = (async (): Promise<Attempt> => {
      try {
        const res = await this.options.fetch(this.options.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch),
          signal: controller?.signal,
        });
        const body = res.text ? await res.text().catch(() => '') : '';
        return { kind: 'answered', status: res.status, retryAfter: res.headers.get('retry-after'), body };
      } catch (error) {
        return { kind: 'failed', reason: describe(error) };
      }
    })();
    try {
      return await Promise.race([request, timeout]);
    } finally {
      timers.clearTimeout(timer);
    }
  }

  /** One more failure in a row: waits its backoff. Returns until when. */
  private fail(reason: string, error?: unknown): number {
    this.failures++;
    const wait = backoffDelay(this.failures, this.options.random, this.options.backoff);
    this.log(`not sent (${reason}); trying again in ${Math.round(wait / 1000)} s`, error);
    return this.waitFor(wait);
  }

  /** Sends nothing for `ms`, then flushes (when paused: once resumed). Returns until when. */
  private waitFor(ms: number): number {
    this.blockedUntil = this.options.now() + ms;
    this.clearWake();
    if (!this.paused) this.scheduleWake(ms);
    return this.blockedUntil;
  }

  private scheduleWake(ms: number): void {
    this.clearWake();
    this.wake = this.options.timers.setTimeout(() => {
      this.wake = null;
      this.blockedUntil = 0; // the wait is over, even if the clock says a millisecond is left
      void this.flush();
    }, ms);
  }

  private waitingUntil(): number | null {
    return this.blockedUntil > this.options.now() ? this.blockedUntil : null;
  }

  private clearWake(): void {
    if (this.wake === null) return;
    this.options.timers.clearTimeout(this.wake);
    this.wake = null;
  }

  private changed(): void {
    try {
      this.options.onQueueChange?.();
    } catch (error) {
      this.log('saving the queue failed', error);
    }
  }

  private log(message: string, detail?: unknown): void {
    this.options.log?.(message, detail);
  }
}
