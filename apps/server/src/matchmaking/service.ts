import { type GameType, ratingKey, type RatingOption, type Scheduler } from '@sudoku-fight/engine';
import {
  type AvatarId,
  COUNTDOWN_MS,
  type CountryCode,
  type GameRoomRuleOverrides,
  KEEP_SEARCHING_WINDOW_MS,
  MATCH_TIMEOUT_MS,
  type MatchCancelReason,
  type MatchmakingError,
  type MatchmakingServerMessage,
  type MatchPlayer,
  type MatchSeatReservation,
  type NO_AVATAR_ID,
  OPEN_QUEUE_PLAYER_COUNTS,
  parseDeclaredInterferenceKinds,
  parseQueueKey,
  type QueueKey,
  queueKey,
  type QueuePlayerCount,
  type QueueSpec,
  READY_TIMEOUT_MS,
  roomInterferenceKinds,
} from '@sudoku-fight/protocol';

import type { Identity } from '../auth';
import type { GameRoomLog } from '../rooms/GameRoom';
import {
  DEFAULT_MATCHER,
  type MatcherConfig,
  MatchQueue,
  type NewTicket,
  type OpponentRecord,
  rangeOf,
  type Ticket,
} from './matcher';
import type { RankedMatchLink, RankedMatchSetup, RankedRoomHooks, RankedRooms } from './ranked';

/**
 * Matchmaking on the server (stage 9, spec §10): the queues, the matcher's rounds, the "found" and the ready
 * check, for every matchmaking connection of the process. The Colyseus room (room.ts) only connects players
 * to it; the database (store.ts) and the game rooms (games.ts) come in as interfaces, and so do the clock
 * and the timers, so tests drive all of it with a manual clock.
 *
 * - A player joins a queue (registered accounts only: their rating in the queue's rating key, their opponent
 *   history of the game type and their blocks, both ways, are loaded once). One search per account at a
 *   time.
 * - Every `tickMs` the matcher runs on each queue (matcher.ts has the rules). A `searching` goes out when a
 *   player's range widens or their next range changes (matcher.ts rule 7: someone they could meet joined
 *   the queue or left it; null tells the app nobody else is searching), so whoever waits learns it within
 *   a round.
 * - A group found: matchmaking opens the ranked game room (its onCreate claims the match: RankedRooms) and
 *   reserves a seat for each player, then sends each one `found` with their seat reservation. The game
 *   allows only the interference kinds every player's app declared on joining [D47] (none declared: the
 *   legacy three), so an older app never gets a kind it can't show.
 * - The ready check (D37: ready = connected to the game room): when everyone is in, the countdown runs and
 *   the game starts at its end (`countdown`, `started`; the game room records the opponents met). If
 *   someone is still missing READY_TIMEOUT_MS after "found", the match is cancelled: the room closes, the
 *   players who were there go back to the head of the queue (original order of service, and the time in the
 *   ready check does not count as searching), and the missing players are dropped.
 *
 * A no-show before the game starts is not rated: there is no game yet (D37: the game starts only when
 * everyone is connected), and the others are requeued, not given a win (spec §10). Once the countdown runs
 * the seats are fixed, and leaving is abandonment through the game room's grace period: a loss by place
 * [D32], rated with the leave guards of spec §11.2 (no rating lost by a leaver who had not moved or was not
 * behind).
 *
 * One ranked game at a time: from GO until its room reports the game over (and its result stored) or closes,
 * a player's search is refused (`alreadyQueued`). A player who left their game is in it until the grace runs
 * out (they may go back to it meanwhile), and their next search starts from their stored rating.
 */

export interface StoredPlayer {
  name: string;
  avatarId: AvatarId | typeof NO_AVATAR_ID;
  country: CountryCode | null;
  /** In the queue's rating key (the starting rating when the key has no row yet). */
  rating: number;
  games: number;
  provisional: boolean;
}

/** What matchmaking reads and writes in the database (store.ts has Postgres's). */
export interface MatchmakingStore {
  /** The live account's public profile and its rating in `ratingKey`; undefined when there is none. */
  player(userId: string, ratingKey: string): Promise<StoredPlayer | undefined>;
  /**
   * The player's opponent_history rows of this game type. (They are written when a rated game starts:
   * persistence/records.ts.)
   */
  opponents(userId: string, gameType: GameType): Promise<OpponentRecord[]>;
  /** Everyone the player blocked or was blocked by (spec §3.5): never matched with them. */
  blocked(userId: string): Promise<string[]>;
}

export interface OpenMatch {
  id: string;
  /** In seat order. */
  players: Identity[];
}

export interface OpenedMatch {
  roomId: string;
  /** By user id. */
  reservations: ReadonlyMap<string, MatchSeatReservation>;
}

/** Opens the ranked game room of a match and reserves its seats (games.ts: Colyseus's matchMaker). */
export interface MatchGames {
  open(match: OpenMatch): Promise<OpenedMatch>;
}

/** One matchmaking connection. */
export interface MatchSession {
  readonly id: string;
  send(message: MatchmakingServerMessage): void;
  /** Closes the connection (the room's onLeave follows). */
  close(): void;
}

/** A refused join: the room turns it into "<error>: <message>". */
export class MatchmakingRefusal extends Error {
  constructor(
    readonly error: MatchmakingError,
    message: string,
  ) {
    super(message);
    this.name = 'MatchmakingRefusal';
  }
}

export interface MatchmakingConfig {
  matcher: MatcherConfig;
  /** How often the matcher runs (spec: about every 500 ms). */
  tickMs: number;
  /** After "found", everyone must connect to the game room within this (D37: 10 s). */
  readyTimeoutMs: number;
  /** 3… 2… 1… GO. */
  countdownMs: number;
  /** "Keep searching" searches this much longer. */
  extendedTimeoutMs: number;
  /** After a timeout, how long the connection waits for "keep searching". */
  keepSearchingWindowMs: number;
  /** The queues open (2, 3 and 4 players since stage 10; a server may close some: queueClosed). */
  openPlayerCounts: readonly QueuePlayerCount[];
  /**
   * Rule overrides for the match rooms' games, e.g. a short grace: tests and development only (the server's
   * settings never set it, so production plays the default rules).
   */
  gameRules: GameRoomRuleOverrides;
}

export const DEFAULT_MATCHMAKING: MatchmakingConfig = {
  matcher: DEFAULT_MATCHER,
  tickMs: 500,
  readyTimeoutMs: READY_TIMEOUT_MS,
  countdownMs: COUNTDOWN_MS,
  extendedTimeoutMs: MATCH_TIMEOUT_MS,
  keepSearchingWindowMs: KEEP_SEARCHING_WINDOW_MS,
  openPlayerCounts: OPEN_QUEUE_PLAYER_COUNTS,
  gameRules: {},
};

export interface MatchmakingDeps {
  store: MatchmakingStore;
  games: MatchGames;
  /** RATING_OPTION [D7]: which rating key a queue matches on. */
  ratingOption: RatingOption;
  now: () => number;
  scheduler: Scheduler;
  /** Match ids: unguessable (they let a room claim its match). */
  newId: () => string;
  log: GameRoomLog;
  config: MatchmakingConfig;
}

type EntryPhase = 'joining' | 'searching' | 'matched' | 'timedOut';

/** One account in matchmaking, from its join until it leaves or its game starts. */
interface Entry {
  userId: string;
  identity: Identity;
  /** Null once the connection is gone while its match is pending. */
  session: MatchSession | null;
  queueKey: QueueKey;
  spec: QueueSpec;
  player: StoredPlayer | null;
  phase: EntryPhase;
  /** The ticket while searching; the last one after a timeout (for "keep searching"). */
  ticket: Ticket | null;
  /** The range in the last `searching` sent. */
  lastRange: number | null;
  /** The next range in the last `searching` sent (undefined before the first). */
  lastNextRange: number | null | undefined;
  /** The keep-searching window after a timeout. */
  timer: unknown;
  /**
   * The interference kinds the player's app declared on joining [D47]; undefined: none (app 1.0.0, or a
   * malformed list), which counts as LEGACY_INTERFERENCE_KINDS.
   */
  interferenceKinds: readonly string[] | undefined;
}

type MatchState = 'opening' | 'waiting' | 'countdown' | 'started' | 'cancelled';

interface Match {
  id: string;
  queueKey: QueueKey;
  spec: QueueSpec;
  ratingKey: string;
  /** In seat order, with the tickets they were matched with. */
  members: Entry[];
  tickets: Ticket[];
  rematch: boolean;
  matchedAt: number;
  state: MatchState;
  roomId: string | null;
  readyBy: number;
  ready: Set<string>;
  timer: unknown;
  hooks: RankedRoomHooks | null;
}

export class MatchmakingService implements RankedRooms {
  private readonly entries = new Map<string, Entry>();
  private readonly bySession = new Map<string, Entry>();
  private readonly queues = new Map<QueueKey, MatchQueue>();
  private readonly matches = new Map<string, Match>();
  /** Players whose ranked game runs (from GO until it is over or its room closes): user id → match id. */
  private readonly playing = new Map<string, string>();
  private tickTimer: unknown = null;
  private closed = false;

  constructor(private readonly deps: MatchmakingDeps) {}

  now(): number {
    return this.deps.now();
  }

  // -- the connection's side -----------------------------------------------------------------------------

  /**
   * Puts the player in a queue, or refuses (MatchmakingRefusal). Resolves once the first `searching` is
   * sent (or the connection left meanwhile). `rawInterferenceKinds`: the join option of the same name, the
   * kinds the app can show [D47]; anything but a list of at most 16 strings of at most 32 characters counts
   * as no declaration (the legacy kinds), never as a refusal.
   */
  async enqueue(
    session: MatchSession,
    identity: Identity,
    rawQueueKey: unknown,
    rawInterferenceKinds?: unknown,
  ): Promise<void> {
    const spec = parseQueueKey(rawQueueKey);
    if (spec === null)
      throw new MatchmakingRefusal('badQueue', 'queueKey: one of fast-2p … hard-4p (spec §10)');
    if (!this.deps.config.openPlayerCounts.includes(spec.players))
      throw new MatchmakingRefusal('queueClosed', `${spec.players}-player games are not open yet`);
    if (this.closed) throw new MatchmakingRefusal('queueClosed', 'the server is shutting down');
    if (this.entries.has(identity.userId))
      throw new MatchmakingRefusal(
        'alreadyQueued',
        'this account is searching already, or its match has not started yet',
      );
    if (this.playing.has(identity.userId))
      throw new MatchmakingRefusal('alreadyQueued', 'this account is in a ranked game that has not ended');
    const entry: Entry = {
      userId: identity.userId,
      identity,
      session,
      queueKey: queueKey(spec.gameType, spec.players),
      spec,
      player: null,
      phase: 'joining',
      ticket: null,
      lastRange: null,
      lastNextRange: undefined,
      timer: null,
      interferenceKinds: parseDeclaredInterferenceKinds(rawInterferenceKinds),
    };
    this.entries.set(entry.userId, entry);
    this.bySession.set(session.id, entry);
    try {
      const key = ratingKey(spec.gameType, spec.players, this.deps.ratingOption);
      const [player, opponents, blocked] = await Promise.all([
        this.deps.store.player(entry.userId, key),
        this.deps.store.opponents(entry.userId, spec.gameType),
        this.deps.store.blocked(entry.userId),
      ]);
      if (player === undefined)
        throw new MatchmakingRefusal('unauthenticated', 'no account for this player: register first');
      // Left (or cancelled) while loading.
      if (this.entries.get(entry.userId) !== entry || entry.session === null) return;
      entry.player = player;
      this.search(entry, { userId: entry.userId, rating: player.rating, opponents, blocked });
    } catch (error) {
      this.forget(entry);
      throw error;
    }
  }

  /** The player asked to stop searching. Ignored after "found" (D32: no cancelling then). */
  cancel(sessionId: string): void {
    const entry = this.bySession.get(sessionId);
    if (!entry || entry.phase === 'matched') return;
    this.dropFromQueue(entry);
    entry.session?.send({ type: 'cancelled' });
    this.forget(entry);
    entry.session?.close();
  }

  /** After a timeout: search on, with no cap on the range (spec §10). */
  keepSearching(sessionId: string): void {
    const entry = this.bySession.get(sessionId);
    if (!entry || entry.phase !== 'timedOut' || entry.ticket === null) return;
    this.clearEntryTimer(entry);
    const t = entry.ticket;
    const now = this.now();
    this.search(
      entry,
      {
        userId: t.userId,
        rating: t.rating,
        opponents: t.opponents,
        blocked: t.blocked,
        enqueuedAt: t.enqueuedAt,
        searchStart: t.searchStart,
        deadline: now + this.deps.config.extendedTimeoutMs,
        extended: true,
        priority: t.priority,
      },
      false,
      now,
    );
  }

  /** The connection is gone: a search ends; a pending match goes on without it [D32]. */
  left(sessionId: string): void {
    const entry = this.bySession.get(sessionId);
    if (!entry) return;
    this.bySession.delete(sessionId);
    if (entry.phase === 'matched') {
      entry.session = null;
      return;
    }
    this.dropFromQueue(entry);
    entry.session = null;
    this.forget(entry);
  }

  /** Stops the timers (server shutdown). */
  close(): void {
    this.closed = true;
    if (this.tickTimer !== null) this.deps.scheduler.clearTimeout(this.tickTimer);
    this.tickTimer = null;
    for (const entry of this.entries.values()) this.clearEntryTimer(entry);
    for (const match of this.matches.values()) this.clearMatchTimer(match);
    this.playing.clear();
  }

  // -- for tests and diagnostics -------------------------------------------------------------------------

  /** The tickets waiting in a queue, in order of service. */
  queued(key: QueueKey): Ticket[] {
    return this.queues.get(key)?.list() ?? [];
  }

  /** Matches found and not started or cancelled yet. */
  get pendingMatches(): number {
    return this.matches.size;
  }

  /** The player's ranked game runs (from GO until it is over): a search is refused meanwhile. */
  isPlaying(userId: string): boolean {
    return this.playing.has(userId);
  }

  // -- the matcher's rounds ------------------------------------------------------------------------------

  /** One round on every queue. Runs by itself every tickMs while anyone is searching. */
  tick(): void {
    if (this.tickTimer !== null) this.deps.scheduler.clearTimeout(this.tickTimer);
    this.tickTimer = null;
    const now = this.now();
    for (const queue of this.queues.values()) {
      if (queue.size === 0) continue;
      const { groups, timedOut } = queue.tick(now);
      for (const group of groups) this.found(queue, group.tickets, group.rematch, now);
      for (const ticket of timedOut) this.timedOut(queue, ticket, now);
      // The matched and the timed out are out of the queue by now: no `searching` after their `found`.
      for (const ticket of queue.list()) {
        const entry = this.entries.get(ticket.userId);
        if (
          entry &&
          (rangeOf(ticket, now, queue.config) !== entry.lastRange ||
            queue.nextRange(ticket.userId) !== entry.lastNextRange)
        )
          this.sendSearching(entry, false, now);
      }
    }
    this.ensureTicking();
  }

  private ensureTicking(): void {
    if (this.tickTimer !== null || this.closed) return;
    if (![...this.queues.values()].some((q) => q.size > 0)) return;
    this.tickTimer = this.deps.scheduler.setTimeout(() => {
      this.tickTimer = null;
      try {
        this.tick();
      } catch (error) {
        this.deps.log.error('[matchmaking] round failed', error);
        this.ensureTicking();
      }
    }, this.deps.config.tickMs);
  }

  private queueFor(entry: Entry): MatchQueue {
    let queue = this.queues.get(entry.queueKey);
    if (!queue) {
      queue = new MatchQueue(entry.queueKey, entry.spec.players, this.deps.config.matcher);
      this.queues.set(entry.queueKey, queue);
    }
    return queue;
  }

  private search(entry: Entry, ticket: NewTicket, requeued = false, now = this.now()): void {
    // One instant for the ticket and its message: a new search's time starts at 0, its timeout is whole.
    this.requeue(entry, ticket, now);
    this.sendSearching(entry, requeued, now);
    this.ensureTicking();
  }

  /** Into the queue without a word yet (search() sends the `searching`). */
  private requeue(entry: Entry, ticket: NewTicket, now: number): void {
    entry.ticket = this.queueFor(entry).add(ticket, now);
    entry.phase = 'searching';
  }

  /** `now`: the instant the message describes (its serverTime), the same one its range and times are at. */
  private sendSearching(entry: Entry, requeued = false, now = this.now()): void {
    const t = entry.ticket;
    if (t === null || entry.session === null) return;
    const range = rangeOf(t, now, this.deps.config.matcher);
    const nextRange = this.queueFor(entry).nextRange(t.userId);
    entry.lastRange = range;
    entry.lastNextRange = nextRange;
    entry.session.send({
      type: 'searching',
      queueKey: entry.queueKey,
      rating: t.rating,
      elapsedMs: now - t.searchStart,
      range,
      extended: t.extended,
      timeoutAt: t.deadline,
      serverTime: now,
      ...(requeued ? { requeued: true } : {}),
      nextRange,
    });
  }

  private timedOut(queue: MatchQueue, ticket: Ticket, now: number): void {
    const entry = this.entries.get(ticket.userId);
    if (!entry) return;
    entry.phase = 'timedOut';
    entry.ticket = ticket;
    const window = this.deps.config.keepSearchingWindowMs;
    entry.session?.send({
      type: 'timeout',
      queueKey: entry.queueKey,
      elapsedMs: now - ticket.searchStart,
      range: rangeOf(ticket, now, this.deps.config.matcher),
      extended: ticket.extended,
      keepSearchingUntil: now + window,
      nextRange: queue.nextRangeOf(ticket),
    });
    this.deps.log.info(`[matchmaking] ${entry.userId} timed out in ${entry.queueKey}`);
    entry.timer = this.deps.scheduler.setTimeout(() => {
      entry.timer = null;
      if (this.entries.get(entry.userId) !== entry || entry.phase !== 'timedOut') return;
      const session = entry.session;
      this.forget(entry);
      session?.close();
    }, window);
  }

  // -- a match -------------------------------------------------------------------------------------------

  private found(queue: MatchQueue, tickets: Ticket[], rematch: boolean, now: number): void {
    const members = tickets.map((t) => this.entries.get(t.userId)!);
    const spec = members[0]!.spec;
    const match: Match = {
      id: this.deps.newId(),
      queueKey: queue.key,
      spec,
      ratingKey: ratingKey(spec.gameType, spec.players, this.deps.ratingOption),
      members,
      tickets,
      rematch,
      matchedAt: now,
      state: 'opening',
      roomId: null,
      readyBy: 0,
      ready: new Set(),
      timer: null,
      hooks: null,
    };
    for (const m of members) m.phase = 'matched';
    this.matches.set(match.id, match);
    const who = tickets.map(
      (t) => `${t.userId} (${t.rating}, ${((now - t.searchStart) / 1000).toFixed(1)} s)`,
    );
    this.deps.log.info(`[matchmaking] ${queue.key} match ${match.id}: ${who.join(' vs ')}`);
    this.open(match).catch((error: unknown) => {
      this.deps.log.error(`[matchmaking] match ${match.id} failed to open`, error);
      this.fail(match, 'error', []);
    });
  }

  private async open(match: Match): Promise<void> {
    let opened: OpenedMatch;
    try {
      opened = await this.deps.games.open({ id: match.id, players: match.members.map((m) => m.identity) });
    } catch (error) {
      this.deps.log.error(`[matchmaking] match ${match.id}: the game room did not open`, error);
      this.fail(match, 'error', []);
      return;
    }
    if (match.state !== 'opening') return;
    // Gone before they could be told: they can't come, and the others need not wait for them.
    const gone = match.members.filter((m) => m.session === null).map((m) => m.userId);
    if (gone.length > 0) return this.fail(match, 'noShow', gone);
    if (match.members.some((m) => !opened.reservations.has(m.userId))) {
      this.deps.log.error(`[matchmaking] match ${match.id}: a seat reservation is missing`);
      return this.fail(match, 'error', []);
    }

    const now = this.now();
    const { readyTimeoutMs } = this.deps.config;
    match.state = 'waiting';
    match.roomId = opened.roomId;
    match.readyBy = now + readyTimeoutMs;
    match.timer = this.deps.scheduler.setTimeout(() => this.readyCheck(match), readyTimeoutMs);
    const players = match.members.map((m, i) => this.profile(m, match.tickets[i]!));
    for (const m of match.members)
      m.session!.send({
        type: 'found',
        matchId: match.id,
        queueKey: match.queueKey,
        playerId: m.userId,
        players,
        rematch: match.rematch,
        reservation: opened.reservations.get(m.userId)!,
        readyBy: match.readyBy,
        serverTime: now,
      });
  }

  private profile(entry: Entry, ticket: Ticket): MatchPlayer {
    const p = entry.player!;
    return {
      id: entry.userId,
      name: entry.identity.name,
      avatarId: p.avatarId,
      country: p.country,
      rating: ticket.rating,
      provisional: p.provisional,
    };
  }

  /** READY_TIMEOUT_MS after "found": everyone in, or the match is off. */
  private readyCheck(match: Match): void {
    match.timer = null;
    if (match.state !== 'waiting') return;
    const missing = match.members.filter((m) => !match.ready.has(m.userId)).map((m) => m.userId);
    if (missing.length === 0) return this.startCountdown(match);
    this.fail(match, 'noShow', missing);
  }

  private sendReady(match: Match): void {
    const ready = match.members.filter((m) => match.ready.has(m.userId)).map((m) => m.userId);
    for (const m of match.members) m.session?.send({ type: 'ready', matchId: match.id, ready });
  }

  private startCountdown(match: Match): void {
    this.clearMatchTimer(match);
    match.state = 'countdown';
    const now = this.now();
    const startsAt = now + this.deps.config.countdownMs;
    this.callHook(match, (h) => h.onCountdown(startsAt));
    for (const m of match.members)
      m.session?.send({ type: 'countdown', matchId: match.id, startsAt, serverTime: now });
    match.timer = this.deps.scheduler.setTimeout(() => this.go(match), this.deps.config.countdownMs);
  }

  private go(match: Match): void {
    match.timer = null;
    if (match.state !== 'countdown') return;
    match.state = 'started';
    this.matches.delete(match.id);
    for (const m of match.members) this.playing.set(m.userId, match.id);
    this.callHook(match, (h) => h.onGo());
    for (const m of match.members) {
      const session = m.session;
      session?.send({ type: 'started', matchId: match.id, roomId: match.roomId! });
      this.forget(m);
      session?.close();
    }
    this.deps.log.info(`[matchmaking] match ${match.id} started in room ${match.roomId}`);
  }

  /**
   * The match is off before GO: the missing players are dropped, the others go back to the head of the
   * queue (spec §10) with their order of service, and the time since the match does not count as searching.
   */
  private fail(match: Match, reason: MatchCancelReason, missing: string[]): void {
    if (match.state === 'started' || match.state === 'cancelled') return;
    this.clearMatchTimer(match);
    match.state = 'cancelled';
    this.matches.delete(match.id);
    const now = this.now();
    const pausedMs = now - match.matchedAt;
    this.deps.log.info(
      `[matchmaking] match ${match.id} cancelled (${reason}${missing.length ? `: ${missing.join(', ')}` : ''})`,
    );
    // Everyone requeued is back in the queue before anyone is told: their next ranges count each other.
    const requeued: Entry[] = [];
    match.members.forEach((m, i) => {
      const t = match.tickets[i]!;
      const session = m.session;
      const requeue = session !== null && !missing.includes(m.userId) && !this.closed;
      session?.send({ type: 'matchCancelled', matchId: match.id, reason, missing, requeued: requeue });
      if (!requeue) {
        this.forget(m);
        session?.close();
        return;
      }
      this.requeue(
        m,
        {
          userId: t.userId,
          rating: t.rating,
          opponents: t.opponents,
          blocked: t.blocked,
          enqueuedAt: t.enqueuedAt,
          searchStart: t.searchStart + pausedMs,
          deadline: t.deadline + pausedMs,
          extended: t.extended,
          priority: true,
        },
        now,
      );
      requeued.push(m);
    });
    for (const m of requeued) this.sendSearching(m, true, now);
    if (requeued.length > 0) this.ensureTicking();
    this.callHook(match, (h) => h.onCancel());
  }

  // -- the game room's side (RankedRooms) ----------------------------------------------------------------

  claim(matchId: string, hooks: RankedRoomHooks): RankedMatchLink | undefined {
    const match = this.matches.get(matchId);
    if (!match || match.hooks !== null || match.state !== 'opening') return undefined;
    match.hooks = hooks;
    const setup: RankedMatchSetup = {
      matchId: match.id,
      queueKey: match.queueKey,
      gameType: match.spec.gameType,
      playerCount: match.spec.players,
      ratingKey: match.ratingKey,
      players: match.members.map((m, i) => ({
        userId: m.userId,
        name: m.identity.name,
        rating: match.tickets[i]!.rating,
        games: m.player?.games ?? 0,
      })),
      readyTimeoutMs: this.deps.config.readyTimeoutMs,
      countdownMs: this.deps.config.countdownMs,
      rules: this.matchRules(match),
    };
    const isMember = (userId: string) => match.members.some((m) => m.userId === userId);
    return {
      setup,
      has: isMember,
      join: (userId) => {
        if (!isMember(userId) || (match.state !== 'waiting' && match.state !== 'opening')) return;
        match.ready.add(userId);
        this.sendReady(match);
        if (match.state === 'waiting' && match.ready.size === match.members.length)
          this.startCountdown(match);
      },
      leave: (userId) => {
        if (match.state !== 'waiting' && match.state !== 'opening') return;
        if (match.ready.delete(userId)) this.sendReady(match);
      },
      over: () => this.gameEnded(match),
      closed: () => {
        if (match.state === 'started') return this.gameEnded(match);
        if (match.state === 'cancelled') return;
        // Gone before anyone could come (the room failed to open): nobody's fault.
        if (match.state === 'opening') return this.fail(match, 'error', []);
        const missing = match.members.filter((m) => !match.ready.has(m.userId)).map((m) => m.userId);
        this.fail(match, missing.length > 0 ? 'noShow' : 'error', missing);
      },
    };
  }

  /**
   * The rules of a match's game: the configured overrides, and only the interference kinds every player's
   * app declared [D47] (within the configured kinds, if any), so no app gets a kind it can't show.
   */
  private matchRules(match: Match): GameRoomRuleOverrides {
    const { gameRules } = this.deps.config;
    return {
      ...gameRules,
      interferenceKinds: roomInterferenceKinds(
        match.members.map((m) => m.interferenceKinds),
        gameRules.interferenceKinds,
      ),
    };
  }

  /** The match's game is over (or its room gone): its players may search again. */
  private gameEnded(match: Match): void {
    for (const m of match.members) if (this.playing.get(m.userId) === match.id) this.playing.delete(m.userId);
  }

  // -- helpers -------------------------------------------------------------------------------------------

  private callHook(match: Match, call: (hooks: RankedRoomHooks) => void): void {
    if (match.hooks === null) return;
    try {
      call(match.hooks);
    } catch (error) {
      this.deps.log.error(`[matchmaking] match ${match.id}: the game room failed`, error);
    }
  }

  private dropFromQueue(entry: Entry): void {
    if (entry.phase === 'searching') this.queues.get(entry.queueKey)?.remove(entry.userId);
    this.clearEntryTimer(entry);
  }

  /** The account is out of matchmaking (it may join again). */
  private forget(entry: Entry): void {
    this.clearEntryTimer(entry);
    if (this.entries.get(entry.userId) === entry) this.entries.delete(entry.userId);
    if (entry.session && this.bySession.get(entry.session.id) === entry)
      this.bySession.delete(entry.session.id);
  }

  private clearEntryTimer(entry: Entry): void {
    if (entry.timer !== null) this.deps.scheduler.clearTimeout(entry.timer);
    entry.timer = null;
  }

  private clearMatchTimer(match: Match): void {
    if (match.timer !== null) this.deps.scheduler.clearTimeout(match.timer);
    match.timer = null;
  }
}
