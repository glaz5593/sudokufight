import { randomInt } from 'node:crypto';

import { Client, CloseCode, type Room } from '@colyseus/sdk';
import {
  type BotConfig,
  type BotLevelId,
  cellName,
  type ClientAction,
  createRng,
  type EndReason,
  type GameEvent,
  type GameState,
  type PlayerStatus,
  type RankEntry,
  ratingKey,
  type RatingChange,
  type RejectReason,
  type Rng,
  type Scheduler,
} from '@sudoku-fight/engine';
import {
  AVATAR_IDS,
  type AvatarId,
  type ClientMessage,
  type CountryCode,
  devToken,
  GAME_ROOM_NAME,
  type GameRoomCreateOptions,
  type GameRoomJoinOptions,
  type MatchCancelReason,
  MATCHMAKING_ROOM_NAME,
  MATCHMAKING_SERVER_MESSAGE_TYPES,
  type MatchmakingJoinOptions,
  type MatchmakingServerMessage,
  type MatchPlayer,
  type MatchSeatReservation,
  type Me,
  normalizeRoomCode,
  parseQueueKey,
  type QueueKey,
  type RatingEntry,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import type { LatencySummary } from '../../game/metrics';
import { httpOrigin, readMe, signIn } from './account';
import { FakeBrain, type FakeBrainTrace } from './brain';
import { GameMirror } from './mirror';
import { solveGivens } from './solve';
import { ActionTracker, ClockSync, Pacer } from './stats';

/**
 * A fake player over the network (work plan, stage 7: apps/server/scripts/fake-client.ts, "a Node client that
 * plays like a bot"). It does what the app's RemoteGameHost does, with a FakeBrain instead of a person:
 *
 * - joins a room by code, or creates one, with the dev identity ({ devUserId, name }); or (stage 9) plays a
 *   ranked game: signs in with a token (registering the account the first time, POST /v1/users), searches in
 *   a matchmaking queue, connects to the match's room when found (D37: that is being ready), counts down, and
 *   after the game reads its stored rating back (GET /v1/me) next to the one the result announced;
 * - keeps the game with the engine's evolve() over the snapshot and the events (GameMirror), and the solution
 *   it gets after gameOver; it solves the puzzle itself from the givens, because the server never sends it;
 * - plays human-like (the engine bot's think times, mistakes, reactions and interferences), with clientSeq,
 *   never over the server's rate limits;
 * - measures (spec §18): round trips and the clock offset from ping/pong, how long actions take to be
 *   answered, and after a drop how long it takes to reconnect and to be in sync again;
 * - makes trouble on demand: drop the connection and come back with the reconnection token, leave for good
 *   (abandonment after the grace, D32), surrender (6.6), or (ranked) never connect after "found" (a no-show);
 * - after an unplanned drop it reconnects by itself while the server holds its seat.
 *
 * `done` resolves with a summary when its game is over (or it left, or lost the connection for good, or its
 * search ended without a game).
 */

export interface FakeClientTrouble {
  /** Drop the connection (no goodbye) this long after the game starts… */
  dropAfterMs?: number;
  /** …and come back with the reconnection token after this long (default 5000). */
  dropForMs?: number;
  /**
   * Ranked: drop the connection to the match's room as soon as its countdown starts (3… 2… 1…), and come
   * back after this long. The seats are fixed by then [D32]: the game starts at GO either way, and the grace
   * runs from then on.
   */
  dropInCountdownForMs?: number;
  /** Leave on purpose this long after the start, and never come back. */
  leaveAfterMs?: number;
  /** Surrender this long after the start. */
  surrenderAfterMs?: number;
}

/**
 * An account to play a private room with (stage 10's tests: a rated room, `create: { rated: true }`, takes
 * registered players only): signed in with its token, registered the first time, and in the room by that
 * token instead of the development identity.
 */
export interface FakeAccountOptions {
  /** Default: the development token of `id` (`dev:<id>`), which only a server outside production takes. */
  token?: string;
  /** For the registration when the token has no account yet; default AVATAR_IDS[0]. */
  avatarId?: AvatarId;
  /** Likewise; default IL. */
  country?: CountryCode;
}

/** A ranked game (stage 9, spec §10): search in a matchmaking queue with an account. */
export interface FakeQueueOptions {
  /** fast-2p … hard-4p (3–4 players since stage 10). */
  queueKey: QueueKey;
  /**
   * The account's ID token, for the game connections and the account routes alike. Default: the development
   * token of `id` (`dev:<id>`), which only a server outside production takes.
   */
  token?: string;
  /** For the registration (POST /v1/users) when the token has no account yet; default AVATAR_IDS[0]. */
  avatarId?: AvatarId;
  /** Likewise; default IL. */
  country?: CountryCode;
  /** After a timeout: search on, with no cap on the range (default: give up, outcome 'timeout'). */
  keepSearching?: boolean;
  /** After "found", never connect to the game room: a no-show (the match is called off, spec §10). */
  noShow?: boolean;
}

export interface FakeClientOptions {
  /** The server: ws://host:port (http:// works too). */
  url: string;
  /**
   * The display name (spec §3.1: 3–16 letters, digits, '_' or '.'). With `queue`, the account's name when it
   * registers one (an account keeps its own name).
   */
  name: string;
  /** The dev user id (default `fake-<name>`); with `queue`, the uid of the default development token. */
  id?: string;
  /** Exactly one of: join the room with this code (as typed: case, spaces and dashes don't matter)… */
  code?: string;
  /** …create a private room and join it (its code is then `client.code`)… */
  create?: Omit<GameRoomCreateOptions, 'private' | 'devUserId' | 'name'>;
  /** …or search for a ranked game (stage 9). */
  queue?: FakeQueueOptions;
  /** With `code` or `create`: play the room as an account (a rated room needs one). */
  account?: FakeAccountOptions;
  /** The bot level to play like (spec §9), default 3. */
  level?: BotLevelId;
  /** Think time multiplier: 1 is a person's pace (default), 0.02 fifty times faster. */
  thinkScale?: number;
  /** Bot settings over the engine's BOT_CONFIG, e.g. { lingerShare: 0 }. */
  botConfig?: Partial<BotConfig>;
  /** The RNG seed (default: random; it is in the summary). */
  seed?: number;
  /** Send interferences per the level's policy (default true). */
  interfere?: boolean;
  /** Send reactions per the level's table (default true). */
  react?: boolean;
  /** A ping every this many ms (default 1000; 0 for none). Never over the server's limit (2 a second). */
  pingEveryMs?: number;
  trouble?: FakeClientTrouble;
  /** Progress lines (default: nowhere). */
  log?: (line: string) => void;
  /** Log every move of this player too. */
  verbose?: boolean;
  /** Every update from the very first (onUpdate() after connect() may miss the first `searching`). */
  onUpdate?: (update: FakeClientUpdate) => void;
}

/**
 * How it ended for this client: 'over' (the game ended and it saw the result), 'left' (on purpose),
 * 'lostConnection' (could not come back), 'closed' (the server closed the room before the end),
 * 'stopped' (stop() was called), 'error'. Ranked: 'timeout' (no opponent within the search time, and no
 * "keep searching"), 'cancelled' (the match was called off, and this player was not put back in the queue:
 * a no-show). 'playing' while it is not done.
 */
export type FakeOutcome =
  'playing' | 'over' | 'left' | 'lostConnection' | 'closed' | 'stopped' | 'error' | 'timeout' | 'cancelled';

/** One return after a drop (spec §18: reconnect time and sync time). */
export interface FakeResync {
  via: 'reconnect' | 'rejoin';
  /** How long the connection was down before trying to come back. */
  downMs: number;
  /** From trying to come back until the room took the connection. */
  reconnectMs: number;
  /** From trying to come back until the state was whole again (snapshot, and the game running again). */
  syncMs: number;
  /** The state's seq at that moment. */
  seq: number;
  /** Epoch ms when it started coming back, and when it was in sync. */
  startedAt: number;
  syncedAt: number;
}

/** The rating a ranked game moved for this player, as its result announced it (spec §11.2). */
export interface FakeRatingChange {
  /** The rating key (RATING_OPTION B: `fast`; A: `fast-2p`). */
  key: string;
  before: number;
  after: number;
  delta: number;
  /** K doubled: the key's first 10 games. */
  provisional: boolean;
}

/** The ranked part of a run (queue mode). */
export interface FakeMatchSummary {
  queueKey: QueueKey;
  /** Every range (±) the server announced while searching, in order. */
  ranges: number[];
  /** Searching time when the match was found (or at the last timeout); null before either. */
  searchedMs: number | null;
  /** Timeouts seen (each one offers "keep searching"). */
  timeouts: number;
  matchId: string | null;
  /** Some of the players met before (opponent_history); null before a match. */
  rematch: boolean | null;
  /** The other players, as the "found" screen shows them. */
  opponents: MatchPlayer[];
  /** Why the last match fell through, when one did. */
  cancelled: MatchCancelReason | null;
  /** The account was registered by this run (false: it had one). */
  registered: boolean;
  /**
   * The account's rating in the key this queue moves (RATING_OPTION B: `fast`; A: `fast-2p`), from
   * GET /v1/me before the search.
   */
  ratingBefore: RatingEntry | null;
  /** The game's result for this player; null without one. */
  rating: FakeRatingChange | null;
  /** The same key read back after the game (GET /v1/me), once the server has stored it; else null. */
  ratingAfter: RatingEntry | null;
}

export interface FakeClientSummary {
  playerId: string;
  name: string;
  code: string;
  outcome: FakeOutcome;
  error: string | null;
  endReason: EndReason | null;
  /** This player's place in the final ranking; null without a result. */
  place: number | null;
  players: number;
  /** As this client last saw itself in the game. */
  status: PlayerStatus | null;
  score: number | null;
  mistakes: number | null;
  correct: number | null;
  ranking: RankEntry[] | null;
  /** Round trips of ping/pong. */
  rtt: LatencySummary;
  /** From an action sent to its answer (an event or a refusal). */
  actions: LatencySummary;
  /** Actions never answered. */
  actionsLost: number;
  /** Server time minus client time, from the best round trip; null without a pong. */
  clockOffsetMs: number | null;
  resyncs: FakeResync[];
  /** How long solving the puzzle from the givens took; null before the game. */
  solveMs: number | null;
  /** The solution it worked out is the one the server revealed after the end; null before that. */
  solutionMatches: boolean | null;
  /** Mirror health: seq gaps, duplicate events, snapshots of a running game that carried the solution. */
  seqGaps: number;
  duplicates: number;
  leaks: number;
  rejected: Partial<Record<RejectReason, number>>;
  level: BotLevelId;
  seed: number;
  /** Ranked (queue mode); null for a private room. */
  match: FakeMatchSummary | null;
}

export type FakeClientUpdate =
  /** Ranked: every message of the matchmaking connection. */
  | { kind: 'matchmaking'; message: MatchmakingServerMessage }
  /** A match room's countdown (protocol GameRoomCountdown). */
  | { kind: 'countdown'; startsAt: number; serverTime: number }
  | { kind: 'snapshot'; state: GameState }
  | { kind: 'events'; events: GameEvent[]; state: GameState }
  | { kind: 'resynced'; resync: FakeResync }
  | { kind: 'finished'; summary: FakeClientSummary };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** `fake-<name>` with anything a dev user id can't hold turned into '_'. */
export const defaultFakeId = (name: string): string =>
  `fake-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);

/** The grace after a drop when the game's rules are not known yet (spec §16.2, D4: 15 s). */
const DEFAULT_GRACE_MS = 15_000;

/** After a ranked game, how long to look for the stored rating (it is written in the background). */
const STORED_RATING_WAIT_MS = 5000;

/** The account's rating in the key a queue moves: `fast-2p` under RATING_OPTION A, else `fast` (B). */
export function queueRatingOf(me: Me, queueKey: QueueKey): RatingEntry | null {
  const gameType = parseQueueKey(queueKey)?.gameType;
  return me.ratings.find((r) => r.key === queueKey) ?? me.ratings.find((r) => r.key === gameType) ?? null;
}

export class FakeClient {
  readonly mirror = new GameMirror();
  readonly sync = new ClockSync();
  readonly actions = new ActionTracker();
  readonly resyncs: FakeResync[] = [];
  /** Resolves when this client is done (see FakeOutcome). */
  readonly done: Promise<FakeClientSummary>;
  /** The player's id in games: the dev user id, or (queue) the account's users.id. */
  readonly playerId: string;
  readonly name: string;
  readonly seed: number;
  readonly level: BotLevelId;

  private readonly sdk: Client;
  private readonly rng: Rng;
  private readonly pacer = new Pacer(() => Date.now());
  private readonly listeners = new Set<(update: FakeClientUpdate) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly sleepers = new Set<() => void>();
  private readonly rejectedCounts: Partial<Record<RejectReason, number>> = {};
  /** Ranked: the account's token and where its routes are. */
  private readonly account: { origin: string; token: string } | null;
  private readonly match: FakeMatchSummary | null;
  private room: Room | null = null;
  /** Ranked: the matchmaking connection, until the server closes it (at GO) or the search ends. */
  private searchRoom: Room | null = null;
  /** The search's start on the server's clock (from the last `searching`). */
  private searchStart: number | null = null;
  /** The match whose seat reservation is being used (a cancelled match's late seat is let go). */
  private entering: string | null = null;
  /** The match room's GO (its countdown started); null before. */
  private countdownAt: number | null = null;
  /** The drop at the countdown (trouble) happened already: a countdown sent again on return is not another. */
  private droppedInCountdown = false;
  /** Offline on purpose or by accident, and on the way back: the room being away is not the end. */
  private returning = false;
  /** The game is over and the stored rating is being read before finishing. */
  private wrappingUp = false;
  private roomCode = '';
  private brain: FakeBrain | null = null;
  private solved: { solution: string; ms: number } | null = null;
  private revealed: string | null = null;
  private clientSeq = 0;
  private stage: 'connecting' | 'searching' | 'lobby' | 'playing' | 'over' = 'connecting';
  private comingBack:
    (Omit<FakeResync, 'syncMs' | 'seq' | 'syncedAt'> & { mono: number; snapshot: boolean }) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private ended: { outcome: FakeOutcome; error: string | null } | null = null;
  private resolveDone!: (summary: FakeClientSummary) => void;

  private constructor(
    private readonly opts: FakeClientOptions,
    playerId: string,
    ranked: { origin: string; token: string; registered: boolean; me: Me } | null,
  ) {
    this.name = opts.name;
    this.playerId = playerId;
    this.seed = opts.seed ?? randomInt(2 ** 31);
    this.level = opts.level ?? 3;
    this.rng = createRng(this.seed);
    this.sdk = new Client(opts.url);
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
    if (opts.onUpdate) this.listeners.add(opts.onUpdate);
    this.account = ranked && { origin: ranked.origin, token: ranked.token };
    this.match =
      opts.queue && ranked
        ? {
            queueKey: opts.queue.queueKey,
            ranges: [],
            searchedMs: null,
            timeouts: 0,
            matchId: null,
            rematch: null,
            opponents: [],
            cancelled: null,
            registered: ranked.registered,
            ratingBefore: queueRatingOf(ranked.me, opts.queue.queueKey),
            rating: null,
            ratingAfter: null,
          }
        : null;
  }

  /**
   * Connects: creates the room, joins it by code, or (queue) signs in, registering the account if it has
   * none, and starts searching. Rejects when the server refuses (GameRoomError, MatchmakingError, or an
   * account route's error).
   */
  static async connect(opts: FakeClientOptions): Promise<FakeClient> {
    const ways = [opts.code, opts.create, opts.queue].filter((w) => w !== undefined).length;
    if (ways !== 1) throw new Error('Give exactly one of: a room code to join, create options, or a queue');
    if (opts.queue) {
      const origin = httpOrigin(opts.url);
      const token = opts.queue.token ?? devToken(opts.id ?? defaultFakeId(opts.name));
      const { me, registered } = await signIn(origin, token, {
        displayName: opts.name,
        avatarId: opts.queue.avatarId ?? AVATAR_IDS[0],
        country: opts.queue.country ?? 'IL',
      });
      const client = new FakeClient(opts, me.id, { origin, token, registered, me });
      const before = queueRatingOf(me, opts.queue.queueKey);
      const rating = before
        ? `${before.key} ${before.rating} (${before.games} games${before.provisional ? ', provisional' : ''})`
        : 'no rating in this queue';
      client.log(`${registered ? 'registered' : 'signed in as'} ${me.displayName} (${me.id}): ${rating}`);
      await client.search();
      return client;
    }
    if (opts.account) {
      const origin = httpOrigin(opts.url);
      const token = opts.account.token ?? devToken(opts.id ?? defaultFakeId(opts.name));
      const { me, registered } = await signIn(origin, token, {
        displayName: opts.name,
        avatarId: opts.account.avatarId ?? AVATAR_IDS[0],
        country: opts.account.country ?? 'IL',
      });
      const client = new FakeClient(opts, me.id, { origin, token, registered, me });
      client.log(`${registered ? 'registered' : 'signed in as'} ${me.displayName} (${me.id})`);
      await client.join();
      return client;
    }
    const client = new FakeClient(opts, opts.id ?? defaultFakeId(opts.name), null);
    await client.join();
    return client;
  }

  /** The room's code (its id). */
  get code(): string {
    return this.roomCode;
  }

  /** The game as this client holds it; null before the game starts. */
  get state(): GameState | null {
    return this.mirror.state;
  }

  get outcome(): FakeOutcome {
    return this.ended?.outcome ?? 'playing';
  }

  /** The solution it worked out from the givens; null before the game. */
  get solution(): string | null {
    return this.solved?.solution ?? null;
  }

  /** Every update, after the client handled it. Returns the unsubscribe function. */
  onUpdate(listener: (update: FakeClientUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Done now: stops playing (or searching), leaves the rooms (on purpose), resolves `done`. */
  async stop(): Promise<FakeClientSummary> {
    this.finish('stopped');
    return this.done;
  }

  summary(): FakeClientSummary {
    const s = this.mirror.state;
    const me = s?.players.find((p) => p.id === this.playerId) ?? null;
    const ranking = s?.result?.ranking ?? null;
    return {
      playerId: this.playerId,
      name: this.name,
      code: this.roomCode,
      outcome: this.outcome,
      error: this.ended?.error ?? null,
      endReason: s?.result?.reason ?? null,
      place: ranking?.find((r) => r.playerId === this.playerId)?.place ?? null,
      players: s?.players.length ?? 0,
      status: me?.status ?? null,
      score: me?.score ?? null,
      mistakes: me?.mistakes ?? null,
      correct: me?.correct ?? null,
      ranking,
      rtt: this.sync.rtt.summary(),
      actions: this.actions.latency.summary(),
      actionsLost: this.actions.lost,
      clockOffsetMs: this.sync.synced ? Math.round(this.sync.offsetMs) : null,
      resyncs: [...this.resyncs],
      solveMs: this.solved ? Math.round(this.solved.ms * 100) / 100 : null,
      solutionMatches:
        this.revealed === null || this.solved === null ? null : this.revealed === this.solved.solution,
      seqGaps: this.mirror.gaps,
      duplicates: this.mirror.duplicates,
      leaks: this.mirror.leaks,
      rejected: { ...this.rejectedCounts },
      level: this.level,
      seed: this.seed,
      match: this.match && {
        ...this.match,
        ranges: [...this.match.ranges],
        opponents: [...this.match.opponents],
        ratingBefore: this.match.ratingBefore && { ...this.match.ratingBefore },
        rating: this.match.rating && { ...this.match.rating },
        ratingAfter: this.match.ratingAfter && { ...this.match.ratingAfter },
      },
    };
  }

  // -- connecting -----------------------------------------------------------------------------------------

  /** The join options of a rejoin by code: the dev identity, or none with an account (its token says). */
  private get identity(): GameRoomJoinOptions | Record<string, never> {
    return this.account ? {} : { devUserId: this.playerId, name: this.name };
  }

  private async join(): Promise<void> {
    let room: Room;
    // An account comes in by its token; the room knows it by its users.id and display name.
    if (this.account) this.sdk.auth.token = this.account.token;
    if (this.opts.create) {
      const options = {
        private: true,
        ...this.identity,
        ...this.opts.create,
      } as GameRoomCreateOptions;
      room = await this.sdk.create(GAME_ROOM_NAME, options);
    } else {
      const code = normalizeRoomCode(this.opts.code ?? '');
      if (code === null) throw new Error(`"${this.opts.code}" is not a room code`);
      room = await this.sdk.joinById(code, this.identity);
    }
    this.roomCode = room.roomId;
    this.stage = 'lobby';
    this.attach(room);
    this.log(`${this.opts.create ? 'created' : 'joined'} room ${this.roomCode} as ${this.playerId}`);
  }

  private attach(room: Room): void {
    this.room = room;
    // Reconnecting is ours to do: on demand (a simulated drop), and with the grace period in view.
    room.reconnection.enabled = false;
    for (const type of SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m: ServerMessage) => this.safely(() => this.onMessage(room, m)));
    room.onLeave((code: number) => this.safely(() => this.onLeave(room, code)));
    this.startPings();
  }

  /** Offline: whatever was on the way is lost. */
  private offline(): void {
    this.room = null;
    this.stopPings();
    this.brain?.setConnected(false);
    this.actions.reset();
    this.sync.forgetInFlight();
  }

  private onLeave(room: Room, code: number): void {
    if (room !== this.room) return; // a connection already given up
    const token = room.reconnectionToken;
    this.offline();
    if (this.ended) return;
    if (this.stage === 'over') return this.gameOver();
    if (this.stage === 'lobby' && this.match) {
      if (code === CloseCode.CONSENTED) {
        // A match room closes before its game when the match is called off: matchmaking says what next.
        if (this.searchRoom === null)
          this.finish('closed', `the match room closed before the game (${code})`);
        return;
      }
      // Dropped before the game. Before the countdown the room gives the seat up at once (rejoin by code
      // while the ready check runs); from the countdown on it holds it like a game's [D32].
      this.log(`connection to the match's room lost (${code}); coming back`);
      const retryForMs = this.countdownAt === null ? 0 : DEFAULT_GRACE_MS + 1000;
      this.run(this.comeBack(token, performance.now(), retryForMs));
      return;
    }
    if (this.stage !== 'playing') return this.finish('error', `the server closed the connection (${code})`);
    if (code === CloseCode.CONSENTED) return this.finish('closed', 'the server closed the room');
    // Dropped (or disconnected by the server): come back while the seat is held.
    this.log(`connection lost (${code}); reconnecting`);
    const graceMs = this.mirror.state?.config.rules.graceMs ?? DEFAULT_GRACE_MS;
    this.run(this.comeBack(token, performance.now(), graceMs + 1000));
  }

  /**
   * Back into the room: with the reconnection token, retrying for `retryForMs`; when the seat is gone, a
   * rejoin by code, which still shows how the game ended while the room lasts.
   */
  private async comeBack(token: string, downAt: number, retryForMs: number): Promise<void> {
    this.returning = true;
    try {
      await this.tryComingBack(token, downAt, retryForMs);
    } finally {
      this.returning = false;
    }
  }

  private async tryComingBack(token: string, downAt: number, retryForMs: number): Promise<void> {
    const mono = performance.now();
    const startedAt = Date.now();
    let room: Room | null = null;
    let via: FakeResync['via'] = 'reconnect';
    for (;;) {
      try {
        room = await this.sdk.reconnect(token);
        break;
      } catch {
        if (this.ended || performance.now() - mono >= retryForMs) break;
        await this.sleep(500);
      }
    }
    if (this.ended) {
      void room?.leave();
      return;
    }
    if (room === null) {
      try {
        room = await this.sdk.joinById(this.roomCode, this.identity);
        via = 'rejoin';
      } catch (error) {
        return this.finish('lostConnection', `could not come back: ${message(error)}`);
      }
    }
    if (this.ended) {
      void room.leave();
      return;
    }
    const reconnectMs = performance.now() - mono;
    this.comingBack = { via, downMs: mono - downAt, reconnectMs, startedAt, mono, snapshot: false };
    this.log(`back in the room (${via}) after ${Math.round(reconnectMs)} ms`);
    this.attach(room);
  }

  // -- ranked: matchmaking (stage 9) ----------------------------------------------------------------------

  /** Joins the matchmaking queue with the account's token (protocol matchmaking.ts). */
  private async search(): Promise<void> {
    const queue = this.opts.queue!;
    this.sdk.auth.token = this.account!.token;
    const options: MatchmakingJoinOptions = { queueKey: queue.queueKey };
    const room = await this.sdk.joinOrCreate(MATCHMAKING_ROOM_NAME, options);
    this.searchRoom = room;
    this.stage = 'searching';
    room.reconnection.enabled = false;
    for (const type of MATCHMAKING_SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m: MatchmakingServerMessage) => this.safely(() => this.onMatchmaking(room, m)));
    room.onLeave((code: number) => this.safely(() => this.onMatchmakingLeave(room, code)));
  }

  private onMatchmaking(room: Room, m: MatchmakingServerMessage): void {
    const info = this.match;
    if (room !== this.searchRoom || this.ended || info === null) return;
    switch (m.type) {
      case 'searching':
        info.ranges.push(m.range);
        this.searchStart = m.serverTime - m.elapsedMs;
        this.log(
          `${m.requeued ? 'back at the head of the queue' : 'searching'} ${m.queueKey}: rating ${m.rating}, ` +
            `range ±${m.range}${m.extended ? ' (no cap)' : ''} after ${seconds(m.elapsedMs)}`,
        );
        break;
      case 'timeout':
        info.timeouts++;
        info.searchedMs = m.elapsedMs;
        this.log(`no opponent within ${seconds(m.elapsedMs)} (range ±${m.range})`);
        if (this.opts.queue?.keepSearching) {
          this.log('keep searching, without the cap on the range');
          room.send('keepSearching', { type: 'keepSearching' });
        } else {
          this.emit({ kind: 'matchmaking', message: m });
          return this.finish('timeout');
        }
        break;
      case 'found': {
        info.matchId = m.matchId;
        info.rematch = m.rematch;
        info.cancelled = null;
        info.opponents = m.players.filter((p) => p.id !== this.playerId);
        info.searchedMs = this.searchStart === null ? null : m.serverTime - this.searchStart;
        const vs = info.opponents.map(
          (p) => `${p.name} (${p.rating}${p.provisional ? ', provisional' : ''})`,
        );
        const after = info.searchedMs === null ? '' : ` after ${seconds(info.searchedMs)}`;
        this.log(`found: vs ${vs.join(', ')}${m.rematch ? ' (a rematch)' : ''}${after}`);
        if (this.opts.queue?.noShow) this.log('not going to the game room (a no-show)');
        else {
          this.entering = m.matchId;
          this.run(this.enterMatch(m.matchId, m.reservation));
        }
        break;
      }
      case 'ready':
        if (this.opts.verbose) this.log(`ready: ${m.ready.length} of ${info.opponents.length + 1}`);
        break;
      case 'countdown':
        if (this.opts.verbose) this.log(`matchmaking: GO in ${seconds(m.startsAt - m.serverTime)}`);
        break;
      case 'started':
        this.log(`GO: the game runs in room ${m.roomId}`);
        break;
      case 'matchCancelled': {
        info.cancelled = m.reason;
        const missing = m.missing.length ? `, missing ${m.missing.join(', ')}` : '';
        this.entering = null;
        this.countdownAt = null;
        this.leaveMatchRoom();
        if (m.requeued) {
          this.stage = 'searching';
          this.log(`the match is off (${m.reason}${missing}): back in the queue`);
          break;
        }
        this.emit({ kind: 'matchmaking', message: m });
        return this.finish('cancelled', `the match is off (${m.reason}${missing})`);
      }
      case 'cancelled':
      case 'pong':
        break;
    }
    this.emit({ kind: 'matchmaking', message: m });
  }

  /**
   * "Found": into the match's room with the seat reservation (D37: connected = ready). A match called off
   * meanwhile is let go: its room is closing, and matchmaking has put this player back in the queue.
   */
  private async enterMatch(matchId: string, reservation: MatchSeatReservation): Promise<void> {
    let room: Room;
    try {
      room = await this.sdk.consumeSeatReservation(reservation);
    } catch (error) {
      if (this.ended || this.entering !== matchId) return;
      throw error;
    }
    if (this.ended || this.entering !== matchId) {
      void room.leave();
      return;
    }
    this.entering = null;
    this.roomCode = room.roomId;
    this.stage = 'lobby';
    this.attach(room);
    this.log(`in the match's room ${room.roomId}: ready`);
  }

  /** The match was called off: its room is closing anyway. */
  private leaveMatchRoom(): void {
    const room = this.room;
    if (room === null || this.stage !== 'lobby') return;
    this.offline();
    void room.leave(true);
  }

  private onMatchmakingLeave(room: Room, code: number): void {
    if (room !== this.searchRoom) return;
    this.searchRoom = null;
    if (this.ended || this.returning) return;
    // The server closes it at GO; from "found" on the match goes on without it [D32].
    if (this.stage === 'searching')
      return this.finish('error', `matchmaking closed the connection (${code})`);
    if (this.stage === 'lobby' && this.room === null && !this.opts.queue?.noShow)
      this.finish('closed', 'the match fell through');
  }

  /** gameOver: the rating the result gives this player (ranked games move one, spec §11.2). */
  private noteRating(changes: readonly RatingChange[], state: GameState): void {
    const change = changes.find((c) => c.playerId === this.playerId);
    if (!this.match || !change) return;
    const { gameType, players, rules } = state.config;
    const key = ratingKey(gameType, players.length, rules.rating.option);
    const { before, after, delta, provisional } = change;
    this.match.rating = { key, before, after, delta, provisional };
    const sign = change.delta >= 0 ? '+' : '';
    this.log(
      `rating ${key}: ${change.before} -> ${change.after} (${sign}${change.delta}` +
        `${change.provisional ? ', provisional' : ''})`,
    );
  }

  /** The game is over and seen: finish, after reading the stored rating back (ranked). */
  private gameOver(): void {
    if (this.ended || this.wrappingUp) return;
    if (!this.account || !this.match?.rating) return this.finish('over');
    this.wrappingUp = true;
    this.run(this.readStoredRating().then(() => this.finish('over')));
  }

  /** GET /v1/me until the game counts in the rating key (the server writes it in the background). */
  private async readStoredRating(): Promise<void> {
    const rating = this.match!.rating!;
    const gamesBefore =
      this.mirror.state?.config.players.find((p) => p.id === this.playerId)?.ratedGames ?? 0;
    const until = Date.now() + STORED_RATING_WAIT_MS;
    while (!this.ended && Date.now() < until) {
      try {
        const me = await readMe(this.account!.origin, this.account!.token);
        const entry = me?.ratings.find((r) => r.key === rating.key);
        if (entry && entry.games > gamesBefore) {
          this.match!.ratingAfter = entry;
          this.log(`the server stored ${rating.key} ${entry.rating} (${entry.games} game(s) in it)`);
          return;
        }
      } catch (error) {
        this.log(`could not read the stored rating: ${message(error)}`);
        return;
      }
      await this.sleep(200);
    }
    this.log('the stored rating did not show up in time');
  }

  // -- messages -------------------------------------------------------------------------------------------

  private onMessage(room: Room, m: ServerMessage): void {
    if (room !== this.room || this.ended) return;
    switch (m.type) {
      case 'lobby': {
        const who = m.players.map((p) => p.name).join(', ');
        this.log(`lobby ${m.code}: ${who} (${m.players.length}/${m.playerCount}, ${m.gameType})`);
        return;
      }
      case 'countdown': {
        this.countdownAt = m.startsAt;
        this.log(`everyone is in: 3... 2... 1... GO in ${seconds(m.startsAt - m.serverTime)}`);
        this.emit({ kind: 'countdown', startsAt: m.startsAt, serverTime: m.serverTime });
        const forMs = this.opts.trouble?.dropInCountdownForMs;
        if (forMs !== undefined && !this.droppedInCountdown) {
          this.droppedInCountdown = true;
          this.run(this.drop(forMs));
        }
        return;
      }
      case 'snapshot': {
        if (m.playerId !== this.playerId) throw new Error(`The server says I am ${m.playerId}`);
        this.mirror.snapshot(m.state, m.playerId);
        if (this.comingBack) this.comingBack.snapshot = true;
        if (m.state.status === 'over') this.stage = 'over';
        else if (this.stage !== 'over') this.stage = 'playing';
        this.startBrain(m.state);
        this.brain?.setConnected(true);
        this.brain?.update(m.state);
        this.emit({ kind: 'snapshot', state: m.state });
        this.checkInSync();
        return;
      }
      case 'events': {
        const applied = this.mirror.events(m.events);
        const state = this.mirror.state;
        if (!applied.length || state === null) return;
        this.actions.events(applied, this.playerId, performance.now());
        for (const e of applied) this.observe(e, state);
        this.brain?.update(state, applied);
        this.emit({ kind: 'events', events: applied, state });
        this.checkInSync();
        return;
      }
      case 'rejected':
        this.rejectedCounts[m.reason] = (this.rejectedCounts[m.reason] ?? 0) + 1;
        this.actions.rejected(m.clientSeq, performance.now());
        if (this.opts.verbose) this.log(`refused #${m.clientSeq}: ${m.reason}`);
        this.brain?.rejected(m.clientSeq, m.reason);
        return;
      case 'solution':
        this.revealed = m.solution;
        this.mirror.solution(m.solution);
        if (this.stage === 'over') this.gameOver();
        return;
      case 'pong':
        this.sync.pong(m.t, m.serverTime, performance.now(), Date.now());
        return;
    }
  }

  /** What the log says, and what this client does about it (the start, the end). */
  private observe(e: GameEvent, state: GameState): void {
    const me = this.playerId;
    const name = (id: string) => state.config.players.find((p) => p.id === id)?.name ?? id;
    switch (e.type) {
      case 'gameStarted': {
        const empty = state.grid.filter((v) => v === 0).length;
        const solved = this.solved ? `, solved in ${this.solved.ms.toFixed(1)} ms` : '';
        this.log(`game started: ${state.config.gameType}, ${empty} empty cells${solved}`);
        this.scheduleTrouble();
        return;
      }
      case 'placedCorrect':
        if (this.opts.verbose && e.playerId === me)
          this.log(`${cellName(e.cell)}=${e.digit} right, +${e.points} (score ${e.score})`);
        return;
      case 'placedWrong':
        if (this.opts.verbose && e.playerId === me)
          this.log(`${cellName(e.cell)}=${e.digit} wrong, -${e.penalty} (score ${e.score})`);
        return;
      case 'interference':
        if (e.fromId === me) this.log(`sent ${e.kind} to ${name(e.targetId)} (cost ${e.cost})`);
        else if (e.targetId === me) this.log(`hit by ${e.kind} from ${name(e.fromId)}`);
        return;
      case 'reaction':
        if (this.opts.verbose) this.log(`${name(e.playerId)} reacts ${e.emoji}`);
        return;
      case 'playerDisconnected':
        if (e.playerId !== me) this.log(`${name(e.playerId)} dropped`);
        return;
      case 'playerReconnected':
        if (e.playerId !== me) this.log(`${name(e.playerId)} is back`);
        return;
      case 'playerAbandoned':
        this.log(`${name(e.playerId)} abandoned the game`);
        return;
      case 'playerSurrendered':
        this.log(`${name(e.playerId)} surrendered`);
        return;
      case 'gamePaused':
        this.log('game frozen');
        return;
      case 'gameResumed':
        this.log(`game resumed after ${seconds(e.pausedMs)}`);
        return;
      case 'gameOver': {
        this.stage = 'over';
        const ranking = e.ranking.map((r) => `${r.place}. ${name(r.playerId)} ${r.score}`).join(', ');
        this.log(`game over (${e.reason}): ${ranking}`);
        this.noteRating(e.ratingChanges, state);
        // The solution follows at once; finish anyway if it doesn't.
        this.later(3000, () => this.gameOver());
        return;
      }
      default:
        return;
    }
  }

  /** After a return: in sync once the snapshot is in and this player is back in a running game. */
  private checkInSync(): void {
    const back = this.comingBack;
    const s = this.mirror.state;
    if (back === null || !back.snapshot || s === null) return;
    const me = s.players.find((p) => p.id === this.playerId);
    const othersAway = s.players.some((p) => p.id !== this.playerId && p.status === 'active' && !p.connected);
    const whole =
      s.status === 'over' ||
      !me ||
      me.status !== 'active' ||
      (me.connected && (s.status !== 'paused' || othersAway));
    if (!whole) return;
    this.comingBack = null;
    const { mono: _mono, snapshot: _snapshot, ...rest } = back;
    const resync: FakeResync = {
      ...rest,
      syncMs: performance.now() - back.mono,
      seq: s.seq,
      syncedAt: Date.now(),
    };
    this.resyncs.push(resync);
    this.log(`in sync again ${Math.round(resync.syncMs)} ms after trying to come back (seq ${s.seq})`);
    this.emit({ kind: 'resynced', resync });
  }

  // -- playing --------------------------------------------------------------------------------------------

  private startBrain(state: GameState): void {
    if (this.brain || this.solved) return;
    const t0 = performance.now();
    const solved = solveGivens(state.config.puzzle.givens);
    this.solved = { solution: solved.solution, ms: performance.now() - t0 };
    if (!solved.unique)
      this.log("warning: this puzzle has more than one solution; mine may not be the server's");
    const scheduler: Scheduler = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.brain = new FakeBrain({
      playerId: this.playerId,
      level: this.level,
      solution: solved.solution,
      clock: { now: () => Date.now() + this.sync.offsetMs },
      scheduler,
      rng: this.rng,
      thinkScale: this.opts.thinkScale ?? 1,
      config: this.opts.botConfig,
      interfere: this.opts.interfere,
      react: this.opts.react,
      send: (action) => this.send(action),
      pace: (type) => this.pacer.take(type),
      onTrace: (t) => this.onTrace(t),
    });
  }

  private send(action: ClientAction): number | null {
    const room = this.room;
    if (room === null || this.ended) return null;
    const clientSeq = ++this.clientSeq;
    const msg: ClientMessage = { ...action, clientSeq };
    room.send(action.type, msg);
    this.actions.sent(clientSeq, action, performance.now());
    return clientSeq;
  }

  private onTrace(t: FakeBrainTrace): void {
    if (t.type === 'error') this.log(`player error: ${message(t.error)}`);
    else if (this.opts.verbose && t.type === 'noAnswer') this.log(`no answer to #${t.clientSeq}`);
  }

  private scheduleTrouble(): void {
    const t = this.opts.trouble ?? {};
    if (t.dropAfterMs !== undefined) {
      const forMs = t.dropForMs ?? 5000;
      this.later(t.dropAfterMs, () => this.run(this.drop(forMs)));
    }
    if (t.leaveAfterMs !== undefined) this.later(t.leaveAfterMs, () => this.run(this.leave()));
    if (t.surrenderAfterMs !== undefined) this.later(t.surrenderAfterMs, () => this.surrender());
  }

  /** The connection drops (no goodbye), and comes back after `forMs` with the reconnection token. */
  private async drop(forMs: number): Promise<void> {
    const room = this.room;
    const inCountdown = this.stage === 'lobby' && this.countdownAt !== null;
    if (room === null || this.ended || (this.stage !== 'playing' && !inCountdown)) return;
    const token = room.reconnectionToken;
    this.log(`dropping the connection for ${seconds(forMs)}${inCountdown ? ' (in the countdown)' : ''}`);
    const downAt = performance.now();
    // Offline first: the closing room is no longer this.room, so its onLeave is not taken for a failure.
    this.offline();
    this.returning = true;
    try {
      await room.leave(false);
      await this.sleep(forMs);
    } finally {
      this.returning = false;
    }
    if (this.ended) return;
    await this.comeBack(token, downAt, 0);
  }

  /** Leaves on purpose and never comes back: after the grace it is abandonment (D32). */
  private async leave(): Promise<void> {
    const room = this.room;
    if (room === null || this.ended || this.stage !== 'playing') return;
    this.log('leaving the game for good');
    this.brain?.stop();
    this.offline();
    await room.leave(true);
    this.finish('left');
  }

  private surrender(): void {
    if (this.room === null || this.ended || this.stage !== 'playing') return;
    this.log('surrendering');
    this.send({ type: 'surrender' });
  }

  // -- pings ----------------------------------------------------------------------------------------------

  private startPings(): void {
    this.stopPings();
    const every = this.opts.pingEveryMs ?? 1000;
    if (every <= 0) return;
    // A quick first sync: a few at once, within the server's burst.
    for (let k = 0; k < 3; k++) this.ping();
    this.pingTimer = setInterval(() => this.safely(() => this.ping()), every);
  }

  private stopPings(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private ping(): void {
    if (this.room === null || this.pacer.take('ping') > 0) return;
    this.room.send('ping', { type: 'ping', t: this.sync.ping(performance.now()) } satisfies ClientMessage);
  }

  // -- the end --------------------------------------------------------------------------------------------

  private finish(outcome: FakeOutcome, error: string | null = null): void {
    if (this.ended) return;
    this.ended = { outcome, error };
    this.brain?.stop();
    this.stopPings();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const wake of [...this.sleepers]) wake();
    const room = this.room;
    this.room = null;
    if (room) void room.leave(true);
    // Leaving matchmaking while searching cancels the search; after "found" it changes nothing [D32].
    const search = this.searchRoom;
    this.searchRoom = null;
    if (search) void search.leave(true);
    if (error !== null) this.log(`${outcome}: ${error}`);
    const summary = this.summary();
    this.emit({ kind: 'finished', summary });
    this.resolveDone(summary);
  }

  // -- helpers --------------------------------------------------------------------------------------------

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.safely(fn);
    }, ms);
    this.timers.add(timer);
  }

  /** Waits `ms`, or less if the client finishes meanwhile. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.timers.delete(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.timers.add(timer);
      this.sleepers.add(wake);
    });
  }

  private emit(update: FakeClientUpdate): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(update);
      } catch (error) {
        this.log(`listener error: ${message(error)}`);
      }
    }
  }

  /** An async step whose failure ends this client with 'error'. */
  private run(task: Promise<void>): void {
    task.catch((error: unknown) => this.finish('error', message(error)));
  }

  /** A handler's bug ends this client with 'error' instead of an unhandled exception. */
  private safely(step: () => void): void {
    try {
      step();
    } catch (error) {
      this.finish('error', message(error));
    }
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }
}
