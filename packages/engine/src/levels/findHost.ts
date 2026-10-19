import type { HostAction, HostUpdate } from '../game/host';
import type { InterferenceKind } from '../game/rules';
import type { PlayerId, RejectReason } from '../game/types';
import type { GameView } from '../game/view';
import type { CellIndex, Digit } from '../sudoku/board';
import type { Scheduler } from '../util/scheduler';
import {
  applyFind,
  createFind,
  type FindAction,
  type FindActionResult,
  type FindDeps,
  type FindSetup,
  type FindState,
  findView,
  nextFindDeadline,
  tickFind,
} from './find';
import type { FindLevelOver, LevelEvent } from './spec';

/**
 * LocalFindHost runs a tap level (find, findDuel, spotError) on the phone behind the same GameHost interface as
 * LocalGameHost (spec §17.2; dev-plan §1.4): the screens can't tell the two apart. Like it, it has one
 * scheduler timer (nextFindDeadline) and an outbox that delivers updates in order, one at a time.
 *
 * What a tap level can do: `tap` (the one move), `surrender` (the X: the level ends 'quit'), and the phone's own
 * freeze [D65] (`pause` / `resume`). There is nothing to select, place or send: those are refused at once
 * ('badAction', the log untouched), and so is `react` while the level allows no reactions (none by default,
 * D62; the bot still reacts). Updates carry the tap engine's events as `levelEvents` (`events` stays empty).
 */

export interface LocalFindHostOptions extends FindSetup, FindDeps {
  scheduler: Scheduler;
  /** Start right away (default). Set false to start with dispatch({ type: 'start' }) after a countdown. */
  autoStart?: boolean;
}

export class LocalFindHost {
  readonly playerId: PlayerId;
  private current: FindState;
  private readonly log: LevelEvent[];
  private readonly listeners = new Set<(update: HostUpdate) => void>();
  private readonly clock: FindDeps['clock'];
  private readonly scheduler: Scheduler;
  private timer: unknown = null;
  private closed = false;
  /** Updates waiting to be delivered; a listener that acts while being notified must not jump the queue. */
  private readonly outbox: HostUpdate[] = [];
  private delivering = false;
  /** The first error a listener threw; rethrown once every listener got every update. */
  private listenerError: { error: unknown } | null = null;

  constructor(options: LocalFindHostOptions) {
    const { scheduler, autoStart = true, ...rest } = options;
    this.playerId = rest.player.id;
    this.clock = rest.clock;
    this.scheduler = scheduler;
    const { state, events } = createFind(rest, rest);
    this.current = state;
    this.log = [...events];
    if (autoStart) this.dispatch({ type: 'start' });
  }

  /** The full event log, the bot's plan included: replayFind() rebuilds the level from it. */
  get events(): readonly LevelEvent[] {
    return this.log;
  }

  get state(): FindState {
    return this.current;
  }

  /** How the level ended (the levelOver event), for levelOutcome(); null while it runs. */
  get over(): FindLevelOver | null {
    return this.current.result;
  }

  // -- GameHost ------------------------------------------------------------------------------------------

  getView(): GameView {
    return findView(this.current, this.playerId, this.clock.now());
  }

  /** Returns the unsubscribe function. */
  subscribe(onEvent: (update: HostUpdate) => void): () => void {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  /** A tap level has no lock and no keypad: refused, the log untouched. */
  select(cell: CellIndex): void {
    this.refuse({ type: 'select', cell }, 'badAction');
  }

  release(): void {
    this.refuse({ type: 'release' }, 'badAction');
  }

  place(cell: CellIndex, digit: Digit): void {
    this.refuse({ type: 'place', cell, digit }, 'badAction');
  }

  /** No interference of any kind in a level [D49]. */
  interfere(targetId: PlayerId, kind: InterferenceKind): void {
    this.refuse({ type: 'interfere', targetId, kind }, 'badAction');
  }

  /** Refused while the level allows no reactions (none by default, D62). */
  react(emoji: string): void {
    this.send({ type: 'react', emoji }, { type: 'react', playerId: this.playerId, emoji });
  }

  /** The X, confirmed: the level ends 'quit'. Allowed while frozen too. */
  surrender(): void {
    this.send({ type: 'surrender' }, { type: 'quit', playerId: this.playerId });
  }

  tap(cell: CellIndex): void {
    this.send({ type: 'tap', cell }, { type: 'tap', playerId: this.playerId, cell });
  }

  /**
   * [D65] The app left the foreground mid-level: the level freezes (levelPaused). Nothing runs out meanwhile,
   * and taps are refused 'paused'. Only a running level; again while frozen: nothing.
   */
  pause(): void {
    if (this.closed || this.current.status !== 'running') return;
    this.dispatch({ type: 'pause' });
  }

  /**
   * [D65] Back, after the 3, 2, 1 over the covered board: the level goes on from where it froze, every deadline
   * (the limit, the 3 s freezes, the bot's plan) moved on by the freeze. Only while frozen; else nothing.
   */
  resume(): void {
    if (this.closed || this.current.status !== 'paused') return;
    this.dispatch({ type: 'resume' });
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
    this.outbox.length = 0;
  }

  // -- beyond the interface ------------------------------------------------------------------------------

  /** Any action of the tap engine: the host's own (start, pause, resume) or a player's. */
  dispatch(action: FindAction): FindActionResult {
    const result = this.apply(action);
    this.rethrow();
    return result;
  }

  /** The local player's action; a refusal is reported as the screen's action. */
  private send(asked: HostAction, action: FindAction): void {
    const result = this.apply(action);
    if (result.rejected)
      this.enqueue({ kind: 'rejected', action: asked, reason: result.rejected, view: this.getView() });
    this.rethrow();
  }

  private refuse(action: HostAction, reason: RejectReason): void {
    if (this.closed) throw new Error('The game host is closed');
    this.enqueue({ kind: 'rejected', action, reason, view: this.getView() });
    this.rethrow();
  }

  private apply(action: FindAction): FindActionResult {
    if (this.closed) throw new Error('The game host is closed');
    const result = applyFind(this.current, action, this.clock.now());
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

  private commit(state: FindState, events: LevelEvent[]): void {
    this.current = state;
    if (events.length) this.log.push(...events);
    // Re-arm the clock before anyone hears about it, so a listener that throws can't stop the level.
    this.schedule();
    if (events.length)
      this.enqueue({ kind: 'events', events: [], view: this.getView(), levelEvents: events });
  }

  private schedule(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    const at = nextFindDeadline(this.current);
    if (at === null || this.closed) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      if (this.closed) return;
      const { state, events } = tickFind(this.current, this.clock.now());
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
