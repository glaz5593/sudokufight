import {
  type CellIndex,
  type ClientAction,
  type Clock,
  type Digit,
  evolve,
  type GameEvent,
  type GameState,
  type GameType,
  type GameView,
  type HostUpdate,
  type InterferenceKind,
  isSoftOffline,
  type LocalLock,
  offlinePlayable,
  type PlayerId,
  type RejectReason,
  type Scheduler,
  toView,
} from '@sudoku-fight/engine';
import {
  type ClientMessage,
  type FriendsLobbyCommand,
  type FriendsLobbyRefused,
  type FriendsRoomClosedReason,
  type GameHost,
  type LobbyPlayer,
  type MatchSeatReservation,
  PROTOCOL_VERSION,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { ClockSync, type ClockSyncOptions, TokenBucket } from './clockSync';
import { OnlineError, onlineErrorOf } from './errors';
import { type InFlight, type MetricsTrack, NetMetrics, type NetMetricsOptions } from './metrics';
import { OfflinePlayBook, type QueuedMove, type ReturnPlan } from './offlinePlay';
import type { DevRoomOptions, OnlineClient, RoomLike } from './onlineClient';

/**
 * RemoteGameHost: a game on the server behind the same GameHost interface as the engine's LocalGameHost
 * (spec §17.2, §18), so the game screen can't tell them apart. The server is authoritative; this host only
 * mirrors it:
 *
 * - The game: the snapshot's public state (no solution while it runs), moved on with the engine's evolve()
 *   over every event above its seq (duplicates are skipped, events that come early wait for the missing
 *   ones), and drawn with toView(state, me, serverNow()). Each change goes to subscribers as a HostUpdate,
 *   like LocalGameHost's; an 'events' update with no events means the picture changed without an event (a
 *   snapshot, or the solution after the end). Actions go out with a growing clientSeq that carries on from
 *   the snapshot's lastClientSeq; refusals come back as 'rejected'. While offline an action is refused here
 *   with 'disconnected' (spec §16.2: the board is locked while reconnecting), but in the soft phase (below).
 * - Optimistic select (spec §18): a tapped cell shows as pending (`pendingCell`, for boardModel's pending
 *   option) until its lock or refusal arrives, or `pendingTimeoutMs` passes (a rate-limited message gets no
 *   answer at all). A digit's result only ever comes from the server.
 * - The clock: ping/pong every `pingEveryMs` (a burst at every join), and the offset from ClockSync;
 *   serverNow() = phone time + offset, the clock the view's deadlines (expiresAt) are in.
 * - Connection (spec §16.2): a drop (or `silenceTimeoutMs` without a word from the server, or an action with
 *   nothing heard for `answerTimeoutMs`) turns to 'reconnecting' and comes back with the reconnection token,
 *   with backoff, until the soft phase and the grace period are over (+ the time the server may take to
 *   notice, + 1 s); when the server holds no seat for the token but the room is alive, it rejoins by code with
 *   the same identity. Giving up is 'closed' with 'lostConnection'. The token is a bearer secret: in memory
 *   only, never logged. Once the game is over nothing reconnects: a drop, a silence or a gap after the end
 *   closes the host as 'gameOver' (the result is here already).
 * - The soft phase [D42] (Moshe, 2026-10-15): for rules.softGraceMs after the loss the game goes on for
 *   everyone, and this player plays on here (OfflinePlayBook): a tap locks the cell locally with its own
 *   countdown, and a digit is queued as "waiting" (`online.queuedMoves`); interferences, reactions and the
 *   surrender stay refused. The select or digit the server had not answered when the connection went is
 *   carried into it. Back (the snapshot), the queue goes out as `offlineMove` in order (the moves the
 *   snapshot already settles are dropped) and a cell held here without a digit is selected again; the server
 *   decides each on the board as it is then, and a refused one comes back as 'rejected' (lost, no penalty).
 *   A lock of mine the server kept on a cell let go of here is released there first. A game frozen at the
 *   return (another player still away, or me until the server's playerReconnected) would refuse all of it
 *   ('paused'): it waits for gameResumed, and the engine keeps the move window for it meanwhile. A sent move
 *   with no answer after `offlineAnswerTimeoutMs` (the server dropped it) goes out again.
 *   A return inside the soft phase shows no "back, all synced" banner (`resyncedAt` is left as it was).
 *   After the phone's own soft phase nothing more is played here (the hard phase: the board locked); the
 *   queue waits for the return. An older server (rules without softGraceMs) gets none of this.
 * - Diagnostics: `log` lines say what happened (no token, no names), and `report` gets what the host survived
 *   but must not hide (a listener that threw, a message that broke the mirror); release builds send both to
 *   Crashlytics (net/device.ts).
 * - AppState (work plan, stage 7): the app going to the background during a game is a disconnect (the socket
 *   closes, the token is kept); back in the foreground it reconnects at once.
 * - Measures (spec §18): see NetMetrics; reconnect time is from starting to come back to the snapshot, sync
 *   time from the snapshot to the game being current again (this player out of the soft phase too). A return
 *   is reported as track('reconnect'), with its phase ('soft' or 'hard') and the moves queued offline.
 * - Ranked matches (stage 9): enterReserved() takes the seat matchmaking reserved (net/matchmaking.ts); the
 *   room's 3… 2… 1… shows as `online.startsAt`, and the game comes at GO like any other.
 * - Friends rooms (1.0.4, protocol friends.ts): enterFriends() takes the seat a ticket of our HTTP routes
 *   reserved (net/friends.ts). The room's code is its 6 digits, never the Colyseus roomId; the lobby carries the
 *   host and each seat's avatar, flag, rating and `away`; the host's commands go out with sendLobbyCommand(),
 *   and a refusal shows as `online.friends.refused`. The seat is held while the app is away [D84a], so the
 *   background in the lobby is a disconnect here too (the others see "לא בחדר כרגע"), and the way back is the
 *   token, or, without a seat for it (or no token at all: a retry, the app opened again), a fresh reservation
 *   from POST /v1/rooms/join with the room's code (`rejoin`), which gives the same account its own seat. The
 *   server's `roomClosed` (kicked, removed, another device, a restart) closes the host at once, with its reason
 *   in `online.friends.closed`: nothing reconnects after it.
 *
 * Pure: the SDK is behind OnlineClient, and the clock, timers, AppState and analytics are injected, so the same
 * code runs in Jest against a fake room and in Node against the real server.
 */

export type OnlineStatus = 'connecting' | 'lobby' | 'live' | 'reconnecting' | 'closed';

export type CloseReason =
  /** close() was called: the player left (during a game the server's grace runs, then abandonment [D32]). */
  | 'left'
  /** The game is over and the server closed the room. */
  | 'gameOver'
  /** The server closed the room before the game ended. */
  | 'serverClosed'
  /** Could not come back after a drop: the grace ran out, or the room is gone. See `error`. */
  | 'lostConnection'
  /** The server would not let this player in (create or join). See `error`. */
  | 'refused'
  /** The server speaks another protocol version: the app needs an update. */
  | 'protocol';

export interface LobbyInfo {
  code: string;
  gameType: GameType;
  playerCount: number;
  players: LobbyPlayer[];
  /** A friends room (1.0.4): the host, who alone sends the lobby commands [D84b]. Absent elsewhere. */
  hostId?: PlayerId;
  /** A friends room: `start` needs at least this many connected players. */
  minPlayers?: number;
  /** A friends room: at most this many seats. */
  maxPlayers?: number;
}

/** A friends room's own state (1.0.4, protocol friends.ts), in OnlineInfo.friends. */
export interface FriendsHostInfo {
  /** The room's 6-digit code (never its Colyseus roomId). */
  code: string;
  /** Why the server put this connection out of the room (its `roomClosed`); null until it did. */
  closed: FriendsRoomClosedReason | null;
  /**
   * The latest lobby command of mine the server refused (`lobbyRefused`), numbered so the same refusal twice
   * is two changes; null before any.
   */
  refused: (FriendsLobbyRefused & { seq: number }) | null;
}

/**
 * Back into a friends room without a seat for the token (or with no token at all): a fresh seat reservation
 * from POST /v1/rooms/join with the room's code, which gives the same account its own seat [D84a]. A refusal
 * rejects with an OnlineError (net/errors.ts onlineErrorOfFriends).
 */
export type FriendsRejoin = (code: string) => Promise<MatchSeatReservation>;

export interface ReconnectInfo {
  /** Why: the connection dropped, or the app went to the background. */
  cause: 'drop' | 'background';
  /** Attempts so far, for "reconnecting… attempt 2" (spec §16.2); 0 while waiting for the foreground. */
  attempt: number;
  /** Phone time when the connection was lost. */
  since: number;
  /** The same moment in the server's clock, like the view's deadlines (for the countdowns). */
  lostAt: number;
  /**
   * The end of the soft phase as this phone reckons it (server clock: lostAt + rules.softGraceMs) [D42]: until
   * then the game goes on and nothing about the connection is shown. Null when the game has none.
   */
  softEndsAt: number | null;
  /** When the server calls it abandonment, as this phone reckons it (lostAt + the soft phase + the grace). */
  graceEndsAt: number;
  /** Phone time after which it gives up. */
  deadline: number;
  /** A room took this player back; the fresh snapshot is on its way. */
  resyncing: boolean;
}

/** The connection as the screens show it; a new object on every change. */
export interface OnlineInfo {
  status: OnlineStatus;
  /** Set once closed. */
  closeReason: CloseReason | null;
  /** What went wrong, when something did (refused, lost). */
  error: OnlineError | null;
  /** The room's code. */
  code: string | null;
  /** This player, once the server said (lobby or snapshot). */
  playerId: PlayerId | null;
  /** Who is in the room so far. */
  lobby: LobbyInfo | null;
  /** While reconnecting. */
  reconnect: ReconnectInfo | null;
  /** The cell tapped whose lock the server has not confirmed yet (spec §18). */
  pendingCell: CellIndex | null;
  /** A game is here (the first snapshot came): getView() works. */
  hasGame: boolean;
  /**
   * Server time when the latest return's snapshot came after the hard phase (the "back in the game" banner);
   * null before any. A return inside the soft phase leaves it as it was [D42].
   */
  resyncedAt: number | null;
  /**
   * While the connection is lost and the game has a soft phase [D42]: since when, until when (server clock),
   * and whether this player plays on here meanwhile. Null otherwise.
   */
  offlinePlay: { since: number; softEndsAt: number; playable: boolean } | null;
  /** Digits entered offline, waiting for the server's answer (the board shows them as "waiting"); oldest first. */
  queuedMoves: readonly QueuedMove[];
  /**
   * The other players whose absence (still on, or ended by abandonment) began hard, with no soft phase [D42]: a
   * deliberate leave, a seat empty at GO. "The opponent left" counts their grace alone. Absent or empty when
   * none is known: an absence first seen in a snapshot counts as a dropped connection.
   */
  hardLeavers?: readonly PlayerId[];
  /**
   * A ranked match's room (stage 9): GO, in the server's clock, once everyone is in and its 3… 2… 1… runs
   * (protocol GameRoomCountdown); the snapshot follows at GO. Null (or absent) otherwise. A friends room's too,
   * once its host started it.
   */
  startsAt?: number | null;
  /** A friends room (1.0.4): its code, why it put me out, my refused command. Absent for any other room. */
  friends?: FriendsHostInfo;
}

/** What RemoteGameHost needs of React Native's AppState. */
export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

export interface RemoteHostOptions {
  /** A ping this often (ms). */
  pingEveryMs: number;
  /** Pings at every join, for a quick first sync… */
  pingBurst: number;
  /** …this far apart (ms). */
  pingBurstGapMs: number;
  /** The server's rate limit for pings (spec §21); never gone over. */
  pingLimit: { limit: number; windowMs: number };
  /** A select with no answer after this long stops showing as pending (a rate-limited one never gets one). */
  pendingTimeoutMs: number;
  /** Nothing from the server for this long while connected: the connection is taken for dropped. */
  silenceTimeoutMs: number;
  /** An event that came before the one it follows waits this long for it; then a fresh snapshot is fetched. */
  gapTimeoutMs: number;
  /** The wait before reconnect attempt 1, 2, …; the last one repeats. */
  reconnectDelaysMs: readonly number[];
  /** An attempt with no answer after this long counts as failed (a late success is still taken). */
  attemptTimeoutMs: number;
  /** The server keeps a dropped seat this much longer than the game's grace (GameRoom's RECONNECT_SLACK_MS). */
  reconnectSlackMs: number;
  /** How long the server may take to notice a silent phone (its heartbeat), added to the deadline. */
  serverNoticeMs: number;
  /** The grace period before there is a game to read it from. */
  defaultGraceMs: number;
  /**
   * The soft phase before there is a game to read it from [D42] (a drop in a match's countdown is soft at GO).
   * A game's rules without one (an older server) count as 0.
   */
  defaultSoftGraceMs: number;
  /**
   * An action sent, and nothing at all heard from the server for this long: the connection is taken for lost
   * at once (a dead network sends no close) [D42]. A false alarm costs a moment of play offline. 0: off.
   */
  answerTimeoutMs: number;
  /**
   * A move made offline that was sent and has no answer after this long (the server dropped the message, e.g.
   * over its rate limit, while the connection itself is fine) is sent again [D42]. 0: off.
   */
  offlineAnswerTimeoutMs: number;
  /**
   * A friends room's lobby holds the seat for hours [D84a]: after a drop, or back from the background, the host
   * tries this long to come back before it gives up (then "נסה שוב" rejoins by the code).
   */
  friendsLobbyReturnMs: number;
  clock: ClockSyncOptions;
  metrics: Omit<NetMetricsOptions, 'track'>;
}

export const DEFAULT_REMOTE_HOST_OPTIONS: RemoteHostOptions = {
  pingEveryMs: 2000,
  pingBurst: 5,
  pingBurstGapMs: 100,
  pingLimit: { limit: 5, windowMs: 2500 },
  pendingTimeoutMs: 2000,
  silenceTimeoutMs: 6000,
  gapTimeoutMs: 1000,
  reconnectDelaysMs: [250, 500, 1000],
  attemptTimeoutMs: 5000,
  reconnectSlackMs: 1000,
  serverNoticeMs: 4500,
  defaultGraceMs: 15_000,
  defaultSoftGraceMs: 10_000,
  answerTimeoutMs: 2_500,
  offlineAnswerTimeoutMs: 3_000,
  friendsLobbyReturnMs: 60_000,
  clock: {},
  metrics: {},
};

export interface RemoteHostDeps {
  client: OnlineClient;
  /** The phone's clock: epoch ms. */
  clock: Clock;
  scheduler: Scheduler;
  /** React Native's AppState; none: the background is not watched (tests, Node). */
  appState?: AppStateLike | null;
  /** Analytics (latency_sample, reconnect). */
  track?: MetricsTrack;
  /**
   * Diagnostics (release builds: Crashlytics breadcrumbs, net/device.ts). Never gets the reconnection token,
   * a name or anything else about a player: what happened, codes and counts.
   */
  log?: (line: string) => void;
  /**
   * An error the host survived but must not hide (release builds: a Crashlytics non-fatal): a listener that
   * threw while being told an update ('listener failed', 'online listener failed'), or a server message that
   * broke the mirror ('message failed', the host then fetches a fresh snapshot).
   */
  report?: (error: unknown, context: HostFailure) => void;
  options?: Partial<RemoteHostOptions>;
}

/** What RemoteHostDeps.report is told about. */
export type HostFailure = 'listener failed' | 'online listener failed' | 'message failed';

const CONSENTED = 4000;
/** Errors after which coming back is pointless: the room is gone, or it won't take this player. */
const FATAL_ON_RETURN = new Set<OnlineError['code']>([
  'notFound',
  'roomGone',
  'gameStarted',
  'unauthenticated',
  'suspended',
  'badCode',
  'protocol',
  // A friends room's: removed by its host, closed, blocked, or a server without the routes.
  'kicked',
  'roomClosed',
  'cantJoin',
  'notAvailable',
]);
/** Actions remembered for their refusals. */
const SENT_KEPT = 64;

type Attempt = { room: RoomLike } | { error: OnlineError };

export class RemoteGameHost implements GameHost {
  readonly metrics: NetMetrics;
  readonly sync: ClockSync;
  /** The server's clock (phone time + offset): what the view's deadlines are in. */
  readonly clock: Clock = { now: () => this.serverNow() };

  private readonly deps: RemoteHostDeps;
  private readonly opts: RemoteHostOptions;
  private readonly pingBucket: TokenBucket;

  private room: RoomLike | null = null;
  /** Bearer secret: memory only, never logged. */
  private token: string | null = null;
  private code: string | null = null;
  private me: PlayerId | null = null;
  private state: GameState | null = null;
  private solutionText: string | null = null;
  private lobby: LobbyInfo | null = null;
  private status: OnlineStatus = 'connecting';
  private closeReason: CloseReason | null = null;
  private error: OnlineError | null = null;
  private closed = false;
  private started = false;
  /** A friends room (1.0.4): its code, the way back without a token, and what its server said. */
  private friends: {
    code: string;
    rejoin: FriendsRejoin;
    closed: FriendsRoomClosedReason | null;
    refused: (FriendsLobbyRefused & { seq: number }) | null;
  } | null = null;
  private refusedSeq = 0;

  private clientSeq = 0;
  private readonly sent = new Map<number, ClientAction>();
  private pending: { cell: CellIndex; clientSeq: number; timer: unknown } | null = null;
  /** Events above the next seq, waiting for the ones before them. */
  private readonly ahead = new Map<number, GameEvent>();
  private gapTimer: unknown = null;

  private tickTimer: unknown = null;
  private readonly burstTimers = new Set<unknown>();
  private lastHeardAt = 0;

  /** Bumped by every new connection, background and close: an older reconnect loop knows it lost. */
  private run = 0;
  private lost: ReconnectInfo | null = null;
  private resyncedAt: number | null = null;
  private startsAt: number | null = null;
  /**
   * After a drop: when coming back started, and when its snapshot came; then whether the return was inside the
   * soft phase, and how many moves made offline it brought (for track('reconnect')).
   */
  private comingBack: {
    startedAt: number;
    snapshotAt: number | null;
    phase: 'soft' | 'hard';
    queued: number;
  } | null = null;
  /** Playing on while the connection is lost [D42]: the local lock and the queue. */
  private readonly offline = new OfflinePlayBook();
  /** Wakes the picture of the play offline when something in it runs out (a lock, the soft phase). */
  private offlineTimer: unknown = null;
  /** What was on its way when the connection last went (NetMetrics.unanswered()), for the play offline. */
  private inFlightAtLoss: InFlight[] = [];
  /** A return's moves made offline (and its cells), held back while the game is frozen [D42]. */
  private flushOnResume: ReturnPlan | null = null;
  /** The watch for the answers of moves made offline (offlineAnswerTimeoutMs). */
  private offlineAnswerTimer: unknown = null;
  /** How each other player's absence began [D42]: a drop ('soft') or 'hard' at once; none while they are here. */
  private readonly absences = new Map<PlayerId, 'soft' | 'hard'>();
  /** Phone time of the last action sent, and the watch for its answer (answerTimeoutMs). */
  private lastSentAt = 0;
  private answerTimer: unknown = null;
  private backgrounded = false;
  private readonly sleepers = new Set<() => void>();
  private appStateSub: { remove(): void } | null = null;

  private readonly listeners = new Set<(update: HostUpdate) => void>();
  private readonly onlineListeners = new Set<(info: OnlineInfo) => void>();
  private readonly outbox: HostUpdate[] = [];
  private delivering = false;
  private info: OnlineInfo;

  constructor(deps: RemoteHostDeps) {
    this.deps = deps;
    this.opts = { ...DEFAULT_REMOTE_HOST_OPTIONS, ...deps.options };
    this.sync = new ClockSync(this.opts.clock);
    this.metrics = new NetMetrics({ ...this.opts.metrics, track: deps.track });
    this.pingBucket = new TokenBucket(
      this.opts.pingLimit.limit,
      this.opts.pingLimit.windowMs,
      deps.clock.now(),
    );
    this.info = this.makeInfo();
    this.appStateSub = deps.appState?.addEventListener('change', (s) => this.onAppState(s)) ?? null;
  }

  // -- connecting ----------------------------------------------------------------------------------------

  /** Creates a private room and joins it (dev, stage 7); resolves with its code. */
  async create(options: DevRoomOptions = {}): Promise<string> {
    await this.enter(() => this.deps.client.create(options));
    return this.code!;
  }

  /** Joins the room with this code (as typed). */
  async join(code: string): Promise<void> {
    await this.enter(() => this.deps.client.join(code));
  }

  /**
   * Takes the seat matchmaking reserved in a ranked match's room (stage 9, protocol matchmaking.ts `found`):
   * being connected is being ready (D37). The room's countdown shows in `online.startsAt`, and the game comes
   * at GO as in any room; a drop after that comes back by token or by the room's code, as in any game.
   */
  async enterReserved(reservation: MatchSeatReservation): Promise<void> {
    await this.enter(() => this.deps.client.consumeSeatReservation(reservation));
  }

  /**
   * Into a friends room (1.0.4, protocol friends.ts) with the 6-digit `code`: the seat its ticket reserved, or,
   * with none (a retry, the app opened again), a fresh one from `rejoin`. Being connected is being in the lobby;
   * the game comes after the host's start (`online.startsAt`, then the snapshot at GO), as in a ranked match.
   */
  async enterFriends(
    code: string,
    reservation: MatchSeatReservation | null,
    rejoin: FriendsRejoin,
  ): Promise<void> {
    if (this.started) throw new Error('This host has joined a room already');
    this.friends = { code, rejoin, closed: null, refused: null };
    this.code = code;
    this.notifyOnline();
    await this.enter(async () =>
      this.deps.client.consumeSeatReservation(reservation ?? (await rejoin(code))),
    );
  }

  private async enter(open: () => Promise<RoomLike>): Promise<void> {
    if (this.started) throw new Error('This host has joined a room already');
    this.started = true;
    let room: RoomLike;
    try {
      room = await open();
    } catch (error) {
      const e = onlineErrorOf(error);
      this.shutdown('refused', e);
      throw e;
    }
    if (this.closed) {
      void room.leave(true).catch(() => undefined);
      throw new OnlineError('unknown', 'The host was closed while joining');
    }
    this.attach(room);
    this.setStatus('lobby');
  }

  // -- GameHost ------------------------------------------------------------------------------------------

  /** This player: the server's word once it spoke (lobby or snapshot). */
  get playerId(): PlayerId {
    return this.me ?? '';
  }

  /**
   * The game as this player sees it now. Only once a game is here (`online.hasGame`). While the connection is
   * lost in the soft phase [D42], with the play offline on it: the local lock, and the player marked.
   */
  getView(): GameView {
    if (!this.state) throw new Error('No game yet: wait for the first snapshot');
    const now = this.serverNow();
    const shown = this.me !== null ? this.offline.overlay(this.state, this.me, now) : this.state;
    return toView(shown, this.me, now);
  }

  subscribe(onEvent: (update: HostUpdate) => void): () => void {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  select(cell: CellIndex): void {
    this.act({ type: 'select', cell });
  }

  release(): void {
    this.act({ type: 'release' });
  }

  place(cell: CellIndex, digit: Digit): void {
    this.act({ type: 'place', cell, digit });
  }

  interfere(targetId: PlayerId, kind: InterferenceKind): void {
    this.act({ type: 'interfere', targetId, kind });
  }

  react(emoji: string): void {
    this.act({ type: 'react', emoji });
  }

  /** After the player confirmed (spec §6.6); in a two-player game an immediate loss. */
  surrender(): void {
    this.act({ type: 'surrender' });
  }

  /** A tap level's move: no online game has one. Refused here ('badAction'), and never sent (not a wire action). */
  tap(cell: CellIndex): void {
    if (this.closed || !this.state) return;
    this.emit({ kind: 'rejected', action: { type: 'tap', cell }, reason: 'badAction', view: this.getView() });
  }

  /** The puzzle's move (1.0.3): no online game has one. Refused here ('badAction'), and never sent. */
  swapBoxes(from: number, to: number): void {
    if (this.closed || !this.state) return;
    this.emit({
      kind: 'rejected',
      action: { type: 'swapBoxes', from, to },
      reason: 'badAction',
      view: this.getView(),
    });
  }

  /** [D65] is for local play only: an online game never freezes for the app's background (onAppState). */
  pause(): void {
    // Nothing: the server's game runs on, and the background is a disconnect here.
  }

  resume(): void {
    // Nothing, as pause().
  }

  /** Leaves the room on purpose, and stops every timer and update. */
  close(): void {
    this.shutdown('left', null);
    this.listeners.clear();
    this.outbox.length = 0;
  }

  // -- beyond the interface ------------------------------------------------------------------------------

  /** The connection, for the banners and the lobby. */
  get online(): OnlineInfo {
    return this.info;
  }

  /** Every change of `online`. Returns the unsubscribe function. */
  subscribeOnline(listener: (info: OnlineInfo) => void): () => void {
    this.onlineListeners.add(listener);
    return () => this.onlineListeners.delete(listener);
  }

  /** The server's time now, as well as the phone knows it. */
  serverNow(): number {
    return this.deps.clock.now() + this.sync.offsetMs;
  }

  /** The game as held here (public: no solution while it runs); null before the first snapshot. */
  get game(): GameState | null {
    return this.state;
  }

  /** The solution: sent by the server only after gameOver (spec §21), for the replay. */
  get solution(): string | null {
    return this.solutionText;
  }

  /** The room's code (a friends room's 6 digits). */
  get roomCode(): string | null {
    return this.code;
  }

  /** A friends room (1.0.4): enterFriends() was its way in. */
  get isFriendsRoom(): boolean {
    return this.friends !== null;
  }

  /**
   * A friends room's lobby command (protocol FriendsLobbyCommand: the host's start, setGameType, kick), sent as
   * `room.send(command.type, command)`. Only while connected to the lobby, before the countdown; false when it
   * could not go. The server is the judge: a refusal comes back as `online.friends.refused`.
   */
  sendLobbyCommand(command: FriendsLobbyCommand): boolean {
    const room = this.room;
    if (
      !this.friends ||
      this.closed ||
      room === null ||
      this.status !== 'lobby' ||
      this.state !== null ||
      this.startsAt !== null
    )
      return false;
    try {
      room.send(command.type, command);
    } catch (error) {
      this.log(`send ${command.type} failed: ${messageOf(error)}`);
      this.dropConnection();
      return false;
    }
    this.log(`lobby command ${command.type}`);
    return true;
  }

  /** The cell tapped and not confirmed yet (spec §18): boardModel's `pendingCell`. */
  get pendingCell(): CellIndex | null {
    return this.pending?.cell ?? null;
  }

  // -- actions -------------------------------------------------------------------------------------------

  private act(action: ClientAction): void {
    if (this.closed || !this.state) return;
    const clientSeq = this.room !== null && this.status === 'live' ? this.send(action) : null;
    if (clientSeq === null) {
      // Offline: played here in the soft phase [D42], else refused (spec §16.2: the board is locked).
      if (!this.playOffline(action))
        this.emit({ kind: 'rejected', action, reason: 'disconnected', view: this.getView() });
      return;
    }
    if (action.type === 'select') this.setPending(action.cell, clientSeq);
  }

  /** Sends an action now; its clientSeq, or null when it could not go (the connection is taken for lost). */
  private send(action: ClientAction): number | null {
    const room = this.room;
    if (room === null) return null;
    const clientSeq = ++this.clientSeq;
    try {
      room.send(action.type, { ...action, clientSeq } as ClientMessage);
    } catch (error) {
      this.log(`send ${action.type} failed: ${messageOf(error)}`);
      this.dropConnection();
      return null;
    }
    const at = this.now();
    this.metrics.sent(clientSeq, action, at);
    this.sent.set(clientSeq, action);
    if (this.sent.size > SENT_KEPT) this.sent.delete(this.sent.keys().next().value!);
    this.lastSentAt = at;
    this.watchAnswer();
    return clientSeq;
  }

  /**
   * An action while the connection is lost, played here in the soft phase [D42]: a select locks the cell
   * locally, "ביטול בחירה" lets it go, a digit joins the queue. A refusal is the engine's reason, as the server
   * would give it. False when nothing is played here (no soft phase, it ran out, the app in the background, or
   * an action that needs the server: interferences, reactions, the surrender).
   */
  private playOffline(action: ClientAction): boolean {
    const state = this.state;
    const me = this.me;
    if (!state || me === null || !this.offline.active || this.backgrounded) return false;
    const now = this.serverNow();
    let refusal: RejectReason | null;
    switch (action.type) {
      case 'select':
        refusal = this.offline.select(state, me, action.cell, now);
        break;
      case 'release':
        refusal = this.offline.release(now);
        break;
      case 'place':
        refusal = this.offline.place(state, me, action.cell, action.digit, now);
        break;
      default:
        return false;
    }
    if (refusal) {
      this.emit({ kind: 'rejected', action, reason: refusal, view: this.getView() });
      return true;
    }
    if (action.type === 'place') {
      this.log(`a move queued offline (${this.offline.size})`);
      this.notifyOnline();
    }
    this.scheduleOfflineWake();
    this.emit({ kind: 'events', events: [], view: this.getView() });
    return true;
  }

  private setPending(cell: CellIndex, clientSeq: number): void {
    if (this.pending) this.deps.scheduler.clearTimeout(this.pending.timer);
    const timer = this.deps.scheduler.setTimeout(() => {
      if (this.pending?.clientSeq !== clientSeq) return;
      this.pending = null;
      this.notifyOnline();
    }, this.opts.pendingTimeoutMs);
    this.pending = { cell, clientSeq, timer };
    this.notifyOnline();
  }

  private clearPending(notify = true): void {
    if (!this.pending) return;
    this.deps.scheduler.clearTimeout(this.pending.timer);
    this.pending = null;
    if (notify) this.notifyOnline();
  }

  // -- the room ------------------------------------------------------------------------------------------

  private attach(room: RoomLike): void {
    this.room = room;
    this.token = room.reconnectionToken || this.token;
    // A friends room's code is its 6 digits: its roomId is a long random id, no code (protocol friends.ts).
    this.code = this.friends ? this.friends.code : room.roomId || this.code;
    this.lastHeardAt = this.now();
    this.run++;
    for (const type of SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m) => this.safely(room, () => this.onMessage(room, m)));
    room.onLeave((code) => this.safely(room, () => this.onLeave(room, code)));
    room.onError((code, message) => this.log(`room error ${code ?? '?'} ${message ?? ''}`.trim()));
    this.startTicking();
  }

  private onMessage(room: RoomLike, m: ServerMessage): void {
    if (room !== this.room || this.closed) return;
    this.lastHeardAt = this.now();
    switch (m.type) {
      case 'lobby':
        this.me = m.playerId;
        this.code = m.code;
        this.lobby = {
          code: m.code,
          gameType: m.gameType,
          playerCount: m.playerCount,
          players: m.players,
          // A friends room's (1.0.4); absent elsewhere.
          ...(m.hostId !== undefined && { hostId: m.hostId }),
          ...(m.minPlayers !== undefined && { minPlayers: m.minPlayers }),
          ...(m.maxPlayers !== undefined && { maxPlayers: m.maxPlayers }),
        };
        if (this.state) this.notifyOnline();
        else {
          // Back in a lobby after a drop (the seat was given up, and taken again by code).
          this.lost = null;
          this.comingBack = null;
          this.setStatus('lobby');
        }
        return;
      case 'countdown':
        // A ranked match's room: everyone is in, GO at startsAt (sent again to a player who comes back in it).
        this.startsAt = m.startsAt;
        this.notifyOnline();
        return;
      case 'snapshot':
        return this.onSnapshot(m);
      case 'events':
        return this.onEvents(m.events);
      case 'rejected': {
        this.metrics.rejected(m.clientSeq, this.now());
        const action = this.sent.get(m.clientSeq);
        this.sent.delete(m.clientSeq);
        if (this.pending?.clientSeq === m.clientSeq) this.clearPending();
        // A move made offline that did not count [D42]: the cell was no longer free for me. No penalty.
        const lost = this.offline.rejected(m.clientSeq);
        if (lost) {
          this.log(`a move made offline did not count: ${m.reason}`);
          this.notifyOnline();
        }
        // A move made offline whose entry is gone: a copy sent again after its first one was answered, or a
        // queue the end cleared. Nothing was lost, nothing to say.
        if (action?.type === 'offlineMove' && !lost) {
          this.log(`an old copy of a move made offline refused: ${m.reason}`);
          return;
        }
        const refused: ClientAction | undefined =
          action ??
          (lost
            ? { type: 'offlineMove', cell: lost.cell, digit: lost.digit, thinkMs: lost.thinkMs }
            : undefined);
        if (refused && this.state)
          this.emit({ kind: 'rejected', action: refused, reason: m.reason, view: this.getView() });
        return;
      }
      case 'solution':
        // Only for a finished game (spec §21); the server never sends it earlier.
        if (this.state?.status !== 'over') return this.log('solution before the end: ignored');
        this.solutionText = m.solution;
        this.state = withSolution(this.state, m.solution);
        this.emit({ kind: 'events', events: [], view: this.getView() });
        return;
      case 'pong':
        this.sync.pong(m.t, m.serverTime, this.now());
        return;
      case 'lobbyRefused':
        // A friends room: a lobby command of mine was refused (to me only).
        if (!this.friends) return;
        this.friends.refused = { ...m, seq: ++this.refusedSeq };
        this.log(`lobby command ${m.command} refused: ${m.reason}`);
        this.notifyOnline();
        return;
      case 'roomClosed':
        return this.onRoomClosed(m.reason);
    }
  }

  /**
   * A friends room put this connection out (kicked, removed, the same account on another device, a restart, or
   * closed): the server closes it next. Nothing comes back after it: the host closes at once, with the reason.
   */
  private onRoomClosed(reason: FriendsRoomClosedReason): void {
    this.log(`the room closed this connection: ${reason}`);
    if (this.friends) this.friends.closed = reason;
    if (this.state?.status === 'over') return this.shutdown('gameOver', null);
    this.shutdown(
      'serverClosed',
      new OnlineError(reason === 'kicked' ? 'kicked' : 'roomClosed', `roomClosed: ${reason}`),
    );
  }

  private onSnapshot(m: Extract<ServerMessage, { type: 'snapshot' }>): void {
    if (m.protocol !== PROTOCOL_VERSION) {
      return this.shutdown(
        'protocol',
        new OnlineError('protocol', `The server speaks protocol ${m.protocol}, this app ${PROTOCOL_VERSION}`),
      );
    }
    this.me = m.playerId;
    this.state =
      this.solutionText !== null && m.state.status === 'over'
        ? withSolution(m.state, this.solutionText)
        : m.state;
    if (m.state.status === 'over' && m.state.config.puzzle.solution !== '')
      this.solutionText = m.state.config.puzzle.solution;
    this.ahead.clear();
    this.clearGapTimer();
    this.clientSeq = Math.max(this.clientSeq, m.lastClientSeq ?? 0);
    this.clearPending(false);
    // Back. Inside the soft phase [D42] nothing froze and nobody was told: no "back, all synced" banner. Past
    // it (by this phone's reckoning, or the snapshot shows me away), the banner as before.
    const lost = this.lost;
    const mine = m.state.players.find((p) => p.id === m.playerId);
    const hard =
      lost !== null &&
      (lost.softEndsAt === null ||
        this.serverNow() >= lost.softEndsAt ||
        (mine?.status === 'active' && !mine.connected));
    if (this.comingBack) {
      this.comingBack.snapshotAt = this.now();
      this.comingBack.phase = hard ? 'hard' : 'soft';
      this.comingBack.queued = this.offline.size;
    }
    if (hard) this.resyncedAt = this.serverNow();
    this.trackAbsences(m.state);
    // The server's word replaces the play offline; its queue goes out below.
    const plan = this.offline.end(this.serverNow());
    this.clearOfflineTimer();
    this.lost = null;
    this.setStatus('live');
    this.checkInSync();
    this.emit({ kind: 'events', events: [], view: this.getView() });
    this.flushOffline(plan);
  }

  /**
   * Back with moves made offline [D42]: they go to the server in the order they were made, as `offlineMove`
   * (the server takes my return before any message of mine); those the snapshot already settles are not sent
   * again. First a lock of mine the server kept on a cell I let go of here is released there (else it would
   * come back as mine, and block the others, until it ran out). Then a cell held here without a digit is
   * selected again, when it is still free (the server says "taken" otherwise). A game that ended meanwhile, or
   * that I am out of, drops them quietly. A frozen game would refuse each of them ('paused'), however free its
   * cell: all of it waits for the game to go on (onEvents), the engine's window waiting with it.
   */
  private flushOffline(plan: ReturnPlan): void {
    const state = this.state;
    const me = this.me;
    if (!state || me === null || this.closed) return;
    const p = state.players.find((x) => x.id === me);
    if (state.status === 'over' || p?.status !== 'active') {
      this.flushOnResume = null;
      if (this.offline.size) {
        this.log(`the game went on without the ${this.offline.size} moves made offline`);
        this.offline.clear();
        this.notifyOnline();
      }
      return;
    }
    if (state.status === 'paused') {
      const waiting = this.flushOnResume;
      if (!waiting && (this.offline.size || plan.held !== null || plan.letGo.length))
        this.log(`the game is frozen: ${this.offline.size} moves made offline wait for it to go on`);
      this.flushOnResume = waiting
        ? { held: waiting.held ?? plan.held, letGo: [...new Set([...waiting.letGo, ...plan.letGo])] }
        : plan;
      return;
    }
    this.flushOnResume = null;
    const queuedAt = (cell: CellIndex) => this.offline.queued.some((q) => q.cell === cell);
    const mine = state.locks.find((l) => l.playerId === me);
    if (mine && plan.letGo.includes(mine.cell) && mine.cell !== plan.held && !queuedAt(mine.cell)) {
      if (this.send({ type: 'release' }) === null) return; // the connection went again
      this.log('released at the server: the cell let go of offline');
    }
    const before = this.offline.size;
    const entries = this.offline.entriesToSend(state, me);
    let sent = 0;
    for (const entry of entries) {
      const action: ClientAction = {
        type: 'offlineMove',
        cell: entry.cell,
        digit: entry.digit,
        thinkMs: entry.thinkMs,
      };
      const clientSeq = this.send(action);
      if (clientSeq === null) return; // the connection went again: they wait for the next return
      this.offline.markSent(entry, clientSeq, this.now());
      sent++;
    }
    if (sent) {
      this.log(`sent ${sent} moves made offline`);
      this.watchOfflineAnswers();
    }
    const held = plan.held;
    if (
      held !== null &&
      state.grid[held] === 0 &&
      !state.locks.some((l) => l.cell === held && l.playerId === me) &&
      !queuedAt(held)
    )
      this.act({ type: 'select', cell: held });
    if (this.offline.size !== before) this.notifyOnline();
  }

  /**
   * The moves made offline that were sent wait for their answer (placed* with `offline`, or 'rejected'). One
   * with none after offlineAnswerTimeoutMs was dropped by the server (its rate limit answers nothing) while the
   * connection is fine: it is sent again, so no cell stays "waiting" for good. An answer to the old copy that
   * comes after all is taken as usual; a refusal of it is ignored (the new copy gets its own).
   */
  private watchOfflineAnswers(): void {
    const timeoutMs = this.opts.offlineAnswerTimeoutMs;
    if (this.offlineAnswerTimer !== null || !(timeoutMs > 0)) return;
    const oldest = this.offline.oldestSentAt;
    if (oldest === null) return;
    this.offlineAnswerTimer = this.deps.scheduler.setTimeout(
      () => {
        this.offlineAnswerTimer = null;
        if (this.closed || this.room === null || this.status !== 'live') return;
        const again = this.offline.resetSentBy(this.now() - timeoutMs);
        if (again) {
          this.log(`${again} moves made offline got no answer: sending them again`);
          this.notifyOnline();
          this.flushOffline({ held: null, letGo: [] });
        }
        this.watchOfflineAnswers();
      },
      Math.max(0, oldest + timeoutMs - this.now()),
    );
  }

  private clearOfflineAnswerTimer(): void {
    if (this.offlineAnswerTimer !== null) this.deps.scheduler.clearTimeout(this.offlineAnswerTimer);
    this.offlineAnswerTimer = null;
  }

  /**
   * How the other players' absences began [D42], from the events (and a snapshot's picture): a drop starts with
   * the soft phase (playerConnectionLost), a deliberate leave or a seat empty at GO with playerDisconnected. An
   * absence first seen in a snapshot, already hard, is not known: it counts as a drop. True when it changed.
   */
  private trackAbsence(e: GameEvent): boolean {
    if (!('playerId' in e) || e.playerId === this.me) return false;
    const id = e.playerId;
    const was = this.absences.get(id);
    if (e.type === 'playerConnectionLost') this.absences.set(id, 'soft');
    else if (e.type === 'playerDisconnected' && was === undefined) this.absences.set(id, 'hard');
    else if (e.type === 'playerReconnected') this.absences.delete(id);
    return this.absences.get(id) !== was;
  }

  private trackAbsences(state: GameState): void {
    for (const p of state.players) {
      if (p.id === this.me) continue;
      if (isSoftOffline(p)) this.absences.set(p.id, 'soft');
      else if (p.connected && p.status === 'active') this.absences.delete(p.id);
    }
  }

  private onEvents(events: readonly GameEvent[]): void {
    let state = this.state;
    if (!state) return;
    for (const e of events) if (e.seq > state.seq) this.ahead.set(e.seq, e);
    const applied: GameEvent[] = [];
    for (let next = this.ahead.get(state.seq + 1); next; next = this.ahead.get(state.seq + 1)) {
      this.ahead.delete(next.seq);
      state = evolve(state, next);
      applied.push(next);
    }
    this.state = state;
    if (this.ahead.size) this.startGapTimer();
    else this.clearGapTimer();
    if (!applied.length) return;

    const me = this.me ?? '';
    this.metrics.events(applied, me, this.now(), this.sync.synced ? this.sync.offsetMs : null);
    // A move made offline is answered [D42]: no longer "waiting". Someone's absence began, or ended.
    let changed = false;
    for (const e of applied) {
      if (this.offline.answered(e, me)) changed = true;
      if (this.trackAbsence(e)) changed = true;
    }
    if (changed) this.notifyOnline();
    const pending = this.pending;
    if (
      pending &&
      applied.some(
        (e) =>
          (e.type === 'cellLocked' && e.cell === pending.cell) ||
          (e.type === 'placedCorrect' && e.cell === pending.cell),
      )
    )
      this.clearPending();
    this.checkInSync();
    this.emit({ kind: 'events', events: applied, view: this.getView() });
    // The game goes on (or ended) after a frozen return: what the return held back goes now [D42].
    const waiting = this.flushOnResume;
    if (waiting && this.state?.status !== 'paused') {
      this.flushOnResume = null;
      this.flushOffline(waiting);
    }
  }

  /** The room is gone: closed by the server, dropped, or kicked. */
  private onLeave(room: RoomLike, code: number): void {
    if (room !== this.room || this.closed) return; // a connection already let go
    this.goOffline();
    if (this.state?.status === 'over') return this.shutdown('gameOver', null);
    if (code === CONSENTED) return this.shutdown('serverClosed', null);
    this.log(`connection lost (${code})`);
    this.lose('drop');
  }

  // -- ping, pong and silence ----------------------------------------------------------------------------

  private startTicking(): void {
    this.stopTicking();
    const { pingBurst, pingBurstGapMs } = this.opts;
    this.ping();
    for (let k = 1; k < pingBurst; k++) {
      const timer = this.deps.scheduler.setTimeout(() => {
        this.burstTimers.delete(timer);
        this.ping();
      }, k * pingBurstGapMs);
      this.burstTimers.add(timer);
    }
    this.scheduleTick();
  }

  private scheduleTick(): void {
    const armedAt = this.now();
    this.tickTimer = this.deps.scheduler.setTimeout(() => {
      this.tickTimer = null;
      if (!this.room || this.closed) return;
      const now = this.now();
      // A tick far too late means this app was not running (suspended): the silence was ours, not the
      // server's. Give the server a fresh chance to answer.
      if (now - armedAt > 2 * this.opts.pingEveryMs) this.lastHeardAt = now;
      if (now - this.lastHeardAt > this.opts.silenceTimeoutMs) {
        this.log('the server went silent');
        this.dropConnection();
        return;
      }
      this.ping();
      this.scheduleTick();
    }, this.opts.pingEveryMs);
  }

  private stopTicking(): void {
    if (this.tickTimer !== null) this.deps.scheduler.clearTimeout(this.tickTimer);
    this.tickTimer = null;
    for (const timer of this.burstTimers) this.deps.scheduler.clearTimeout(timer);
    this.burstTimers.clear();
  }

  private ping(): void {
    const room = this.room;
    if (!room || this.closed) return;
    const now = this.now();
    if (!this.pingBucket.take(now)) return;
    try {
      room.send('ping', { type: 'ping', t: this.sync.ping(now) });
    } catch (error) {
      this.log(`ping failed: ${messageOf(error)}`);
    }
  }

  // -- gaps ----------------------------------------------------------------------------------------------

  private startGapTimer(): void {
    if (this.gapTimer !== null) return;
    this.gapTimer = this.deps.scheduler.setTimeout(() => {
      this.gapTimer = null;
      if (!this.ahead.size || this.closed) return;
      this.log(`events missing after seq ${this.state?.seq}: fetching a fresh snapshot`);
      this.dropConnection();
    }, this.opts.gapTimeoutMs);
  }

  private clearGapTimer(): void {
    if (this.gapTimer !== null) this.deps.scheduler.clearTimeout(this.gapTimer);
    this.gapTimer = null;
  }

  // -- losing the connection and coming back -------------------------------------------------------------

  /**
   * Offline: whatever was on the way is lost; what it was is kept for the play offline [D42], and moves made
   * offline that were sent and not answered go out again after the next return.
   */
  private goOffline(): void {
    this.room = null;
    this.stopTicking();
    this.clearAnswerTimer();
    this.sync.forgetInFlight();
    this.inFlightAtLoss = this.metrics.unanswered();
    this.metrics.dropped();
    this.offline.resetUnanswered();
    this.clearOfflineAnswerTimer();
    // A frozen return's held-back moves wait for the next return instead (they stay in the queue).
    this.flushOnResume = null;
    this.sent.clear();
    this.clearPending(false);
    this.ahead.clear();
    this.clearGapTimer();
  }

  /**
   * Lets go of the socket (the server sees a drop and holds the seat) and comes back with the token. Not after
   * the end: a finished game has nothing to come back to (its result and solution are here), so the host
   * closes as 'gameOver' instead of a reconnect loop against a room that is closing.
   */
  private dropConnection(): void {
    const room = this.room;
    if (!room) return;
    if (this.state?.status === 'over') {
      this.log('the connection went after the end: closing');
      return this.shutdown('gameOver', null);
    }
    this.goOffline();
    void room.leave(false).catch(() => undefined);
    this.lose('drop');
  }

  private lose(cause: ReconnectInfo['cause']): void {
    if (this.closed) return;
    const now = this.now();
    const inFlight = this.inFlightAtLoss;
    this.inFlightAtLoss = [];
    if (!this.lost) {
      const rules = this.state?.config.rules;
      const graceMs = rules?.graceMs ?? this.opts.defaultGraceMs;
      // [D42] The soft phase comes first, then the grace. Rules without one (an older server) have none.
      const softGraceMs = rules ? (rules.softGraceMs ?? 0) : this.opts.defaultSoftGraceMs;
      const { serverNoticeMs, reconnectSlackMs } = this.opts;
      const lostAt = this.serverNow();
      // A friends room's lobby: no soft phase, and the seat is held for hours [D84a].
      const lobbyMs = this.inFriendsLobby() ? this.opts.friendsLobbyReturnMs : null;
      this.lost =
        lobbyMs !== null
          ? {
              cause,
              attempt: 0,
              since: now,
              lostAt,
              softEndsAt: null,
              graceEndsAt: lostAt + lobbyMs,
              deadline: now + lobbyMs,
              resyncing: false,
            }
          : {
              cause,
              attempt: 0,
              since: now,
              lostAt,
              softEndsAt: softGraceMs > 0 ? lostAt + softGraceMs : null,
              graceEndsAt: lostAt + softGraceMs + graceMs,
              deadline: now + softGraceMs + graceMs + serverNoticeMs + reconnectSlackMs,
              resyncing: false,
            };
      this.startOfflinePlay(inFlight);
    } else {
      this.lost = { ...this.lost, cause, attempt: 0, resyncing: false };
    }
    this.setStatus('reconnecting');
    if (!this.backgrounded) void this.comeBack();
  }

  /**
   * The connection is lost with a soft phase ahead [D42]: this player plays on here until its end, from where
   * he stood. My lock of the moment keeps running here (as it does on the server, where it may run out); what
   * the server had not answered is carried in, in order: a select becomes the lock here, a digit the first
   * queued move, "ביטול בחירה" lets go. Nothing for a game that can't be played so ('turns', an older server).
   */
  private startOfflinePlay(inFlight: readonly InFlight[]): void {
    const state = this.state;
    const me = this.me;
    const lost = this.lost;
    if (!state || me === null || lost?.softEndsAt == null || !offlinePlayable(state, me)) return;
    const now = this.serverNow();
    const offset = this.sync.offsetMs;
    const mine = state.locks.find((l) => l.playerId === me);
    const lock: LocalLock | null = mine
      ? { cell: mine.cell, lockedAt: mine.lockedAt, expiresAt: mine.expiresAt ?? now + mine.remainingMs }
      : null;
    this.offline.start(lost.lostAt, lost.softEndsAt, lock);
    for (const { action, at } of inFlight) {
      const t = at + offset;
      if (action.type === 'select') this.offline.select(state, me, action.cell, t);
      else if (action.type === 'release') this.offline.release(t);
      else if (action.type === 'place') this.offline.place(state, me, action.cell, action.digit, t);
    }
    this.offline.expire(now);
    this.log(`playing on offline${this.offline.size ? `, ${this.offline.size} moves queued` : ''}`);
    this.scheduleOfflineWake();
    // The picture changed: I am marked, and my lock is the one here.
    this.emit({ kind: 'events', events: [], view: this.getView() });
  }

  /**
   * The picture of the play offline changes by itself when a lock (mine here, or another's) or the soft phase
   * runs out: one timer to draw it again then. Every time is read from the clock when it fires, not counted.
   */
  private scheduleOfflineWake(): void {
    this.clearOfflineTimer();
    const state = this.state;
    const me = this.me;
    if (!state || me === null || this.closed || !this.offline.active) return;
    const now = this.serverNow();
    const at = this.offline.nextWake(state, me, now);
    if (at === null) return;
    this.offlineTimer = this.deps.scheduler.setTimeout(
      () => {
        this.offlineTimer = null;
        if (this.closed || !this.offline.active) return;
        this.offline.expire(this.serverNow());
        this.notifyOnline();
        this.emit({ kind: 'events', events: [], view: this.getView() });
        this.scheduleOfflineWake();
      },
      Math.max(0, at - now),
    );
  }

  private clearOfflineTimer(): void {
    if (this.offlineTimer !== null) this.deps.scheduler.clearTimeout(this.offlineTimer);
    this.offlineTimer = null;
  }

  /**
   * After an action, the server should say something soon (its answer, a pong): nothing at all for
   * answerTimeoutMs after the last send means the network is gone, without the close a socket would see
   * [D42]. Then the play offline starts at once, not only after silenceTimeoutMs without a word.
   */
  private watchAnswer(): void {
    const { answerTimeoutMs } = this.opts;
    if (this.answerTimer !== null || !(answerTimeoutMs > 0)) return;
    const room = this.room;
    const sentAt = this.lastSentAt;
    this.answerTimer = this.deps.scheduler.setTimeout(
      () => {
        this.answerTimer = null;
        if (room === null || room !== this.room || this.closed) return;
        // Far too late: this app was not running (suspended), the silence was ours.
        if (this.now() - sentAt > 2 * answerTimeoutMs) return;
        if (this.lastHeardAt < sentAt) {
          this.log('no answer from the server');
          this.dropConnection();
          return;
        }
        // Heard since that send; a later one may still be waiting for a word.
        if (this.lastSentAt > sentAt && this.lastHeardAt < this.lastSentAt) this.watchAnswer();
      },
      Math.max(0, answerTimeoutMs - (this.now() - sentAt)),
    );
  }

  private clearAnswerTimer(): void {
    if (this.answerTimer !== null) this.deps.scheduler.clearTimeout(this.answerTimer);
    this.answerTimer = null;
  }

  /** Tries to come back until it does, the deadline passes, or the room can't take this player any more. */
  private async comeBack(): Promise<void> {
    const run = ++this.run;
    this.comingBack = { startedAt: this.now(), snapshotAt: null, phase: 'hard', queued: 0 };
    let lastError: OnlineError | null = null;
    for (let attempt = 1; ; attempt++) {
      if (this.isStale(run) || !this.lost) return;
      this.lost = { ...this.lost, attempt, resyncing: false };
      this.notifyOnline();
      const outcome = await this.tryOnce(run);
      if (this.isStale(run)) return;
      if (outcome === 'back') return;
      lastError = outcome;
      this.log(`attempt ${attempt} failed: ${outcome.code}`);
      if (FATAL_ON_RETURN.has(outcome.code)) break;
      if (!this.lost || this.now() >= this.lost.deadline) break;
      const delays = this.opts.reconnectDelaysMs;
      let delay = delays[Math.min(attempt, delays.length) - 1] ?? 1000;
      // A friends room's route asked to wait (429): not before then, and not at all past the deadline.
      if (outcome.code === 'tooManyRequests' && outcome.retryAfterMs !== null) {
        if (this.now() + outcome.retryAfterMs > this.lost.deadline) break;
        delay = Math.max(delay, outcome.retryAfterMs);
      }
      await this.sleep(delay);
    }
    if (this.isStale(run)) return;
    this.shutdown('lostConnection', lastError);
  }

  /** One try: with the token, then (the token refused, the room alive) by code with the same identity. */
  private async tryOnce(run: number): Promise<'back' | OnlineError> {
    let error: OnlineError | null = null;
    const token = this.token;
    if (token) {
      const r = await this.attempt(() => this.deps.client.reconnect(token), run);
      // Taken, or let go because this loop is over (the caller sees that it is stale).
      if ('room' in r) {
        this.adopt(r.room, run);
        return 'back';
      }
      error = r.error;
      if (error.code !== 'tokenExpired') return error;
    }
    if (this.isStale(run)) return error ?? new OnlineError('unknown', 'Stale attempt');
    const friends = this.friends;
    if (friends) {
      // A friends room: no seat for the token (or no token): a fresh reservation from our HTTP route, which gives
      // the same account its own seat back (an earlier connection that still looks open is let go there).
      const r = await this.attempt(
        async () => this.deps.client.consumeSeatReservation(await friends.rejoin(friends.code)),
        run,
      );
      if ('room' in r) {
        this.adopt(r.room, run);
        return 'back';
      }
      return r.error;
    }
    const code = this.code;
    if (!code) return error ?? new OnlineError('notFound', 'No room to go back to');
    // The seat is not held for the token (the lobby gave it up, or the server has not noticed the drop yet):
    // by code, with the same identity. 'alreadyInRoom' or 'roomFull' then mean "not noticed yet": try again.
    const r = await this.attempt(() => this.deps.client.join(code), run);
    if ('room' in r) {
      this.adopt(r.room, run);
      return 'back';
    }
    return r.error;
  }

  /** An SDK call with a time limit; a room that comes after the limit is still taken if it is wanted. */
  private attempt(open: () => Promise<RoomLike>, run: number): Promise<Attempt> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = this.deps.scheduler.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ error: new OnlineError('network', 'No answer from the server') });
      }, this.opts.attemptTimeoutMs);
      Promise.resolve()
        .then(open)
        .then(
          (room) => {
            if (settled) return void this.adopt(room, run);
            settled = true;
            this.deps.scheduler.clearTimeout(timer);
            resolve({ room });
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            this.deps.scheduler.clearTimeout(timer);
            resolve({ error: onlineErrorOf(error) });
          },
        );
    });
  }

  /** Takes a room that came back, unless it is not wanted any more (then lets it go). */
  private adopt(room: RoomLike, run: number): boolean {
    if (this.closed) {
      void room.leave(true).catch(() => undefined);
      return false;
    }
    if (this.room !== null || this.backgrounded || run !== this.run || !this.lost) {
      // Not wanted now; the seat stays held for the token (a drop, not a goodbye).
      void room.leave(false).catch(() => undefined);
      return false;
    }
    this.log('back in the room');
    this.attach(room);
    this.lost = { ...this.lost, resyncing: true };
    this.notifyOnline();
    return true;
  }

  private isStale(run: number): boolean {
    return this.closed || this.backgrounded || run !== this.run;
  }

  /**
   * After a return: the game is current once the snapshot is in and this player is back in a running game, out
   * of the soft phase too (the snapshot may still show him in it, until the server's playerReconnected) [D42].
   */
  private checkInSync(): void {
    const back = this.comingBack;
    const s = this.state;
    if (!back || back.snapshotAt === null || !s) return;
    const me = s.players.find((p) => p.id === this.me);
    const othersAway = s.players.some((p) => p.id !== this.me && p.status === 'active' && !p.connected);
    const current =
      s.status === 'over' ||
      !me ||
      me.status !== 'active' ||
      (me.connected && !isSoftOffline(me) && (s.status !== 'paused' || othersAway));
    if (!current) return;
    this.comingBack = null;
    const now = this.now();
    this.metrics.cameBack(back.snapshotAt - back.startedAt, now - back.snapshotAt);
    this.trackSafely('reconnect', {
      durationMs: Math.round(now - back.startedAt),
      success: true,
      phase: back.phase,
      queued: back.queued,
    });
  }

  // -- the app in the background -------------------------------------------------------------------------

  private onAppState(next: string): void {
    if (this.closed) return;
    if (next === 'background') {
      if (this.backgrounded) return;
      // A friends room's lobby holds the seat while the app is away [D84a]: let go of the socket, so the others
      // see "לא בחדר כרגע", and come back to it in the foreground.
      const lobby = this.inFriendsLobby();
      if (lobby) {
        if (this.status !== 'lobby' && this.status !== 'reconnecting') return;
      } else {
        if (!this.state || this.state.status === 'over') return;
        if (this.status !== 'live' && this.status !== 'reconnecting') return;
      }
      this.log(
        lobby
          ? 'in the background: out of the lobby until the foreground'
          : 'in the background: disconnecting',
      );
      this.backgrounded = true;
      this.run++;
      this.wakeSleepers();
      const room = this.room;
      if (room) {
        this.goOffline();
        void room.leave(false).catch(() => undefined);
      }
      this.lose('background');
    } else if (next === 'active' && this.backgrounded) {
      this.backgrounded = false;
      if (this.lost) {
        // The lobby's seat was held all along [D84a]: the time to come back to it starts now.
        if (this.inFriendsLobby())
          this.lost = {
            ...this.lost,
            deadline: Math.max(this.lost.deadline, this.now() + this.opts.friendsLobbyReturnMs),
          };
        this.log('back in the foreground: reconnecting');
        void this.comeBack();
      }
    }
  }

  /** A friends room before its game: the lobby, before the host's start (no countdown, no game). */
  private inFriendsLobby(): boolean {
    return this.friends !== null && this.state === null && this.startsAt === null;
  }

  // -- the end -------------------------------------------------------------------------------------------

  private shutdown(reason: CloseReason, error: OnlineError | null): void {
    if (this.closed) return;
    const failedReturn = this.comingBack !== null && reason === 'lostConnection';
    const startedAt = this.comingBack?.startedAt ?? 0;
    const softEndsAt = this.lost?.softEndsAt ?? null;
    const phase = softEndsAt !== null && this.serverNow() < softEndsAt ? 'soft' : 'hard';
    const queued = this.offline.size;
    this.closed = true;
    this.run++;
    const room = this.room;
    this.goOffline();
    // Nothing more is played or sent: a finished game's moves made offline go with it.
    this.offline.clear();
    this.clearOfflineTimer();
    if (room) void room.leave(true).catch(() => undefined);
    this.wakeSleepers();
    this.appStateSub?.remove();
    this.appStateSub = null;
    const now = this.now();
    if (failedReturn)
      this.trackSafely('reconnect', {
        durationMs: Math.round(now - startedAt),
        success: false,
        phase,
        queued,
      });
    this.metrics.flush(now);
    this.comingBack = null;
    this.lost = null;
    this.closeReason = reason;
    this.error = error;
    this.status = 'closed';
    this.notifyOnline();
    this.onlineListeners.clear();
  }

  // -- helpers -------------------------------------------------------------------------------------------

  private now(): number {
    return this.deps.clock.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        this.deps.scheduler.clearTimeout(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = this.deps.scheduler.setTimeout(wake, ms);
      this.sleepers.add(wake);
    });
  }

  private wakeSleepers(): void {
    for (const wake of [...this.sleepers]) wake();
  }

  private setStatus(status: OnlineStatus): void {
    this.status = status;
    this.notifyOnline();
  }

  private makeInfo(): OnlineInfo {
    return {
      status: this.status,
      closeReason: this.closeReason,
      error: this.error,
      code: this.code,
      playerId: this.me,
      lobby: this.lobby,
      reconnect: this.lost,
      pendingCell: this.pending?.cell ?? null,
      hasGame: this.state !== null,
      resyncedAt: this.resyncedAt,
      offlinePlay:
        this.lost && this.lost.softEndsAt !== null
          ? { since: this.lost.lostAt, softEndsAt: this.lost.softEndsAt, playable: this.offline.active }
          : null,
      queuedMoves: this.offline.queued,
      hardLeavers: [...this.absences].filter(([, began]) => began === 'hard').map(([id]) => id),
      startsAt: this.startsAt,
      ...(this.friends && {
        friends: { code: this.friends.code, closed: this.friends.closed, refused: this.friends.refused },
      }),
    };
  }

  private notifyOnline(): void {
    this.info = this.makeInfo();
    for (const listener of [...this.onlineListeners]) {
      try {
        listener(this.info);
      } catch (error) {
        this.log(`online listener failed: ${messageOf(error)}`);
        this.report(error, 'online listener failed');
      }
    }
  }

  /** Delivers updates in order, one at a time, to every listener (a listener may act while being told). */
  private emit(update: HostUpdate): void {
    this.outbox.push(update);
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (this.outbox.length && this.listeners.size) {
        const next = this.outbox.shift()!;
        for (const listener of [...this.listeners]) {
          try {
            listener(next);
          } catch (error) {
            this.log(`listener failed: ${messageOf(error)}`);
            this.report(error, 'listener failed');
          }
        }
      }
      this.outbox.length = 0;
    } finally {
      this.delivering = false;
    }
  }

  /** A message that breaks the mirror (a bad event): start over from a fresh snapshot. */
  private safely(room: RoomLike, step: () => void): void {
    try {
      step();
    } catch (error) {
      this.log(`message failed: ${messageOf(error)}`);
      this.report(error, 'message failed');
      if (room === this.room) this.dropConnection();
    }
  }

  private trackSafely(
    name: 'reconnect',
    props: { durationMs: number; success: boolean; phase: 'soft' | 'hard'; queued: number },
  ): void {
    try {
      this.deps.track?.(name, props);
    } catch {
      // Analytics never breaks a game.
    }
  }

  private log(line: string): void {
    this.deps.log?.(line);
  }

  private report(error: unknown, context: HostFailure): void {
    try {
      this.deps.report?.(error, context);
    } catch {
      // Reporting never breaks a game.
    }
  }
}

/** The state with the solution the server sent after the end (as publicState() of the finished game). */
function withSolution(state: GameState, solution: string): GameState {
  const config = state.config;
  return { ...state, config: { ...config, puzzle: { ...config.puzzle, solution } } };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
