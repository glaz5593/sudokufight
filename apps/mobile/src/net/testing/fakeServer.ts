/* Test-only: the game server and the network, faked around the real engine, for RemoteGameHost's tests. */
import {
  type Action,
  applyAction,
  type ClientAction,
  createGame,
  defaultRules,
  type GameConfig,
  type GameEvent,
  type GameState,
  ManualClock,
  ManualScheduler,
  nextDeadline,
  type PlayerId,
  type PlayerInfo,
  publicState,
  type RejectReason,
  type Rules,
  tick,
  toPublicEvent,
} from '@sudoku-fight/engine';
import {
  type ClientMessage,
  type ClientMessageType,
  type MatchSeatReservation,
  PROTOCOL_VERSION,
  type ServerMessage,
  type ServerMessageType,
} from '@sudoku-fight/protocol';

import { PUZZLE } from '../../game/testing/practice';
import type { DevRoomOptions, OnlineClient, RoomLike } from '../onlineClient';
import { type AppStateLike, RemoteGameHost, type RemoteHostOptions } from '../remoteGameHost';

export const ME = 'me';
export const OPP = 'opp';
export const CODE = 'ABC234';

/** A ranked two-player game on the offline pool's first puzzle (me in seat 0). */
export function rankedConfig({
  players = [
    { id: ME, name: 'Moshe' },
    { id: OPP, name: 'Rival' },
  ],
  rules = {},
}: { players?: PlayerInfo[]; rules?: Partial<Rules> } = {}): GameConfig {
  return {
    id: 'online-1',
    mode: 'ranked',
    gameType: PUZZLE.gameType,
    puzzle: { id: PUZZLE.id, givens: PUZZLE.givens, solution: PUZZLE.solution },
    players,
    rules: defaultRules('ranked', PUZZLE.gameType, rules),
    seed: 7,
  };
}

/** The authoritative game: the engine at the server's time, with its timers. Events leave it public. */
export class FakeGame {
  state: GameState;
  /** Every public event so far. */
  readonly log: GameEvent[] = [];
  private timer: unknown = null;

  constructor(
    config: GameConfig,
    private readonly now: () => number,
    private readonly scheduler: ManualScheduler,
    /** Gets every batch of new (public) events. */
    private readonly onEvents: (events: GameEvent[]) => void = () => undefined,
  ) {
    const created = createGame(config, now());
    this.state = created.state;
    this.log.push(...created.events.map(toPublicEvent));
  }

  publicState(): GameState {
    return publicState(this.state);
  }

  /** Applies an action now; returns the public events and the refusal, if any. */
  apply(action: Action): { events: GameEvent[]; rejected: RejectReason | null } {
    const result = applyAction(this.state, action, this.now());
    return { events: this.commit(result.state, result.events), rejected: result.rejected ?? null };
  }

  act(playerId: PlayerId, action: ClientAction): { events: GameEvent[]; rejected: RejectReason | null } {
    return this.apply({ ...action, playerId } as Action);
  }

  close(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private commit(state: GameState, events: GameEvent[]): GameEvent[] {
    this.state = state;
    const out = events.map(toPublicEvent);
    this.log.push(...out);
    this.schedule();
    if (out.length) this.onEvents(out);
    return out;
  }

  private schedule(): void {
    this.close();
    const at = nextDeadline(this.state);
    if (at === null) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      const { state, events } = tick(this.state, this.now());
      this.commit(state, events);
    }, at - this.now());
  }
}

type Handler = (message: ServerMessage) => void;

/** One connection to the room, as the SDK's Room would be (RoomLike). */
export class FakeRoom implements RoomLike {
  /** Everything this connection sent, pings included. */
  readonly sent: ClientMessage[] = [];
  /** null while open; whether the leave was consented once closed. */
  left: boolean | null = null;
  closeCode: number | null = null;
  private readonly handlers = new Map<ServerMessageType, Handler>();
  private readonly leaveHandlers: ((code: number) => void)[] = [];

  constructor(
    readonly roomId: string,
    readonly reconnectionToken: string,
    private readonly onSend: (room: FakeRoom, message: ClientMessage) => void,
    private readonly onClose: (room: FakeRoom, consented: boolean) => void,
  ) {}

  get open(): boolean {
    return this.left === null;
  }

  /** The actions sent (no pings). */
  get actions(): Exclude<ClientMessage, { type: 'ping' }>[] {
    return this.sent.filter((m): m is Exclude<ClientMessage, { type: 'ping' }> => m.type !== 'ping');
  }

  get pings(): Extract<ClientMessage, { type: 'ping' }>[] {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: 'ping' }> => m.type === 'ping');
  }

  onMessage(type: ServerMessageType, callback: Handler): void {
    this.handlers.set(type, callback);
  }

  onLeave(callback: (code: number) => void): void {
    this.leaveHandlers.push(callback);
  }

  onError(): void {}

  send(type: ClientMessageType, message: ClientMessage): void {
    if (!this.open) return;
    if (type !== message.type) throw new Error(`type ${type} ≠ message.type ${message.type}`);
    this.sent.push(message);
    this.onSend(this, message);
  }

  leave(consented: boolean): Promise<number> {
    const code = consented ? 4000 : 1005;
    this.shut(code, consented);
    return Promise.resolve(code);
  }

  /** A message from the server, now. */
  deliver(message: ServerMessage): void {
    if (this.open) this.handlers.get(message.type)?.(message);
  }

  /** The connection closes from the server's side or the network's (1006: dropped; 4000: room closed). */
  cut(code = 1006): void {
    this.shut(code, false);
  }

  private shut(code: number, consented: boolean): void {
    if (!this.open) return;
    this.left = consented;
    this.closeCode = code;
    this.onClose(this, consented);
    for (const h of this.leaveHandlers) h(code);
  }
}

/** An error as the SDK throws it (MatchMakeError: a message and a code). */
export const sdkError = (message: string, code?: number | string): Error =>
  Object.assign(new Error(message), code === undefined ? {} : { code });

export interface FakeTableOptions {
  /** Server clock minus phone clock. */
  skewMs?: number;
  /** One-way network delay. */
  oneWayMs?: number;
  rules?: Partial<Rules>;
  players?: PlayerInfo[];
  /** Answer pings (default true). */
  pong?: boolean;
  /** Take actions to the game and answer them (default true). */
  answer?: boolean;
  options?: Partial<RemoteHostOptions>;
  appState?: AppStateLike | null;
}

/**
 * The server and the network around one RemoteGameHost (me) and a scripted opponent: a room with a code, the
 * engine game, a delay each way, the server's clock `skewMs` off the phone's, and the server's side of
 * reconnecting (a seat held for the token during the grace, a rejoin by code).
 */
export class FakeTable implements OnlineClient {
  readonly clock = new ManualClock(1_000_000);
  readonly scheduler = new ManualScheduler(this.clock);
  readonly host: RemoteGameHost;
  readonly tracked: { name: string; props: Record<string, unknown> }[] = [];
  readonly logs: string[] = [];
  readonly rooms: FakeRoom[] = [];
  readonly calls: { kind: 'create' | 'join' | 'reconnect' | 'reserved'; arg: unknown }[] = [];
  game: FakeGame | null = null;
  skewMs: number;
  oneWayMs: number;
  pong: boolean;
  answer: boolean;
  /** No network: every call fails at once. */
  offline = false;
  /** The room is gone (disposed). */
  disposed = false;
  /** The server has not noticed a drop yet (its socket still looks open). */
  unnoticed = false;
  /** Calls that never answer (a black hole). */
  hang = false;
  /** The server holds no seat for any token (e.g. it took the drop for a goodbye): only a rejoin works. */
  refuseToken = false;
  /** Keep the game's events here instead of sending them (the test delivers them itself). */
  hold = false;
  readonly held: GameEvent[] = [];
  /** Send the solution after gameOver (default true). */
  sendSolution = true;
  private solutionSent = false;
  /** The server's last clientSeq taken from me, per connection lifetime (reset by a rejoin). */
  lastClientSeq = 0;
  private seatHeld = false;
  private tokenCount = 0;
  private config: GameConfig;

  constructor(private readonly o: FakeTableOptions = {}) {
    this.skewMs = o.skewMs ?? 0;
    this.oneWayMs = o.oneWayMs ?? 20;
    this.pong = o.pong ?? true;
    this.answer = o.answer ?? true;
    this.config = rankedConfig({ players: o.players, rules: o.rules });
    this.host = new RemoteGameHost({
      client: this,
      clock: this.clock,
      scheduler: this.scheduler,
      appState: o.appState ?? null,
      track: (name, props) => this.tracked.push({ name, props }),
      log: (line) => this.logs.push(line),
      options: o.options,
    });
  }

  /** The server's clock. */
  serverNow(): number {
    return this.clock.now() + this.skewMs;
  }

  /** The connection in use (the last one made). */
  get room(): FakeRoom {
    const room = this.rooms[this.rooms.length - 1];
    if (!room) throw new Error('No room yet');
    return room;
  }

  // -- OnlineClient --------------------------------------------------------------------------------------

  create(options: DevRoomOptions): Promise<RoomLike> {
    this.calls.push({ kind: 'create', arg: options });
    return this.respond(() => this.newRoom());
  }

  join(code: string): Promise<RoomLike> {
    this.calls.push({ kind: 'join', arg: code });
    return this.respond(() => {
      if (code !== CODE) throw sdkError(`room "${code}" not found`, 522);
      if (!this.game) return this.newRoom();
      const me = this.game.state.players.find((p) => p.id === ME)!;
      if (me.connected || this.unnoticed) throw sdkError(`alreadyInRoom: ${ME} is connected already`, 526);
      this.lastClientSeq = 0; // a rejoin starts the count over
      const room = this.newRoom();
      this.welcomeBack(room);
      return room;
    });
  }

  /** A ranked match's room (stage 9): the seat for this reservation, in the room with the table's code. */
  consumeSeatReservation(reservation: MatchSeatReservation): Promise<RoomLike> {
    this.calls.push({ kind: 'reserved', arg: reservation });
    return this.respond(() => {
      if (reservation.roomId !== CODE) throw sdkError(`room "${reservation.roomId}" not found`, 522);
      return this.newRoom();
    });
  }

  reconnect(token: string): Promise<RoomLike> {
    this.calls.push({ kind: 'reconnect', arg: token });
    return this.respond(() => {
      if (this.refuseToken || !this.seatHeld || this.unnoticed || token !== this.room.reconnectionToken)
        throw sdkError('reconnection token invalid or expired.', 524);
      this.seatHeld = false;
      const room = this.newRoom(token);
      this.welcomeBack(room);
      return room;
    });
  }

  // -- the server's side ---------------------------------------------------------------------------------

  /** The lobby message to the current connection, after the delay. */
  lobby(players = [{ id: ME, name: 'Moshe' }]): void {
    this.toMe({
      type: 'lobby',
      code: CODE,
      gameType: this.config.gameType,
      playerCount: 2,
      players,
      playerId: ME,
    });
  }

  /** Everyone is in: the snapshot of the game as created, then the start. */
  startGame(): void {
    const game = new FakeGame(
      this.config,
      () => this.serverNow(),
      this.scheduler,
      (events) => {
        if (this.hold) this.held.push(...events);
        else this.toMe({ type: 'events', events });
        if (game.state.status !== 'over' || this.solutionSent || !this.sendSolution) return;
        this.solutionSent = true;
        this.toMe({ type: 'solution', solution: game.state.config.puzzle.solution });
      },
    );
    this.game = game;
    this.toMe(this.snapshotFor());
    game.apply({ type: 'start' });
  }

  snapshotFor(): Extract<ServerMessage, { type: 'snapshot' }> {
    return {
      type: 'snapshot',
      protocol: PROTOCOL_VERSION,
      state: this.game!.publicState(),
      playerId: ME,
      lastClientSeq: this.lastClientSeq,
    };
  }

  /** The opponent acts now (at the server). */
  opponent(action: ClientAction): RejectReason | null {
    return this.game!.act(OPP, action).rejected;
  }

  /** The server cuts my connection (or the network does): the engine's disconnect, the seat held. */
  cutMe(code = 1006): void {
    const room = this.room;
    room.cut(code);
  }

  /** A message to my current connection, `oneWayMs` from now. */
  toMe(message: ServerMessage, room = this.room): void {
    this.scheduler.setTimeout(() => room.deliver(message), this.oneWayMs);
  }

  // -- helpers -------------------------------------------------------------------------------------------

  private respond(make: () => FakeRoom): Promise<RoomLike> {
    if (this.hang) return new Promise(() => undefined);
    if (this.offline) return Promise.reject(new TypeError('Network request failed'));
    if (this.disposed) return Promise.reject(sdkError(`room "${CODE}" has been disposed.`, 522));
    try {
      return Promise.resolve(make());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private newRoom(token = `${CODE}:secret${++this.tokenCount}`): FakeRoom {
    const room = new FakeRoom(
      CODE,
      token,
      (r, m) => this.received(r, m),
      (r, consented) => this.closed(r, consented),
    );
    this.rooms.push(room);
    return room;
  }

  /** Back in the seat: a fresh snapshot, then the engine's reconnect for everyone. */
  private welcomeBack(room: FakeRoom): void {
    this.scheduler.setTimeout(() => {
      if (!room.open || !this.game) return;
      room.deliver(this.snapshotFor());
      this.game.apply({ type: 'reconnect', playerId: ME });
    }, this.oneWayMs);
  }

  /** A connection closed: the server notices (unless `unnoticed`) and holds the seat for the token. */
  private closed(room: FakeRoom, consented: boolean): void {
    if (room !== this.room || !this.game || this.game.state.status === 'over') return;
    this.heldIfDropped = !consented;
    if (this.unnoticed) return;
    this.scheduler.setTimeout(() => this.notice(), this.oneWayMs);
  }

  private heldIfDropped = false;

  /** The server notices my connection is gone: the engine's disconnect (the grace starts), the seat held. */
  notice(): void {
    this.unnoticed = false;
    this.seatHeld = this.heldIfDropped;
    if (this.game?.state.players.find((p) => p.id === ME)?.connected)
      this.game.apply({ type: 'disconnect', playerId: ME });
  }

  /** A message reaches the server `oneWayMs` after it was sent; its answer takes as long again. */
  private received(room: FakeRoom, message: ClientMessage): void {
    this.scheduler.setTimeout(() => {
      if (message.type === 'ping') {
        if (this.pong) this.toMe({ type: 'pong', t: message.t, serverTime: this.serverNow() }, room);
        return;
      }
      if (!this.answer || !this.game) return;
      if (message.clientSeq <= this.lastClientSeq) return; // a duplicate: dropped
      this.lastClientSeq = message.clientSeq;
      const { clientSeq, ...action } = message;
      const { rejected } = this.game.act(ME, action as ClientAction);
      if (rejected) this.toMe({ type: 'rejected', clientSeq, reason: rejected }, room);
    }, this.oneWayMs);
  }
}

/** Lets pending promise callbacks run. */
export async function settle(): Promise<void> {
  for (let k = 0; k < 20; k++) await Promise.resolve();
}

/** Moves the clock forward `ms` in steps, running timers and the promises they start. */
export async function elapse(table: FakeTable, ms: number, step = 10): Promise<void> {
  await settle();
  for (let done = 0; done < ms; done += step) {
    table.scheduler.advance(Math.min(step, ms - done));
    await settle();
  }
}

/** A table whose game has started: created, in the lobby, snapshot and start received, clock synced. */
export async function liveTable(o: FakeTableOptions = {}): Promise<FakeTable> {
  const table = new FakeTable(o);
  await table.host.create({ gameType: 'fast' });
  table.lobby();
  table.startGame();
  await elapse(table, 300);
  return table;
}
