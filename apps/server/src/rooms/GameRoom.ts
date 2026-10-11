import { randomInt, randomUUID } from 'node:crypto';

import {
  type AuthContext,
  type Client,
  CloseCode,
  ErrorCode,
  matchMaker,
  Room,
  type RoomException,
  type RoomMethodName,
  ServerError,
} from '@colyseus/core';
import {
  defaultRules,
  type GameConfig,
  type GameType,
  type PlayerId,
  type Scheduler,
  toPublicEvent,
} from '@sudoku-fight/engine';
import {
  type GameRoomError,
  type GameRoomRuleOverrides,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { type Identity, IdentityError, type IdentityVerifier, isIdentity } from '../auth';
import type { NodeEnv } from '../config';
import { DEFAULT_ABUSE_LIMIT, DEFAULT_MESSAGE_LIMITS, MessageGate, type MessageLimits } from '../game/gate';
import { GameMetrics, LatencyStats } from '../game/metrics';
import { type GameRoomSetup, parseCreateOptions, RoomOptionsError } from '../game/options';
import type { PuzzleSource } from '../game/puzzles';
import { generateRoomCode } from '../game/roomCode';
import { ServerGame, type ServerGameUpdate } from '../game/serverGame';
import type { RateLimitRule } from '../http/rateLimiter';
import {
  type RankedMatchLink,
  rankedMatchIdOf,
  type RankedMatchSetup,
  type RankedRooms,
} from '../matchmaking/ranked';
import { reportError } from '../monitoring/report';
import type { GameRecorder, RankedGames } from '../persistence';

/**
 * The game room (stage 7, spec §16.2, §17, §18, §21). The server is authoritative: it runs the engine
 * (ServerGame) and the clients only send actions. No Colyseus Schema: the room sends the engine's events
 * as messages, and a snapshot (the public state, without the solution) when a client needs the whole game.
 *
 * Life of a room:
 * 1. Lobby. `create('game', { private: true, … })` makes a room whose id is a 6-character code; others join
 *    with joinById(code). Everyone gets a `lobby` message on every join and leave. A drop or a leave in the
 *    lobby frees the seat.
 * 2. Playing. When the last seat is taken the game is created and started at once (D37: ready on connect; a
 *    match room counts down first, see below): each client gets a `snapshot` (the game before the start,
 *    seq 1), then everyone gets the `events` of the start, and from then on every engine update as `events`.
 *    - An action is checked by the MessageGate (shape, rate limit, clientSeq), then applied at the server's
 *      time. A refusal goes to its sender only (`rejected`).
 *    - A drop: the engine's 'disconnect' (graceEndsAt, and a freeze in a two-player game) and Colyseus's
 *      allowReconnection for the same grace. Back in time: a fresh `snapshot` to that client, then the
 *      engine's 'reconnect' (playerReconnected, gameResumed) to everyone. Not back: the engine's grace timer
 *      makes it abandonment (2 players: the other wins [D8]; 3–4: the game goes on).
 *    - Leaving on purpose (a consented leave) is a disconnect too: the grace runs and it ends in abandonment
 *      [D32: leaving after "found" is abandonment]; meanwhile the player may rejoin by code (same identity),
 *      and gets a fresh `snapshot`. Giving up on purpose is the `surrender` message (6.6).
 *    - The room stays while the game runs, even with nobody connected (the game is kept on the server, spec
 *      §16.2); the graces end it.
 * 3. Over. After gameOver everyone gets the `solution` (spec §21: only now), and the room closes after
 *    closeAfterGameMs, or as soon as nobody is in it.
 *
 * Rated rooms (stage 9, `rated: true`): before the game starts (phase 'starting', a database round trip)
 * deps.ranked makes its config: a ranked-pool puzzle none of the players has played, and each player's
 * rating. A player who leaves meanwhile is in the game, disconnected (the grace runs). While it runs, the
 * game is recorded (persistence/GameRecorder: games, game_players, game_events, histories), and at gameOver
 * the result, the ratings and the anomaly flags are written, in the background: the room never waits for
 * the database. A config that can't be made (a player without an account, no ranked puzzles) closes the room.
 *
 * Match rooms (stage 9, matchmaking): created by the server for a match (`{ match: <id> }`, never by a
 * client), rated, open to the match's players only, who come with seat reservations. Matchmaking runs the
 * ready check (D37: connected = ready): when everyone is in, phase 'countdown' (seats fixed, leaving is
 * abandonment [D32]; everyone gets a `countdown` with GO's time, 3… 2… 1…), then GO starts the game as above;
 * a no-show cancels the match and closes the room. A drop in the countdown holds the seat as in the game: the
 * game starts at GO with that player disconnected (the grace runs from then), and the reconnection token
 * brings them back. When the game is over and its result stored, the room tells matchmaking, which refuses
 * the players' searches until then (one ranked game at a time).
 *
 * Abuse: messages over a type's rate limit are dropped; too many malformed or over-the-limit messages and
 * the client is disconnected (for the game, a drop). Measures: every action's handling time goes to
 * GameMetrics (GET /dev/metrics outside production) and to the game's summary line in the log when it ends;
 * an action slower than slowActionMs is logged on its own.
 */

export interface GameRoomLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface GameRoomDeps {
  nodeEnv: NodeEnv;
  identity: IdentityVerifier;
  puzzles: PuzzleSource;
  /** The game clock: epoch ms. */
  now: () => number;
  /** The engine's timers. */
  scheduler: Scheduler;
  metrics: GameMetrics;
  /** How long a finished game's room stays open (clients read the result and the solution). */
  closeAfterGameMs: number;
  /** Per player and per message type (spec §21). */
  limits: MessageLimits;
  /** Malformed or over-the-limit messages allowed in a window before the client is disconnected. */
  abuseLimit: RateLimitRule;
  /** All messages together; above it Colyseus disconnects the client at once. */
  maxMessagesPerSecond: number;
  /** Actions slower than this (ms) are logged. */
  slowActionMs: number;
  /** An integer in [0, n): codes and seeds. */
  random: (n: number) => number;
  log: GameRoomLog;
  /** Rated rooms (stage 9): their config and their record. Without it, a rated room is refused. */
  ranked?: RankedGames;
  /** Matchmaking's matches (stage 9): a room created for one claims it. Without it, no match rooms. */
  matches?: RankedRooms;
}

/** Node's timers, for the engine. */
export const systemScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** The rooms' log (game and matchmaking). Its errors are bugs: they are reported too (src/monitoring). */
export const consoleGameLog: GameRoomLog = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m, e) => {
    console.error(m, e);
    reportError(e ?? m, { area: 'rooms', message: m });
  },
};

/**
 * Colyseus' onUncaughtException, for both rooms (stage 14): a hook, message handler or timer that threw. The
 * room's own error goes to its log (and so to the reports); the wrapper Colyseus made around it carries the
 * client, its options and its identity, which stay here. A refusal (a ServerError: bad options, a full or
 * started game, no identity) is the room saying no, not a bug; Colyseus still answers the client with it.
 */
export function logRoomException(
  log: GameRoomLog,
  where: string,
  exception: RoomException,
  method: RoomMethodName,
): void {
  const cause = exception.cause ?? exception;
  if (cause instanceof ServerError) return;
  log.error(`${where} ${method} failed`, cause);
}

/** Colyseus keeps a dropped seat a little longer than the engine's grace, so a late comer still gets told. */
export const RECONNECT_SLACK_MS = 1000;

export const GAME_ROOM_DEFAULTS = {
  closeAfterGameMs: 60_000,
  limits: DEFAULT_MESSAGE_LIMITS,
  abuseLimit: DEFAULT_ABUSE_LIMIT,
  maxMessagesPerSecond: 40,
  slowActionMs: 50,
} as const;

type Phase = 'lobby' | 'countdown' | 'starting' | 'playing' | 'over';

/**
 * A match room holds its reserved seats this much longer than matchmaking's ready check (a seat is taken by
 * then, or the match is off; an unused reservation keeps a cancelled room alive until it runs out).
 */
export const MATCH_SEAT_SLACK_MS = 1000;

interface Seat {
  playerId: PlayerId;
  name: string;
  /** The connection holding the seat; null while nobody does (left, or dropped for good). */
  sessionId: string | null;
  /** Dropped before the game (a match's countdown, a rated game being set up), the seat held to come back. */
  away?: boolean;
}

/**
 * A seat dropped before its game is held until the game's grace would run out: the time to GO, the grace,
 * and this much for the rated game's set-up (a database round trip) and the late comer.
 */
export const BEFORE_GAME_SLACK_MS = 5000;

/** A refusal the client can act on: the message starts with a GameRoomError (protocol). */
const refuse = (code: number, error: GameRoomError, text: string) =>
  new ServerError(code, `${error}: ${text}`);

/**
 * The room class to register, bound to its dependencies: `defineRoom(createGameRoom(deps))`. Identity is
 * checked in the static onAuth, during matchmaking, before a seat is reserved (or a room created).
 */
export function createGameRoom(deps: GameRoomDeps) {
  return class BoundGameRoom extends GameRoom {
    protected override readonly deps = deps;

    static override async onAuth(token: string | undefined, options: unknown, context: AuthContext) {
      try {
        return await deps.identity.verify({ token: token || undefined, options, ip: context.ip });
      } catch (error) {
        if (error instanceof IdentityError)
          throw refuse(ErrorCode.AUTH_FAILED, 'unauthenticated', error.message);
        // Not a refusal: the check itself failed (the database, Google's keys). Colyseus tells the client.
        reportError(error, { area: 'rooms', message: '[game] onAuth failed' });
        throw error;
      }
    }
  };
}

export abstract class GameRoom extends Room {
  protected abstract readonly deps: GameRoomDeps;

  private phase: Phase = 'lobby';
  private code = '';
  private gameType: GameType = 'fast';
  private playerCount = 2;
  private ruleOverrides: GameRoomRuleOverrides = {};
  private rated = false;
  /** The matchmaking match this room was created for (its players only), or null. */
  private match: RankedMatchLink | null = null;
  /** A match room's GO (this room's clock), once its countdown runs. */
  private goAt: number | null = null;
  private readonly seats: Seat[] = [];
  private game: ServerGame | null = null;
  private recorder: GameRecorder | null = null;
  private gate: MessageGate | null = null;
  private closeTimer: unknown = null;
  /** onCreate finished (a refused create is disposed too, and must not count as a room closed). */
  private opened = false;
  /** Connections disconnected for abuse: their last messages may still be in the pipe, and count for nothing. */
  private readonly kicked = new Set<string>();
  /** This room's action handling times, for the summary when the game ends. */
  private readonly actionTimes = new LatencyStats(2048);

  /** The game, once every seat is taken (diagnostics and tests; stage 9 stores its events). */
  get currentGame(): ServerGame | null {
    return this.game;
  }

  /** The matchmaking match this room plays, or null (diagnostics and tests). */
  get matchSetup(): RankedMatchSetup | null {
    return this.match?.setup ?? null;
  }

  // -- lifecycle -----------------------------------------------------------------------------------------

  override async onCreate(options: unknown): Promise<void> {
    let setup;
    try {
      const matchId = rankedMatchIdOf(options);
      setup = matchId === null ? parseCreateOptions(options, this.deps.nodeEnv) : this.claimMatch(matchId);
    } catch (error) {
      if (error instanceof RoomOptionsError)
        throw refuse(ErrorCode.MATCHMAKE_INVALID_CRITERIA, 'badOptions', error.message);
      throw error;
    }
    if (setup.code !== null && (await matchMaker.getRoomById(setup.code)))
      throw refuse(
        ErrorCode.MATCHMAKE_INVALID_CRITERIA,
        'codeTaken',
        `a room already has the code ${setup.code}`,
      );
    this.code = setup.code ?? (await this.freeCode());
    this.roomId = this.code;
    this.gameType = setup.gameType;
    this.playerCount = setup.playerCount;
    this.ruleOverrides = setup.rules;
    this.rated = setup.rated;
    if (this.rated && this.deps.ranked === undefined)
      throw refuse(ErrorCode.MATCHMAKE_INVALID_CRITERIA, 'badOptions', 'rated rooms need the database');
    this.maxClients = setup.playerCount;
    if (this.match)
      this.seatReservationTimeout = (this.match.setup.readyTimeoutMs + MATCH_SEAT_SLACK_MS) / 1000;
    this.maxMessagesPerSecond = this.deps.maxMessagesPerSecond;
    this.gate = new MessageGate({
      now: this.deps.now,
      limits: this.deps.limits,
      abuseLimit: this.deps.abuseLimit,
    });
    // Never offered by join/joinOrCreate: only its code gets you in.
    await this.setPrivate(true);
    this.onMessage('*', (client: Client, type: string | number, message: unknown) =>
      this.onClientMessage(client, type, message),
    );
    this.opened = true;
    this.deps.metrics.roomOpened();
  }

  override onJoin(client: Client): void {
    const identity: unknown = client.auth;
    if (!isIdentity(identity)) throw refuse(ErrorCode.AUTH_FAILED, 'unauthenticated', 'no identity');
    if (this.phase === 'lobby') return this.joinLobby(client, identity);

    // The game is on (or over): only its own players come back, after leaving on purpose.
    const seat = this.seatOfPlayer(identity.userId);
    if (!seat) throw refuse(ErrorCode.APPLICATION_ERROR, 'gameStarted', 'the game in this room has started');
    if (seat.sessionId !== null)
      throw refuse(ErrorCode.APPLICATION_ERROR, 'alreadyInRoom', `${seat.playerId} is connected already`);
    seat.sessionId = client.sessionId;
    this.gate!.newSession(seat.playerId);
    this.deps.log.info(`[game ${this.code}] ${seat.playerId} rejoined`);
    this.welcomeBack(client, seat);
  }

  /** Dropped without saying goodbye: hold the seat for the grace period (spec §16.2). */
  override onDrop(client: Client): void {
    const seat = this.seatOfSession(client.sessionId);
    if (!seat) return;
    if (this.phase === 'lobby') return this.leaveLobby(seat);
    if (this.phase === 'over') {
      seat.sessionId = null;
      return;
    }
    if (!this.game) return this.holdSeatBeforeGame(client, seat);
    const result = this.game.disconnect(seat.playerId);
    if (result.rejected) {
      // Out of the game already (surrendered, abandoned): nothing to hold.
      seat.sessionId = null;
      return;
    }
    const graceEndsAt =
      this.game.state.players.find((p) => p.id === seat.playerId)?.graceEndsAt ?? this.deps.now();
    const seconds = (Math.max(0, graceEndsAt - this.deps.now()) + RECONNECT_SLACK_MS) / 1000;
    this.deps.log.info(`[game ${this.code}] ${seat.playerId} dropped; ${seconds.toFixed(1)} s to come back`);
    // A client that never finished joining can't reconnect; it may still rejoin by code.
    this.allowReconnection(client, seconds).catch(() => undefined);
  }

  /** Back within the grace period with the reconnection token (same session). */
  override onReconnect(client: Client): void {
    this.kicked.delete(client.sessionId);
    const seat = this.seatOfSession(client.sessionId);
    if (!seat) return;
    seat.away = false;
    this.deps.log.info(`[game ${this.code}] ${seat.playerId} reconnected`);
    this.welcomeBack(client, seat);
  }

  /**
   * Left: on purpose (consented), after a drop with no reconnection, or a reconnection that failed half way
   * (Colyseus calls onLeave, not onDrop, for a socket that dies while it reconnects).
   */
  override onLeave(client: Client, code?: number): void {
    this.kicked.delete(client.sessionId);
    const seat = this.seatOfSession(client.sessionId);
    if (!seat) return;
    if (this.phase === 'lobby') return this.leaveLobby(seat);
    seat.sessionId = null;
    seat.away = false;
    if (this.phase !== 'playing' || !this.game) return;
    // A seat with no connection is disconnected in the engine, whatever the way out: leaving after "found" is
    // abandonment [D32], so the grace runs and the player may rejoin by code meanwhile; and a reconnection
    // that the engine took but whose socket then died must not leave a player "connected" who isn't (the game
    // would neither freeze nor end). After an ordinary drop the engine has it already (refused, no change).
    const result = this.game.disconnect(seat.playerId);
    if (!result.rejected) {
      const how = code === CloseCode.CONSENTED ? 'left' : 'is gone';
      this.deps.log.info(`[game ${this.code}] ${seat.playerId} ${how}; grace runs`);
    }
  }

  /** A hook, a message handler or a timer threw (stage 14): logged and reported, refusals aside. */
  override onUncaughtException(exception: RoomException, method: RoomMethodName): void {
    logRoomException(this.deps.log, `[game ${this.code || '?'}]`, exception, method);
  }

  override onDispose(): void {
    // A match that never got to its countdown is off (matchmaking requeues whoever was here).
    this.match?.closed();
    this.game?.close();
    // A game that is over still gets its end written; one cut short keeps what it has.
    this.recorder?.close();
    if (this.closeTimer !== null) this.deps.scheduler.clearTimeout(this.closeTimer);
    this.closeTimer = null;
    if (this.opened) this.deps.metrics.roomClosed();
    this.opened = false;
  }

  /**
   * Dropped in a match's countdown, or while a rated game is being set up: the seat is the player's from the
   * countdown on [D32], and the game starts at GO without them (disconnected: their grace runs from the
   * start, like a drop in the game). Colyseus holds the connection until that grace would run out, so the
   * app comes back with its reconnection token as it would in the game (a rejoin by code works too).
   */
  private holdSeatBeforeGame(client: Client, seat: Seat): void {
    seat.away = true;
    const now = this.deps.now();
    const graceMs = defaultRules('ranked', this.gameType, this.ruleOverrides).graceMs;
    const toGoMs = Math.max(0, (this.goAt ?? now) - now);
    const seconds = (toGoMs + graceMs + BEFORE_GAME_SLACK_MS + RECONNECT_SLACK_MS) / 1000;
    this.deps.log.info(
      `[game ${this.code}] ${seat.playerId} dropped before the game; ${seconds.toFixed(1)} s to come back`,
    );
    this.allowReconnection(client, seconds).catch(() => undefined);
  }

  // -- lobby ---------------------------------------------------------------------------------------------

  private joinLobby(client: Client, identity: Identity): void {
    if (this.match && !this.match.has(identity.userId))
      throw refuse(ErrorCode.APPLICATION_ERROR, 'gameStarted', 'this ranked game is for its matched players');
    if (this.seatOfPlayer(identity.userId))
      throw refuse(
        ErrorCode.APPLICATION_ERROR,
        'alreadyInRoom',
        `${identity.userId} is in this room already`,
      );
    this.seats.push({ playerId: identity.userId, name: identity.name, sessionId: client.sessionId });
    this.gate!.newSession(identity.userId);
    this.sendLobby();
    // A match room starts when matchmaking says GO (everyone in, then the countdown: onMatchGo).
    if (this.match) this.match.join(identity.userId);
    else if (this.seats.length === this.playerCount) this.startGame();
  }

  private leaveLobby(seat: Seat): void {
    this.seats.splice(this.seats.indexOf(seat), 1);
    this.sendLobby();
    this.match?.leave(seat.playerId);
  }

  // -- a matchmaking match (stage 9, spec §10, D37) ------------------------------------------------------

  /**
   * The setup of a room matchmaking creates for a match (matchmaking/ranked.ts): its game type and players,
   * rated. Throws RoomOptionsError for an unknown match (or one already claimed: the id is single use).
   */
  private claimMatch(matchId: string): GameRoomSetup {
    const link = this.deps.matches?.claim(matchId, {
      onCountdown: () => this.onMatchCountdown(),
      onGo: () => this.onMatchGo(),
      onCancel: () => this.onMatchCancel(),
    });
    if (!link) throw new RoomOptionsError(`no match ${matchId} waiting for a room`);
    this.match = link;
    const { gameType, playerCount, rules } = link.setup;
    return { code: null, gameType, playerCount, rules, rated: true };
  }

  /**
   * Everyone is in: the seats are fixed from now on (leaving is abandonment [D32]), and GO follows. Everyone
   * here gets the `countdown` (protocol GameRoomCountdown), timed by this room's clock, the one its pongs
   * report; a player who comes back during it gets it again (welcomeBack).
   */
  private onMatchCountdown(): void {
    if (this.phase !== 'lobby' || !this.match) return;
    this.phase = 'countdown';
    this.autoDispose = false;
    this.goAt = this.deps.now() + this.match.setup.countdownMs;
    for (const client of this.clients) if (this.seatOfSession(client.sessionId)) this.sendCountdown(client);
  }

  private sendCountdown(client: Client): void {
    if (this.goAt === null) return;
    this.sendTo(client, { type: 'countdown', startsAt: this.goAt, serverTime: this.deps.now() });
  }

  /** GO: the game starts, its seats in the match's order. */
  private onMatchGo(): void {
    if (this.phase !== 'countdown' || !this.match) return;
    const order = this.match.setup.players.map((p) => p.userId);
    this.seats.sort((a, b) => order.indexOf(a.playerId) - order.indexOf(b.playerId));
    this.startGame();
  }

  /**
   * The match fell through before its countdown: everyone out (matchmaking tells them why), and nobody in
   * (a late seat reservation finds a room with no game for it).
   */
  private onMatchCancel(): void {
    this.phase = 'over';
    if (!this.opened) return; // onCreate failed: Colyseus disposes the room itself
    this.disconnect(CloseCode.CONSENTED).catch((error: unknown) =>
      this.deps.log.error(`[game ${this.code}] close`, error),
    );
  }

  private sendLobby(): void {
    const players = this.seats.map((s) => ({ id: s.playerId, name: s.name }));
    for (const client of this.clients) {
      const seat = this.seatOfSession(client.sessionId);
      if (!seat) continue;
      this.sendTo(client, {
        type: 'lobby',
        code: this.code,
        gameType: this.gameType,
        playerCount: this.playerCount,
        players,
        playerId: seat.playerId,
      });
    }
  }

  // -- the game ------------------------------------------------------------------------------------------

  private startGame(): void {
    const id = randomUUID();
    const seed = this.deps.random(2 ** 31);
    const ranked = this.deps.ranked;
    if (!this.rated || ranked === undefined) {
      return this.launch({
        id,
        mode: 'ranked',
        gameType: this.gameType,
        puzzle: this.deps.puzzles.pick(this.gameType),
        players: this.seats.map((s) => ({ id: s.playerId, name: s.name })),
        rules: defaultRules('ranked', this.gameType, this.ruleOverrides),
        seed,
      });
    }
    // A rated game's config needs the database (puzzle, ratings). The room stays even if everyone leaves
    // meanwhile: they are in the game from here on [D32].
    this.phase = 'starting';
    this.autoDispose = false;
    const players = this.seats.map((s) => ({ id: s.playerId, name: s.name }));
    ranked
      .createConfig({ id, gameType: this.gameType, players, rules: this.ruleOverrides, seed })
      .then((config) => {
        // The room may be gone meanwhile (the server shutting down): no game for nobody.
        if (this.opened) this.launch(config);
      })
      .catch((error: unknown) => {
        this.deps.log.error(`[game ${this.code}] the ranked game could not start`, error);
        this.disconnect().catch((e: unknown) => this.deps.log.error(`[game ${this.code}] close`, e));
      });
  }

  private launch(config: GameConfig): void {
    this.recorder = this.rated ? (this.deps.ranked?.record(config) ?? null) : null;
    this.game = new ServerGame({
      config,
      clock: { now: this.deps.now },
      scheduler: this.deps.scheduler,
      onUpdate: (update) => {
        this.recorder?.push(update);
        this.onGameUpdate(update);
      },
      onError: (error) => this.deps.log.error(`[game ${this.code}] error`, error),
    });
    this.recorder?.push({ events: this.game.events, state: this.game.state });
    this.phase = 'playing';
    // The game is kept on the server while it runs (spec §16.2), even with nobody connected: players who left
    // on purpose are in their grace and may rejoin by code. It ends at the latest when the last grace runs out;
    // then the room closes (onGameUpdate).
    this.autoDispose = false;
    // Everyone gets the game as created (status 'waiting'), then the start as events.
    for (const client of this.clients) {
      const seat = this.seatOfSession(client.sessionId);
      if (seat) this.sendSnapshot(client, seat.playerId);
    }
    this.game.start();
    // Whoever left or dropped before the game (the countdown, a rated game being set up) is in it,
    // disconnected: their grace starts now. A dropped seat may still come back with its reconnection token.
    for (const seat of this.seats)
      if (seat.sessionId === null || seat.away) this.game.disconnect(seat.playerId);
    this.deps.metrics.gameStarted();
    const who = this.seats.map((s) => s.playerId).join(', ');
    const rated = this.rated ? ' (rated)' : '';
    this.deps.log.info(
      `[game ${this.code}] started${rated}: ${this.gameType}, ${who}, puzzle ${config.puzzle.id}`,
    );
  }

  private onGameUpdate({ events, state }: ServerGameUpdate): void {
    this.broadcastMessage({ type: 'events', events: events.map(toPublicEvent) });
    if (state.status !== 'over' || this.phase === 'over') return;
    this.phase = 'over';
    // A match's players may search again once the result is stored, so the next search has the new rating.
    const match = this.match;
    if (match) void (this.recorder?.done ?? Promise.resolve()).then(() => match.over());
    // Only now (spec §21): for the replay.
    this.broadcastMessage({ type: 'solution', solution: state.config.puzzle.solution });
    // Nobody left to read the result: close now rather than after closeAfterGameMs.
    this.autoDispose = true;
    this.deps.metrics.gameOver();
    const t = this.actionTimes.summary();
    const ranking = (state.result?.ranking ?? [])
      .map((r) => `${r.place}. ${r.playerId} ${r.score}`)
      .join(', ');
    this.deps.log.info(
      `[game ${this.code}] over (${state.result?.reason}): ${ranking}; ` +
        `${t.count} actions, p50 ${t.p50Ms} ms, p95 ${t.p95Ms} ms, max ${t.maxMs} ms`,
    );
    this.closeTimer = this.deps.scheduler.setTimeout(() => {
      this.closeTimer = null;
      this.disconnect().catch((error: unknown) => this.deps.log.error(`[game ${this.code}] close`, error));
    }, this.deps.closeAfterGameMs);
  }

  /**
   * A fresh snapshot to a player coming back, then the engine's reconnect for everyone. Before the game (a
   * match's countdown, or a rated game being set up) there is nothing to send but the countdown: the
   * snapshot goes to everyone in the room when the game starts.
   */
  private welcomeBack(client: Client, seat: Seat): void {
    if (!this.game) {
      if (this.phase === 'countdown') this.sendCountdown(client);
      return;
    }
    this.sendSnapshot(client, seat.playerId);
    if (this.phase === 'over') {
      this.sendTo(client, { type: 'solution', solution: this.game.solution });
      return;
    }
    // Refused when the player was out meanwhile (abandoned): the snapshot shows it. The engine runs what is
    // due first, so a grace that ran out a moment ago ends the game here, and the solution goes to everyone
    // (this client included) from onGameUpdate.
    this.game.reconnect(seat.playerId);
  }

  private sendSnapshot(client: Client, playerId: PlayerId): void {
    this.sendTo(client, {
      type: 'snapshot',
      protocol: PROTOCOL_VERSION,
      state: this.game!.publicState(),
      playerId,
      lastClientSeq: this.gate!.lastClientSeq(playerId),
    });
  }

  // -- messages ------------------------------------------------------------------------------------------

  private onClientMessage(client: Client, type: string | number, payload: unknown): void {
    const started = performance.now();
    const seat = this.seatOfSession(client.sessionId);
    if (!seat || !this.gate || this.kicked.has(client.sessionId)) return;
    try {
      const admission = this.gate.admit(seat.playerId, type, payload);
      switch (admission.kind) {
        case 'ping':
          this.deps.metrics.ping();
          this.sendTo(client, { type: 'pong', t: admission.t, serverTime: this.deps.now() });
          return;

        case 'dropped': {
          this.deps.metrics.drop(admission.reason);
          const malformed = admission.reason === 'malformed' || admission.reason === 'unknownType';
          if (malformed && admission.clientSeq !== null)
            this.sendTo(client, { type: 'rejected', clientSeq: admission.clientSeq, reason: 'badAction' });
          if (admission.kick) {
            this.deps.metrics.kick();
            this.deps.log.warn(`[game ${this.code}] ${seat.playerId} disconnected: too many bad messages`);
            this.kicked.add(client.sessionId);
            client.leave(CloseCode.WITH_ERROR);
          }
          return;
        }

        case 'action': {
          const reason = this.game
            ? this.game.act(seat.playerId, admission.action).rejected
            : ('notStarted' as const);
          if (reason) this.sendTo(client, { type: 'rejected', clientSeq: admission.clientSeq, reason });
          const ms = performance.now() - started;
          this.actionTimes.add(ms);
          this.deps.metrics.action(admission.action.type, ms);
          if (ms > this.deps.slowActionMs)
            this.deps.log.warn(`[game ${this.code}] slow ${admission.action.type}: ${ms.toFixed(1)} ms`);
          return;
        }
      }
    } catch (error) {
      this.deps.log.error(`[game ${this.code}] message ${String(type)} from ${seat.playerId} failed`, error);
    }
  }

  private sendTo(client: Client, message: ServerMessage): void {
    client.send(message.type, message);
  }

  private broadcastMessage(message: ServerMessage): void {
    this.broadcast(message.type, message);
  }

  // -- helpers -------------------------------------------------------------------------------------------

  private seatOfSession(sessionId: string): Seat | undefined {
    return this.seats.find((s) => s.sessionId === sessionId);
  }

  private seatOfPlayer(playerId: PlayerId): Seat | undefined {
    return this.seats.find((s) => s.playerId === playerId);
  }

  /** A code no room has. */
  private async freeCode(): Promise<string> {
    for (let k = 0; k < 10; k++) {
      const code = generateRoomCode(this.deps.random);
      if (!(await matchMaker.getRoomById(code))) return code;
    }
    throw new Error('No free room code after 10 draws');
  }
}

/** Fills in what tests and app.ts don't say. */
export function gameRoomDeps(
  nodeEnv: NodeEnv,
  required: Pick<GameRoomDeps, 'identity' | 'puzzles'>,
  overrides: Partial<GameRoomDeps> = {},
): GameRoomDeps {
  return {
    nodeEnv,
    now: Date.now,
    scheduler: systemScheduler,
    metrics: new GameMetrics(),
    random: randomInt,
    log: consoleGameLog,
    ...GAME_ROOM_DEFAULTS,
    ...required,
    // An override left undefined keeps the default.
    ...(Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== undefined),
    ) as Partial<GameRoomDeps>),
  };
}
