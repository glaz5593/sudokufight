import { type GameType, INTERFERENCE_KINDS, type PlayerId } from '@sudoku-fight/engine';
import {
  FRIENDS_DEFAULT_GAME_TYPE,
  FRIENDS_MAX_PLAYERS,
  FRIENDS_MIN_PLAYERS,
  type FriendRoomSummary,
  type FriendRoomTicket,
  type FriendsField,
  type FriendsJoinVia,
  type FriendsLobbyCommand,
  type FriendsLobbyRefused,
  type FriendsRoomClosedReason,
  friendsJoinResultOf,
  type LobbyPlayer,
  type MatchSeatReservation,
  normalizeFriendCode,
} from '@sudoku-fight/protocol';

import { isRoomsApiError, type RoomsApi } from '../api/roomsApi';
import type { FriendsRequest, FriendsSessionDeps, OnlineSession } from '../game/onlineSession';
import { type FriendsProblem, friendsProblemOf, OnlineError, onlineErrorOfFriends } from './errors';
import type { CloseReason, OnlineInfo, RemoteGameHost } from './remoteGameHost';

/**
 * Playing with friends (1.0.4; docs/handoff/2026-10-19/friends-room.md, protocol friends.ts): what the friends
 * screens call, and what they show.
 *
 * - createRoom() opens a room (POST /v1/rooms, the caller its host) and joinByCode() takes a seat in one by its
 *   code (POST /v1/rooms/join: typed, or from a link). Each ends in a ticket, whose seat reservation the game
 *   store's friends session takes at once (gameStore.startFriends): from then on the room is the store's
 *   `online`, its lobby, countdown, game and end, like any online game. The way back without a seat for the
 *   token (the app was in the background or closed, "נסה שוב") is the same route: the same account gets its own
 *   seat back (`rejoin`).
 * - start(), setGameType(), kick(): the host's lobby commands (the server is the judge: a refusal shows as the
 *   room's `refused`); leave(): "יציאה מהחדר", which frees the seat at once.
 * - friendsRoomOf(): the room as the screens draw it, from the session's connection info: the seats in the
 *   order they came (avatar, flag, rating, away, host, me), who may start, the countdown, and why the room was
 *   left (a friends screen's text for every code: FriendsProblem).
 * - Analytics (protocol telemetry.ts, generation 3; never a code or an id): friends_room_open and
 *   friends_room_join here, friends_invite_share with shared(), friends_room_start and friends_room_close in
 *   the session (game/onlineSession.ts). friends_link_open is the link's (M3).
 *
 * Pure: the routes, the store, the host and the analytics come in (net/friendsDevice.ts on the phone, fakes in
 * tests). No React Native.
 */

// ---------------------------------------------------------------------------------------------------------
// The room, as the screens draw it

export type FriendsRoomPhase =
  /** Getting into the room (the reservation, then its first word). */
  | 'connecting'
  /** The waiting room. */
  | 'lobby'
  /** The connection went (or the app was in the background): coming back to the same seat. */
  | 'reconnecting'
  /** The host started: 3… 2… 1… (`startsAt`), the game at GO. */
  | 'countdown'
  /** The game is here (the game screen's). */
  | 'game'
  /** Out of the room: see `closed`. */
  | 'closed';

/** A seat, in the order the players came in. */
export interface FriendsSeat extends LobbyPlayer {
  /** "לא בחדר כרגע" [D84a]: the app is not connected now; the seat is held. */
  away: boolean;
  isHost: boolean;
  isMe: boolean;
}

/** Why this player is out of the room. */
export interface FriendsClosed {
  /** The host's way of putting it (RemoteGameHost CloseReason). */
  closeReason: CloseReason;
  /** The server's own reason, when it put this connection out (`roomClosed`). */
  reason: FriendsRoomClosedReason | null;
  /**
   * What the friends screen says (friends.json); null when there is nothing to explain: I left on purpose, or
   * the game ended.
   */
  problem: FriendsProblem | null;
  /** tooManyRequests: how long to wait (ms). */
  retryAfterMs: number | null;
}

export interface FriendsRoomView {
  phase: FriendsRoomPhase;
  /** The 6-digit code (show it with protocol formatFriendCode, wrapped in LRI…PDI in Hebrew text). */
  code: string;
  /** The host's current choice [D82]. */
  gameType: GameType;
  seats: FriendsSeat[];
  minPlayers: number;
  maxPlayers: number;
  meId: PlayerId | null;
  hostId: PlayerId | null;
  /** The host's seat; null before the lobby. */
  host: FriendsSeat | null;
  isHost: boolean;
  /** Seats connected now, mine included: what "התחל משחק · N שחקנים" counts [D83]. */
  connected: number;
  /** The other seats away now: "Avi לא בחדר כרגע. להתחיל בלי Avi?" (pass their ids to start()). */
  away: FriendsSeat[];
  /** The host may press "התחל": in the lobby, with at least `minPlayers` connected. */
  canStart: boolean;
  /** GO in the server's clock, once the host started; null before. */
  startsAt: number | null;
  /** Set once out of the room. */
  closed: FriendsClosed | null;
  /** The latest of my lobby commands the server refused (its `seq` grows with each refusal). */
  refused: (FriendsLobbyRefused & { seq: number }) | null;
  /** The room as its ticket described it (the host's name, avatar and flag), before the lobby comes. */
  ticket: FriendRoomSummary | null;
}

function phaseOf(info: OnlineInfo): FriendsRoomPhase {
  if (info.status === 'closed') return 'closed';
  if (info.hasGame) return 'game';
  if (info.startsAt != null) return 'countdown';
  if (info.status === 'reconnecting') return 'reconnecting';
  if (info.status === 'lobby' && info.lobby && info.playerId !== null) return 'lobby';
  return 'connecting';
}

function closedOf(info: OnlineInfo): FriendsClosed | null {
  const closeReason = info.closeReason;
  if (info.status !== 'closed' || closeReason === null) return null;
  const reason = info.friends?.closed ?? null;
  const error = info.error;
  let problem: FriendsProblem | null;
  if (closeReason === 'left' || closeReason === 'gameOver') problem = null;
  else if (reason !== null) problem = reason === 'kicked' ? 'kicked' : 'roomClosed';
  else if (error) problem = friendsProblemOf(error);
  else problem = closeReason === 'serverClosed' ? 'roomClosed' : 'internal';
  return { closeReason, reason, problem, retryAfterMs: error?.retryAfterMs ?? null };
}

/**
 * The room as the screens draw it, from a friends session's connection info (its `online`, on every change) and
 * its request (the code and the ticket's summary, for before the lobby comes).
 */
export function friendsRoomOf(info: OnlineInfo, request: FriendsRequest): FriendsRoomView {
  const lobby = info.lobby;
  const meId = info.playerId;
  const hostId = lobby?.hostId ?? null;
  const seats: FriendsSeat[] = (lobby?.players ?? []).map((p) => ({
    ...p,
    away: p.away === true,
    isHost: p.id === hostId,
    isMe: p.id === meId,
  }));
  const minPlayers = lobby?.minPlayers ?? FRIENDS_MIN_PLAYERS;
  const phase = phaseOf(info);
  const connected = seats.filter((s) => !s.away).length;
  const isHost = meId !== null && hostId === meId;
  return {
    phase,
    code: info.friends?.code ?? request.code,
    gameType: lobby?.gameType ?? request.gameType ?? request.room?.gameType ?? FRIENDS_DEFAULT_GAME_TYPE,
    seats,
    minPlayers,
    maxPlayers: lobby?.maxPlayers ?? request.room?.maxPlayers ?? FRIENDS_MAX_PLAYERS,
    meId,
    hostId,
    host: seats.find((s) => s.isHost) ?? null,
    isHost,
    connected,
    away: seats.filter((s) => s.away && !s.isMe),
    canStart: isHost && phase === 'lobby' && connected >= minPlayers,
    startsAt: info.startsAt ?? null,
    closed: closedOf(info),
    refused: info.friends?.refused ?? null,
    ticket: request.room ?? null,
  };
}

/** The friends room view of a session, or null when it is not a friends room's. */
export function friendsRoomOfSession(session: OnlineSession | null | undefined): FriendsRoomView | null {
  if (!session || session.request.kind !== 'friends') return null;
  return friendsRoomOf(session.online, session.request);
}

// ---------------------------------------------------------------------------------------------------------
// Getting in, and the host's commands

/** How a join began: a typed code, a link [D88], or (`resume`) back to my room after the app was closed. */
export type FriendsJoinWay = FriendsJoinVia | 'resume';

export type FriendsEntry =
  /** In: the session is the game store's `online` (its connection says how the entering goes). */
  | { ok: true; session: OnlineSession; room: FriendRoomSummary | null }
  | {
      ok: false;
      cancelled?: false;
      /** What the screen says (friends.json). */
      problem: FriendsProblem;
      /** tooManyRequests: how long to wait (ms). */
      retryAfterMs: number | null;
      /** tooManyRooms: the code of the lobby I host already ("לסגור את החדר הקודם?", then replace: true). */
      openCode: string | null;
      /** badRequest: the field at fault ('code': not 6 digits). */
      field: FriendsField | null;
    }
  /**
   * Called off (cancel(), leave()) before the server answered: nothing was entered, and nothing else was closed.
   * The screen that asked is gone; nothing is said or shown for it. (A room the server opened meanwhile keeps
   * my seat reserved only until the reservation lapses.)
   */
  | { ok: false; cancelled: true };

/** What net/friends.ts needs of the game store (gameStore.ts; a fake in tests). */
export interface FriendsStore {
  /** The store's online session, if any. */
  getOnline(): OnlineSession | null;
  startFriends(request: FriendsRequest, deps: FriendsSessionDeps): OnlineSession;
  /** Closes the session in progress (a friends room's: a consented leave, the seat freed). */
  clear(): void;
}

export type FriendsTrackName = 'friends_room_open' | 'friends_room_join' | 'friends_invite_share';
export type FriendsTrack = (name: FriendsTrackName, props: Record<string, string | number | boolean>) => void;

export interface FriendsRoomsDeps {
  /** The routes for whoever is signed in now; null when nobody is (then `unauthorized`). */
  api: () => RoomsApi | null;
  store: FriendsStore;
  /** A RemoteGameHost that has joined nothing yet (net/device.ts deviceHost on the phone). */
  makeHost: () => RemoteGameHost;
  track?: FriendsTrack;
  /** The interference kinds this app can show [D47]; every kind of the engine by default. */
  interferenceKinds?: readonly string[];
  /** Diagnostics: never a code, a token or a name. */
  log?: (line: string) => void;
}

export interface CreateRoomOptions {
  /** The room's first game type [D82]: the player's last one; FRIENDS_DEFAULT_GAME_TYPE without. */
  gameType?: GameType;
  /** Close the lobby I host already (the answer to `tooManyRooms`), then open the new one. */
  replace?: boolean;
}

export interface FriendsRooms {
  /** "צור חדר": a new room, me its host. Resolves with the session, or why not (never rejects). */
  createRoom(options?: CreateRoomOptions): Promise<FriendsEntry>;
  /**
   * A seat in the room with this code (as typed: spaces, dashes and any digits a keyboard makes; a pasted
   * message goes through protocol extractFriendCode first). Already in that room: the same session. Never
   * rejects.
   */
  joinByCode(input: string, via?: FriendsJoinWay): Promise<FriendsEntry>;
  /** The store's friends session, if any. */
  current(): OnlineSession | null;
  /** The current room as the screens draw it; null without one. */
  room(): FriendsRoomView | null;
  /** The host's "התחל משחק"; `withoutAway`: the away players the host agreed to start without [D83]. */
  start(withoutAway?: readonly PlayerId[]): boolean;
  /** The host's game type for the room [D82]. */
  setGameType(gameType: GameType): boolean;
  /** The host's "הוצא מהחדר" [D85a]. */
  kick(playerId: PlayerId): boolean;
  /**
   * "יציאה מהחדר" (no confirmation in the lobby: nothing is lost there). A way in still waiting for the server
   * is called off too (as cancel()).
   */
  leave(): void;
  /**
   * The screen that asked for a way in is gone (back, a swipe, another screen on top): every createRoom() and
   * joinByCode() still waiting for the server resolves `cancelled` and enters nothing, so nothing under way
   * now (a practice, a search) is closed by a late answer, and no room is entered that no screen shows.
   */
  cancel(): void;
  /** "שתף קישור" was used: friends_invite_share (the screen opens the share sheet itself). */
  shared(): void;
}

type Failed = Extract<FriendsEntry, { problem: FriendsProblem }>;
type Cancelled = Extract<FriendsEntry, { cancelled: true }>;

const CANCELLED: Cancelled = { ok: false, cancelled: true };

const failed = (problem: FriendsProblem, more: Partial<Omit<Failed, 'ok' | 'problem'>> = {}): Failed => ({
  ok: false,
  problem,
  retryAfterMs: null,
  openCode: null,
  field: null,
  ...more,
});

function failedOf(error: unknown): Failed {
  if (isRoomsApiError(error))
    return failed(error.code, {
      retryAfterMs: error.retryAfterMs,
      openCode: error.openCode,
      field: error.field,
    });
  return failed('internal');
}

export function createFriendsRooms(deps: FriendsRoomsDeps): FriendsRooms {
  const kinds = [...(deps.interferenceKinds ?? INTERFERENCE_KINDS)];
  /** One way in at a time, in the order asked; the same one asked again while it runs is shared. */
  let queue: Promise<unknown> = Promise.resolve();
  const running = new Map<string, Promise<FriendsEntry>>();
  /** Grows with each cancel(): a way in asked under an older one enters nothing. */
  let epoch = 0;
  const callOff = () => {
    epoch++;
    // The next ask is a new step, not the one being called off.
    running.clear();
  };

  const log = (line: string) => deps.log?.(line);
  const send = (name: FriendsTrackName, props: Record<string, string | number | boolean>) => {
    try {
      deps.track?.(name, props);
    } catch {
      // Analytics never breaks a room.
    }
  };

  const current = (): OnlineSession | null => {
    const online = deps.store.getOnline();
    return online && online.request.kind === 'friends' ? online : null;
  };

  /** Back into a room without a reservation (POST /v1/rooms/join): the same account's own seat. */
  const rejoin = async (code: string): Promise<MatchSeatReservation> => {
    const api = deps.api();
    if (!api) throw onlineErrorOfFriends('unauthorized');
    try {
      return (await api.join({ code, interferenceKinds: kinds })).reservation;
    } catch (error) {
      if (isRoomsApiError(error)) throw onlineErrorOfFriends(error.code, error.status, error.retryAfterMs);
      throw error instanceof OnlineError ? error : onlineErrorOfFriends('internal');
    }
  };

  const enter = (ticket: FriendRoomTicket): OnlineSession =>
    deps.store.startFriends(
      {
        kind: 'friends',
        code: ticket.room.code,
        reservation: ticket.reservation,
        room: ticket.room,
        gameType: ticket.room.gameType,
      },
      { makeHost: deps.makeHost, rejoin },
    );

  /** Runs `step` after the ways in asked before it; the same `key` asked again while it runs shares it. */
  const once = (key: string, step: () => Promise<FriendsEntry>): Promise<FriendsEntry> => {
    const same = running.get(key);
    if (same) return same;
    const next = queue.then(step, step).catch((error: unknown) => {
      log(`friends: ${key.split(':')[0]} failed: ${error instanceof Error ? error.name : 'unknown'}`);
      return failed('internal');
    });
    running.set(key, next);
    queue = next;
    void next.finally(() => {
      if (running.get(key) === next) running.delete(key);
    });
    return next;
  };

  /** friends_room_join once the seat is taken or refused (a ticket can still be refused at the door). */
  const trackJoin = (via: FriendsJoinVia, session: OnlineSession) => {
    void session.ready.then(() => {
      const { status, error } = session.online;
      const result = status === 'closed' && error ? friendsProblemOf(error) : 'ok';
      send('friends_room_join', { via, result: friendsJoinResultOf(result) });
    });
  };

  const command = (cmd: FriendsLobbyCommand): boolean => current()?.host.sendLobbyCommand(cmd) ?? false;

  return {
    createRoom({ gameType = FRIENDS_DEFAULT_GAME_TYPE, replace = false } = {}) {
      const asked = epoch;
      return once(`create:${gameType}:${replace}`, async () => {
        if (asked !== epoch) return CANCELLED;
        const api = deps.api();
        if (!api) return failed('unauthorized');
        let ticket: FriendRoomTicket;
        try {
          ticket = await api.create({
            gameType,
            interferenceKinds: kinds,
            ...(replace && { replace: true }),
          });
        } catch (error) {
          if (asked !== epoch) return CANCELLED;
          const out = failedOf(error);
          log(`friends: create refused: ${out.problem}`);
          return out;
        }
        if (asked !== epoch) {
          log('friends: create called off');
          return CANCELLED;
        }
        send('friends_room_open', { gameType: ticket.room.gameType, via: 'create' });
        log('friends: room opened');
        return { ok: true, session: enter(ticket), room: ticket.room };
      });
    },

    joinByCode(input, via = 'code') {
      const code = normalizeFriendCode(input);
      if (code === null) return Promise.resolve(failed('badRequest', { field: 'code' }));
      const asked = epoch;
      return once(`join:${code}`, async () => {
        if (asked !== epoch) return CANCELLED;
        // Already in this room (a second tap on the link, the same code typed again): stay.
        const here = current();
        if (here && here.friendsCode === code && here.online.status !== 'closed')
          return {
            ok: true,
            session: here,
            room: here.request.kind === 'friends' ? (here.request.room ?? null) : null,
          };
        const api = deps.api();
        if (!api) {
          if (via !== 'resume')
            send('friends_room_join', { via, result: friendsJoinResultOf('unauthorized') });
          return failed('unauthorized');
        }
        let ticket: FriendRoomTicket;
        try {
          ticket = await api.join({ code, interferenceKinds: kinds });
        } catch (error) {
          if (asked !== epoch) return CANCELLED;
          const out = failedOf(error);
          log(`friends: join refused: ${out.problem}`);
          if (via !== 'resume') send('friends_room_join', { via, result: friendsJoinResultOf(out.problem) });
          return out;
        }
        if (asked !== epoch) {
          log('friends: join called off');
          return CANCELLED;
        }
        const session = enter(ticket);
        if (via !== 'resume') trackJoin(via, session);
        log('friends: joined a room');
        return { ok: true, session, room: ticket.room };
      });
    },

    current,

    room: () => friendsRoomOfSession(current()),

    start(withoutAway = []) {
      return command(
        withoutAway.length ? { type: 'start', withoutAway: [...withoutAway] } : { type: 'start' },
      );
    },

    setGameType(gameType) {
      return command({ type: 'setGameType', gameType });
    },

    kick(playerId) {
      return command({ type: 'kick', playerId });
    },

    leave() {
      callOff();
      if (current()) deps.store.clear();
    },

    cancel: callOff,

    shared() {
      const room = friendsRoomOfSession(current());
      if (!room) return;
      send('friends_invite_share', { by: room.isHost ? 'host' : 'guest' });
    },
  };
}
