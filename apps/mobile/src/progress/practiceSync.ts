import { MAX_PRACTICE_RESULTS, type MyProgress, type PracticeResult } from '@sudoku-fight/protocol';

import { isProgressApiError, type ProgressApi } from '../api/progressApi';
import {
  type BackoffPolicy,
  backoffDelay,
  DEFAULT_BACKOFF,
  MAX_RETRY_AFTER_MS,
  MIN_RETRY_AFTER_MS,
  type Timers,
} from '../services/telemetry/sender';
import type { PracticeQueue } from './practiceQueue';

/**
 * Sends the practice XP queue to `POST /v1/me/practice-results` [D41], oldest first, MAX_PRACTICE_RESULTS at a
 * time, for whoever is signed in now. The triggers are the app's (app start and sign-in, a practice's end,
 * the app back in the foreground); this decides what each answer means:
 *
 * - 2xx: the server took them (a resend of a result it has counts as a duplicate, never twice); they leave the
 *   queue, and its answer's progress is the new one (`onProgress`).
 * - 400 / 413: the batch is malformed. The results are sent one by one to find the one at fault, and only that
 *   one is dropped (resending it would never help).
 * - 429: keep them, and wait the Retry-After.
 * - no connection, a timeout, 5xx, an answer the app can't read: keep them, and back off (5 s, 10 s, 20 s… up
 *   to 5 minutes, with jitter). While it waits a trigger sends nothing; when the wait is over it tries itself.
 * - signed out, or no account: keep them for when that player is back; no retry until a trigger.
 *
 * Pure: the queue, the API, the timers and the randomness come in, so tests drive it with a fake fetch.
 */

export interface PracticeSyncDeps {
  queue: PracticeQueue;
  /** Who is signed in now (the Firebase uid); null when nobody is. */
  owner: () => string | null;
  /** The progress API of the signed-in player; null when nobody is signed in. */
  api: () => ProgressApi | null;
  /** The server took results: the progress its answer carries. */
  onProgress?: (owner: string, progress: MyProgress) => void;
  /** After every flush: how many results still wait for `owner`. */
  onPending?: (owner: string, count: number) => void;
  timers: Timers;
  /** In [0, 1): the backoff's jitter. */
  random: () => number;
  backoff?: BackoffPolicy;
  /** Requests per flush; more waiting after them goes on after FOLLOW_UP_MS. */
  maxBatchesPerFlush?: number;
  log?: (message: string, detail?: unknown) => void;
}

export type SyncStatus =
  /** Nothing waits (or everything just went). */
  | 'done'
  /** Results wait: the server could not take them now; a retry is scheduled. */
  | 'offline'
  /** A retry is already scheduled: this trigger sent nothing. */
  | 'waiting'
  /** Nobody signed in, or no account: the results stay for that player. */
  | 'signedOut'
  /** More than one flush's worth: the rest goes next. */
  | 'more';

export interface SyncOutcome {
  status: SyncStatus;
  /** Results the server took in this flush (duplicates included). */
  sent: number;
  /** Results it refused for good. */
  dropped: number;
  /** Results still waiting for this player. */
  pending: number;
}

export const DEFAULT_SYNC_BATCHES = 10;
/** The pause before the next flush when one flush could not send everything. */
export const FOLLOW_UP_MS = 1_000;

const SIGNED_OUT_CODES = new Set(['signedOut', 'notRegistered']);
const MALFORMED_CODES = new Set(['badRequest', 'tooLarge']);

export class PracticeSync {
  private inFlight: Promise<SyncOutcome> | null = null;
  private again = false;
  private failures = 0;
  private timer: unknown = null;
  private lastOwner: string | null = null;

  constructor(private readonly deps: PracticeSyncDeps) {}

  /**
   * A finished practice: queued for the signed-in player, then sent if it can be. Nobody signed in: nothing is
   * queued (registration comes first, D24), and false.
   */
  async enqueue(result: PracticeResult): Promise<boolean> {
    const owner = this.deps.owner();
    if (!owner) return false;
    const added = await this.deps.queue.add(owner, result);
    void this.flush();
    return added;
  }

  /** True while a retry is scheduled (the backoff, or a Retry-After). */
  get waiting(): boolean {
    return this.timer !== null;
  }

  /** Sends what waits, unless a retry is already scheduled. Never throws. */
  flush(): Promise<SyncOutcome> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const owner = this.deps.owner();
    // Another player signed in: the last one's backoff is not theirs.
    if (owner !== this.lastOwner) {
      this.lastOwner = owner;
      this.cancelTimer();
      this.failures = 0;
    }
    if (this.timer !== null) return this.counted(owner, 'waiting', 0, 0);
    const run = this.run(owner)
      .catch((error: unknown) => {
        this.deps.log?.('flush failed', error);
        return this.counted(owner, 'offline', 0, 0);
      })
      .finally(() => {
        this.inFlight = null;
        if (this.again) {
          this.again = false;
          void this.flush();
        }
      });
    this.inFlight = run;
    return run;
  }

  /** Stops the scheduled retry (sign-out, tests). */
  stop(): void {
    this.cancelTimer();
    this.failures = 0;
  }

  // -----------------------------------------------------------------------------------------------------

  private async run(owner: string | null): Promise<SyncOutcome> {
    const api = owner ? this.deps.api() : null;
    if (!owner || !api) return this.counted(owner, 'signedOut', 0, 0);
    const { queue } = this.deps;
    const limit = this.deps.maxBatchesPerFlush ?? DEFAULT_SYNC_BATCHES;
    let sent = 0;
    let dropped = 0;
    // After a malformed batch: one at a time, to find the result at fault.
    let single = false;
    for (let request = 0; request < limit; request++) {
      const batch = await queue.pending(owner, single ? 1 : MAX_PRACTICE_RESULTS);
      if (batch.length === 0) return this.counted(owner, 'done', sent, dropped);
      try {
        const answer = await api.sendPracticeResults(batch);
        await queue.remove(
          owner,
          batch.map((r) => r.id),
        );
        sent += batch.length;
        this.failures = 0;
        this.deps.onProgress?.(owner, answer.progress);
      } catch (error) {
        const code = isProgressApiError(error) ? error.code : 'unexpected';
        if (MALFORMED_CODES.has(code)) {
          if (batch.length > 1) {
            single = true;
            continue;
          }
          this.deps.log?.(`practice result ${batch[0]!.id} refused (${code}); dropped`);
          await queue.remove(owner, [batch[0]!.id]);
          dropped += 1;
          continue;
        }
        if (SIGNED_OUT_CODES.has(code)) return this.counted(owner, 'signedOut', sent, dropped);
        this.failures += 1;
        const asked = isProgressApiError(error) && code === 'tooManyRequests' ? error.retryAfterMs : null;
        const wait =
          asked !== null
            ? Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, asked))
            : backoffDelay(this.failures, this.deps.random, this.deps.backoff ?? DEFAULT_BACKOFF);
        this.deps.log?.(`practice results kept (${code}); next try in ${wait} ms`);
        this.schedule(wait);
        return this.counted(owner, 'offline', sent, dropped);
      }
    }
    const outcome = await this.counted(owner, 'more', sent, dropped);
    if (outcome.pending === 0) return { ...outcome, status: 'done' };
    this.schedule(FOLLOW_UP_MS);
    return outcome;
  }

  private async counted(
    owner: string | null,
    status: SyncStatus,
    sent: number,
    dropped: number,
  ): Promise<SyncOutcome> {
    let pending = 0;
    if (owner) {
      pending = await this.deps.queue.size(owner).catch(() => 0);
      this.deps.onPending?.(owner, pending);
    }
    return { status, sent, dropped, pending };
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.deps.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
