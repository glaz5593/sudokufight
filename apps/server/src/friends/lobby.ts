import type { GameType, PlayerId } from '@sudoku-fight/engine';
import type {
  AvatarId,
  CountryCode,
  FriendRoomState,
  FriendsLobbyError,
  LobbyPlayer,
  NO_AVATAR_ID,
} from '@sudoku-fight/protocol';

import type { FriendsRules } from './options';

/**
 * The waiting room of a friends room, as rules only (friends-room.md §3.2, §4; D82–D85): who holds a seat,
 * in the order they came, who is the host, which seats are away, who was kicked, and what `start`,
 * `setGameType` and `kick` do. No Colyseus and no network: the room (rooms/FriendsRoom.ts) turns connections
 * into calls here and the answers into messages, and the service (./service.ts) asks it before it hands out
 * a ticket. Time is injected (`now`), so the tests move it.
 *
 * - A seat is taken in two steps: the service admits an account (a ticket: a seat reserved for
 *   `seatReservationMs`, counted against the room's seats), then its app connects. The same account again
 *   (another device, or the app was closed) is admitted to its own seat: the seat stays where it was, with the
 *   host still the host.
 * - A lost connection holds the seat, away, for `lobbyAwayHoldMs` (6 h) [D84a]; back in time, it is the
 *   player's again. Leaving on purpose frees it at once. There is no other time limit (`lobbyMaxMs` null).
 * - The host is the account that opened the room; when the host's seat goes (left, lapsed, kicked out by a
 *   block), the earliest of the others is the host [D84b].
 * - The lobby is over when nobody holds a seat or a reservation: the room closes.
 * - `start` [D83]: the host only, with at least `minPlayers` connected seats; a seat away now must be on the
 *   host's `withoutAway`, else `playersAway`. The connected seats are the game's players, in their order;
 *   the away ones are out (their app gets "the game started without you").
 * - `kick` [D85a]: the host only, before the start, a guest; a kicked account never gets back in.
 * - A block between two seats [D85c]: the blocked one is out (told only "יצאת מהחדר").
 */

/** A player as the lobby shows them (the service reads it from the database on the way in). */
export interface LobbyMember {
  id: PlayerId;
  name: string;
  avatarId: AvatarId | typeof NO_AVATAR_ID;
  country: CountryCode | null;
  /** The general rating; null before any rated game. */
  rating: number | null;
}

interface Seat extends LobbyMember {
  /** null while connected; when away, the time its hold runs out. */
  awayUntil: number | null;
}

export type LobbyRules = Pick<
  FriendsRules,
  'minPlayers' | 'maxPlayers' | 'lobbyAwayHoldMs' | 'lobbyMaxMs' | 'seatReservationMs'
>;

export interface FriendsLobbyOptions {
  hostId: PlayerId;
  gameType: GameType;
  rules: LobbyRules;
  now: () => number;
}

/** Why an account can't have a seat (the service's refusal, and the room's when the app connects). */
export type SeatRefusal = 'roomFull' | 'gameStarted' | 'kicked' | 'roomClosed';

export type AdmitResult =
  /** `new`: a seat reserved now. `own`: the account holds a seat already, or plays the started game. */
  { ok: true; seat: 'new' | 'own' } | { ok: false; error: SeatRefusal };

export type ConnectResult =
  /** `takeover`: the account held its seat already (away, or connected elsewhere: that connection goes). */
  { ok: true; takeover: boolean } | { ok: false; error: SeatRefusal };

/** What a change did to the room. */
export interface LobbyChange {
  /** Seats that went (left, lapsed, kicked, removed). */
  gone: PlayerId[];
  /** The host is someone else now (or nobody: no seat left). */
  hostChanged: boolean;
  /** Nobody holds a seat or a reservation any more (or the lobby ran out of time): the room closes. */
  closed: boolean;
}

export type CommandResult<T = LobbyChange> = { ok: true; value: T } | { ok: false; error: FriendsLobbyError };

export interface StartedGame {
  /** The game's players: the connected seats, in their order. */
  players: PlayerId[];
  /** Away seats left out (the host agreed) [D83]. */
  left: PlayerId[];
}

export type StartResult =
  { ok: true; value: StartedGame } | { ok: false; error: FriendsLobbyError; away?: PlayerId[] };

export class FriendsLobby {
  private readonly seatList: Seat[] = [];
  /** Admitted accounts whose app has not connected yet, and until when their reservation holds. */
  private readonly pending = new Map<PlayerId, number>();
  private readonly kickedIds = new Set<PlayerId>();
  /** Out for another player's sake (a block): their reservation, if any, is no good any more. */
  private readonly barred = new Set<PlayerId>();
  private host: PlayerId | null;
  private type: GameType;
  private phase: 'lobby' | 'started' | 'closed' = 'lobby';
  private players: PlayerId[] = [];
  readonly openedAt: number;
  private startedTime: number | null = null;

  constructor(private readonly o: FriendsLobbyOptions) {
    this.host = o.hostId;
    this.type = o.gameType;
    this.openedAt = o.now();
  }

  // -- views ---------------------------------------------------------------------------------------------

  get state(): 'lobby' | 'started' | 'closed' {
    return this.phase;
  }

  /** As the admin site and a ticket show it: 'playing' from the start on. */
  get roomState(): FriendRoomState {
    return this.phase === 'lobby' ? 'lobby' : 'playing';
  }

  get hostId(): PlayerId | null {
    return this.host;
  }

  get gameType(): GameType {
    return this.type;
  }

  get startedAt(): number | null {
    return this.startedTime;
  }

  /** The started game's players (empty before the start). */
  get gamePlayers(): readonly PlayerId[] {
    return this.players;
  }

  /** The seats in their order, as `lobby` sends them. */
  view(): LobbyPlayer[] {
    return this.seatList.map((s) => ({
      id: s.id,
      name: s.name,
      avatarId: s.avatarId,
      country: s.country,
      rating: s.rating,
      away: s.awayUntil !== null,
    }));
  }

  seat(id: PlayerId): Readonly<LobbyMember & { away: boolean }> | undefined {
    const s = this.find(id);
    return s && { ...s, away: s.awayUntil !== null };
  }

  /** Seats taken: connected, away, and reserved for an account on its way in. */
  get taken(): number {
    return this.seatList.length + this.livePending().length;
  }

  /** Everyone in the room or on the way in (the service checks blocks against them). */
  members(): PlayerId[] {
    return [...this.seatList.map((s) => s.id), ...this.livePending()];
  }

  /** Connected seats now. */
  get connected(): number {
    return this.seatList.filter((s) => s.awayUntil === null).length;
  }

  wasKicked(id: PlayerId): boolean {
    return this.kickedIds.has(id);
  }

  /** The next time something runs out (an away seat, a reservation, the lobby's limit); null: nothing. */
  nextDeadline(): number | null {
    if (this.phase !== 'lobby') return null;
    const times = [
      ...this.seatList.flatMap((s) => (s.awayUntil === null ? [] : [s.awayUntil])),
      ...this.pending.values(),
    ];
    if (this.o.rules.lobbyMaxMs !== null) times.push(this.openedAt + this.o.rules.lobbyMaxMs);
    return times.length === 0 ? null : Math.min(...times);
  }

  // -- seats ---------------------------------------------------------------------------------------------

  /** May this account have a seat (the service, before it reserves one)? A new seat is reserved here. */
  admit(id: PlayerId): AdmitResult {
    if (this.phase === 'closed' || this.barred.has(id)) return { ok: false, error: 'roomClosed' };
    if (this.kickedIds.has(id)) return { ok: false, error: 'kicked' };
    if (this.phase === 'started')
      return this.players.includes(id) ? { ok: true, seat: 'own' } : { ok: false, error: 'gameStarted' };
    if (this.find(id)) return { ok: true, seat: 'own' };
    if (this.full(id)) return { ok: false, error: 'roomFull' };
    this.pending.set(id, this.o.now() + this.o.rules.seatReservationMs);
    return { ok: true, seat: 'new' };
  }

  /** A reservation that could not be made after admit(): the seat is free again. */
  cancel(id: PlayerId): LobbyChange {
    this.pending.delete(id);
    return this.settle([], false);
  }

  /** The account's app connected (with its ticket) before the start. */
  connect(member: LobbyMember): ConnectResult {
    const { id } = member;
    if (this.phase === 'closed' || this.barred.has(id)) return { ok: false, error: 'roomClosed' };
    if (this.kickedIds.has(id)) return { ok: false, error: 'kicked' };
    if (this.phase === 'started') return { ok: false, error: 'gameStarted' };
    this.pending.delete(id);
    const seat = this.find(id);
    if (seat) {
      Object.assign(seat, member, { awayUntil: null });
      return { ok: true, takeover: true };
    }
    if (this.full(id)) return { ok: false, error: 'roomFull' };
    this.seatList.push({ ...member, awayUntil: null });
    // The first one in is the host when the room's creator is neither here nor on the way in.
    if (this.host === null || (!this.holds(this.host) && !this.livePending().includes(this.host)))
      this.host = id;
    return { ok: true, takeover: false };
  }

  /** The connection was lost (the app in the background, or closed): the seat is held [D84a]. */
  drop(id: PlayerId): number | null {
    const seat = this.find(id);
    if (!seat || this.phase !== 'lobby') return null;
    seat.awayUntil = this.o.now() + this.o.rules.lobbyAwayHoldMs;
    return seat.awayUntil;
  }

  /** Back in time with the reconnection token. */
  back(id: PlayerId): boolean {
    const seat = this.find(id);
    if (!seat) return false;
    seat.awayUntil = null;
    return true;
  }

  /** Left on purpose ("יציאה מהחדר"): the seat is free at once. */
  leave(id: PlayerId): LobbyChange {
    this.pending.delete(id);
    return this.removeSeats([id]);
  }

  /** Away seats whose hold ran out, reservations that lapsed, and the lobby's own limit, as of now. */
  expire(): LobbyChange {
    if (this.phase !== 'lobby') return { gone: [], hostChanged: false, closed: this.phase === 'closed' };
    const now = this.o.now();
    for (const [id, until] of this.pending) if (until <= now) this.pending.delete(id);
    const max = this.o.rules.lobbyMaxMs;
    if (max !== null && this.openedAt + max <= now) {
      const gone = this.seatList.map((s) => s.id);
      return this.close(gone);
    }
    const lapsed = this.seatList.filter((s) => s.awayUntil !== null && s.awayUntil <= now).map((s) => s.id);
    return this.removeSeats(lapsed);
  }

  /** The room closes for everyone (the service: its host opened another, the server is going down). */
  close(gone: PlayerId[] = this.seatList.map((s) => s.id)): LobbyChange {
    const hadHost = this.host !== null;
    this.seatList.splice(0);
    this.pending.clear();
    this.host = null;
    this.phase = 'closed';
    return { gone, hostChanged: hadHost, closed: true };
  }

  /**
   * A block between two accounts [D85c]: before the start, with both in the room, the blocked one is out
   * (their seat or their reservation). Returns the change, or null when it touches nobody here.
   */
  block(blockerId: PlayerId, blockedId: PlayerId): LobbyChange | null {
    if (this.phase !== 'lobby' || blockerId === blockedId) return null;
    const members = this.members();
    if (!members.includes(blockerId) || !members.includes(blockedId)) return null;
    this.barred.add(blockedId);
    this.pending.delete(blockedId);
    return this.removeSeats([blockedId]);
  }

  // -- the host's commands -------------------------------------------------------------------------------

  /** [D82] The game type, until the start. */
  setGameType(by: PlayerId, gameType: GameType): CommandResult<GameType> {
    const refused = this.hostCommand(by);
    if (refused) return { ok: false, error: refused };
    this.type = gameType;
    return { ok: true, value: gameType };
  }

  /** [D85a] A guest out, for good. */
  kick(by: PlayerId, target: PlayerId): CommandResult {
    const refused = this.hostCommand(by);
    if (refused) return { ok: false, error: refused };
    if (target === by || !this.find(target)) return { ok: false, error: 'badCommand' };
    this.kickedIds.add(target);
    return { ok: true, value: this.removeSeats([target]) };
  }

  /** [D83] 3… 2… 1… with the connected seats. */
  start(by: PlayerId, withoutAway: readonly PlayerId[] = []): StartResult {
    const refused = this.hostCommand(by);
    if (refused) return { ok: false, error: refused };
    const connected = this.seatList.filter((s) => s.awayUntil === null).map((s) => s.id);
    if (connected.length < this.o.rules.minPlayers) return { ok: false, error: 'notEnoughPlayers' };
    const away = this.seatList.filter((s) => s.awayUntil !== null).map((s) => s.id);
    if (away.some((id) => !withoutAway.includes(id))) return { ok: false, error: 'playersAway', away };
    this.phase = 'started';
    this.players = connected;
    this.startedTime = this.o.now();
    this.pending.clear();
    this.seatList.splice(0, this.seatList.length, ...this.seatList.filter((s) => s.awayUntil === null));
    return { ok: true, value: { players: connected, left: away } };
  }

  /** The room is gone (closed after its game, or disposed). */
  ended(): void {
    this.phase = 'closed';
    this.pending.clear();
  }

  // -- helpers -------------------------------------------------------------------------------------------

  private hostCommand(by: PlayerId): FriendsLobbyError | null {
    if (this.phase !== 'lobby') return 'gameStarted';
    if (by !== this.host) return 'notHost';
    return null;
  }

  private find(id: PlayerId): Seat | undefined {
    return this.seatList.find((s) => s.id === id);
  }

  private holds(id: PlayerId): boolean {
    return this.find(id) !== undefined;
  }

  private livePending(): PlayerId[] {
    const now = this.o.now();
    return [...this.pending].filter(([, until]) => until > now).map(([id]) => id);
  }

  /** No seat left for `id` (its own reservation aside). */
  private full(id: PlayerId): boolean {
    const others = this.livePending().filter((p) => p !== id).length;
    return this.seatList.length + others >= this.o.rules.maxPlayers;
  }

  private removeSeats(ids: readonly PlayerId[]): LobbyChange {
    const gone: PlayerId[] = [];
    for (const id of ids) {
      const i = this.seatList.findIndex((s) => s.id === id);
      if (i < 0) continue;
      this.seatList.splice(i, 1);
      gone.push(id);
    }
    return this.settle(gone, gone.includes(this.host ?? ''));
  }

  /** After seats went: the host passes [D84b]; nobody left (no seat, no reservation): closed. */
  private settle(gone: PlayerId[], hostGone: boolean): LobbyChange {
    let hostChanged = false;
    if (this.phase === 'lobby' && (hostGone || (this.host !== null && !this.holds(this.host)))) {
      const next = this.seatList[0]?.id ?? null;
      // A host still on the way in (the room's creator) keeps the role until their reservation lapses.
      const waiting = this.host !== null && this.livePending().includes(this.host);
      if (!waiting && next !== this.host) {
        this.host = next;
        hostChanged = true;
      }
    }
    const closed = this.phase === 'lobby' && this.seatList.length === 0 && this.livePending().length === 0;
    if (closed) this.phase = 'closed';
    return { gone, hostChanged, closed: closed || this.phase === 'closed' };
  }
}
