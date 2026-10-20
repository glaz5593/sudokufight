import { type Client, CloseCode, type Deferred, ErrorCode, matchMaker, ServerError } from '@colyseus/core';
import type { PlayerId } from '@sudoku-fight/engine';
import {
  FRIENDS_LOBBY_COMMAND_TYPES,
  FRIENDS_ROOM_NAME,
  type FriendsLobbyCommandType,
  type FriendsLobbyError,
  type FriendsLobbyRefused,
  friendsLobbyCommandOf,
  type FriendsRoomClosed,
  type FriendsRoomClosedReason,
  type GameRoomError,
} from '@sudoku-fight/protocol';

import type { FriendsLobby, LobbyChange, StartedGame } from '../friends/lobby';
import { FRIENDS_CLAIM_OPTION, friendsClaimIdOf } from '../friends/options';
import {
  type FriendsRoomClaims,
  type FriendsRoomLink,
  type FriendsRoomOpener,
  isFriendsSeatAuth,
} from '../friends/service';
import type { GameRoomSetup } from '../game/options';
import { RoomOptionsError } from '../game/options';
import { RateLimiter } from '../http/rateLimiter';
import type { RankedGames } from '../persistence';
import { type GameMaker, GameRoom, type GameRoomDeps, type GameRoomLobbyContent } from './GameRoom';

/**
 * A friends room (1.0.4; friends-room.md §3–§5, §7.1): the game room of a private room with a 6-digit code,
 * opened on the server by the friends service (friends/service.ts) for a POST /v1/rooms, and entered only with
 * a ticket's seat reservation (POST /v1/rooms/join). From the countdown on it is the ranked game room's game
 * (GameRoom), unrated; before it, it runs a waiting room of its own on the pure rules of friends/lobby.ts,
 * which it shares with the service:
 * - Its id is Colyseus's own random one, never the code: `joinById(code)` finds nothing, and a client can't
 *   create one or join one by id (onAuth refuses `badOptions`), so every way in passes the service's checks.
 * - The seats in the order they came; the host (the creator; then the earliest of the others [D84b]); `lobby`
 *   on every change, with each seat's avatar, flag, rating and `away`, the host and the seat counts.
 * - A lost connection holds the seat, away, for `lobbyAwayHoldMs` (6 h) [D84a]: Colyseus keeps the
 *   reconnection open ("manual") and this room lets it go when the lobby says the hold ran out. Leaving on
 *   purpose frees the seat at once.
 * - The same account with a new ticket (another device, or the app closed and opened again) takes its seat
 *   over: the earlier connection gets `roomClosed` `otherDevice` and is closed (or its held reconnection is
 *   let go). The host stays the host.
 * - The host's commands (`start`, `setGameType`, `kick`), each rate limited per player; a refusal goes back
 *   to the sender only as `lobbyRefused`. `start` [D83] counts the connected seats only and needs the host's
 *   yes for each away one (they are out of the game); then 3… 2… 1… (`countdown`) and the game at GO.
 * - `kick` [D85a]: the guest gets `roomClosed` `kicked`; a block between two seats [D85c] puts the blocked one
 *   out with `roomClosed` `removed` (never a word about the block).
 * - The service closes a lobby (its host opened another room: `closed`; the server is going down:
 *   `serverRestart`): everyone gets `roomClosed`, then the room closes.
 * - After the start the room is not locked: one of the game's players who left may come back with a new
 *   ticket, as in a ranked game; anyone else is refused `gameStarted` (by the service, and here).
 */

export interface FriendsRoomDeps {
  /** The friends service's side for the rooms: the claim of a room's setup, and the rules. */
  claims: FriendsRoomClaims;
  /** Hook 5: the game's config (a ranked-pool puzzle, nobody rated) and its record (games.mode 'friends'). */
  games: GameMaker;
}

/** A friends game's maker from the ranked games' persistence (S3: createFriendsConfig, recordFriends). */
export function friendsGameMaker(ranked: RankedGames): GameMaker {
  return {
    createConfig: (setup) => ranked.createFriendsConfig(setup),
    record: (config) => ranked.recordFriends(config),
  };
}

/** Lets a held reconnection go (its Deferred's reject): Colyseus then calls onLeave for it. */
type LetGo = (reason: Error) => void;

/** A refusal the app can act on: "<GameRoomError>: <text>". */
const refuse = (code: number, error: GameRoomError, text: string) =>
  new ServerError(code, `${error}: ${text}`);

/** The room class to register: `defineRoom(createFriendsRoom(deps, friends))`. */
export function createFriendsRoom(deps: GameRoomDeps, friends: FriendsRoomDeps) {
  return class BoundFriendsRoom extends FriendsRoom {
    protected override readonly deps = deps;
    protected override readonly friends = friends;

    /**
     * Every join or create a client makes itself is refused: a friends room is opened by the server, and
     * entered with a ticket's seat reservation (which carries its own auth, so Colyseus does not ask here) or
     * with a reconnection token.
     */
    static override onAuth(): Promise<never> {
      return Promise.reject(
        refuse(
          ErrorCode.MATCHMAKE_INVALID_CRITERIA,
          'badOptions',
          'a friends room is entered with a ticket from POST /v1/rooms or /v1/rooms/join',
        ),
      );
    }
  };
}

/**
 * Opens friends rooms with Colyseus's matchmaker (the service's FriendsRoomOpener): the room is created on the
 * server (its onCreate claims the setup by the single-use id), then a seat is reserved for each ticket with the
 * player's identity and card as its auth.
 */
export function colyseusFriendsRooms(roomName = FRIENDS_ROOM_NAME): FriendsRoomOpener {
  return {
    async open(claimId) {
      const room = await matchMaker.createRoom(roomName, { [FRIENDS_CLAIM_OPTION]: claimId });
      return room.roomId;
    },
    async reserve(roomId, auth, options) {
      const room = await matchMaker.getRoomById(roomId);
      if (!room) throw new Error(`no room ${roomId}`);
      return matchMaker.reserveSeatFor(room, options, auth);
    },
  };
}

export abstract class FriendsRoom extends GameRoom {
  protected abstract readonly friends: FriendsRoomDeps;

  private link: FriendsRoomLink | null = null;
  /** Reconnections held for away seats, by session: rejected to let a seat go. */
  private readonly holds = new Map<string, LetGo>();
  private lobbyTimer: unknown = null;
  private commands: RateLimiter | null = null;
  private stopLobbyBlocks: (() => void) | null = null;

  private get lobby(): FriendsLobby {
    return this.link!.lobby;
  }

  private get log(): string {
    return `[friends ${this.roomCode || '?'}]`;
  }

  // -- the hook points (GameRoom) ------------------------------------------------------------------------

  protected override roomSetup(options: unknown): GameRoomSetup {
    const claimId = friendsClaimIdOf(options);
    if (claimId === null)
      throw new RoomOptionsError('a friends room is opened by the server, for POST /v1/rooms');
    const link = this.friends.claims.claim(claimId, { close: (reason) => this.closeLobby(reason) });
    if (!link) throw new RoomOptionsError(`no friends room ${claimId} waiting to open`);
    this.link = link;
    const { code, gameType, rules, gameRules } = link.setup;
    return { code, gameType, playerCount: rules.maxPlayers, rules: gameRules, rated: false };
  }

  protected override roomIdIsCode(): boolean {
    return false;
  }

  protected override gameMaker(): GameMaker {
    return this.friends.games;
  }

  protected override lobbyContent(): GameRoomLobbyContent {
    const { rules } = this.link!.setup;
    const hostId = this.lobby.hostId;
    return {
      players: this.lobby.view(),
      ...(hostId === null ? {} : { hostId }),
      minPlayers: rules.minPlayers,
      maxPlayers: rules.maxPlayers,
    };
  }

  // -- lifecycle -----------------------------------------------------------------------------------------

  override async onCreate(options: unknown): Promise<void> {
    await super.onCreate(options);
    const { rules } = this.link!.setup;
    // Room for a takeover's new connection while the old one is still here; the lobby keeps the seats to 4.
    this.maxClients = rules.maxPlayers * 2;
    this.seatReservationTimeout = rules.seatReservationMs / 1000;
    this.commands = new RateLimiter({ ...rules.commandLimit, now: this.deps.now });
    for (const type of FRIENDS_LOBBY_COMMAND_TYPES)
      this.onMessage(type, (client: Client, message: unknown) => this.onCommand(client, type, message));
    this.watchLobbyBlocks();
    this.scheduleLobbyTimer();
  }

  override onJoin(client: Client, options?: unknown): void {
    if (this.gamePhase !== 'lobby') return super.onJoin(client, options);
    const auth: unknown = client.auth;
    if (!isFriendsSeatAuth(auth)) throw refuse(ErrorCode.AUTH_FAILED, 'unauthenticated', 'no ticket');
    const result = this.lobby.connect({ ...auth.member, id: auth.userId, name: auth.name });
    if (!result.ok) {
      if (result.error === 'roomFull')
        throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${this.roomId}" is full`);
      throw refuse(ErrorCode.APPLICATION_ERROR, result.error, refusalText[result.error]);
    }
    const kinds =
      typeof options === 'object' && options !== null
        ? (options as { interferenceKinds?: unknown }).interferenceKinds
        : undefined;
    if (result.takeover) {
      const earlier = this.sessionOfPlayer(auth.userId);
      this.moveSeat(auth.userId, auth.name, client.sessionId, kinds);
      if (earlier) this.dismiss(earlier, 'otherDevice');
      this.deps.log.info(`${this.log} ${auth.userId} took their seat over`);
    } else {
      this.takeSeat(auth.userId, auth.name, client.sessionId, kinds);
      this.deps.log.info(
        `${this.log} ${auth.userId} joined (${this.lobby.taken}/${this.link!.setup.rules.maxPlayers})`,
      );
    }
    this.lobbyChanged();
  }

  /** A lost connection in the lobby holds the seat, away [D84a]; after it, the game room's rules. */
  override onDrop(client: Client): void {
    if (this.gamePhase !== 'lobby') return super.onDrop(client);
    const playerId = this.playerOfSession(client.sessionId);
    if (playerId === undefined) return;
    const until = this.lobby.drop(playerId);
    if (until === null) return;
    this.markAway(playerId, true);
    // Held until the lobby lets it go (its clock, its timer): no Colyseus timeout of its own.
    const hold = this.allowReconnection(client, 'manual');
    if (typeof (hold as Partial<Deferred<Client>>).reject === 'function') {
      this.holds.set(client.sessionId, hold.reject as LetGo);
      hold.then(
        () => undefined,
        () => undefined,
      );
    }
    this.deps.log.info(`${this.log} ${playerId} is away; the seat is held`);
    this.lobbyChanged();
  }

  override onReconnect(client: Client): void {
    this.holds.delete(client.sessionId);
    super.onReconnect(client);
    if (this.gamePhase !== 'lobby') return;
    const playerId = this.playerOfSession(client.sessionId);
    if (playerId === undefined || !this.lobby.back(playerId)) return;
    this.deps.log.info(`${this.log} ${playerId} is back`);
    this.lobbyChanged();
  }

  override onLeave(client: Client, code?: number): void {
    this.holds.delete(client.sessionId);
    if (this.gamePhase !== 'lobby') return super.onLeave(client, code);
    const playerId = this.playerOfSession(client.sessionId);
    if (playerId === undefined) return;
    this.freeSeat(playerId);
    this.deps.log.info(`${this.log} ${playerId} left`);
    this.afterChange(this.lobby.leave(playerId));
  }

  /** The server is going down (an update): the lobby's connections are told first [§3.6]. */
  override onBeforeShutdown(): void {
    if (this.link !== null && this.gamePhase === 'lobby' && this.lobby.state === 'lobby') {
      this.lobby.close();
      this.tellAll('serverRestart');
      this.releaseHolds();
    }
    super.onBeforeShutdown();
  }

  override onDispose(): void {
    super.onDispose();
    this.clearLobbyTimer();
    this.stopLobbyBlocks?.();
    this.stopLobbyBlocks = null;
    this.releaseHolds();
    this.link?.closed();
  }

  // -- the host's commands -------------------------------------------------------------------------------

  private onCommand(client: Client, type: FriendsLobbyCommandType, message: unknown): void {
    const playerId = this.playerOfSession(client.sessionId);
    if (playerId === undefined) return;
    const refused = (reason: FriendsLobbyError, away?: PlayerId[]) =>
      this.tell(client, {
        type: 'lobbyRefused',
        command: type,
        reason,
        ...(away === undefined ? {} : { away }),
      } satisfies FriendsLobbyRefused);
    if (!this.commands!.take(playerId).ok) return refused('tooManyRequests');
    const command = friendsLobbyCommandOf(type, message);
    if (command === null) return refused('badCommand');
    if (this.gamePhase !== 'lobby') return refused('gameStarted');
    switch (command.type) {
      case 'setGameType': {
        const r = this.lobby.setGameType(playerId, command.gameType);
        if (!r.ok) return refused(r.error);
        this.setGameType(r.value);
        this.deps.log.info(`${this.log} game type ${r.value}`);
        return this.lobbyChanged();
      }
      case 'kick': {
        const r = this.lobby.kick(playerId, command.playerId);
        if (!r.ok) return refused(r.error);
        this.deps.log.info(`${this.log} ${command.playerId} kicked by the host`);
        this.removePlayers(r.value.gone, 'kicked');
        return this.afterChange(r.value);
      }
      case 'start': {
        const r = this.lobby.start(playerId, command.withoutAway);
        if (!r.ok) return refused(r.error, r.away);
        return this.begin(r.value);
      }
    }
  }

  /** `start`: the away seats the host agreed to leave out go; the others count down to the game. */
  private begin({ players, left }: StartedGame): void {
    this.clearLobbyTimer();
    this.stopLobbyBlocks?.();
    this.stopLobbyBlocks = null;
    // Out of the game: their held reconnections are let go (back later, they hear "gameStarted").
    this.removePlayers(left, null);
    this.keepSeats(players);
    this.deps.log.info(
      `${this.log} started by the host: ${this.lobby.gameType}, ${players.join(', ')}` +
        (left.length > 0 ? ` (without ${left.join(', ')})` : ''),
    );
    this.countDown(this.link!.setup.rules.countdownMs);
  }

  // -- the lobby -------------------------------------------------------------------------------------------

  /** `lobby` to everyone, and the timer of the next hold to run out. */
  private lobbyChanged(): void {
    this.sendLobby();
    this.scheduleLobbyTimer();
  }

  /** After seats went: the room closes when nobody is left; else everyone gets the new `lobby`. */
  private afterChange(change: LobbyChange): void {
    if (change.hostChanged && this.lobby.hostId !== null)
      this.deps.log.info(`${this.log} ${this.lobby.hostId} is the host now`);
    if (change.closed) return this.closeLobby('closed');
    this.lobbyChanged();
  }

  private scheduleLobbyTimer(): void {
    this.clearLobbyTimer();
    const at = this.lobby.nextDeadline();
    if (at === null) return;
    this.lobbyTimer = this.deps.scheduler.setTimeout(
      () => {
        this.lobbyTimer = null;
        this.onLobbyTimer();
      },
      Math.max(0, at - this.deps.now()),
    );
  }

  private clearLobbyTimer(): void {
    if (this.lobbyTimer !== null) this.deps.scheduler.clearTimeout(this.lobbyTimer);
    this.lobbyTimer = null;
  }

  /** Holds that ran out (6 h away), reservations that lapsed. */
  private onLobbyTimer(): void {
    if (this.gamePhase !== 'lobby' || this.lobby.state !== 'lobby') return;
    const change = this.lobby.expire();
    // Only a reservation that lapsed or was used (nobody's seat changed): the next deadline, nothing to tell.
    if (change.gone.length === 0 && !change.hostChanged && !change.closed) return this.scheduleLobbyTimer();
    if (change.gone.length > 0)
      this.deps.log.info(`${this.log} seat hold ran out: ${change.gone.join(', ')}`);
    if (change.closed) {
      // Everyone out at once (closeLobby tells whoever is still connected, and lets the holds go).
      for (const id of change.gone) this.freeSeat(id);
      return this.closeLobby('closed');
    }
    this.removePlayers(change.gone, 'closed');
    this.afterChange(change);
  }

  /** [D85c] A block between two of the lobby's players: the blocked one is out, told only "removed". */
  private watchLobbyBlocks(): void {
    const blocks = this.deps.blocks;
    if (blocks === undefined) return;
    this.stopLobbyBlocks = blocks.subscribe((change) => {
      if (!change.blocked || this.gamePhase !== 'lobby') return;
      const r = this.lobby.block(change.blockerId, change.blockedId);
      if (r === null) return;
      this.deps.log.info(`${this.log} ${change.blockedId} is out of the room (a block)`);
      this.removePlayers(r.gone, 'removed');
      this.afterChange(r);
    });
  }

  /** Seats out of the room: their connection is told why and closed, or their held reconnection let go. */
  private removePlayers(ids: readonly PlayerId[], reason: FriendsRoomClosedReason | null): void {
    for (const id of ids) {
      const sessionId = this.sessionOfPlayer(id);
      this.freeSeat(id);
      if (sessionId) this.dismiss(sessionId, reason);
    }
  }

  /** One connection out: `roomClosed` (when there is a reason to tell) and closed; or its hold let go. */
  private dismiss(sessionId: string, reason: FriendsRoomClosedReason | null): void {
    const hold = this.holds.get(sessionId);
    if (hold) {
      this.holds.delete(sessionId);
      hold(new Error('the seat was let go'));
      return;
    }
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;
    if (reason !== null) this.tell(client, { type: 'roomClosed', reason } satisfies FriendsRoomClosed);
    client.leave(CloseCode.CONSENTED);
  }

  /** The lobby is over (everyone left, or the service closed it): everyone out, then the room closes. */
  private closeLobby(reason: FriendsRoomClosedReason): void {
    if (this.link === null || this.gamePhase !== 'lobby') return;
    if (this.lobby.state !== 'closed') this.lobby.close();
    this.clearLobbyTimer();
    this.deps.log.info(`${this.log} closed (${reason})`);
    this.tellAll(reason);
    this.releaseHolds();
    this.disconnect(CloseCode.CONSENTED).catch((error: unknown) =>
      this.deps.log.error(`${this.log} close`, error),
    );
  }

  private tellAll(reason: FriendsRoomClosedReason): void {
    for (const client of this.clients)
      this.tell(client, { type: 'roomClosed', reason } satisfies FriendsRoomClosed);
  }

  private releaseHolds(): void {
    const holds = [...this.holds.values()];
    this.holds.clear();
    for (const letGo of holds) letGo(new Error('the room closed'));
  }

  private tell(client: Client, message: FriendsLobbyRefused | FriendsRoomClosed): void {
    client.send(message.type, message);
  }
}

const refusalText: Record<'gameStarted' | 'kicked' | 'roomClosed', string> = {
  gameStarted: 'the game in this room has started',
  kicked: 'the host removed you from this room',
  roomClosed: 'the room closed',
};
