import type { HostAction, HostUpdate } from '../game/host';
import type { PlayerId, RejectReason } from '../game/types';
import type { GameView } from '../game/view';
import type { Clock } from '../util/clock';
import type { Scheduler } from '../util/scheduler';

/**
 * What the two local level hosts share (levels-content.md §5.4): LocalFindHost (the tap kinds) and
 * LocalPuzzleHost (the puzzle) each drive a small pure machine behind the GameHost interface, with one
 * scheduler timer (the machine's next deadline), an outbox that delivers updates in order, one at a time, a
 * listener's error rethrown once everyone was served, and the phone's own freeze [D65].
 *
 * Each host keeps its own GameHost methods (what it refuses, what it sends) and hands the machinery to one of
 * these: `send` for the local player's moves (a refusal reported as the screen's action), `refuse` for a move
 * the level never takes (at once, the log untouched), `dispatch` for the host's own actions (start, pause,
 * resume).
 */

/** A level engine as the host drives it: pure functions of its state, the clock's time passed in. */
export interface LevelMachine<S, A, E> {
  apply(state: S, action: A, now: number): { state: S; events: E[]; rejected?: RejectReason };
  tick(state: S, now: number): { state: S; events: E[] };
  nextDeadline(state: S): number | null;
  view(state: S, viewer: PlayerId, now: number): GameView;
  /** The 'events' update that carries these events to the screens (levelEvents, puzzleEvents). */
  update(events: E[], view: GameView): Extract<HostUpdate, { kind: 'events' }>;
  /** Whether the level runs (pause() freezes only then), and whether it is frozen (resume() only then). */
  running(state: S): boolean;
  paused(state: S): boolean;
  /** The machine's own freeze and thaw actions [D65]. */
  readonly pauseAction: A;
  readonly resumeAction: A;
}

export interface LocalLevelHostOptions {
  playerId: PlayerId;
  clock: Clock;
  scheduler: Scheduler;
}

export class LocalLevelHost<S, A, E> {
  readonly playerId: PlayerId;
  private current: S;
  private readonly log: E[];
  private readonly listeners = new Set<(update: HostUpdate) => void>();
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private timer: unknown = null;
  private closed = false;
  /** Updates waiting to be delivered; a listener that acts while being notified must not jump the queue. */
  private readonly outbox: HostUpdate[] = [];
  private delivering = false;
  /** The first error a listener threw; rethrown once every listener got every update. */
  private listenerError: { error: unknown } | null = null;

  constructor(
    private readonly machine: LevelMachine<S, A, E>,
    first: { state: S; events: E[] },
    options: LocalLevelHostOptions,
  ) {
    this.playerId = options.playerId;
    this.clock = options.clock;
    this.scheduler = options.scheduler;
    this.current = first.state;
    this.log = [...first.events];
    this.schedule();
  }

  /** The full event log. */
  get events(): readonly E[] {
    return this.log;
  }

  get state(): S {
    return this.current;
  }

  getView(): GameView {
    return this.machine.view(this.current, this.playerId, this.clock.now());
  }

  /** Returns the unsubscribe function. */
  subscribe(onEvent: (update: HostUpdate) => void): () => void {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  /** Any action of the machine: the host's own (start, pause, resume) or a player's. */
  dispatch(action: A): { state: S; events: E[]; rejected?: RejectReason } {
    const result = this.apply(action);
    this.rethrow();
    return result;
  }

  /** The local player's action; a refusal is reported as the screen's action (`asked`). */
  send(asked: HostAction, action: A): void {
    const result = this.apply(action);
    if (result.rejected)
      this.enqueue({ kind: 'rejected', action: asked, reason: result.rejected, view: this.getView() });
    this.rethrow();
  }

  /** An action this level never takes: refused at once, the log untouched. */
  refuse(action: HostAction, reason: RejectReason): void {
    if (this.closed) throw new Error('The game host is closed');
    this.enqueue({ kind: 'rejected', action, reason, view: this.getView() });
    this.rethrow();
  }

  /** [D65] Freeze a running level; else nothing (again while frozen, before the start, after the end). */
  pause(): void {
    if (this.closed || !this.machine.running(this.current)) return;
    this.dispatch(this.machine.pauseAction);
  }

  /** [D65] Go on from where it froze, every deadline moved on by the freeze; only while frozen, else nothing. */
  resume(): void {
    if (this.closed || !this.machine.paused(this.current)) return;
    this.dispatch(this.machine.resumeAction);
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
    this.outbox.length = 0;
  }

  private apply(action: A): { state: S; events: E[]; rejected?: RejectReason } {
    if (this.closed) throw new Error('The game host is closed');
    const result = this.machine.apply(this.current, action, this.clock.now());
    this.commit(result.state, result.events);
    return result;
  }

  /** A listener's error surfaces to whoever triggered the update, once everyone was served. */
  private rethrow(): void {
    if (this.delivering || !this.listenerError) return;
    const { error } = this.listenerError;
    this.listenerError = null;
    throw error;
  }

  private commit(state: S, events: E[]): void {
    this.current = state;
    if (events.length) this.log.push(...events);
    // Re-arm the clock before anyone hears about it, so a listener that throws can't stop the level.
    this.schedule();
    if (events.length) this.enqueue(this.machine.update(events, this.getView()));
  }

  private schedule(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    const at = this.machine.nextDeadline(this.current);
    if (at === null || this.closed) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      if (this.closed) return;
      const { state, events } = this.machine.tick(this.current, this.clock.now());
      this.commit(state, events);
      this.rethrow();
    }, at - this.clock.now());
  }

  /** Delivers updates in order, one at a time, to every listener; stops as soon as the host is closed. */
  private enqueue(update: HostUpdate): void {
    this.outbox.push(update);
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (this.outbox.length && !this.closed) {
        const next = this.outbox.shift()!;
        for (const listener of [...this.listeners]) {
          if (this.closed) break;
          try {
            listener(next);
          } catch (error) {
            // One broken listener must not cost the others this update or the ones queued behind it.
            this.listenerError ??= { error };
          }
        }
      }
    } finally {
      this.delivering = false;
    }
  }
}
