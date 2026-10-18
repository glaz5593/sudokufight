import {
  type Action,
  type ActionResult,
  applyAction,
  type ClientAction,
  type Clock,
  createGame,
  type GameConfig,
  type GameEvent,
  type GameState,
  nextDeadline,
  type PlayerId,
  publicState,
  type Rng,
  type Scheduler,
  tick,
} from '@sudoku-fight/engine';

/**
 * One game on the server (spec §6, §16.2, §18, §21): the engine driven by the server's clock, for N remote
 * players. Like the engine's LocalGameHost, but nobody here is "the local player": every action names its
 * player, and the updates go to a room that sends them to everyone.
 *
 * - Time: every action is applied at clock.now() (the server is authoritative); one timer, re-armed after
 *   every change at the engine's nextDeadline(), runs tick() for locks, interferences, the soft phase of a lost
 *   connection [D42] and grace periods. A frozen two-player game (gamePaused) has only soft-phase and grace
 *   deadlines, so the lock timers stop with it.
 * - Updates: onUpdate gets the engine's own events (with the solution in gameCreated: make them public with
 *   toPublicEvent before they leave the server) and the state after them, in order, one at a time, even when
 *   the receiver acts while being told.
 * - Nothing here touches the network, so tests drive it with a ManualClock and a ManualScheduler.
 */

export interface ServerGameUpdate {
  /** The engine's events, as they are (the room makes them public). */
  events: GameEvent[];
  state: GameState;
}

export interface ServerGameOptions {
  config: GameConfig;
  clock: Clock;
  scheduler: Scheduler;
  /** Draws the game's seed when the config has none. */
  rng?: Rng;
  onUpdate: (update: ServerGameUpdate) => void;
  /** A receiver or a timer failed; the game goes on (default console.error). */
  onError?: (error: unknown) => void;
}

export class ServerGame {
  private current: GameState;
  private readonly log: GameEvent[];
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly onUpdate: (update: ServerGameUpdate) => void;
  private readonly onError: (error: unknown) => void;
  private timer: unknown = null;
  private closed = false;
  private readonly outbox: ServerGameUpdate[] = [];
  private delivering = false;

  constructor({ config, clock, scheduler, rng, onUpdate, onError }: ServerGameOptions) {
    this.clock = clock;
    this.scheduler = scheduler;
    this.onUpdate = onUpdate;
    this.onError = onError ?? ((error) => console.error('[game] error', error));
    const { state, events } = createGame(config, { clock, rng });
    this.current = state;
    this.log = [...events];
  }

  get state(): GameState {
    return this.current;
  }

  /** Every event so far, solution included: what stage 9 stores for the replay. */
  get events(): readonly GameEvent[] {
    return this.log;
  }

  get isOver(): boolean {
    return this.current.status === 'over';
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** The state a client may hold: no solution while the game runs (spec §21). */
  publicState(): GameState {
    return publicState(this.current);
  }

  /** The solution, for the replay once the game is over. */
  get solution(): string {
    return this.current.config.puzzle.solution;
  }

  start(): ActionResult {
    return this.apply({ type: 'start' });
  }

  /** A player's action, at the server's time. `rejected` says why it was refused; nothing else changes then. */
  act(playerId: PlayerId, action: ClientAction): ActionResult {
    return this.apply({ ...action, playerId });
  }

  /**
   * The player is away (spec §16.2). `soft`: the connection dropped (no goodbye), so the soft phase starts
   * when the rules have one [D42]: he is only marked, and the grace [D4] follows at its end. Without it (a
   * deliberate leave, the default) the grace starts now; a deliberate leave in the soft phase hardens it.
   */
  disconnect(playerId: PlayerId, { soft = false }: { soft?: boolean } = {}): ActionResult {
    return this.apply({ type: 'disconnect', playerId, soft });
  }

  reconnect(playerId: PlayerId): ActionResult {
    return this.apply({ type: 'reconnect', playerId });
  }

  /** Stops the timer and the updates. */
  close(): void {
    this.closed = true;
    this.clearTimer();
    this.outbox.length = 0;
  }

  private apply(action: Action): ActionResult {
    if (this.closed) throw new Error('The game is closed');
    const result = applyAction(this.current, action, this.clock.now());
    this.commit(result.state, result.events);
    return result;
  }

  private commit(state: GameState, events: GameEvent[]): void {
    this.current = state;
    if (events.length) this.log.push(...events);
    // Re-arm first: a receiver that throws must not stop the game's clock.
    this.schedule();
    if (events.length) this.enqueue({ events, state });
  }

  private clearTimer(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    const at = nextDeadline(this.current);
    if (at === null || this.closed) return;
    this.timer = this.scheduler.setTimeout(
      () => {
        this.timer = null;
        if (this.closed) return;
        try {
          const { state, events } = tick(this.current, this.clock.now());
          // A timer that fires a little early finds nothing due yet: commit() re-arms it.
          this.commit(state, events);
        } catch (error) {
          this.onError(error);
        }
      },
      Math.max(0, at - this.clock.now()),
    );
  }

  /** Delivers updates in order, one at a time; a receiver that acts while being told can't jump the queue. */
  private enqueue(update: ServerGameUpdate): void {
    this.outbox.push(update);
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (this.outbox.length && !this.closed) {
        const next = this.outbox.shift()!;
        try {
          this.onUpdate(next);
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.delivering = false;
    }
  }
}
