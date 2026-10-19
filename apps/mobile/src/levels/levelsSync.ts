import {
  type LevelBest,
  type LevelsSyncResponse,
  MAX_LEVELS_PER_REQUEST,
  type MyProgress,
} from '@sudoku-fight/protocol';

import { isProgressApiError, type ProgressApi } from '../api/progressApi';
import {
  type BackoffPolicy,
  backoffDelay,
  DEFAULT_BACKOFF,
  MAX_RETRY_AFTER_MS,
  MIN_RETRY_AFTER_MS,
  type Timers,
} from '../services/telemetry/sender';
import { LEVELS_DATA, type LevelsDataSettings } from './levelsConfig';
import type { LevelsRepo } from './levelsRepo';

/**
 * The levels' bests to the account and back (1.0.2; plan §5.4; dev-plan §2ו) [D57]: `GET` and
 * `PUT /v1/me/levels` for whoever is signed in now. The server keeps the max of each level and pays the level
 * XP itself; the phone only sends what it has. The triggers are the app's (sign-in and app start, a level's
 * end, the foreground); this decides what each answer means:
 *
 * - LEVELS_DATA.sync off: nothing is sent, nothing is asked.
 * - The first flush of each player in a run: GET first, merged into levels.db (the max of each: a new phone
 *   gets everything back, and two phones end with the best of both). Then the rows the server lacks go, in
 *   PUTs of at most MAX_LEVELS_PER_REQUEST; each answer is merged too, and its progress is the new one.
 * - Level XP the server still owes (the daily cap, owedXp in every answer): the first flush of each UTC day
 *   sends a PUT even with nothing to send, an empty one, so the rest is paid.
 * - A server without the route (404 notFound, before 1.0.2): 'unsupported'. The rows stay to be sent, and the
 *   phone asks again on the next app start, or once LEVELS_DATA.unsupportedRetryMs has passed: no retry loop.
 *   Levels the server lists as `unknown` (a newer app than the server) wait the same way.
 * - 400 / 413: the batch is split in halves to find the row at fault; a row refused alone is marked (not sent
 *   again until it changes) and reported (`onRejected`).
 * - 429: keep them, and wait the Retry-After. No connection, a timeout, 5xx, an answer the app can't read:
 *   keep them, and back off (5 s, 10 s, 20 s… up to 5 minutes, with jitter).
 * - Signed out, or no account: keep them for when that player is back; no retry until a trigger. Another
 *   player signed in: the last one's backoff is not theirs.
 * - A flush belongs to the player it started with: its API is that player's (deps.api(owner): their token only),
 *   and once someone else is signed in (a shared phone, mid-request) it stops ('signedOut') before its next
 *   request and without using the answer that came back. One account's bests never go to another's, and never
 *   land in another's rows of levels.db; that player's rows stay to be sent (the server keeps the max).
 *
 * Pure: the database, the API, the clock, the timers and the randomness come in, so tests drive it with a fake
 * fetch and the server's contract test with the real server.
 */

export interface LevelsSyncDeps {
  /** levels.db, opened on first need (after a GET with levels to merge, or with rows to send). */
  repo: () => Promise<LevelsRepo>;
  /** Who is signed in now (the Firebase uid); null when nobody is. */
  owner: () => string | null;
  /**
   * The progress API of `owner` (the flush's player): its requests carry only that player's token (none, so
   * 'signedOut', once another player is signed in). Null when nobody is signed in.
   */
  api: (owner: string) => ProgressApi | null;
  /** Wall-clock ms: the UTC day of the owed XP, and the wait after 'unsupported'. */
  now: () => number;
  timers: Timers;
  /** In [0, 1): the backoff's jitter. */
  random: () => number;
  backoff?: BackoffPolicy;
  /** Read at every flush: LEVELS_DATA by default. */
  settings?: LevelsDataSettings;
  /** A PUT's answer: my XP and level after it. */
  onProgress?: (owner: string, progress: MyProgress) => void;
  /** The server's levels changed rows on the phone (a restore, the other phone's bests). */
  onMerged?: (owner: string) => void;
  /** The server refused these levels, each alone (400). */
  onRejected?: (owner: string, levels: readonly LevelBest[]) => void;
  /** Requests per flush; more waiting after them goes on after FOLLOW_UP_MS. */
  maxRequestsPerFlush?: number;
  log?: (message: string, detail?: unknown) => void;
}

export type LevelsSyncStatus =
  /** Nothing waits (or everything just went). */
  | 'done'
  /** LEVELS_DATA.sync is off: nothing was sent. */
  | 'disabled'
  /** The server could not take them now; a retry is scheduled. */
  | 'offline'
  /** A retry is already scheduled: this trigger sent nothing. */
  | 'waiting'
  /** Nobody signed in, or no account: the rows stay for that player. */
  | 'signedOut'
  /** The server has no levels' route, or does not know some levels: they stay, and it is asked again later. */
  | 'unsupported'
  /** levels.db could not be opened: nothing could be read or merged. */
  | 'unavailable'
  /** More than one flush's worth: the rest goes next. */
  | 'more';

export interface LevelsSyncOutcome {
  status: LevelsSyncStatus;
  /** Levels the server took in this flush. */
  sent: number;
  /** Levels it refused alone (marked, not sent again as they are). */
  rejected: number;
  /** Level XP the server paid in this flush. */
  xp: number;
}

export const DEFAULT_LEVEL_SYNC_REQUESTS = 10;
/** The pause before the next flush when one flush could not send everything. */
export const LEVELS_FOLLOW_UP_MS = 1_000;

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (t: number): number => Math.floor(t / DAY_MS);
const rowKey = (l: LevelBest): string => `${l.id}:${l.stars}:${l.plays}`;

const SIGNED_OUT_CODES = new Set(['signedOut', 'notRegistered']);
const MALFORMED_CODES = new Set(['badRequest', 'tooLarge']);

/** Ends a flush, with how it ended. */
class Stop extends Error {
  constructor(readonly status: LevelsSyncStatus) {
    super(status);
  }
}

/** A batch the server refused as malformed (400 / 413). */
class Refused extends Error {}

export class LevelsSync {
  private inFlight: Promise<LevelsSyncOutcome> | null = null;
  private again = false;
  private failures = 0;
  private timer: unknown = null;
  private lastOwner: string | null = null;
  /** Owners whose server levels were merged in this run. */
  private readonly restored = new Set<string>();
  /** The level XP the server owes each owner (its last answer). */
  private readonly owed = new Map<string, number>();
  /** The UTC day each owner's last PUT went (it collects what is owed). */
  private readonly collectedOn = new Map<string, number>();
  /** Levels the server said it does not know, per owner: held back until then. */
  private readonly unknown = new Map<string, Map<string, number>>();
  /** The halves of refused batches still to send, per owner (level ids), the next one first. */
  private readonly splits = new Map<string, string[][]>();
  /** A server without the levels' route: asked again from then. */
  private unsupportedUntil = 0;

  constructor(private readonly deps: LevelsSyncDeps) {}

  /** True while a retry is scheduled (the backoff, or a Retry-After). */
  get waiting(): boolean {
    return this.timer !== null;
  }

  /** The level XP the server said it still owes `owner` (0 before any answer). */
  owedXp(owner: string): number {
    return this.owed.get(owner) ?? 0;
  }

  /** Sends what waits, unless a retry is already scheduled. Never throws. */
  flush(): Promise<LevelsSyncOutcome> {
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
    if (this.timer !== null) return Promise.resolve(outcome('waiting'));
    const run = this.run(owner)
      .catch((error: unknown) => {
        this.deps.log?.('levels sync failed', error);
        return outcome('offline');
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

  private async run(owner: string | null): Promise<LevelsSyncOutcome> {
    const { deps } = this;
    if (!(deps.settings ?? LEVELS_DATA).sync) return outcome('disabled');
    const api = owner ? deps.api(owner) : null;
    if (!owner || !api) return outcome('signedOut');
    // Still the player this flush started with: before every request, and before any answer is used.
    const still = () => {
      if (deps.owner() !== owner) throw new Stop('signedOut');
    };
    if (deps.now() < this.unsupportedUntil) return outcome('unsupported');
    const result = outcome('done');
    const today = () => utcDay(deps.now());

    let repo: LevelsRepo | null = null;
    const open = async (): Promise<LevelsRepo> => {
      try {
        repo ??= await deps.repo();
        return repo;
      } catch (error) {
        deps.log?.('levels.db is unavailable; nothing to sync', error);
        throw new Stop('unavailable');
      }
    };

    try {
      // A new phone, or another one played meanwhile: the server's levels first.
      if (!this.restored.has(owner)) {
        still();
        const mine = await this.call(() => api.myLevels(), null);
        still();
        this.owed.set(owner, mine.owedXp);
        const changed = await (await open()).mergeFromServer(owner, mine.levels, deps.now());
        this.restored.add(owner);
        this.failures = 0;
        if (changed > 0) deps.onMerged?.(owner);
      }

      const limit = deps.maxRequestsPerFlush ?? DEFAULT_LEVEL_SYNC_REQUESTS;
      // Rows the server took in this flush, as they were: never sent twice in one flush (a server that did
      // not keep one must not make a loop of it; the next trigger tries again).
      const took = new Set<string>();
      const pendingNow = async () =>
        (await (await open()).dirty(owner)).filter(
          (l) => !this.heldBack(owner, l.id) && !took.has(rowKey(l)),
        );
      for (let request = 0; request < limit; request++) {
        const pending = await pendingNow();
        const batch = this.nextSplit(owner, pending) ?? pending.slice(0, MAX_LEVELS_PER_REQUEST);
        if (batch.length === 0 && !(this.owedXp(owner) > 0 && this.collectedOn.get(owner) !== today()))
          return { ...result, status: this.heldCount(owner) > 0 ? 'unsupported' : 'done' };
        let answer: LevelsSyncResponse;
        try {
          still();
          answer = await this.call(() => api.putMyLevels(batch), batch);
        } catch (error) {
          if (!(error instanceof Refused)) throw error;
          still();
          if (batch.length > 1) {
            // Halves, the first one next: on to the row at fault (also in the flushes after this one).
            const half = Math.ceil(batch.length / 2);
            const ids = (part: LevelBest[]) => part.map((l) => l.id);
            this.splits.set(owner, [
              ids(batch.slice(0, half)),
              ids(batch.slice(half)),
              ...(this.splits.get(owner) ?? []),
            ]);
          } else if (batch.length === 1) {
            deps.log?.(`level ${batch[0]!.id} refused by the server; not sent again as it is`);
            await (await open()).markRejected(owner, batch);
            result.rejected += 1;
            deps.onRejected?.(owner, batch);
          } else {
            // An empty PUT refused: nothing to collect today.
            this.collectedOn.set(owner, today());
          }
          continue;
        }
        still();
        this.failures = 0;
        this.collectedOn.set(owner, today());
        this.owed.set(owner, answer.owedXp);
        const unknown = new Set(answer.unknown);
        if (unknown.size > 0) this.holdBack(owner, unknown);
        const kept = batch.filter((l) => !unknown.has(l.id));
        for (const l of kept) took.add(rowKey(l));
        const db = await open();
        await db.markSynced(owner, kept);
        const changed = await db.mergeFromServer(owner, answer.levels, deps.now());
        result.sent += kept.length;
        result.xp += answer.xp;
        deps.onProgress?.(owner, answer.progress);
        if (changed > 0) deps.onMerged?.(owner);
      }
      if ((await pendingNow()).length === 0) return result;
      this.schedule(LEVELS_FOLLOW_UP_MS);
      return { ...result, status: 'more' };
    } catch (error) {
      if (error instanceof Stop) return { ...result, status: error.status };
      throw error;
    }
  }

  /**
   * One request. A refusal of `batch` (400 / 413) comes out as Refused, for the caller to split; every other
   * failure ends the flush (Stop), after setting what comes next: the wait of an old server, the backoff or
   * the Retry-After, or nothing (signed out).
   */
  private async call<T>(request: () => Promise<T>, batch: LevelBest[] | null): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const code = isProgressApiError(error) ? error.code : 'unexpected';
      const { deps } = this;
      if (batch !== null && MALFORMED_CODES.has(code)) throw new Refused();
      if (code === 'notFound') {
        // A server from before 1.0.2: no levels' route. Everything stays; asked again later, not in a loop.
        const wait = (deps.settings ?? LEVELS_DATA).unsupportedRetryMs;
        this.unsupportedUntil = deps.now() + wait;
        deps.log?.(`the server has no levels' route; asking again in ${Math.round(wait / 60_000)} min`);
        throw new Stop('unsupported');
      }
      if (SIGNED_OUT_CODES.has(code)) throw new Stop('signedOut');
      this.failures += 1;
      const asked = isProgressApiError(error) && code === 'tooManyRequests' ? error.retryAfterMs : null;
      const wait =
        asked !== null
          ? Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, asked))
          : backoffDelay(this.failures, deps.random, deps.backoff ?? DEFAULT_BACKOFF);
      // Once a streak: an offline phone is normal, not a line every few seconds.
      if (this.failures === 1) deps.log?.(`levels kept (${code}); trying again by itself`);
      this.schedule(wait);
      throw new Stop('offline');
    }
  }

  /** The next half of a refused batch whose rows still wait (as they are now); null when none is left. */
  private nextSplit(owner: string, pending: readonly LevelBest[]): LevelBest[] | null {
    const chunks = this.splits.get(owner);
    while (chunks?.length) {
      const ids = new Set(chunks.shift());
      const rows = pending.filter((l) => ids.has(l.id));
      if (rows.length > 0) return rows;
    }
    return null;
  }

  private holdBack(owner: string, ids: ReadonlySet<string>): void {
    const until = this.deps.now() + (this.deps.settings ?? LEVELS_DATA).unsupportedRetryMs;
    const held = this.unknown.get(owner) ?? new Map<string, number>();
    for (const id of ids) held.set(id, until);
    this.unknown.set(owner, held);
    this.deps.log?.(`the server does not know ${[...ids].join(', ')}; kept for a newer server`);
  }

  private heldBack(owner: string, id: string): boolean {
    const until = this.unknown.get(owner)?.get(id);
    return until !== undefined && this.deps.now() < until;
  }

  private heldCount(owner: string): number {
    let n = 0;
    for (const id of this.unknown.get(owner)?.keys() ?? []) if (this.heldBack(owner, id)) n++;
    return n;
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

const outcome = (status: LevelsSyncStatus): LevelsSyncOutcome => ({ status, sent: 0, rejected: 0, xp: 0 });
