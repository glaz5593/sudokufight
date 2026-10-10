import type { GameConfig, GameEvent, GameState, Scheduler } from '@sudoku-fight/engine';

import type { CheatThresholds } from '../config';
import type { Db } from '../db';
import {
  appendGameEvents,
  type EndOutcome,
  type GameSeat,
  type GameStartRecord,
  recordGameEnd,
  recordGameStart,
  seatsOf,
} from './records';

/**
 * Records one ranked game as it is played (spec §19, ./records): fed the game's updates in order (the
 * ServerGame's onUpdate, and first the events of its creation), it writes
 * - the games row and its players, once the game has started;
 * - the events in small batches: every `batchSize` events, or `flushMs` after the first one waiting;
 * - the end (result, ratings, flags) in one transaction, once the game is over.
 *
 * The game never waits for the database: writes run one at a time in the background, in order. A write that
 * fails is tried again (`retries` times in all, waiting `retryDelayMs`, then twice as long each time); every
 * write is idempotent, and the end writes whatever is still missing (the start, events), so a database that
 * was away for a while loses nothing as long as it is back before the last try of the end.
 */

export interface RecorderLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface RecorderTuning {
  /** Events per batch (default 50). */
  batchSize: number;
  /** The longest an event waits for its batch, ms (default 2000). */
  flushMs: number;
  /** Tries per write, the first one included (default 5). */
  retries: number;
  /** Wait before the second try, ms; doubles after each (default 500). */
  retryDelayMs: number;
}

export const RECORDER_DEFAULTS: RecorderTuning = {
  batchSize: 50,
  flushMs: 2000,
  retries: 5,
  retryDelayMs: 500,
};

export interface GameRecorderOptions extends Partial<RecorderTuning> {
  /** The database, or how to get it once it is open. */
  db: Db | (() => Db);
  config: GameConfig;
  /** Who plays each seat; default seatsOf(config): each player's id is its users.id, bots have none. */
  seats?: readonly GameSeat[];
  /** The rating key the game moves, or null. */
  ratingKey: string | null;
  cheat: CheatThresholds;
  /** Batch timers and retry waits (default Node's timers). */
  scheduler?: Scheduler;
  log: RecorderLog;
}

export type RecordOutcome =
  | { ok: true; outcome: EndOutcome }
  /** The end could not be written (`error`), or the game never ended (`unfinished`: the room went away). */
  | { ok: false; error: unknown; unfinished?: boolean };

export interface GameUpdateLike {
  events: readonly GameEvent[];
  state: GameState;
}

const nodeScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export class GameRecorder {
  /** Settles once the end is written (or could not be, or the game never ended). Never rejects. */
  readonly done: Promise<RecordOutcome>;

  private readonly o: RecorderTuning;
  private readonly db: () => Db;
  private readonly config: GameConfig;
  private readonly seats: readonly GameSeat[];
  private readonly ratingKey: string | null;
  private readonly cheat: CheatThresholds;
  private readonly scheduler: Scheduler;
  private readonly log: RecorderLog;
  private settle!: (outcome: RecordOutcome) => void;

  /** Every event so far, in seq order. */
  private readonly events: GameEvent[] = [];
  /** events[0, written) are in the database. */
  private written = 0;
  private start: GameStartRecord | null = null;
  private startWritten = false;
  private ending = false;
  private closed = false;
  private timer: unknown = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: GameRecorderOptions) {
    this.o = {
      batchSize: options.batchSize ?? RECORDER_DEFAULTS.batchSize,
      flushMs: options.flushMs ?? RECORDER_DEFAULTS.flushMs,
      retries: Math.max(1, options.retries ?? RECORDER_DEFAULTS.retries),
      retryDelayMs: options.retryDelayMs ?? RECORDER_DEFAULTS.retryDelayMs,
    };
    const { db } = options;
    this.db = typeof db === 'function' ? db : () => db;
    this.config = options.config;
    this.seats = options.seats ?? seatsOf(options.config);
    this.ratingKey = options.ratingKey;
    this.cheat = options.cheat;
    this.scheduler = options.scheduler ?? nodeScheduler;
    this.log = options.log;
    this.done = new Promise((resolve) => (this.settle = resolve));
  }

  get gameId(): string {
    return this.config.id;
  }

  /** The game's events and the state after them, in order. */
  push({ events, state }: GameUpdateLike): void {
    if (this.ending || this.closed) return;
    this.events.push(...events);
    if (this.start === null && state.startedAt !== null) {
      this.start = {
        config: this.config,
        startedAt: state.startedAt,
        seats: this.seats,
        ratingKey: this.ratingKey,
      };
      const start = this.start;
      this.enqueue('start', async () => {
        await recordGameStart(this.db(), start);
        this.startWritten = true;
      });
    }
    if (state.status === 'over') return this.end(state);
    if (this.start === null) return; // events before the start wait for the games row
    if (this.events.length - this.written >= this.o.batchSize) this.flushSoon(0);
    else this.flushSoon(this.o.flushMs);
  }

  /** Resolves when every write asked for so far has run (written, or given up on). */
  async flush(): Promise<void> {
    if (!this.ending && this.start !== null) this.writeEvents();
    await this.queue;
  }

  /**
   * The room is going away. A game that is over still gets its end written; one that is not writes the
   * events it has and settles `done` as unfinished (its games row keeps ended_at null).
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    if (this.ending) return;
    if (this.start !== null) this.writeEvents();
    void this.queue.then(() =>
      this.settle({ ok: false, error: new Error('The game did not end'), unfinished: true }),
    );
  }

  // -- writes --------------------------------------------------------------------------------------------

  private end(state: GameState): void {
    this.ending = true;
    this.clearTimer();
    const start = this.start ?? {
      config: this.config,
      startedAt: state.startedAt ?? state.endedAt ?? state.createdAt,
      seats: this.seats,
      ratingKey: this.ratingKey,
    };
    let outcome: RecordOutcome | null = null;
    this.enqueue('end', async () => {
      const result = await recordGameEnd(this.db(), {
        start,
        state,
        unwritten: this.events.slice(this.written),
        log: this.events,
        cheat: this.cheat,
      });
      this.written = this.events.length;
      outcome = { ok: true, outcome: result };
    });
    void this.queue.then(() => {
      if (outcome === null) return this.settle({ ok: false, error: new Error('The end was not written') });
      if (outcome.ok && outcome.outcome === 'recorded')
        this.log.info(`[record ${this.gameId}] stored: ${this.events.length} events`);
      this.settle(outcome);
    });
  }

  private flushSoon(ms: number): void {
    if (this.timer !== null) {
      if (ms > 0) return; // a batch is due already
      this.clearTimer();
    }
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.writeEvents();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Queues a write of every event not written yet. */
  private writeEvents(): void {
    this.clearTimer();
    this.enqueue('events', async () => {
      // Without the games row the events can't go in yet; the end writes them.
      if (!this.startWritten) return;
      const upTo = this.events.length;
      if (upTo <= this.written) return;
      await appendGameEvents(this.db(), this.gameId, this.events.slice(this.written, upTo));
      this.written = Math.max(this.written, upTo);
    });
  }

  /** Runs `write` after everything queued before it, with retries; a write that gives up is logged. */
  private enqueue(what: string, write: () => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      try {
        await this.withRetries(what, write);
      } catch (error) {
        this.log.error(`[record ${this.gameId}] ${what} not written after ${this.o.retries} tries`, error);
      }
    });
  }

  private async withRetries(what: string, write: () => Promise<void>): Promise<void> {
    let wait = this.o.retryDelayMs;
    for (let attempt = 1; ; attempt++) {
      try {
        return await write();
      } catch (error) {
        if (attempt >= this.o.retries) throw error;
        this.log.warn(
          `[record ${this.gameId}] ${what} failed (try ${attempt} of ${this.o.retries}): ${String(error)}; ` +
            `again in ${wait} ms`,
        );
        await new Promise<void>((resolve) => this.scheduler.setTimeout(resolve, wait));
        wait *= 2;
      }
    }
  }
}
