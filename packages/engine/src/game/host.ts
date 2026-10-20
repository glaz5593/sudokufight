import type { LevelEvent, PuzzleEvent } from '../levels/spec';
import type { CellIndex, Digit } from '../sudoku/board';
import type { Clock } from '../util/clock';
import type { Rng } from '../util/random';
import type { Scheduler } from '../util/scheduler';
import { type ActionResult, applyAction, createGame, nextDeadline, tick } from './engine';
import type { InterferenceKind } from './rules';
import type { Action, GameConfig, GameEvent, GameState, PlayerAction, PlayerId, RejectReason } from './types';
import { type GameView, toPublicEvent, toView } from './view';

/**
 * LocalGameHost runs the engine on the phone (practice, bots, offline) behind the GameHost interface that
 * packages/protocol defines for the screens (spec §17.2). RemoteGameHost (stage 7) implements the same
 * interface against the server, so the screens can't tell them apart.
 *
 * The engine can't import packages/protocol (protocol builds on the engine), so the shapes the interface
 * uses live here and protocol re-exports them; protocol also checks at compile time that LocalGameHost
 * satisfies GameHost.
 */

type WithoutPlayer<A> = A extends unknown ? Omit<A, 'playerId'> : never;
/** An action of the local player; the host adds who it is. */
export type ClientAction = WithoutPlayer<PlayerAction>;

/**
 * A tap on a cell: the only move of the tap levels (find, findDuel, spotError), which LocalFindHost plays. Not
 * an action of the game engine and not a wire action: it is never sent, and every other host refuses it at
 * once ('badAction'), as the screens of other games never send it.
 */
export type TapAction = { type: 'tap'; cell: CellIndex };
/**
 * A swap of two boxes (places 0–8, row-major, LTR): the only move of the puzzle (1.0.3), which LocalPuzzleHost
 * plays. Like a tap: not a game-engine or wire action, refused at once ('badAction') by every other host.
 */
export type SwapBoxesAction = { type: 'swapBoxes'; from: number; to: number };
/** Whatever a screen can ask a host for. */
export type HostAction = ClientAction | TapAction | SwapBoxesAction;

export type HostUpdate =
  /**
   * Something happened; `view` is the picture after it. Events never carry the solution. A tap level's host
   * (LocalFindHost) has events of its own instead (`levelEvents`, `events` empty), and so has the puzzle's
   * (LocalPuzzleHost: `puzzleEvents`, `events` empty).
   */
  | {
      kind: 'events';
      events: GameEvent[];
      view: GameView;
      levelEvents?: LevelEvent[];
      puzzleEvents?: PuzzleEvent[];
    }
  /** The local player's action was refused (e.g. "taken": a short buzz, no penalty). */
  | { kind: 'rejected'; action: HostAction; reason: RejectReason; view: GameView };

export interface LocalGameHostOptions {
  config: GameConfig;
  /** The player on this phone. */
  playerId: PlayerId;
  clock: Clock;
  scheduler: Scheduler;
  /** Draws the game's seed when the config has none. */
  rng?: Rng;
  /** Start right away (default). Set false to start with dispatch({ type: 'start' }) after a countdown. */
  autoStart?: boolean;
}

export class LocalGameHost {
  readonly playerId: PlayerId;
  private current: GameState;
  private readonly log: GameEvent[];
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

  constructor({ config, playerId, clock, scheduler, rng, autoStart = true }: LocalGameHostOptions) {
    if (!config.players.some((p) => p.id === playerId))
      throw new RangeError(`${playerId} is not in the game`);
    this.playerId = playerId;
    this.clock = clock;
    this.scheduler = scheduler;
    const { state, events } = createGame(config, { clock, rng });
    this.current = state;
    this.log = [...events];
    if (autoStart) this.dispatch({ type: 'start' });
  }

  /** The full event log, solution included: what a local save keeps for the replay [D25]. */
  get events(): readonly GameEvent[] {
    return this.log;
  }

  get state(): GameState {
    return this.current;
  }

  // -- GameHost ------------------------------------------------------------------------------------------

  getView(): GameView {
    return toView(this.current, this.playerId, this.clock.now());
  }

  /** Returns the unsubscribe function. */
  subscribe(onEvent: (update: HostUpdate) => void): () => void {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  select(cell: CellIndex): void {
    this.send({ type: 'select', cell });
  }

  release(): void {
    this.send({ type: 'release' });
  }

  place(cell: CellIndex, digit: Digit): void {
    this.send({ type: 'place', cell, digit });
  }

  interfere(targetId: PlayerId, kind: InterferenceKind): void {
    this.send({ type: 'interfere', targetId, kind });
  }

  react(emoji: string): void {
    this.send({ type: 'react', emoji });
  }

  surrender(): void {
    this.send({ type: 'surrender' });
  }

  /** Not a move of this game (the tap levels have their own host): refused here, the log untouched. */
  tap(cell: CellIndex): void {
    this.refuseLocally({ type: 'tap', cell });
  }

  /** Not a move of this game (the puzzle has its own host): refused here, the log untouched. */
  swapBoxes(from: number, to: number): void {
    this.refuseLocally({ type: 'swapBoxes', from, to });
  }

  /**
   * [D65] The app left the foreground mid-level: the game freezes (gamePaused 'background'). Nothing runs out
   * meanwhile, and every move is refused 'paused'. Only a running game; again while frozen: nothing.
   */
  pause(): void {
    if (this.closed || this.current.status !== 'running') return;
    this.dispatch({ type: 'pause' });
  }

  /**
   * [D65] Back, after the 3, 2, 1 over the covered board: the game goes on from where it froze, every deadline
   * (the time limit, locks, waits) moved on by the freeze. Only a freeze of this host's own; else nothing.
   */
  resume(): void {
    if (this.closed || this.current.pausedBy !== 'background') return;
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

  /** Any action of the local player. */
  send(action: ClientAction): void {
    const result = this.apply({ ...action, playerId: this.playerId });
    if (result.rejected)
      this.enqueue({ kind: 'rejected', action, reason: result.rejected, view: this.getView() });
    this.rethrow();
  }

  /** Any action: of a bot, or of the host itself (start, disconnect, reconnect). */
  dispatch(action: Action): ActionResult {
    const result = this.apply(action);
    this.rethrow();
    return result;
  }

  /** A move of another host (a tap, a swap): one 'badAction' refusal, nothing applied. */
  private refuseLocally(action: TapAction | SwapBoxesAction): void {
    if (this.closed) throw new Error('The game host is closed');
    this.enqueue({ kind: 'rejected', action, reason: 'badAction', view: this.getView() });
    this.rethrow();
  }

  private apply(action: Action): ActionResult {
    if (this.closed) throw new Error('The game host is closed');
    const result = applyAction(this.current, action, this.clock.now());
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

  private commit(state: GameState, events: GameEvent[]): void {
    this.current = state;
    if (events.length) this.log.push(...events);
    // Re-arm the clock before anyone hears about it, so a listener that throws can't stop the game.
    this.schedule();
    if (events.length)
      this.enqueue({ kind: 'events', events: events.map(toPublicEvent), view: this.getView() });
  }

  private schedule(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    const at = nextDeadline(this.current);
    if (at === null || this.closed) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      if (this.closed) return;
      const { state, events } = tick(this.current, this.clock.now());
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
