import type { GameType, PlayerId } from '@sudoku-fight/engine';
import {
  type AdminFriendRoomCounts,
  type AdminFriendRoomRow,
  FRIENDS_DEFAULT_GAME_TYPE,
  type FriendRoomCreateRequest,
  type FriendRoomJoinRequest,
  type FriendRoomSummary,
  type FriendRoomTicket,
  type FriendsErrorCode,
  type FriendsField,
  type FriendsRoomClosedReason,
  type GameRoomRuleOverrides,
  type MatchSeatReservation,
  NO_AVATAR_ID,
} from '@sudoku-fight/protocol';

import type { BlockPair } from '../moderation/watch';
import { type CodeLookup, FriendCodes } from './codes';
import { FriendsLobby, type LobbyMember } from './lobby';
import { type FriendsRules, friendsRules, type FriendsRoomSetup } from './options';

/**
 * Friends rooms on the server (1.0.4; docs/handoff/2026-10-19/friends-room.md §4, §5, §7.1; the wire contract:
 * packages/protocol/src/friends.ts): one service for the whole process, like MatchmakingService. It holds
 * - the table of codes (./codes.ts: 6 digits, unique among open rooms, not reused for codeCooldownMs after a
 *   room closes; the code is never the Colyseus room's id);
 * - create and join, each ending in a seat reservation (as matchmaking/games.ts does for a ranked match);
 * - the block and suspension checks, and who was kicked from which room (each room's lobby, ./lobby.ts);
 * - what the admin site lists.
 * The rate limits of create and join [D86] are the HTTP routes' (S2, friends/router.ts: config.friends.limits),
 * in front of this service, so it never answers `tooManyRequests` itself.
 *
 * Who uses it:
 * - S2, friends/router.ts: POST /v1/rooms → create(), POST /v1/rooms/join → join(). The router checks the token,
 *   finds the live account (none: 404 notRegistered), checks the body (FRIEND_CODE_PATTERN, isGameType, the
 *   interference kinds), and turns a FriendRoomsResult into the answer: FRIENDS_ERROR_STATUS[error], a
 *   FriendsError body with `rooms: true`, and for tooManyRequests `Retry-After` and `retryAfterSec` (whole
 *   seconds, at least 1). http/index.ts takes the service as an optional HttpDeps field (absent: no /v1/rooms
 *   routes, so the app says "notAvailable"); app.ts passes it.
 * - S3, admin/rooms.ts: GET /admin/api/rooms → openRooms() and counts() (AdminFriendRooms).
 * - rooms/FriendsRoom.ts: the Colyseus room of each friends room. The service opens it on the server
 *   (FriendsRoomOpener: matchMaker.createRoom with `{ friends: <claim id> }`), and the room's onCreate claims
 *   its setup by that single-use id (claim(), as a ranked room claims its match). The room and the service
 *   share the room's lobby (FriendsLobby): the service admits accounts to it before it reserves a seat; the
 *   room connects them, holds their seats, runs the host's commands and starts the game. The room tells the
 *   service when it is gone (the code cools down), and the service tells the room to close (its host opened
 *   another room, the server is going down).
 *
 * Every seat reservation carries the player's identity and their lobby card (FriendsSeatAuth) as its auth, so
 * the room knows them without another token check or a database read; nobody gets into the room without one
 * (the room's onAuth refuses every client-made join or create).
 */

/** Who is asking: the router verified the token and found the live account. */
export interface FriendsCaller {
  /** users.id: the player's id in the game (Identity.userId). */
  userId: string;
  /** The display name the game shows (Identity.name). */
  name: string;
  /** users.suspended_at is set (spec §3.5): create and join refuse `suspended`. */
  suspended: boolean;
  /** clientKey(req.ip) (http/clientKey.ts), for the per-IP limit; 'unknown' without an address. */
  ipKey: string;
}

/**
 * The refusals the service gives. The router adds its own: unauthorized, notRegistered, disabled, tooLarge,
 * internal (and badRequest for a body it can't read).
 */
export type FriendRoomsRefusal = Extract<
  FriendsErrorCode,
  | 'badRequest'
  | 'suspended'
  | 'kicked'
  | 'cantJoin'
  | 'notFound'
  | 'roomFull'
  | 'gameStarted'
  | 'tooManyRooms'
  | 'roomClosed'
  | 'tooManyRequests'
  | 'unavailable'
>;

export type FriendRoomsResult =
  | { ok: true; ticket: FriendRoomTicket }
  | {
      ok: false;
      error: FriendRoomsRefusal;
      message?: string;
      /** badRequest: the field at fault. */
      field?: FriendsField;
      /** tooManyRequests: ms until another try may pass. */
      retryAfterMs?: number;
      /** tooManyRooms: the code of the open lobby the caller hosts. */
      code?: string;
    };

export interface FriendRooms {
  /**
   * POST /v1/rooms: opens a room with the caller as its host and a seat reserved for them (201). Refuses
   * `suspended`; `tooManyRooms` (with `code`) when the caller hosts an open lobby and `replace` is not true
   * (with it, that lobby closes first: its others get `roomClosed` `closed`); `unavailable` when no code is
   * free or the room can't open. (The create limit, 10 an hour per account, is the router's.)
   */
  create(caller: FriendsCaller, request: FriendRoomCreateRequest): Promise<FriendRoomsResult>;
  /**
   * POST /v1/rooms/join: a seat in the room with `request.code` (6 digits, canonical). In this order (the
   * router's rate limits come first: 20 per 10 minutes per account, 60 per IP): `suspended`, no open room with
   * the code (`notFound`; `roomClosed` while the code cools down after its room closed), blocks [D85c]
   * (someone in the room blocked the caller: `notFound`, the same answer; the caller blocked someone in it:
   * `cantJoin`; never for a player of the room's running game, who always gets a ticket back to it, since a
   * block inside a game only mutes reactions), `kicked`, then the room's state: the caller's own seat again (another device, or the app was
   * closed: the same seat, and the earlier connection gets `roomClosed` `otherDevice`), `gameStarted` for
   * anyone who is not one of its game's players (a player of the game gets a ticket back into it), `roomFull`.
   * An unverified email may join [D85b].
   */
  join(caller: FriendsCaller, request: FriendRoomJoinRequest): Promise<FriendRoomsResult>;
  /** The admin site: every open room, newest first. No codes. */
  openRooms(): AdminFriendRoomRow[];
  /** The admin overview: open rooms in the lobby and playing. */
  counts(): AdminFriendRoomCounts;
  /**
   * The server is going down (an update): every lobby's connections get `roomClosed` `serverRestart` and the
   * rooms close; running games end as every game does on a shutdown.
   */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------
// The implementation

/** The auth of a friends room's seat reservation: who the player is, and their card in the lobby. */
export interface FriendsSeatAuth {
  userId: string;
  name: string;
  member: LobbyMember;
}

export function isFriendsSeatAuth(v: unknown): v is FriendsSeatAuth {
  if (typeof v !== 'object' || v === null) return false;
  const { userId, name, member } = v as Record<string, unknown>;
  return (
    typeof userId === 'string' &&
    userId !== '' &&
    typeof name === 'string' &&
    typeof member === 'object' &&
    member !== null &&
    (member as LobbyMember).id === userId
  );
}

/** What the service reads from the database (./store.ts has Postgres's). */
export interface FriendsStore {
  /** The account's card in the lobby: avatar, flag, general rating (null without a rated game). */
  member(userId: string, name: string): Promise<LobbyMember>;
  /** The blocks among these accounts (spec §3.5). */
  blocksAmong(userIds: readonly string[]): Promise<BlockPair[]>;
}

/** Opens a friends room's Colyseus room and reserves its seats (rooms/FriendsRoom.ts colyseusFriendsRooms). */
export interface FriendsRoomOpener {
  /** Creates the room with `{ friends: claimId }` (its onCreate claims the setup); its roomId. */
  open(claimId: string): Promise<string>;
  /** A seat in that room for this player (the reservation's auth), with these join options. */
  reserve(
    roomId: string,
    auth: FriendsSeatAuth,
    options: { interferenceKinds?: string[] },
  ): Promise<MatchSeatReservation>;
}

/** What the room lets the service do to it. */
export interface FriendsRoomControl {
  /** Everyone out with `roomClosed` and this reason, then the room closes. */
  close(reason: FriendsRoomClosedReason): void;
}

/** The room's side of the claim. */
export interface FriendsRoomLink {
  readonly setup: FriendsRoomSetup;
  /** The room's lobby, shared with the service (admissions, kicks, blocks). */
  readonly lobby: FriendsLobby;
  /** The room is gone (closed or disposed): its code cools down. */
  closed(): void;
}

/** The room's side (rooms/FriendsRoom.ts takes it as a dependency). */
export interface FriendsRoomClaims {
  /** The setup a room is created for, once; undefined for an unknown or claimed id. */
  claim(claimId: string, control: FriendsRoomControl): FriendsRoomLink | undefined;
  readonly rules: FriendsRules;
}

export interface FriendRoomsLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface FriendRoomsDeps {
  store: FriendsStore;
  opener: FriendsRoomOpener;
  now: () => number;
  /** An integer in [0, n) (codes): crypto.randomInt on the server. */
  random: (n: number) => number;
  /** Claim ids: unguessable (they let a room claim its setup). */
  newId: () => string;
  log: FriendRoomsLog;
  rules?: Partial<FriendsRules>;
  /** Rule overrides for the games (tests and development, e.g. a short grace); none in production. */
  gameRules?: GameRoomRuleOverrides;
}

interface RoomEntry {
  code: string;
  claimId: string;
  /** The Colyseus room's id, once open. */
  roomId: string | null;
  setup: FriendsRoomSetup;
  lobby: FriendsLobby;
  control: FriendsRoomControl | null;
  /** The host's name when the room opened (the admin list, should the host's seat be gone). */
  hostName: string;
  /** The creator's card, read for their ticket (the summary shows it before their app is in). */
  hostCard: LobbyMember | null;
  closed: boolean;
}

/** Counters for GET /dev/metrics. */
export interface FriendRoomsStats {
  open: AdminFriendRoomCounts;
  opened: number;
  tickets: number;
  refused: Partial<Record<FriendRoomsRefusal, number>>;
  closed: number;
}

export class FriendRoomsService implements FriendRooms, FriendsRoomClaims {
  readonly rules: FriendsRules;
  private readonly codes: FriendCodes<RoomEntry>;
  /** Rooms being opened, by claim id, until their room claims them. */
  private readonly opening = new Map<string, RoomEntry>();
  private shuttingDown = false;
  private readonly stats = { opened: 0, tickets: 0, closed: 0, refused: {} as FriendRoomsStats['refused'] };

  constructor(private readonly deps: FriendRoomsDeps) {
    this.rules = friendsRules(deps.rules);
    this.codes = new FriendCodes<RoomEntry>({
      space: this.rules.codeSpace,
      cooldownMs: this.rules.codeCooldownMs,
      random: deps.random,
      now: deps.now,
    });
  }

  // -- the routes ------------------------------------------------------------------------------------------

  async create(caller: FriendsCaller, request: FriendRoomCreateRequest): Promise<FriendRoomsResult> {
    if (this.shuttingDown) return this.refuse('unavailable', 'the server is restarting');
    if (caller.suspended) return this.refuse('suspended', 'this account is suspended');
    const hosted = this.hostedLobby(caller.userId);
    if (hosted !== undefined) {
      if (request.replace !== true)
        return { ...this.refuse('tooManyRooms', 'you have an open room'), code: hosted.code };
      this.closeEntry(hosted, 'closed', 'its host opened another room');
    }

    const gameType: GameType = request.gameType ?? FRIENDS_DEFAULT_GAME_TYPE;
    const setup: FriendsRoomSetup = {
      code: '',
      gameType,
      hostId: caller.userId,
      rules: this.rules,
      gameRules: this.deps.gameRules ?? {},
    };
    const entry: RoomEntry = {
      code: '',
      claimId: this.deps.newId(),
      roomId: null,
      setup,
      lobby: new FriendsLobby({ hostId: caller.userId, gameType, rules: this.rules, now: this.deps.now }),
      control: null,
      hostName: caller.name,
      hostCard: null,
      closed: false,
    };
    // Taken now, before anything is awaited: a second create of the same account sees this room.
    const code = this.codes.allocate(entry);
    if (code === null) return this.refuse('unavailable', 'no free room code; try again later');
    entry.code = code;
    setup.code = code;
    entry.lobby.admit(caller.userId);

    let roomId: string;
    try {
      this.opening.set(entry.claimId, entry);
      roomId = await this.deps.opener.open(entry.claimId);
    } catch (error) {
      this.deps.log.error(`[friends ${code}] the room did not open`, error);
      this.forget(entry);
      return this.refuse('unavailable', 'the room could not open');
    } finally {
      this.opening.delete(entry.claimId);
    }
    entry.roomId = roomId;
    if (entry.closed) return this.refuse('unavailable', 'the room closed while opening');
    this.stats.opened++;
    this.deps.log.info(`[friends ${code}] opened by ${caller.userId} (${gameType}) in room ${roomId}`);
    return this.ticketFor(entry, caller, request.interferenceKinds, 'new');
  }

  async join(caller: FriendsCaller, request: FriendRoomJoinRequest): Promise<FriendRoomsResult> {
    if (this.shuttingDown) return this.refuse('unavailable', 'the server is restarting');
    if (caller.suspended) return this.refuse('suspended', 'this account is suspended');
    const found = this.lookup(request.code);
    if (found.kind !== 'open') return this.noRoom(found);
    const entry = found.value;

    // A player of the room's running game always gets a ticket back to it (the app was killed, "נסה שוב"):
    // inside a game a block only mutes reactions (GameRoom.watchBlocks) and removes nobody, so a block made
    // mid-game must neither lock its own players out nor give itself away.
    if (!this.playsIn(entry, caller.userId)) {
      // [D85c] Blocks either way, with everyone in the room or on the way in. Whoever was blocked by someone
      // in it hears what a wrong code says. Two joins of one room are not serialized, so after every read
      // the members are taken again, and anyone new since (a join that was admitted meanwhile) is checked
      // too, until nobody new is there. admit() then runs in the same tick as that last read, with nothing
      // awaited between them: the later of two racing joins always sees the earlier one's reservation.
      const checked = new Set<PlayerId>([caller.userId]);
      for (;;) {
        const fresh = this.membersOf(entry).filter((id) => !checked.has(id));
        if (fresh.length === 0) break;
        let pairs: BlockPair[];
        try {
          pairs = await this.deps.store.blocksAmong([caller.userId, ...fresh]);
        } catch (error) {
          this.deps.log.error(`[friends ${entry.code}] the blocks could not be read`, error);
          return this.refuse('unavailable', 'try again in a moment');
        }
        if (pairs.some((p) => p.blockedId === caller.userId && fresh.includes(p.blockerId)))
          return this.refuse('notFound', 'no open room has this code');
        if (pairs.some((p) => p.blockerId === caller.userId && fresh.includes(p.blockedId)))
          return this.refuse('cantJoin', 'you blocked a player in this room');
        for (const id of fresh) checked.add(id);
        // The room may have changed while the blocks were read.
        const now = this.lookup(request.code);
        if (now.kind !== 'open' || now.value !== entry) return this.noRoom(now);
      }
    }
    if (entry.lobby.wasKicked(caller.userId))
      return this.refuse('kicked', 'the host removed you from this room');

    const admitted = entry.lobby.admit(caller.userId);
    if (!admitted.ok) return this.refuse(admitted.error, refusalText[admitted.error]);
    return this.ticketFor(entry, caller, request.interferenceKinds, admitted.seat);
  }

  openRooms(): AdminFriendRoomRow[] {
    return this.codes
      .entries()
      .map(([, entry]) => entry)
      .filter((e) => e.roomId !== null && !e.closed)
      .map((e) => {
        const { lobby } = e;
        const hostId = lobby.hostId ?? e.setup.hostId;
        return {
          roomId: e.roomId!,
          state: lobby.roomState,
          gameType: lobby.gameType,
          players: lobby.state === 'lobby' ? lobby.taken : lobby.gamePlayers.length,
          maxPlayers: this.rules.maxPlayers,
          hostId,
          hostName: lobby.seat(hostId)?.name ?? e.hostName,
          openedAt: lobby.openedAt,
          startedAt: lobby.startedAt,
        };
      })
      .sort((a, b) => b.openedAt - a.openedAt);
  }

  counts(): AdminFriendRoomCounts {
    const rows = this.openRooms();
    return {
      lobby: rows.filter((r) => r.state === 'lobby').length,
      playing: rows.filter((r) => r.state === 'playing').length,
    };
  }

  /** GET /dev/metrics. */
  report(): FriendRoomsStats {
    return {
      open: this.counts(),
      opened: this.stats.opened,
      tickets: this.stats.tickets,
      refused: { ...this.stats.refused },
      closed: this.stats.closed,
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const [, entry] of this.codes.entries())
      if (entry.lobby.state === 'lobby') this.closeEntry(entry, 'serverRestart', 'the server is restarting');
    return Promise.resolve();
  }

  // -- the rooms' side ---------------------------------------------------------------------------------------

  claim(claimId: string, control: FriendsRoomControl): FriendsRoomLink | undefined {
    const entry = this.opening.get(claimId);
    if (!entry || entry.control !== null || entry.closed) return undefined;
    this.opening.delete(claimId);
    entry.control = control;
    return {
      setup: entry.setup,
      lobby: entry.lobby,
      closed: () => this.roomGone(entry),
    };
  }

  // -- helpers -----------------------------------------------------------------------------------------------

  private async ticketFor(
    entry: RoomEntry,
    caller: FriendsCaller,
    interferenceKinds: string[] | undefined,
    seat: 'new' | 'own',
  ): Promise<FriendRoomsResult> {
    const { lobby } = entry;
    let reservation: MatchSeatReservation;
    try {
      const member = await this.memberOf(caller);
      if (caller.userId === entry.setup.hostId) entry.hostCard = member;
      if (entry.closed || entry.roomId === null) throw new Error('the room closed');
      const auth: FriendsSeatAuth = { userId: caller.userId, name: caller.name, member };
      reservation = await this.deps.opener.reserve(
        entry.roomId,
        auth,
        interferenceKinds === undefined ? {} : { interferenceKinds },
      );
    } catch (error) {
      if (seat === 'new') this.afterChange(entry, lobby.cancel(caller.userId).closed);
      if (entry.closed || lobby.state === 'closed') return this.refuse('roomClosed', 'the room closed');
      this.deps.log.warn(`[friends ${entry.code}] no seat for ${caller.userId}: ${String(error)}`);
      return this.refuse('unavailable', 'the room could not take you; try again');
    }
    this.stats.tickets++;
    this.deps.log.info(`[friends ${entry.code}] ticket for ${caller.userId} (${seat} seat)`);
    return { ok: true, ticket: { reservation, room: this.summaryOf(entry) } };
  }

  private async memberOf(caller: FriendsCaller): Promise<LobbyMember> {
    try {
      return await this.deps.store.member(caller.userId, caller.name);
    } catch (error) {
      // The card is decoration: the room still works with the name alone.
      this.deps.log.warn(`[friends] the card of ${caller.userId} could not be read: ${String(error)}`);
      return { id: caller.userId, name: caller.name, avatarId: NO_AVATAR_ID, country: null, rating: null };
    }
  }

  private summaryOf(entry: RoomEntry): FriendRoomSummary {
    const { lobby } = entry;
    const hostId = lobby.hostId ?? entry.setup.hostId;
    const host = lobby.seat(hostId) ?? (hostId === entry.setup.hostId ? entry.hostCard : null) ?? undefined;
    return {
      code: entry.code,
      gameType: lobby.gameType,
      players: lobby.state === 'lobby' ? lobby.taken : lobby.gamePlayers.length,
      maxPlayers: this.rules.maxPlayers,
      state: lobby.roomState,
      host: {
        name: host?.name ?? entry.hostName,
        avatarId: host?.avatarId ?? NO_AVATAR_ID,
        country: host?.country ?? null,
      },
    };
  }

  /** Is this account a player of the room's game, which has started? */
  private playsIn(entry: RoomEntry, userId: PlayerId): boolean {
    return entry.lobby.state === 'started' && entry.lobby.gamePlayers.includes(userId);
  }

  /** Everyone the block check looks at: the lobby's seats and reservations, or the game's players. */
  private membersOf(entry: RoomEntry): PlayerId[] {
    return entry.lobby.state === 'lobby' ? entry.lobby.members() : [...entry.lobby.gamePlayers];
  }

  private lookup(code: string): CodeLookup<RoomEntry> {
    const found = this.codes.lookup(code);
    if (found.kind === 'open' && (found.value.closed || found.value.lobby.state === 'closed'))
      return { kind: 'cooling', code };
    return found;
  }

  private noRoom(found: CodeLookup<RoomEntry>): FriendRoomsResult {
    return found.kind === 'none'
      ? this.refuse('notFound', 'no open room has this code')
      : this.refuse('roomClosed', 'the room closed');
  }

  /** The open lobby this account hosts, if any. */
  private hostedLobby(userId: string): RoomEntry | undefined {
    return this.codes
      .entries()
      .map(([, e]) => e)
      .find((e) => !e.closed && e.lobby.state === 'lobby' && e.lobby.hostId === userId);
  }

  /** The service closes a room: everyone in it out, with this reason. */
  private closeEntry(entry: RoomEntry, reason: FriendsRoomClosedReason, why: string): void {
    if (entry.closed) return;
    this.deps.log.info(`[friends ${entry.code}] closing: ${why}`);
    entry.lobby.close();
    const control = entry.control;
    this.forget(entry);
    try {
      control?.close(reason);
    } catch (error) {
      this.deps.log.error(`[friends ${entry.code}] the room failed to close`, error);
    }
  }

  /** After a change the service made to a lobby: an empty one closes its room. */
  private afterChange(entry: RoomEntry, closed: boolean): void {
    if (closed) this.closeEntry(entry, 'closed', 'nobody is in it');
  }

  /** The room went away (it closed, or was disposed). */
  private roomGone(entry: RoomEntry): void {
    if (entry.closed) return;
    entry.lobby.ended();
    this.forget(entry);
    this.deps.log.info(`[friends ${entry.code}] closed`);
  }

  private forget(entry: RoomEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    this.opening.delete(entry.claimId);
    if (entry.code !== '') this.codes.release(entry.code);
    this.stats.closed++;
  }

  private refuse(error: FriendRoomsRefusal, message: string): Extract<FriendRoomsResult, { ok: false }> {
    this.stats.refused[error] = (this.stats.refused[error] ?? 0) + 1;
    return { ok: false, error, message };
  }
}

const refusalText: Record<'roomFull' | 'gameStarted' | 'kicked' | 'roomClosed', string> = {
  roomFull: 'the room is full',
  gameStarted: 'the game in this room has started',
  kicked: 'the host removed you from this room',
  roomClosed: 'the room closed',
};

export function createFriendRooms(deps: FriendRoomsDeps): FriendRoomsService {
  return new FriendRoomsService(deps);
}
