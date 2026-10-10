import type { Clock, PlayerId, Scheduler } from '@sudoku-fight/engine';
import {
  MATCHMAKING_ROOM_NAME,
  MATCHMAKING_SERVER_MESSAGE_TYPES,
  type MatchCancelReason,
  type MatchmakingClientMessage,
  type MatchmakingError,
  matchmakingErrorOf,
  type MatchmakingJoinOptions,
  type MatchmakingServerMessage,
  type MatchPlayer,
  type QueueKey,
} from '@sudoku-fight/protocol';

import { onlineErrorOf } from './errors';
import type { OnlineInfo } from './remoteGameHost';

/**
 * Matchmaking for ranked games (work plan stage 9, spec §10, protocol matchmaking.ts), the app's side: one
 * connection to the server's `matchmaking` room, and the player's search through it.
 *
 * - `searching`: the rating, the range (it widens every 5 s; "keep searching" lifts its cap) and the search
 *   time. Times are turned into the phone's clock as they arrive (the offset each message's `serverTime`
 *   gives), so the screens count from `search.startedAt` without asking the server every second.
 * - `found`: the opponents, and this player's seat reservation in the match's game room. The client enters
 *   it at once through `deps.enter` (on the phone an OnlineSession over a RemoteGameHost: being connected is
 *   being ready, D37) and keeps this connection until GO. From here there is no cancelling [D32].
 * - `ready`, then `countdown`: 3… 2… 1… and GO at `match.goAt` (phone time). The game room sends its own
 *   countdown; once the host's clock is synced by its pings, its GO wins (the Match-Countdown screen runs off
 *   the game room alone if this connection is gone).
 * - `started`: GO. The game is the entry's from now on (`entry`, handed to whoever runs the game screen).
 * - `timeout` after 60 s: `keepSearching()` (no cap on the range) or leave (`cancel()`, then a bot, or home).
 * - `matchCancelled`: a player did not reach the match's room in time. Requeued: back to `searching` at the
 *   head of the queue (`fellThrough` says why, for a line on the screen); not requeued: this player was the
 *   one missing, and the search failed ('noShow').
 * - Failures (`failed`, with a MatchmakingFailure): the server's refusals (protocol MATCHMAKING_ERRORS: not
 *   signed in, a queue that is closed, a search already running elsewhere), no answer ('network'), a
 *   connection lost while searching ('lost'). `retry()` searches again.
 *
 * Analytics (spec §22): one `matchmaking_wait {sec, result}` per wait: 'found', 'timeout', 'cancelled' or
 * 'error' ("keep searching" after a timeout starts another).
 *
 * Pure: the connection (MatchmakingConnector), the clock, the timers and the entry come in, so the same code
 * runs in Jest against a fake room and in Node against the real server.
 */

export type FoundMessage = Extract<MatchmakingServerMessage, { type: 'found' }>;

// ---------------------------------------------------------------------------------------------------------
// The connection

/** A joined `matchmaking` room, as the client uses it. */
export interface MatchmakingRoomLike {
  onMessage(
    type: MatchmakingServerMessage['type'],
    callback: (message: MatchmakingServerMessage) => void,
  ): void;
  /** The connection is gone: closed by the server (after GO, a cancel, a timeout's window), or dropped. */
  onLeave(callback: (code: number) => void): void;
  send(type: MatchmakingClientMessage['type'], message: MatchmakingClientMessage): void;
  leave(consented: boolean): Promise<unknown>;
}

/** Gets into a queue. Rejects with a MatchmakingFailure. */
export interface MatchmakingConnector {
  join(queueKey: QueueKey): Promise<MatchmakingRoomLike>;
}

export type MatchmakingFailureCode =
  /** The server's refusals (protocol MATCHMAKING_ERRORS). */
  | MatchmakingError
  /** Nobody is signed in: ranked games are for registered players only. */
  | 'signedOut'
  /** No answer: no network, the server is down, or it took too long. */
  | 'network'
  /** The connection to matchmaking was lost while searching. */
  | 'lost'
  /** This player did not reach the match's room in time; the match is off. */
  | 'noShow'
  | 'unknown';

export class MatchmakingFailure extends Error {
  constructor(
    readonly code: MatchmakingFailureCode,
    message: string,
    /** The SDK's own code (an HTTP status, a close code), for the support code; null without. */
    readonly status: number | string | null = null,
  ) {
    super(message);
    this.name = 'MatchmakingFailure';
  }

  /** For the error screen (spec §16.3): e.g. "alreadyQueued-526". Never carries a token. */
  get supportCode(): string {
    return this.status === null ? this.code : `${this.code}-${this.status}`;
  }
}

/** Any failure of the SDK (a refusal, a network error) as a MatchmakingFailure. */
export function matchmakingFailureOf(error: unknown): MatchmakingFailure {
  if (error instanceof MatchmakingFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  const online = onlineErrorOf(error);
  const refusal = matchmakingErrorOf(message);
  if (refusal) return new MatchmakingFailure(refusal, message, online.status);
  return new MatchmakingFailure(online.code === 'network' ? 'network' : 'unknown', message, online.status);
}

/** The parts of an SDK Room the connector uses. */
export interface SdkMatchmakingRoomLike {
  reconnection: { enabled: boolean };
  onMessage(type: string, callback: (message: MatchmakingServerMessage) => void): unknown;
  onLeave(callback: (code: number, reason?: string) => void): unknown;
  send(type: string, message: unknown): void;
  leave(consented?: boolean): Promise<number>;
}

/** The parts of the SDK Client the connector uses. */
export interface MatchmakingSdkLike {
  auth: { token: string | undefined };
  joinOrCreate(roomName: string, options: object): Promise<SdkMatchmakingRoomLike>;
}

export interface MatchmakingConnectorOptions {
  sdk: MatchmakingSdkLike;
  /**
   * The account's ID token, asked on every join (a Firebase token runs out after an hour); null when nobody
   * is signed in. A bearer secret: sent as the SDK's auth token, never logged.
   */
  token: () => Promise<string | null>;
}

/** The SDK's `joinOrCreate('matchmaking', { queueKey })` with the account's token (protocol matchmaking.ts). */
export function createMatchmakingConnector({
  sdk,
  token,
}: MatchmakingConnectorOptions): MatchmakingConnector {
  return {
    async join(queueKey) {
      let bearer: string | null;
      try {
        bearer = await token();
      } catch (error) {
        throw matchmakingFailureOf(error);
      }
      if (!bearer) throw new MatchmakingFailure('signedOut', 'Ranked games need a signed-in account');
      sdk.auth.token = bearer;
      let room: SdkMatchmakingRoomLike;
      try {
        const options: MatchmakingJoinOptions = { queueKey };
        room = await sdk.joinOrCreate(MATCHMAKING_ROOM_NAME, options);
      } catch (error) {
        throw matchmakingFailureOf(error);
      }
      // A search is not resumed after a drop: the server cancels it, and the app says so.
      room.reconnection.enabled = false;
      return {
        onMessage: (type, callback) => void room.onMessage(type, callback),
        onLeave: (callback) => void room.onLeave((code) => callback(code)),
        send: (type, message) => room.send(type, message),
        leave: (consented) => room.leave(consented),
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// The search

export type MatchPhase =
  /** Getting into the queue. */
  | 'connecting'
  | 'searching'
  /** Nobody found in time (spec §10): keep searching, a bot, or home. */
  | 'timeout'
  /** The VS screen: everyone connects to the match's room (D37: connected = ready). */
  | 'found'
  /** 3… 2… 1… */
  | 'countdown'
  /** GO: the game is on (the entry has it, or will in a moment). */
  | 'started'
  | 'cancelled'
  | 'failed';

export interface SearchInfo {
  /** My rating in the queue's rating key (RATING_OPTION: `normal` or `normal-2p`). */
  rating: number;
  /** Half-width of the range: ratings within rating ± range. */
  range: number;
  /** "Keep searching": the range has no cap. */
  extended: boolean;
  /** Phone time the search began: the search time is now − startedAt. */
  startedAt: number;
  /** Phone time it ends with a timeout if nobody is found. */
  timeoutAt: number;
  /** Back at the head of the queue after a match fell through. */
  requeued: boolean;
}

export interface MatchInfo {
  matchId: string;
  /** This player in the match. */
  me: PlayerId;
  /** Everyone, me included, in seat order. */
  players: readonly MatchPlayer[];
  /** Some of us met lately in this game type. */
  rematch: boolean;
  /** Who is connected to the match's room so far (D37: connected = ready). */
  ready: readonly PlayerId[];
  /** Phone time by which everyone must be in. */
  readyBy: number;
  /** GO, phone time, once the countdown runs. */
  goAt: number | null;
}

export interface TimeoutInfo {
  /** How long the search ran. */
  elapsedMs: number;
  range: number;
  extended: boolean;
  /** Phone time until which "keep searching" carries on this search (later: a new one). */
  keepSearchingUntil: number;
}

/** A match that fell through before GO (a player did not come), and I am back in the queue. */
export interface FellThrough {
  reason: MatchCancelReason;
  missing: readonly PlayerId[];
}

/** The search as the screens show it; a new object on every change. */
export interface MatchmakingInfo {
  phase: MatchPhase;
  queueKey: QueueKey;
  /** Since the first `searching`. */
  search: SearchInfo | null;
  /** From "found" until the match falls through. */
  match: MatchInfo | null;
  timeout: TimeoutInfo | null;
  fellThrough: FellThrough | null;
  error: MatchmakingFailure | null;
  /** The entry (the match's room) has the game: the board can be shown. */
  hasGame: boolean;
}

/** What the client needs of the game room's host (RemoteGameHost). */
export interface MatchHostLike {
  readonly online: OnlineInfo;
  subscribeOnline(listener: (info: OnlineInfo) => void): () => void;
  /** The server's time as the host's pings make it out. */
  serverNow(): number;
  readonly sync: { readonly synced: boolean };
}

/** The match's room, entered at "found": an OnlineSession over a RemoteGameHost on the phone. */
export interface MatchEntry {
  readonly host: MatchHostLike;
  /** Leaves the room (before GO the match falls through; after it, abandonment [D32]). */
  close(): void;
}

export type MatchWaitResult = 'found' | 'timeout' | 'cancelled' | 'error';

export interface MatchmakingClientOptions {
  /** Getting into the queue gives up after this long ('network'). */
  joinTimeoutMs: number;
}

export const DEFAULT_MATCHMAKING_OPTIONS: MatchmakingClientOptions = { joinTimeoutMs: 15_000 };

export interface MatchmakingClientDeps<E extends MatchEntry = MatchEntry> {
  connector: MatchmakingConnector;
  /** "Found": into the match's room with this player's reservation, at once. */
  enter(found: FoundMessage): E;
  /** The phone's clock. */
  clock: Clock;
  scheduler: Scheduler;
  /** Analytics: matchmaking_wait. */
  track?: (name: 'matchmaking_wait', props: { sec: number; result: MatchWaitResult }) => void;
  /** Diagnostics. Never gets a token or a reservation. */
  log?: (line: string) => void;
  options?: Partial<MatchmakingClientOptions>;
}

/** Phases before "found": the search can still be called off. */
const SEARCHING_PHASES: readonly MatchPhase[] = ['connecting', 'searching', 'timeout'];

export class MatchmakingClient<E extends MatchEntry = MatchEntry> {
  readonly queueKey: QueueKey;
  private readonly deps: MatchmakingClientDeps<E>;
  private readonly opts: MatchmakingClientOptions;

  private room: MatchmakingRoomLike | null = null;
  /** Bumped by every new search, cancel and close: a join that lands late knows it lost. */
  private run = 0;
  private closed = false;
  private phase: MatchPhase = 'connecting';
  private search: SearchInfo | null = null;
  private match: MatchInfo | null = null;
  private timeout: TimeoutInfo | null = null;
  private fellThrough: FellThrough | null = null;
  private error: MatchmakingFailure | null = null;
  /** Server time minus phone time, from the latest message that carried the server's clock. */
  private offset: number | null = null;

  private current: E | null = null;
  private entryUnsub: (() => void) | null = null;

  /** One matchmaking_wait per wait. */
  private waitStartedAt = 0;
  private waitTracked = false;

  private readonly listeners = new Set<(info: MatchmakingInfo) => void>();
  private snapshot: MatchmakingInfo;

  constructor(queueKey: QueueKey, deps: MatchmakingClientDeps<E>) {
    this.queueKey = queueKey;
    this.deps = deps;
    this.opts = { ...DEFAULT_MATCHMAKING_OPTIONS, ...deps.options };
    this.snapshot = this.makeInfo();
  }

  // -- the surface ---------------------------------------------------------------------------------------

  get info(): MatchmakingInfo {
    return this.snapshot;
  }

  /** The match's room once found (null before, and after the match fell through). */
  get entry(): E | null {
    return this.current;
  }

  /** Every change of `info`. Returns the unsubscribe function. */
  subscribe(listener: (info: MatchmakingInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Gets into the queue: a fresh search. Never rejects (a failure is `failed`). */
  start(): Promise<void> {
    if (this.closed) return Promise.resolve();
    const run = ++this.run;
    this.leaveRoom();
    this.dropEntry();
    this.phase = 'connecting';
    this.search = null;
    this.match = null;
    this.timeout = null;
    this.error = null;
    this.beginWait();
    this.notify();
    return this.connect(run);
  }

  /** After a failure: the same queue again. */
  retry(): Promise<void> {
    return this.start();
  }

  /**
   * "ביטול חיפוש", or leaving the timeout screen (a bot, home): out of the queue. Only before "found" [D32];
   * returns whether the search was called off.
   */
  cancel(): boolean {
    if (this.closed || !SEARCHING_PHASES.includes(this.phase)) return false;
    this.endWait('cancelled');
    this.run++;
    const room = this.room;
    this.room = null;
    if (room) {
      try {
        room.send('cancel', { type: 'cancel' });
      } catch {
        // Leaving cancels too.
      }
      void room.leave(true).catch(() => undefined);
    }
    this.phase = 'cancelled';
    this.notify();
    return true;
  }

  /**
   * "המשך לחפש" after a timeout: the same search with no cap on the range (spec §10). Once the server's
   * window for it is over (or the connection is gone), a new search.
   */
  keepSearching(): void {
    if (this.closed || this.phase !== 'timeout') return;
    const room = this.room;
    const window = this.timeout?.keepSearchingUntil ?? 0;
    if (!room || this.now() >= window) {
      void this.start();
      return;
    }
    try {
      room.send('keepSearching', { type: 'keepSearching' });
    } catch (error) {
      this.log(`keepSearching failed: ${messageOf(error)}`);
      void this.start();
      return;
    }
    this.phase = 'searching';
    this.timeout = null;
    if (this.search) this.search = { ...this.search, extended: true };
    this.beginWait();
    this.notify();
  }

  /**
   * Lets go of everything: out of the queue, and out of the match's room before GO. After GO the game is the
   * entry's owner's, and stays.
   */
  close(): void {
    if (this.closed) return;
    if (SEARCHING_PHASES.includes(this.phase)) this.endWait('cancelled');
    this.closed = true;
    this.run++;
    this.leaveRoom();
    if (this.phase === 'started') this.unfollowEntry();
    else this.dropEntry();
    this.listeners.clear();
  }

  // -- connecting ----------------------------------------------------------------------------------------

  private async connect(run: number): Promise<void> {
    let room: MatchmakingRoomLike;
    try {
      room = await this.withTimeout(this.deps.connector.join(this.queueKey), run);
    } catch (error) {
      if (run !== this.run || this.closed) return;
      const failure = matchmakingFailureOf(error);
      this.log(`could not get into ${this.queueKey}: ${failure.supportCode}`);
      return this.fail(failure);
    }
    if (run !== this.run || this.closed) {
      void room.leave(true).catch(() => undefined);
      return;
    }
    this.room = room;
    for (const type of MATCHMAKING_SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m) => this.safely(room, () => this.onMessage(room, m)));
    room.onLeave((code) => this.safely(room, () => this.onLeave(room, code)));
    this.log(`in the queue ${this.queueKey}`);
  }

  /** The join, or 'network' after joinTimeoutMs (a room that comes later is let go). */
  private withTimeout(join: Promise<MatchmakingRoomLike>, run: number): Promise<MatchmakingRoomLike> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = this.deps.scheduler.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new MatchmakingFailure('network', 'No answer from matchmaking'));
      }, this.opts.joinTimeoutMs);
      join.then(
        (room) => {
          if (settled) {
            void room.leave(true).catch(() => undefined);
            return;
          }
          settled = true;
          this.deps.scheduler.clearTimeout(timer);
          resolve(room);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          this.deps.scheduler.clearTimeout(timer);
          if (run === this.run) reject(error);
          else reject(new MatchmakingFailure('unknown', 'stale'));
        },
      );
    });
  }

  // -- messages ------------------------------------------------------------------------------------------

  private onMessage(room: MatchmakingRoomLike, m: MatchmakingServerMessage): void {
    if (room !== this.room || this.closed) return;
    const now = this.now();
    if ('serverTime' in m) this.offset = m.serverTime - now;
    switch (m.type) {
      case 'searching': {
        // The server's word: a new match's room, if one was being entered, is off.
        if (this.phase !== 'started') this.dropEntry();
        this.match = null;
        this.timeout = null;
        this.phase = 'searching';
        this.search = {
          rating: m.rating,
          range: m.range,
          extended: m.extended,
          startedAt: now - m.elapsedMs,
          timeoutAt: now + (m.timeoutAt - m.serverTime),
          requeued: m.requeued ?? false,
        };
        return this.notify();
      }
      case 'timeout':
        this.phase = 'timeout';
        this.timeout = {
          elapsedMs: m.elapsedMs,
          range: m.range,
          extended: m.extended,
          keepSearchingUntil: m.keepSearchingUntil - (this.offset ?? 0),
        };
        if (this.search) this.search = { ...this.search, range: m.range, extended: m.extended };
        this.endWait('timeout', m.elapsedMs);
        return this.notify();
      case 'found':
        return this.onFound(m, now);
      case 'ready':
        if (this.match?.matchId !== m.matchId) return;
        this.match = { ...this.match, ready: m.ready };
        return this.notify();
      case 'countdown': {
        if (this.match?.matchId !== m.matchId) return;
        const goAt = this.hostGoAt() ?? now + (m.startsAt - m.serverTime);
        this.match = { ...this.match, goAt };
        if (this.phase === 'found') this.phase = 'countdown';
        return this.notify();
      }
      case 'started':
        if (this.match?.matchId !== m.matchId) return;
        this.phase = 'started';
        return this.notify();
      case 'matchCancelled': {
        if (this.match?.matchId !== m.matchId || this.phase === 'started') return;
        this.log(`the match is off (${m.reason}${m.requeued ? ', back in the queue' : ''})`);
        this.dropEntry();
        this.match = null;
        this.fellThrough = { reason: m.reason, missing: m.missing };
        if (!m.requeued) {
          return this.fail(new MatchmakingFailure('noShow', `the match is off (${m.reason})`));
        }
        // A `searching` follows; until it does, the search as it was.
        this.phase = 'searching';
        this.beginWait();
        return this.notify();
      }
      case 'cancelled':
        if (this.phase !== 'cancelled' && SEARCHING_PHASES.includes(this.phase)) {
          this.endWait('cancelled');
          this.phase = 'cancelled';
          this.notify();
        }
        return;
      case 'pong':
        return;
    }
  }

  private onFound(m: FoundMessage, now: number): void {
    if (this.phase === 'started') return;
    this.dropEntry();
    this.endWait('found');
    this.match = {
      matchId: m.matchId,
      me: m.playerId,
      players: m.players,
      rematch: m.rematch,
      ready: [],
      readyBy: now + (m.readyBy - m.serverTime),
      goAt: null,
    };
    this.timeout = null;
    this.fellThrough = null;
    this.phase = 'found';
    const vs = m.players
      .filter((p) => p.id !== m.playerId)
      .map((p) => `${p.name} (${p.rating})`)
      .join(', ');
    this.log(`found: vs ${vs}${m.rematch ? ' (a rematch)' : ''}`);
    let entry: E;
    try {
      entry = this.deps.enter(m);
    } catch (error) {
      // No way into the match's room: matchmaking calls the match off (this player is the no-show).
      this.log(`could not enter the match's room: ${messageOf(error)}`);
      return this.notify();
    }
    this.current = entry;
    this.entryUnsub = entry.host.subscribeOnline((info) => this.onHost(entry, info));
    this.notify();
  }

  /** The game room's word: its countdown, its game, or its end. */
  private onHost(entry: E, info: OnlineInfo): void {
    if (entry !== this.current || this.closed || !this.match) return;
    if (info.startsAt != null) {
      const goAt = this.hostGoAt() ?? this.match.goAt;
      if (goAt !== this.match.goAt) this.match = { ...this.match, goAt };
      if (this.phase === 'found' && goAt !== null) this.phase = 'countdown';
    }
    if (info.hasGame && this.phase !== 'started') {
      this.phase = 'started';
      this.leaveRoom();
    }
    if (info.status === 'closed' && !info.hasGame && this.room === null && this.phase !== 'started') {
      // The match's room is gone before its game, and matchmaking is not here to say what next.
      const code = info.error?.code === 'network' ? 'network' : 'lost';
      return this.fail(new MatchmakingFailure(code, 'the match room closed before the game'));
    }
    this.notify();
  }

  /** GO in phone time from the game room's countdown, once the host's clock is synced. */
  private hostGoAt(): number | null {
    const host = this.current?.host;
    const startsAt = host?.online.startsAt;
    if (!host || startsAt == null) return null;
    if (host.sync.synced) return this.now() + (startsAt - host.serverNow());
    return this.offset === null ? null : startsAt - this.offset;
  }

  private onLeave(room: MatchmakingRoomLike, code: number): void {
    if (room !== this.room) return;
    this.room = null;
    if (this.closed) return;
    switch (this.phase) {
      case 'connecting':
      case 'searching':
        this.log(`matchmaking closed the connection (${code})`);
        return this.fail(new MatchmakingFailure('lost', 'matchmaking closed the connection', code));
      case 'found':
      case 'countdown': {
        // From "found" on the match goes on without this connection [D32]; the game room says the rest.
        const online = this.current?.host.online;
        if (!online || (online.status === 'closed' && !online.hasGame)) {
          return this.fail(new MatchmakingFailure('lost', 'the match fell through', code));
        }
        return this.notify();
      }
      default:
        // A timeout's window ran out ("keep searching" then starts over), GO, a cancel, a failure.
        return this.notify();
    }
  }

  // -- helpers -------------------------------------------------------------------------------------------

  private fail(error: MatchmakingFailure): void {
    this.endWait('error');
    this.dropEntry();
    this.leaveRoom();
    this.match = null;
    this.error = error;
    this.phase = 'failed';
    this.notify();
  }

  private leaveRoom(): void {
    const room = this.room;
    this.room = null;
    if (room) void room.leave(true).catch(() => undefined);
  }

  /** Out of the match's room (it fell through, or the client is done before GO). */
  private dropEntry(): void {
    const entry = this.current;
    this.unfollowEntry();
    if (!entry) return;
    try {
      entry.close();
    } catch (error) {
      this.log(`could not leave the match's room: ${messageOf(error)}`);
    }
  }

  private unfollowEntry(): void {
    this.entryUnsub?.();
    this.entryUnsub = null;
    this.current = null;
  }

  /** A new wait (a search, "keep searching", back in the queue): its end is reported once. */
  private beginWait(): void {
    this.waitStartedAt = this.now();
    this.waitTracked = false;
  }

  /** The search time so far: the server's (from `searching`), else since this wait began. */
  private searchedMs(): number {
    return this.now() - (this.search?.startedAt ?? this.waitStartedAt);
  }

  private endWait(result: MatchWaitResult, elapsedMs = this.searchedMs()): void {
    if (this.waitTracked) return;
    this.waitTracked = true;
    try {
      this.deps.track?.('matchmaking_wait', { sec: Math.max(0, Math.round(elapsedMs / 1000)), result });
    } catch {
      // Analytics never breaks a search.
    }
  }

  private makeInfo(): MatchmakingInfo {
    return {
      phase: this.phase,
      queueKey: this.queueKey,
      search: this.search,
      match: this.match,
      timeout: this.timeout,
      fellThrough: this.fellThrough,
      error: this.error,
      hasGame: this.current?.host.online.hasGame ?? false,
    };
  }

  private notify(): void {
    this.snapshot = this.makeInfo();
    for (const listener of [...this.listeners]) {
      try {
        listener(this.snapshot);
      } catch (error) {
        this.log(`listener failed: ${messageOf(error)}`);
      }
    }
  }

  private safely(room: MatchmakingRoomLike, step: () => void): void {
    try {
      step();
    } catch (error) {
      this.log(`message failed: ${messageOf(error)}`);
      if (room === this.room && SEARCHING_PHASES.includes(this.phase)) {
        this.fail(new MatchmakingFailure('unknown', messageOf(error)));
      }
    }
  }

  private now(): number {
    return this.deps.clock.now();
  }

  private log(line: string): void {
    this.deps.log?.(line);
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
