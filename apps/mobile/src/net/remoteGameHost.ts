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
  type PlayerId,
  type Scheduler,
  toView,
} from '@sudoku-fight/engine';
import {
  type ClientMessage,
  type GameHost,
  type LobbyPlayer,
  type MatchSeatReservation,
  PROTOCOL_VERSION,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { ClockSync, type ClockSyncOptions, TokenBucket } from './clockSync';
import { OnlineError, onlineErrorOf } from './errors';
import { type MetricsTrack, NetMetrics, type NetMetricsOptions } from './metrics';
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
 *   with 'disconnected' (spec §16.2: the board is locked while reconnecting).
 * - Optimistic select (spec §18): a tapped cell shows as pending (`pendingCell`, for boardModel's pending
 *   option) until its lock or refusal arrives, or `pendingTimeoutMs` passes (a rate-limited message gets no
 *   answer at all). A digit's result only ever comes from the server.
 * - The clock: ping/pong every `pingEveryMs` (a burst at every join), and the offset from ClockSync;
 *   serverNow() = phone time + offset, the clock the view's deadlines (expiresAt) are in.
 * - Connection (spec §16.2): a drop (or `silenceTimeoutMs` without a word from the server) turns to
 *   'reconnecting' and comes back with the reconnection token, with backoff, until the grace period is over
 *   (+ the time the server may take to notice, + 1 s); when the server holds no seat for the token but the
 *   room is alive, it rejoins by code with the same identity. Giving up is 'closed' with 'lostConnection'.
 *   The token is a bearer secret: in memory only, never logged.
 * - AppState (work plan, stage 7): the app going to the background during a game is a disconnect (the socket
 *   closes, the token is kept); back in the foreground it reconnects at once.
 * - Measures (spec §18): see NetMetrics; reconnect time is from starting to come back to the snapshot, sync
 *   time from the snapshot to the game being current again. A return is reported as track('reconnect').
 * - Ranked matches (stage 9): enterReserved() takes the seat matchmaking reserved (net/matchmaking.ts); the
 *   room's 3… 2… 1… shows as `online.startsAt`, and the game comes at GO like any other.
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
}

export interface ReconnectInfo {
  /** Why: the connection dropped, or the app went to the background. */
  cause: 'drop' | 'background';
  /** Attempts so far, for "reconnecting… attempt 2" (spec §16.2); 0 while waiting for the foreground. */
  attempt: number;
  /** Phone time when the connection was lost. */
  since: number;
  /** The same moment in the server's clock, like the view's deadlines (for the countdowns). */
  lostAt: number;
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
  /** Server time when the latest return's snapshot came (the "back in the game" banner); null before any. */
  resyncedAt: number | null;
  /**
   * A ranked match's room (stage 9): GO, in the server's clock, once everyone is in and its 3… 2… 1… runs
   * (protocol GameRoomCountdown); the snapshot follows at GO. Null (or absent) otherwise.
   */
  startsAt?: number | null;
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
  /** Diagnostics. Never gets the reconnection token. */
  log?: (line: string) => void;
  options?: Partial<RemoteHostOptions>;
}

const CONSENTED = 4000;
/** Errors after which coming back is pointless: the room is gone, or it won't take this player. */
const FATAL_ON_RETURN = new Set<OnlineError['code']>([
  'notFound',
  'roomGone',
  'gameStarted',
  'unauthenticated',
  'badCode',
  'protocol',
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
  /** After a drop: when coming back started, and when its snapshot came. */
  private comingBack: { startedAt: number; snapshotAt: number | null } | null = null;
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

  /** The game as this player sees it now. Only once a game is here (`online.hasGame`). */
  getView(): GameView {
    if (!this.state) throw new Error('No game yet: wait for the first snapshot');
    return toView(this.state, this.me, this.serverNow());
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

  /** The room's code. */
  get roomCode(): string | null {
    return this.code;
  }

  /** The cell tapped and not confirmed yet (spec §18): boardModel's `pendingCell`. */
  get pendingCell(): CellIndex | null {
    return this.pending?.cell ?? null;
  }

  // -- actions -------------------------------------------------------------------------------------------

  private act(action: ClientAction): void {
    if (this.closed || !this.state) return;
    const room = this.room;
    if (room === null || this.status !== 'live') {
      this.emit({ kind: 'rejected', action, reason: 'disconnected', view: this.getView() });
      return;
    }
    const clientSeq = ++this.clientSeq;
    try {
      room.send(action.type, { ...action, clientSeq } as ClientMessage);
    } catch (error) {
      this.log(`send ${action.type} failed: ${messageOf(error)}`);
      this.dropConnection();
      this.emit({ kind: 'rejected', action, reason: 'disconnected', view: this.getView() });
      return;
    }
    this.metrics.sent(clientSeq, action, this.now());
    this.sent.set(clientSeq, action);
    if (this.sent.size > SENT_KEPT) this.sent.delete(this.sent.keys().next().value!);
    if (action.type === 'select') this.setPending(action.cell, clientSeq);
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
    this.code = room.roomId || this.code;
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
        this.lobby = { code: m.code, gameType: m.gameType, playerCount: m.playerCount, players: m.players };
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
        if (action && this.state)
          this.emit({ kind: 'rejected', action, reason: m.reason, view: this.getView() });
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
    }
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
    if (this.comingBack) this.comingBack.snapshotAt = this.now();
    if (this.lost) this.resyncedAt = this.serverNow();
    this.lost = null;
    this.setStatus('live');
    this.checkInSync();
    this.emit({ kind: 'events', events: [], view: this.getView() });
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

  /** Offline: whatever was on the way is lost. */
  private goOffline(): void {
    this.room = null;
    this.stopTicking();
    this.sync.forgetInFlight();
    this.metrics.dropped();
    this.sent.clear();
    this.clearPending(false);
    this.ahead.clear();
    this.clearGapTimer();
  }

  /** Lets go of the socket (the server sees a drop and holds the seat) and comes back with the token. */
  private dropConnection(): void {
    const room = this.room;
    if (!room) return;
    this.goOffline();
    void room.leave(false).catch(() => undefined);
    this.lose('drop');
  }

  private lose(cause: ReconnectInfo['cause']): void {
    if (this.closed) return;
    const now = this.now();
    if (!this.lost) {
      const graceMs = this.state?.config.rules.graceMs ?? this.opts.defaultGraceMs;
      const { serverNoticeMs, reconnectSlackMs } = this.opts;
      this.lost = {
        cause,
        attempt: 0,
        since: now,
        lostAt: this.serverNow(),
        deadline: now + graceMs + serverNoticeMs + reconnectSlackMs,
        resyncing: false,
      };
    } else {
      this.lost = { ...this.lost, cause, attempt: 0, resyncing: false };
    }
    this.setStatus('reconnecting');
    if (!this.backgrounded) void this.comeBack();
  }

  /** Tries to come back until it does, the deadline passes, or the room can't take this player any more. */
  private async comeBack(): Promise<void> {
    const run = ++this.run;
    this.comingBack = { startedAt: this.now(), snapshotAt: null };
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
      await this.sleep(delays[Math.min(attempt, delays.length) - 1] ?? 1000);
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

  /** After a return: the game is current once the snapshot is in and this player is back in a running game. */
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
      (me.connected && (s.status !== 'paused' || othersAway));
    if (!current) return;
    this.comingBack = null;
    const now = this.now();
    this.metrics.cameBack(back.snapshotAt - back.startedAt, now - back.snapshotAt);
    this.trackSafely('reconnect', { durationMs: Math.round(now - back.startedAt), success: true });
  }

  // -- the app in the background -------------------------------------------------------------------------

  private onAppState(next: string): void {
    if (this.closed) return;
    if (next === 'background') {
      if (this.backgrounded || !this.state || this.state.status === 'over') return;
      if (this.status !== 'live' && this.status !== 'reconnecting') return;
      this.log('in the background: disconnecting');
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
        this.log('back in the foreground: reconnecting');
        void this.comeBack();
      }
    }
  }

  // -- the end -------------------------------------------------------------------------------------------

  private shutdown(reason: CloseReason, error: OnlineError | null): void {
    if (this.closed) return;
    const failedReturn = this.comingBack !== null && reason === 'lostConnection';
    const startedAt = this.comingBack?.startedAt ?? 0;
    this.closed = true;
    this.run++;
    const room = this.room;
    this.goOffline();
    if (room) void room.leave(true).catch(() => undefined);
    this.wakeSleepers();
    this.appStateSub?.remove();
    this.appStateSub = null;
    const now = this.now();
    if (failedReturn)
      this.trackSafely('reconnect', { durationMs: Math.round(now - startedAt), success: false });
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
      startsAt: this.startsAt,
    };
  }

  private notifyOnline(): void {
    this.info = this.makeInfo();
    for (const listener of [...this.onlineListeners]) {
      try {
        listener(this.info);
      } catch (error) {
        this.log(`online listener failed: ${messageOf(error)}`);
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
      if (room === this.room) this.dropConnection();
    }
  }

  private trackSafely(name: 'reconnect', props: { durationMs: number; success: boolean }): void {
    try {
      this.deps.track?.(name, props);
    } catch {
      // Analytics never breaks a game.
    }
  }

  private log(line: string): void {
    this.deps.log?.(line);
  }
}

/** The state with the solution the server sent after the end (as publicState() of the finished game). */
function withSolution(state: GameState, solution: string): GameState {
  const config = state.config;
  return { ...state, config: { ...config, puzzle: { ...config.puzzle, solution } } };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
