import type {
  Clock,
  GameMode,
  GameState,
  GameType,
  GameView,
  HostUpdate,
  PlayerId,
} from '@sudoku-fight/engine';
import {
  type FriendRoomSummary,
  type FriendsCloseReason,
  type MatchSeatReservation,
  parseQueueKey,
  type QueueKey,
} from '@sudoku-fight/protocol';

import type { OnlineError } from '../net/errors';
import type { DevRoomOptions } from '../net/onlineClient';
import type { FriendsRejoin, OnlineInfo, RemoteGameHost } from '../net/remoteGameHost';
import { gameEndProps, gameStartProps } from './analyticsProps';

/**
 * A game on the server (work plan stage 7, spec §16–§18), with the surface the game screen uses for a practice
 * session (session.ts): `host` (the GameHost interface: here a RemoteGameHost), `clock` (the SERVER's clock,
 * synced by ping/pong, which every deadline of the view is in), getView, subscribe, close, and endPractice,
 * which in a ranked game is the surrender (spec §6.6: after the player confirmed).
 *
 * Unlike a practice nothing is saved on the phone: the server keeps the ranked game (spec §16.2; stage 9
 * stores it). Analytics (spec §22): game_start when this session sees the game begin (its first snapshot is
 * the game as created, before the start: a rejoin mid-game is not a new start) and game_end when it sees
 * the end; `reconnect` and `latency_sample` come from the host itself. The end (or leaving a running game) also
 * goes to `onEnd`, so the account's rating follows the game however the screens are left.
 *
 * Before the game there is no view: `online` (the host's OnlineInfo) says what to show instead (connecting,
 * the lobby, a refusal). Pure: no React Native; the host comes in ready made (net/device.ts on the phone, a
 * fake server in tests).
 *
 * A friends room (1.0.4, net/friends.ts): the session enters with the seat its ticket reserved, or without one
 * (a retry, the app opened again) through `friends.rejoin`. Its game is a ranked game without ratings: the same
 * analytics, with `friends: true` on game_start and game_end; and the room's own (protocol telemetry.ts,
 * generation 3): friends_room_start when its countdown begins, friends_room_close when this player is out of it
 * before its game (left, put out, or the room closed). Never a code or an id in them.
 */

/**
 * How the session gets into its room: a new private room (dev, stage 7), one by its code, or (stage 9) the
 * seat matchmaking reserved for this player in a ranked match's room (net/matchmaking.ts, at "found").
 */
export type OnlineRequest =
  | { kind: 'create'; options: DevRoomOptions }
  /** `gameType`: what a rejoined match's room plays, before its game says so. */
  | { kind: 'join'; code: string; gameType?: GameType }
  | { kind: 'match'; queueKey: QueueKey; matchId: string; reservation: MatchSeatReservation }
  | FriendsRequest;

/**
 * A friends room (1.0.4): its 6-digit code, and the seat its ticket reserved, or null to take one through
 * `friends.rejoin` (POST /v1/rooms/join: a retry, the app opened again, the same account's own seat).
 */
export interface FriendsRequest {
  kind: 'friends';
  code: string;
  reservation: MatchSeatReservation | null;
  /** The room as its ticket described it (its host, its game type), until the lobby says more. */
  room?: FriendRoomSummary | null;
  /** The game type before the lobby or the game says so. */
  gameType?: GameType;
}

/** The connection, as the game screen follows it. */
export interface SessionConnection {
  readonly info: OnlineInfo;
  subscribe(listener: (info: OnlineInfo) => void): () => void;
  /** The game's grace period (its rules; a dev room may shorten it); null before the game. */
  readonly graceMs: number | null;
  /**
   * The game's soft phase before that grace [D42] (rules.softGraceMs; 0 from an older server without one);
   * null before the game.
   */
  readonly softGraceMs: number | null;
}

/**
 * What a friends room's session needs (1.0.4, net/friends.ts; the game store's startFriends): a RemoteGameHost
 * that has joined nothing yet, and the way back into the room without a reservation (POST /v1/rooms/join), for
 * its returns and for "נסה שוב". Here, with the session, so net/friends.ts (pure) needs nothing of the store.
 */
export interface FriendsSessionDeps {
  makeHost: () => RemoteGameHost;
  rejoin: FriendsRejoin;
}

/** The analytics an online session sends: the game's, and a friends room's (protocol telemetry.ts, gen 3). */
export type OnlineTrackName = 'game_start' | 'game_end' | 'friends_room_start' | 'friends_room_close';

export type OnlineTrack = (name: OnlineTrackName, props: Record<string, string | number | boolean>) => void;

/**
 * A player's public profile beyond what the game's config says: their avatar and country. A ranked match has
 * them from matchmaking's "found" (protocol MatchPlayer); the game screen and the results draw opponents with
 * them (screens/game SessionProfile). "found" also gives their name and rating, for the loading card of a
 * match's room (Loading.dc.html) before the game's snapshot names them.
 */
export interface OnlineProfile {
  /** protocol AvatarId, or av00. */
  avatarId: string | null;
  /** ISO alpha-2. */
  country: string | null;
  name?: string;
  /** In the match's rating key. */
  rating?: number;
  /** Still in the first 10 games of that key. */
  provisional?: boolean;
}

export type OnlineProfiles = Readonly<Partial<Record<PlayerId, OnlineProfile>>>;

/**
 * How this session's game ended for this player: it is over (`left` false), or the session closed while it ran
 * (`left` true: the server's grace runs, then abandonment [D32]). The session says it whatever the screens do
 * (Android back from the results, the game screen's home, leaving a running game); what it means for the
 * account's numbers is decided elsewhere (game/rankedEnd.ts, progress/rankedRefresh.ts).
 */
export interface OnlineEnd {
  state: GameState;
  playerId: PlayerId;
  left: boolean;
}

export interface OnlineSessionDeps {
  host: RemoteGameHost;
  request: OnlineRequest;
  track?: OnlineTrack;
  /** Where a failed create or join is reported (the host's `online` shows it too). */
  onError?: (error: OnlineError) => void;
  /** The players' avatars and countries, when known before the game (a ranked match's "found"). */
  profiles?: OnlineProfiles | null;
  /** The game's end, once (see OnlineEnd); a listener that throws breaks nothing. */
  onEnd?: (end: OnlineEnd) => void;
  /** A friends room's way in without a reservation (request kind 'friends'): net/friends.ts. */
  friends?: { rejoin: FriendsRejoin } | null;
}

let sessions = 0;

export class OnlineSession {
  readonly kind = 'online' as const;
  readonly mode: GameMode = 'ranked';
  /** Unique per session (a retry is a new session): React keys. */
  readonly key: string;
  readonly host: RemoteGameHost;
  readonly request: OnlineRequest;
  /** The server's clock: what the view's deadlines (expiresAt, graceEndsAt) are in. */
  readonly clock: Clock;
  readonly connection: SessionConnection;
  /** Settles once the room is joined or refused (never rejects: the refusal is in `online`). */
  readonly ready: Promise<void>;
  /** The players' avatars and countries by id (a ranked match's); null for a room by code. */
  readonly profiles: OnlineProfiles | null;

  private started = false;
  private ended = false;
  private closed = false;
  private readonly unsubscribe: () => void;
  private readonly track: OnlineTrack | undefined;
  private readonly onEnd: ((end: OnlineEnd) => void) | undefined;
  /**
   * A friends room's own analytics: when this player got into the room (the server's clock), whether this
   * session saw its lobby (a retry back into a running game did not: nothing to count), and whether it is past
   * the lobby (the countdown or the game) or was out of it before (each is counted once).
   */
  private friendsTrack: {
    enteredAt: number | null;
    sawLobby: boolean;
    pastLobby: boolean;
    closeSent: boolean;
    unsubscribe: () => void;
  } | null = null;

  constructor({ host, request, track, onError, profiles = null, onEnd, friends = null }: OnlineSessionDeps) {
    this.key = `online-${++sessions}`;
    this.host = host;
    this.request = request;
    this.profiles = profiles;
    this.clock = host.clock;
    this.track = track;
    this.onEnd = onEnd;
    const self = this;
    this.connection = {
      get info() {
        return self.host.online;
      },
      subscribe: (listener) => self.host.subscribeOnline(listener),
      get graceMs() {
        return self.graceMs;
      },
      get softGraceMs() {
        return self.softGraceMs;
      },
    };
    // Before any screen: the start and the end are counted however the screens come and go.
    this.unsubscribe = host.subscribe((update) => this.onUpdate(update));
    if (request.kind === 'friends') {
      if (!friends) throw new Error('A friends room needs friends.rejoin (net/friends.ts)');
      this.friendsTrack = {
        enteredAt: null,
        sawLobby: false,
        pastLobby: false,
        closeSent: false,
        unsubscribe: host.subscribeOnline((info) => this.onFriendsInfo(info)),
      };
    }
    const open =
      request.kind === 'create'
        ? host.create(request.options)
        : request.kind === 'join'
          ? host.join(request.code)
          : request.kind === 'friends'
            ? host.enterFriends(request.code, request.reservation, friends!.rejoin)
            : host.enterReserved(request.reservation);
    this.ready = open.then(
      () => {
        if (this.friendsTrack && this.friendsTrack.enteredAt === null && !this.closed)
          this.friendsTrack.enteredAt = this.clock.now();
      },
      (error: OnlineError) => {
        onError?.(error);
      },
    );
  }

  /** The game's id once the server sent it; before that, this session's own key. */
  get id(): string {
    return this.host.game?.config.id ?? this.key;
  }

  /** This player, as the server named it ('' until the lobby or the snapshot). */
  get playerId(): PlayerId {
    return this.host.playerId;
  }

  get online(): OnlineInfo {
    return this.host.online;
  }

  /** The game's type: the server's word once the game (or the lobby) came, else what was asked for. */
  get gameType(): GameType {
    return (
      this.host.game?.config.gameType ??
      this.host.online.lobby?.gameType ??
      (this.request.kind === 'create' ? this.request.options.gameType : undefined) ??
      (this.request.kind === 'join' ? this.request.gameType : undefined) ??
      (this.request.kind === 'match' ? parseQueueKey(this.request.queueKey)?.gameType : undefined) ??
      (this.request.kind === 'friends'
        ? (this.request.gameType ?? this.request.room?.gameType)
        : undefined) ??
      'fast'
    );
  }

  /**
   * A friends room's game (1.0.4): never rated [D81a], kept in the history with its replay, and not a game for
   * "עוד סיבוב".
   */
  get isFriends(): boolean {
    return this.request.kind === 'friends';
  }

  /** A friends room's 6-digit code; null for any other room. */
  get friendsCode(): string | null {
    return this.request.kind === 'friends' ? this.request.code : null;
  }

  /** The matchmaking queue a ranked match came from (stage 9); null for a room by code. */
  get queueKey(): QueueKey | null {
    return this.request.kind === 'match' ? this.request.queueKey : null;
  }

  /** A game is here: getView() works. */
  get hasGame(): boolean {
    return this.host.game !== null;
  }

  /** The game's grace period (rules.graceMs, a dev room may shorten it); null before the game. */
  get graceMs(): number | null {
    return this.host.game?.config.rules.graceMs ?? null;
  }

  /** The game's soft phase of a lost connection [D42] (0 when its rules have none); null before the game. */
  get softGraceMs(): number | null {
    const rules = this.host.game?.config.rules;
    return rules ? (rules.softGraceMs ?? 0) : null;
  }

  getView(): GameView {
    return this.host.getView();
  }

  subscribe(onUpdate: (update: HostUpdate) => void): () => void {
    return this.host.subscribe(onUpdate);
  }

  subscribeOnline(listener: (info: OnlineInfo) => void): () => void {
    return this.host.subscribeOnline(listener);
  }

  /** Ranked (spec §6.6): the surrender, once the player confirmed; with 2 players an immediate loss. */
  endPractice(): void {
    this.surrender();
  }

  surrender(): void {
    if (this.closed || this.host.game?.status === 'over') return;
    this.host.surrender();
  }

  /**
   * Leaves the room (during a game the server's grace runs, then abandonment [D32]) and stops every timer. A
   * friends room's lobby: its "יציאה מהחדר", which frees the seat at once.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Left while the game runs: the server ends it for this player when the grace runs out.
    const game = this.host.game;
    if (!this.ended && game && game.status !== 'over')
      this.ends({ state: game, playerId: this.playerId, left: true });
    this.unsubscribe();
    // The host's last word (closed, 'left') still reaches the friends room's analytics.
    this.host.close();
    this.friendsTrack?.unsubscribe();
  }

  // -----------------------------------------------------------------------------------------------------

  private onUpdate(update: HostUpdate): void {
    if (update.kind !== 'events') return;
    const state = this.host.game;
    if (!state) return;
    // The first snapshot is the game as created ('waiting'): this session sees it begin.
    if (!this.started && update.events.length === 0 && state.status === 'waiting') {
      this.started = true;
      this.send('game_start', {
        ...gameStartProps(state.config.mode, state.config.gameType, players(state)),
        ...this.friendsFlag(),
      });
    }
    if (!this.ended && state.status === 'over' && state.result) {
      this.ended = true;
      this.send('game_end', {
        ...gameEndProps(state.config.mode, state.result, this.playerId),
        ...this.friendsFlag(),
      });
      this.ends({ state, playerId: this.playerId, left: false });
    }
  }

  /** `friends: true` on a friends room's game_start and game_end (protocol telemetry.ts). */
  private friendsFlag(): { friends?: true } {
    return this.isFriends ? { friends: true } : {};
  }

  /**
   * A friends room's own analytics, from the host's connection info: friends_room_start when the countdown
   * begins (the players in the game: the seats not away), friends_room_close when this player is out of the
   * room before it (left on purpose, put out by the server, or it closed). A failed way in is not a close: the
   * join's own event says how it ended (net/friends.ts).
   */
  private onFriendsInfo(info: OnlineInfo): void {
    const t = this.friendsTrack;
    if (!t || t.pastLobby || t.closeSent) return;
    const players = info.lobby?.players ?? [];
    if (info.startsAt != null || info.hasGame) {
      t.pastLobby = true;
      // A session that came back into a running game (a retry) saw no lobby: its start was counted before.
      if (!t.sawLobby) return;
      const inGame = players.filter((p) => !p.away).length;
      this.send('friends_room_start', {
        players: this.host.game?.config.players.length ?? Math.max(inGame, 1),
        waitedSec: this.waitedSec(),
      });
      return;
    }
    if (info.status === 'lobby' && info.lobby) t.sawLobby = true;
    if (info.status !== 'closed' || t.enteredAt === null || !t.sawLobby) return;
    t.closeSent = true;
    this.send('friends_room_close', {
      reason: closeReasonOf(info),
      players: Math.max(players.length, 1),
      waitedSec: this.waitedSec(),
    });
  }

  /** Whole seconds since this player got into the friends room. */
  private waitedSec(): number {
    const at = this.friendsTrack?.enteredAt;
    return at == null ? 0 : Math.max(0, Math.round((this.clock.now() - at) / 1000));
  }

  private send(name: OnlineTrackName, props: Record<string, string | number | boolean>): void {
    try {
      this.track?.(name, props);
    } catch {
      // Analytics never breaks a game.
    }
  }

  private ends(end: OnlineEnd): void {
    try {
      this.onEnd?.(end);
    } catch {
      // The account's refresh never breaks a game.
    }
  }
}

const players = (state: GameState): number => state.config.players.length;

/**
 * Why this player was out of a friends room before its game (protocol FriendsCloseReason): left on purpose, the
 * server's own reason, or `abandoned` for a room that closed otherwise (or could not be come back to).
 */
function closeReasonOf(info: OnlineInfo): FriendsCloseReason {
  if (info.closeReason === 'left') return 'left';
  const reason = info.friends?.closed;
  if (reason && reason !== 'closed') return reason;
  return 'abandoned';
}

/** Whether a session in the store is an online one. */
export const isOnlineSession = (session: unknown): session is OnlineSession =>
  session instanceof OnlineSession;
