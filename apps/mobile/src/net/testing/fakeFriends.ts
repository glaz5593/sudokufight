/* Test-only: a friends room's server (1.0.4) around one RemoteGameHost (me), for the friends tests. */
import { type ClientAction, ManualClock, ManualScheduler, type PlayerId } from '@sudoku-fight/engine';
import {
  type ClientMessage,
  FRIENDS_LOBBY_COMMAND_TYPES,
  FRIENDS_MAX_PLAYERS,
  FRIENDS_MIN_PLAYERS,
  type FriendRoomSummary,
  type FriendRoomTicket,
  type FriendsLobbyCommand,
  type FriendsRoomClosedReason,
  type LobbyPlayer,
  type MatchSeatReservation,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { RoomsApiError, type RoomsApi } from '../../api/roomsApi';
import { type FriendsProblem, onlineErrorOfFriends } from '../errors';
import type { DevRoomOptions, OnlineClient, RoomLike } from '../onlineClient';
import {
  type AppStateLike,
  type FriendsRejoin,
  RemoteGameHost,
  type RemoteHostOptions,
} from '../remoteGameHost';
import { FakeGame, FakeRoom, ME, rankedConfig, sdkError, settle } from './fakeServer';

/** The room's code, and its Colyseus roomId (a long random id: never the code). */
export const FCODE = '123456';
export const FROOM = 'Zq81kPx0aRt7';
export const DANA = 'dana';
export const AVI = 'avi';

/** React Native's AppState, driven by the test. */
export class FakeAppState implements AppStateLike {
  private readonly listeners = new Set<(state: string) => void>();
  addEventListener(_type: 'change', listener: (state: string) => void): { remove(): void } {
    this.listeners.add(listener);
    return { remove: () => void this.listeners.delete(listener) };
  }
  set(state: 'background' | 'active'): void {
    for (const l of [...this.listeners]) l(state);
  }
}

export interface FakeFriendsOptions {
  /** I am the host (default true). */
  host?: boolean;
  /** The other seats, in the order they came (after me when I host; before me when I join). */
  others?: LobbyPlayer[];
  options?: Partial<RemoteHostOptions>;
  oneWayMs?: number;
}

const DANA_SEAT: LobbyPlayer = { id: DANA, name: 'Dana', avatarId: 'av00', country: 'IL', rating: 1190 };

/**
 * A friends room on a fake server: the seats in the order they came (each `away` while its app is not
 * connected [D84a]), the host, the code and the room's random id, the seat held for the token after a drop, and
 * the way back without it (POST /v1/rooms/join: `rejoin`, the same account's own seat). The host's commands
 * are kept in `commands`; the test plays the server's answers (lobby, lobbyRefused, roomClosed, countdown, the
 * game).
 */
export class FakeFriendsTable implements OnlineClient {
  readonly clock = new ManualClock(1_000_000);
  readonly scheduler = new ManualScheduler(this.clock);
  readonly appState = new FakeAppState();
  readonly host: RemoteGameHost;
  readonly rooms: FakeRoom[] = [];
  readonly calls: { kind: 'reconnect' | 'reserved' | 'rejoin'; arg: unknown }[] = [];
  readonly logs: string[] = [];
  readonly tracked: { name: string; props: Record<string, unknown> }[] = [];
  /** The lobby commands that reached the server, in order. */
  readonly commands: FriendsLobbyCommand[] = [];
  /** The seats, in the order they came. */
  players: LobbyPlayer[];
  hostId: PlayerId;
  gameType: FriendRoomSummary['gameType'] = 'normal';
  oneWayMs: number;
  /** No network: every call fails at once. */
  offline = false;
  /** The server holds no seat for any token: only the way back by the route works. */
  refuseToken = false;
  /** The route refuses the way back with this. */
  rejoinRefusal: FriendsProblem | null = null;
  /** The room refuses a reservation with this message (e.g. "kicked: …"). */
  consumeRefusal: string | null = null;
  game: FakeGame | null = null;
  private tokenHeld = false;
  private tokens = 0;
  private reservations = 0;

  constructor(o: FakeFriendsOptions = {}) {
    this.oneWayMs = o.oneWayMs ?? 20;
    const me: LobbyPlayer = { id: ME, name: 'Moshe', avatarId: 'av00', country: 'IL', rating: 1287 };
    const others = o.others ?? [];
    const iHost = o.host ?? true;
    this.players = iHost ? [me, ...others] : [...(others.length ? others : [DANA_SEAT]), me];
    this.hostId = this.players[0]!.id;
    this.host = new RemoteGameHost({
      client: this,
      clock: this.clock,
      scheduler: this.scheduler,
      appState: this.appState,
      track: (name, props) => this.tracked.push({ name, props }),
      log: (line) => this.logs.push(line),
      options: o.options,
    });
  }

  /** The route's side of the way back (POST /v1/rooms/join): a new reservation for my own seat. */
  readonly rejoin: FriendsRejoin = (code) => {
    this.calls.push({ kind: 'rejoin', arg: code });
    if (this.offline) return Promise.reject(onlineErrorOfFriends('network'));
    if (this.rejoinRefusal) return Promise.reject(onlineErrorOfFriends(this.rejoinRefusal, 403));
    if (code !== FCODE) return Promise.reject(onlineErrorOfFriends('notFound', 404));
    return Promise.resolve(this.reservation());
  };

  /** A ticket for my seat (what POST /v1/rooms or /v1/rooms/join answers). */
  ticket(): FriendRoomTicket {
    return { reservation: this.reservation(), room: this.summary() };
  }

  summary(): FriendRoomSummary {
    return {
      code: FCODE,
      gameType: this.gameType,
      players: this.players.length,
      maxPlayers: FRIENDS_MAX_PLAYERS,
      state: this.game ? 'playing' : 'lobby',
      host: { name: 'Moshe', avatarId: 'av00', country: 'IL' },
    };
  }

  reservation(): MatchSeatReservation {
    return { name: 'friends', sessionId: `s${++this.reservations}`, roomId: FROOM };
  }

  /** The connection in use (the last one made). */
  get room(): FakeRoom {
    const room = this.rooms[this.rooms.length - 1];
    if (!room) throw new Error('No room yet');
    return room;
  }

  serverNow(): number {
    return this.clock.now();
  }

  // -- OnlineClient --------------------------------------------------------------------------------------

  create(_options: DevRoomOptions): Promise<RoomLike> {
    return Promise.reject(new Error('a friends room is never created by the app'));
  }

  join(_code: string): Promise<RoomLike> {
    return Promise.reject(new Error('a friends room is never joined by id'));
  }

  reconnect(token: string): Promise<RoomLike> {
    this.calls.push({ kind: 'reconnect', arg: token });
    if (this.offline) return Promise.reject(new TypeError('Network request failed'));
    if (this.refuseToken || !this.tokenHeld || token !== this.room.reconnectionToken)
      return Promise.reject(sdkError('reconnection token invalid or expired.', 524));
    this.tokenHeld = false;
    return Promise.resolve(this.connect(token));
  }

  consumeSeatReservation(reservation: MatchSeatReservation): Promise<RoomLike> {
    this.calls.push({ kind: 'reserved', arg: reservation });
    if (this.offline) return Promise.reject(new TypeError('Network request failed'));
    if (this.consumeRefusal) return Promise.reject(sdkError(this.consumeRefusal, 525));
    if (reservation.roomId !== FROOM)
      return Promise.reject(sdkError(`room "${reservation.roomId}" not found`, 522));
    // The same account again: its own seat (an earlier connection, if still open, is let go).
    const earlier = this.rooms.find((r) => r.open);
    if (earlier) {
      earlier.deliver({ type: 'roomClosed', reason: 'otherDevice' });
      earlier.cut(4000);
    }
    this.tokenHeld = false;
    return Promise.resolve(this.connect());
  }

  // -- the server's side ---------------------------------------------------------------------------------

  /** The lobby as the server sends it to my connection now (after the delay). */
  lobby(): void {
    this.toMe(this.lobbyMessage());
  }

  lobbyMessage(): Extract<ServerMessage, { type: 'lobby' }> {
    return {
      type: 'lobby',
      code: FCODE,
      gameType: this.gameType,
      playerCount: FRIENDS_MAX_PLAYERS,
      players: this.players.map((p) => ({ ...p })),
      playerId: ME,
      hostId: this.hostId,
      minPlayers: FRIENDS_MIN_PLAYERS,
      maxPlayers: FRIENDS_MAX_PLAYERS,
    };
  }

  /** Someone came in. */
  arrive(player: LobbyPlayer): void {
    this.players.push(player);
    this.lobby();
  }

  /** A seat's app went away, or came back [D84a]. */
  setAway(id: PlayerId, away: boolean): void {
    this.players = this.players.map((p) => (p.id === id ? { ...p, away } : p));
    this.lobby();
  }

  /** The server refuses a lobby command of mine. */
  refuse(
    command: FriendsLobbyCommand['type'],
    reason: 'notHost' | 'notEnoughPlayers' | 'playersAway',
    away?: PlayerId[],
  ): void {
    this.toMe({ type: 'lobbyRefused', command, reason, ...(away && { away }) });
  }

  /** The server puts my connection out: `roomClosed`, then it closes the socket (as a consented leave). */
  closeMe(reason: FriendsRoomClosedReason): void {
    const room = this.room;
    this.scheduler.setTimeout(() => {
      room.deliver({ type: 'roomClosed', reason });
      room.cut(4000);
    }, this.oneWayMs);
  }

  /** The host started: 3… 2… 1…, GO at `startsAt`. */
  countdown(inMs = 3000): number {
    const startsAt = this.serverNow() + inMs;
    this.toMe({ type: 'countdown', startsAt, serverTime: this.serverNow() });
    return startsAt;
  }

  /** GO: the game's snapshot, then its start. */
  startGame(): void {
    const others = this.players.filter((p) => p.id !== ME && !p.away);
    const config = rankedConfig({
      players: [{ id: ME, name: 'Moshe' }, ...others.map((p) => ({ id: p.id, name: p.name }))],
    });
    const game = new FakeGame(
      config,
      () => this.serverNow(),
      this.scheduler,
      (events) => this.toMe({ type: 'events', events }),
    );
    this.game = game;
    this.toMe({
      type: 'snapshot',
      protocol: PROTOCOL_VERSION,
      state: game.publicState(),
      playerId: ME,
      lastClientSeq: 0,
    });
    game.apply({ type: 'start' });
  }

  /** A message to my current connection, `oneWayMs` from now (none before I ever connected). */
  toMe(message: ServerMessage, room: FakeRoom | undefined = this.rooms[this.rooms.length - 1]): void {
    if (!room) return;
    this.scheduler.setTimeout(() => room.deliver(message), this.oneWayMs);
  }

  // -- helpers -------------------------------------------------------------------------------------------

  /** A new connection to my seat; the lobby follows (or the game's snapshot, once there is one). */
  private connect(token = `${FROOM}:secret${++this.tokens}`): FakeRoom {
    const room = new FakeRoom(
      FROOM,
      token,
      (r, m) => this.received(r, m),
      (r, consented) => this.closed(r, consented),
    );
    this.rooms.push(room);
    this.players = this.players.map((p) => (p.id === ME ? { ...p, away: false } : p));
    if (!this.players.some((p) => p.id === ME)) this.players.push({ id: ME, name: 'Moshe' });
    this.scheduler.setTimeout(() => {
      if (!room.open) return;
      if (this.game)
        room.deliver({
          type: 'snapshot',
          protocol: PROTOCOL_VERSION,
          state: this.game.publicState(),
          playerId: ME,
          lastClientSeq: 0,
        });
      else room.deliver(this.lobbyMessage());
    }, this.oneWayMs);
    return room;
  }

  /** A lobby command is kept; a game action goes to the game (and a refusal comes back), after the delay. */
  private received(room: FakeRoom, message: ClientMessage | FriendsLobbyCommand): void {
    if ((FRIENDS_LOBBY_COMMAND_TYPES as readonly string[]).includes(message.type)) {
      this.commands.push(message as FriendsLobbyCommand);
      return;
    }
    if (message.type === 'ping' || !('clientSeq' in message)) return;
    this.scheduler.setTimeout(() => {
      if (!this.game) return;
      const { clientSeq, ...action } = message;
      const { rejected } = this.game.act(ME, action as ClientAction);
      if (rejected) this.toMe({ type: 'rejected', clientSeq, reason: rejected }, room);
    }, this.oneWayMs);
  }

  /** My connection closed: a goodbye frees the seat; a drop holds it, shown away [D84a]. */
  private closed(room: FakeRoom, consented: boolean): void {
    if (room !== this.room) return;
    if (consented) {
      this.players = this.players.filter((p) => p.id !== ME);
      this.tokenHeld = false;
      return;
    }
    this.players = this.players.map((p) => (p.id === ME ? { ...p, away: true } : p));
    this.tokenHeld = true;
  }
}

/** Routes of our own (POST /v1/rooms, /v1/rooms/join) for net/friends.ts, answering from a table. */
export class FakeRoomsApi implements RoomsApi {
  readonly calls: { kind: 'create' | 'join'; body: unknown }[] = [];
  /** The next answers' refusal, if any. */
  refuse: RoomsApiError | null = null;

  constructor(private readonly table: FakeFriendsTable) {}

  create(request: object): Promise<FriendRoomTicket> {
    this.calls.push({ kind: 'create', body: request });
    if (this.refuse) return Promise.reject(this.refuse);
    return Promise.resolve(this.table.ticket());
  }

  join(request: { code: string }): Promise<FriendRoomTicket> {
    this.calls.push({ kind: 'join', body: request });
    if (this.refuse) return Promise.reject(this.refuse);
    if (request.code !== FCODE) return Promise.reject(new RoomsApiError('notFound', 404));
    return Promise.resolve(this.table.ticket());
  }
}

/** Moves the clock forward `ms` in steps, running timers and the promises they start (any table's clock). */
export async function elapse(table: { scheduler: ManualScheduler }, ms: number, step = 10): Promise<void> {
  await settle();
  for (let done = 0; done < ms; done += step) {
    table.scheduler.advance(Math.min(step, ms - done));
    await settle();
  }
}
