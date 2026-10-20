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
  abandonmentAt,
  defaultRules,
  type GameConfig,
  type GameEvent,
  type GameType,
  isSoftOffline,
  type PlayerId,
  type Scheduler,
  toPublicEvent,
} from '@sudoku-fight/engine';
import {
  type GameRoomError,
  type GameRoomRuleOverrides,
  type LobbyPlayer,
  MUTED_REACTION_EMOJI,
  parseDeclaredInterferenceKinds,
  PROTOCOL_VERSION,
  roomInterferenceKinds,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { type Identity, IdentityError, type IdentityVerifier, isIdentity } from '../auth';
import type { NodeEnv } from '../config';
import { DEFAULT_ABUSE_LIMIT, DEFAULT_MESSAGE_LIMITS, MessageGate, type MessageLimits } from '../game/gate';
import { type ConnectionChange, ConnectionStats, GameMetrics, LatencyStats } from '../game/metrics';
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
import type { RoomBlocks } from '../moderation/watch';
import { reportError } from '../monitoring/report';
import type { GameRecorder, RankedGames } from '../persistence';
import {
  fallbackSecret,
  type SeatedBot,
  seatStealthBot,
  type StealthBotSeat,
  type StealthSeatDeps,
} from '../stealth/seat';

/**
 * The game room (stage 7, spec §16.2, §17, §18, §21). The server is authoritative: it runs the engine
 * (ServerGame) and the clients only send actions. No Colyseus Schema: the room sends the engine's events
 * as messages, and a snapshot (the public state, without the solution) when a client needs the whole game.
 *
 * Life of a room:
 * 1. Lobby. `create('game', { private: true, … })` makes a room whose id is a 6-character code; others join
 *    with joinById(code). Everyone gets a `lobby` message on every join and leave. A drop or a leave in the
 *    lobby frees the seat. Each app declares the interference kinds it can show (`interferenceKinds` in its
 *    create or join options); the game allows only the kinds every seat declared [D47].
 * 2. Playing. When the last seat is taken the game is created and started at once (D37: ready on connect; a
 *    match room counts down first, see below): each client gets a `snapshot` (the game before the start,
 *    seq 1), then everyone gets the `events` of the start, and from then on every engine update as `events`.
 *    - An action is checked by the MessageGate (shape, rate limit, clientSeq), then applied at the server's
 *      time. A refusal goes to its sender only (`rejected`).
 *    - A drop (no goodbye: a dead socket, the heartbeat, the app in the background) is a lost connection
 *      [D42]: the engine's soft 'disconnect' (playerConnectionLost) marks the player for rules.softGraceMs and
 *      nothing else changes; the game goes on for everyone. Not back by its end: the engine's own timer starts
 *      the grace of [D4] then (playerDisconnected with graceEndsAt, a freeze in a two-player game). Colyseus's
 *      allowReconnection holds the seat for both (abandonmentAt). Back in time: a fresh `snapshot` to that
 *      client, then the engine's 'reconnect' (playerReconnected, and gameResumed after a freeze) to everyone,
 *      before any message of his is read. Not back: the engine's grace timer makes it abandonment (2 players:
 *      the other wins [D8]; 3–4: the game goes on).
 *    - Moves he made on his phone while the connection was lost come after the return as `offlineMove`, the
 *      ordinary action path: each is decided on the board as it is then, and one whose cell is no longer free
 *      for him is refused to him only (`rejected`), with no trace and no penalty.
 *    - Leaving on purpose (a consented leave) is a disconnect too, hard at once (no soft phase): the grace runs
 *      and it ends in abandonment [D32: leaving after "found" is abandonment]; meanwhile the player may rejoin
 *      by code (same identity), and gets a fresh `snapshot`. Giving up on purpose is the `surrender` message
 *      (6.6).
 *    - The room stays while the game runs, even with nobody connected (the game is kept on the server, spec
 *      §16.2); the graces end it.
 * 3. Over. After gameOver everyone gets the `solution` (spec §21: only now). The room closes after
 *    closeAfterGameMs at the latest, and as soon as nobody is in it once every player has had the end. A
 *    player who was away when it came (a drop, the phone in the background, Moshe's black screens of 1.0.0)
 *    keeps the room up to that ceiling: back by the reconnection token or by code, they get the finished
 *    snapshot and the solution, and with them the result. A drop after the end holds the seat until the
 *    ceiling too (the app does not reconnect to a game it has seen end, but an old app might).
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
 * game starts at GO with that player's connection lost (the soft phase, then the grace, run from then), and
 * the reconnection token brings them back; one who left on purpose starts it disconnected (the grace at once).
 * When the game is over and its result stored, the room tells matchmaking, which refuses the players'
 * searches until then (one ranked game at a time).
 *
 * Blocks (spec §3.5): matchmaking never puts two players who blocked each other in one game, but a game that
 * started before the block (or a block made from the opponent's card during the game) brings them together.
 * From the start of the game the room knows the blocks among its players (deps.blocks: the stored ones, then
 * every change), and a blocked player's `reaction` reaches whoever blocked them with MUTED_REACTION_EMOJI:
 * the event stays (its seq, its sender), so that client's state keeps in step, but there is nothing to show.
 * Nobody else's events change, and nobody is told about the block.
 *
 * Abuse: messages over a type's rate limit are dropped; too many malformed or over-the-limit messages and
 * the client is disconnected (for the game, a drop). Measures: every action's handling time goes to
 * GameMetrics (GET /dev/metrics outside production) and to the game's summary line in the log when it ends;
 * an action slower than slowActionMs is logged on its own. So do the connections [D42] (lost, back within
 * the soft phase, hard, back from it: counted from the engine's events) and the moves made offline (applied,
 * or lost by reason).
 *
 * Friends rooms (1.0.4, rooms/FriendsRoom.ts) are this room with a waiting room of their own. The points they
 * hook into change nothing for the rooms above (friends-room.md §7.1):
 * 1. roomSetup() and roomIdIsCode(): the setup comes from the friends service's claim, and the room keeps
 *    Colyseus's random id (the 6-digit code is only a key in the service, never the room's id).
 * 2. They never use joinLobby(): their lobby has no auto-start; the host's `start` runs countDown().
 * 3. Their lobby holds a dropped seat (D84a) and lets the same account take its seat over, with the protected
 *    seat helpers (takeSeat, moveSeat, freeSeat, keepSeats), in place of leaveLobby() and `alreadyInRoom`.
 * 4. lobbyContent(): their `lobby` carries avatar, flag, rating, `away` and the host.
 * 5. gameMaker(): their game's config (a ranked-pool puzzle, nobody rated) and its record (stored unrated).
 *
 * The stealth bot (stealth-bot.md §7) [D90]: a match's setup may name a persona's seat (`bots`), which has no
 * connection, ever. The room seats it `readyAfterMs` after it opened (the `lobby` goes out, and matchmaking hears
 * it is in, as for a person who connected: D37), and at the start the engine's bot plays it through the game
 * (stealth/seat.ts: ServerGame.act, so the server stays authoritative), with a private seed. Its seat is never
 * disconnected, never rejoined, and never waited for at the end. Everything the clients get is what a game
 * between two people sends.
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
  /** Blocks among the players (spec §3.5), to mute reactions. Without it, nothing is muted. */
  blocks?: RoomBlocks;
  /**
   * The stealth bot's seats (config.stealth.secret): the key of its private seed. Without it, a seat a match
   * names gets a secret of the process (stealth/seat.ts fallbackSecret).
   */
  stealth?: StealthSeatDeps;
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

export type GameRoomPhase = 'lobby' | 'countdown' | 'starting' | 'playing' | 'over';
type Phase = GameRoomPhase;

/** What makes a game's config and records it (hook 5): a rated room's RankedGames, or a friends room's. */
export type GameMaker = Pick<RankedGames, 'createConfig' | 'record'>;

/** The `lobby` message's own fields (hook 4): the seats, and a friends room's host and seat counts. */
export interface GameRoomLobbyContent {
  players: LobbyPlayer[];
  hostId?: PlayerId;
  minPlayers?: number;
  maxPlayers?: number;
}

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
  /**
   * Dropped before the game (a match's countdown, a rated game being set up) or after its end, the seat held to
   * come back.
   */
  away?: boolean;
  /**
   * The interference kinds the app declared in its create or join options [D47] (a private room's seats; a
   * match room has its kinds from matchmaking). Undefined: none declared, the legacy kinds.
   */
  interferenceKinds?: readonly string[];
  /** A persona's seat (the stealth bot): no connection, ever; the engine's bot plays it. */
  bot?: StealthBotSeat;
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
        // A suspension (spec §3.5) says so, so the app shows it and reloads the profile; anything else is a
        // sign-in the room can't take.
        if (error instanceof IdentityError)
          throw refuse(
            ErrorCode.AUTH_FAILED,
            error.code === 'suspended' ? 'suspended' : 'unauthenticated',
            error.message,
          );
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
  /** What made this game's config and records it (hook 5), once a rated or friends game starts. */
  private maker: GameMaker | null = null;
  private recorder: GameRecorder | null = null;
  /** GO of a room that counts down by itself (countDown(): a friends room's `start`). */
  private goTimer: unknown = null;
  private gate: MessageGate | null = null;
  private closeTimer: unknown = null;
  /** When the finished game's room closes at the latest (gameOver + closeAfterGameMs, this room's clock). */
  private closeAt: number | null = null;
  /** The players who have had the end: connected when it came, or back since (welcomeBack). */
  private readonly sawEnd = new Set<PlayerId>();
  /** onCreate finished (a refused create is disposed too, and must not count as a room closed). */
  private opened = false;
  /** Connections disconnected for abuse: their last messages may still be in the pipe, and count for nothing. */
  private readonly kicked = new Set<string>();
  /** This room's action handling times, for the summary when the game ends. */
  private readonly actionTimes = new LatencyStats(2048);
  /** This game's connections and moves made offline [D42], for the same summary. */
  private readonly connectionStats = new ConnectionStats();
  /** Players hard-disconnected now (playerDisconnected, not back yet): a return from there is 'backHard'. */
  private readonly hardAway = new Set<PlayerId>();
  /** Blocks among the players, as `<blocker> <blocked>`: the blocked one's reactions are muted for the blocker. */
  private readonly mutes = new Set<string>();
  /** Stops listening for block changes (the room closes). */
  private stopBlocks: (() => void) | null = null;
  /** The stealth bots' "connections" on their way (their seats, readyAfterMs after the room opened). */
  private readonly botTimers = new Set<unknown>();
  /** The stealth bots playing this game. */
  private readonly bots: SeatedBot[] = [];

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
      setup = this.roomSetup(options);
    } catch (error) {
      if (error instanceof RoomOptionsError)
        throw refuse(ErrorCode.MATCHMAKE_INVALID_CRITERIA, 'badOptions', error.message);
      throw error;
    }
    const codeIsId = this.roomIdIsCode();
    if (codeIsId && setup.code !== null && (await matchMaker.getRoomById(setup.code)))
      throw refuse(
        ErrorCode.MATCHMAKE_INVALID_CRITERIA,
        'codeTaken',
        `a room already has the code ${setup.code}`,
      );
    this.code = setup.code ?? (await this.freeCode());
    // Hook 1: a friends room keeps Colyseus's own random id; its code is a key in the friends service only.
    if (codeIsId) this.roomId = this.code;
    this.gameType = setup.gameType;
    this.playerCount = setup.playerCount;
    this.ruleOverrides = setup.rules;
    this.rated = setup.rated;
    if (this.rated && this.deps.ranked === undefined)
      throw refuse(ErrorCode.MATCHMAKE_INVALID_CRITERIA, 'badOptions', 'rated rooms need the database');
    // A persona's seat (the stealth bot) takes no connection.
    const bots = this.match?.setup.bots ?? [];
    this.maxClients = setup.playerCount - bots.length;
    if (this.match)
      this.seatReservationTimeout = (this.match.setup.readyTimeoutMs + MATCH_SEAT_SLACK_MS) / 1000;
    for (const bot of bots) {
      const timer = this.deps.scheduler.setTimeout(() => {
        this.botTimers.delete(timer);
        this.seatBot(bot);
      }, bot.readyAfterMs);
      this.botTimers.add(timer);
    }
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

  override onJoin(client: Client, options?: unknown): void {
    const identity: unknown = client.auth;
    if (!isIdentity(identity)) throw refuse(ErrorCode.AUTH_FAILED, 'unauthenticated', 'no identity');
    if (this.phase === 'lobby') return this.joinLobby(client, identity, options);

    // The game is on (or over): only its own players come back, after leaving on purpose.
    const seat = this.seatOfPlayer(identity.userId);
    if (!seat) throw refuse(ErrorCode.APPLICATION_ERROR, 'gameStarted', 'the game in this room has started');
    // A persona's seat is the bot's for good (nobody can sign in as one; this is the room's own guard).
    if (seat.sessionId !== null || seat.bot)
      throw refuse(ErrorCode.APPLICATION_ERROR, 'alreadyInRoom', `${seat.playerId} is connected already`);
    seat.sessionId = client.sessionId;
    this.gate!.newSession(seat.playerId);
    this.deps.log.info(`[game ${this.code}] ${seat.playerId} rejoined`);
    this.welcomeBack(client, seat);
  }

  /**
   * Dropped without saying goodbye: a lost connection (spec §16.2) [D42]. The engine marks the player for the
   * soft phase (the game goes on), and its timer starts the grace at the soft phase's end; the seat is held for
   * both, until the moment he would abandon the game.
   */
  override onDrop(client: Client): void {
    const seat = this.seatOfSession(client.sessionId);
    if (!seat) return;
    if (this.phase === 'lobby') return this.leaveLobby(seat);
    if (this.phase === 'over') return this.holdSeatAfterGame(client, seat);
    if (!this.game) return this.holdSeatBeforeGame(client, seat);
    const result = this.game.disconnect(seat.playerId, { soft: true });
    if (result.rejected) {
      // Out of the game already (surrendered, abandoned): nothing to hold.
      seat.sessionId = null;
      return;
    }
    const now = this.deps.now();
    const until = abandonmentAt(this.game.state, seat.playerId) ?? now;
    const seconds = (Math.max(0, until - now) + RECONNECT_SLACK_MS) / 1000;
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
    // Leaving on purpose is hard at once (it hardens a soft phase too); a socket that died is a lost
    // connection, with its soft phase [D42].
    const consented = code === CloseCode.CONSENTED;
    const result = this.game.disconnect(seat.playerId, { soft: !consented });
    if (!result.rejected) {
      const me = this.game.state.players.find((p) => p.id === seat.playerId);
      const phase = me && isSoftOffline(me) ? 'the soft phase' : 'grace';
      this.deps.log.info(
        `[game ${this.code}] ${seat.playerId} ${consented ? 'left' : 'is gone'}; ${phase} runs`,
      );
    }
  }

  /** A hook, a message handler or a timer threw (stage 14): logged and reported, refusals aside. */
  override onUncaughtException(exception: RoomException, method: RoomMethodName): void {
    logRoomException(this.deps.log, `[game ${this.code || '?'}]`, exception, method);
  }

  override onDispose(): void {
    this.stopBlocks?.();
    this.stopBlocks = null;
    for (const timer of this.botTimers) this.deps.scheduler.clearTimeout(timer);
    this.botTimers.clear();
    for (const bot of this.bots) bot.stop();
    this.bots.length = 0;
    // A match that never got to its countdown is off (matchmaking requeues whoever was here).
    this.match?.closed();
    this.game?.close();
    // A game that is over still gets its end written; one cut short keeps what it has.
    this.recorder?.close();
    if (this.closeTimer !== null) this.deps.scheduler.clearTimeout(this.closeTimer);
    this.closeTimer = null;
    if (this.goTimer !== null) this.deps.scheduler.clearTimeout(this.goTimer);
    this.goTimer = null;
    if (this.opened) this.deps.metrics.roomClosed();
    this.opened = false;
  }

  /**
   * Dropped in a match's countdown, or while a rated game is being set up: the seat is the player's from the
   * countdown on [D32], and the game starts at GO without them (their connection lost: the soft phase and then
   * the grace run from the start, like a drop in the game [D42]). Colyseus holds the connection until that
   * grace would run out, so the app comes back with its reconnection token as it would in the game (a rejoin
   * by code works too).
   */
  private holdSeatBeforeGame(client: Client, seat: Seat): void {
    seat.away = true;
    const now = this.deps.now();
    const { softGraceMs, graceMs } = defaultRules('ranked', this.gameType, this.ruleOverrides);
    const toGoMs = Math.max(0, (this.goAt ?? now) - now);
    const seconds = (toGoMs + softGraceMs + graceMs + BEFORE_GAME_SLACK_MS + RECONNECT_SLACK_MS) / 1000;
    this.deps.log.info(
      `[game ${this.code}] ${seat.playerId} dropped before the game; ${seconds.toFixed(1)} s to come back`,
    );
    this.allowReconnection(client, seconds).catch(() => undefined);
  }

  /**
   * Dropped after the end: the seat is held until the room closes (closeAt), so the player still gets the end
   * back with the reconnection token (or by code: the seat is freed when the hold lapses, onLeave).
   */
  private holdSeatAfterGame(client: Client, seat: Seat): void {
    seat.away = true;
    const now = this.deps.now();
    const seconds = Math.max(1, ((this.closeAt ?? now) - now) / 1000);
    this.deps.log.info(
      `[game ${this.code}] ${seat.playerId} dropped after the end; ${seconds.toFixed(1)} s to come back`,
    );
    this.allowReconnection(client, seconds).catch(() => undefined);
  }

  /** Everyone has had the end: nothing keeps an empty room open any more (a bot's seat waits for nothing). */
  private everyoneSawEnd(): boolean {
    return this.seats.every((s) => s.bot !== undefined || this.sawEnd.has(s.playerId));
  }

  // -- lobby ---------------------------------------------------------------------------------------------

  private joinLobby(client: Client, identity: Identity, options: unknown): void {
    if (this.match && !this.match.has(identity.userId))
      throw refuse(ErrorCode.APPLICATION_ERROR, 'gameStarted', 'this ranked game is for its matched players');
    if (this.seatOfPlayer(identity.userId))
      throw refuse(
        ErrorCode.APPLICATION_ERROR,
        'alreadyInRoom',
        `${identity.userId} is in this room already`,
      );
    // The kinds this app can show [D47]; a malformed list counts as none (the legacy kinds), never a refusal.
    const declared =
      typeof options === 'object' && options !== null
        ? (options as { interferenceKinds?: unknown }).interferenceKinds
        : undefined;
    this.seats.push({
      playerId: identity.userId,
      name: identity.name,
      sessionId: client.sessionId,
      interferenceKinds: parseDeclaredInterferenceKinds(declared),
    });
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

  // -- hook points of a room with a lobby of its own (the friends room, 1.0.4) ---------------------------

  /**
   * Hook 1: this room's setup from its create options. Here: a matchmaking match's claim, or a dev room's
   * options (outside production). Throws RoomOptionsError (refused `badOptions`).
   */
  protected roomSetup(options: unknown): GameRoomSetup {
    const matchId = rankedMatchIdOf(options);
    return matchId === null ? parseCreateOptions(options, this.deps.nodeEnv) : this.claimMatch(matchId);
  }

  /** Hook 1: the room's id is its code (dev and match rooms). A friends room keeps a random one. */
  protected roomIdIsCode(): boolean {
    return true;
  }

  /** Hook 4: the seats (and extra fields) of `lobby`. Here: each seat's id and name. */
  protected lobbyContent(): GameRoomLobbyContent {
    return { players: this.seats.map((s) => ({ id: s.playerId, name: s.name })) };
  }

  /**
   * Hook 5: what makes this room's game config and records it. Here: a rated room's deps.ranked (null for an
   * unrated dev room: a puzzle from deps.puzzles, nothing stored).
   */
  protected gameMaker(): GameMaker | null {
    return this.rated ? (this.deps.ranked ?? null) : null;
  }

  /** The room's phase (a subclass's lobby runs while it is 'lobby'). */
  protected get gamePhase(): GameRoomPhase {
    return this.phase;
  }

  /** The room's code: a dev room's id, a friends room's 6 digits. */
  protected get roomCode(): string {
    return this.code;
  }

  /** The player a connection plays for, if any. */
  protected playerOfSession(sessionId: string): PlayerId | undefined {
    return this.seatOfSession(sessionId)?.playerId;
  }

  /** The connection that holds a player's seat now (null: nobody; undefined: no such seat). */
  protected sessionOfPlayer(playerId: PlayerId): string | null | undefined {
    return this.seatOfPlayer(playerId)?.sessionId;
  }

  /** A seat for this connection, last in the order (a subclass's lobby). */
  protected takeSeat(playerId: PlayerId, name: string, sessionId: string, interferenceKinds: unknown): void {
    this.seats.push({
      playerId,
      name,
      sessionId,
      interferenceKinds: parseDeclaredInterferenceKinds(interferenceKinds),
    });
    this.gate!.newSession(playerId);
  }

  /**
   * The same player on a new connection (another device, or the app opened again): the seat keeps its place.
   * The earlier connection plays for nobody from now on.
   */
  protected moveSeat(playerId: PlayerId, name: string, sessionId: string, interferenceKinds: unknown): void {
    const seat = this.seatOfPlayer(playerId);
    if (!seat) return this.takeSeat(playerId, name, sessionId, interferenceKinds);
    seat.sessionId = sessionId;
    seat.name = name;
    seat.away = false;
    seat.interferenceKinds = parseDeclaredInterferenceKinds(interferenceKinds);
    this.gate!.newSession(playerId);
  }

  /** The seat is marked away (dropped) or back. */
  protected markAway(playerId: PlayerId, away: boolean): void {
    const seat = this.seatOfPlayer(playerId);
    if (seat) seat.away = away;
  }

  /** The seat is gone (left the lobby, its hold ran out, kicked). */
  protected freeSeat(playerId: PlayerId): void {
    const i = this.seats.findIndex((s) => s.playerId === playerId);
    if (i >= 0) this.seats.splice(i, 1);
  }

  /** Before the game: only these seats stay, in this order (the game's players). */
  protected keepSeats(playerIds: readonly PlayerId[]): void {
    const kept = this.seats.filter((s) => playerIds.includes(s.playerId));
    kept.sort((a, b) => playerIds.indexOf(a.playerId) - playerIds.indexOf(b.playerId));
    this.seats.splice(0, this.seats.length, ...kept);
  }

  /**
   * A room that starts by itself (a friends room's `start`): from now the seats are fixed (leaving is
   * abandonment [D32]); everyone gets the `countdown`, and the game starts at GO, as in a match's room.
   */
  protected countDown(countdownMs: number): void {
    if (this.phase !== 'lobby') return;
    this.phase = 'countdown';
    this.autoDispose = false;
    this.goAt = this.deps.now() + countdownMs;
    for (const client of this.clients) if (this.seatOfSession(client.sessionId)) this.sendCountdown(client);
    this.goTimer = this.deps.scheduler.setTimeout(() => {
      this.goTimer = null;
      if (this.phase === 'countdown') this.startGame();
    }, countdownMs);
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
   * A persona "connects" (the stealth bot, readyAfterMs after the room opened): its seat is taken as a person's
   * would be (last in the order, the `lobby` to everyone here), and matchmaking hears it is in (D37: ready). A
   * match that fell through meanwhile has no seat for it.
   */
  private seatBot(bot: StealthBotSeat): void {
    if (this.phase !== 'lobby' || !this.match || this.seatOfPlayer(bot.userId)) return;
    this.seats.push({ playerId: bot.userId, name: bot.name, sessionId: null, bot });
    this.sendLobby();
    this.match.join(bot.userId);
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

  /** `lobby` to everyone with a seat (hook 4: lobbyContent()). */
  protected sendLobby(): void {
    const { players, ...extra } = this.lobbyContent();
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
        ...extra,
      });
    }
  }

  /** The room's game type until the start (a friends room's host changes it [D82]). */
  protected setGameType(gameType: GameType): void {
    if (this.phase === 'lobby') this.gameType = gameType;
  }

  // -- the game ------------------------------------------------------------------------------------------

  /**
   * The game's rule overrides: the room's, with the interference kinds it allows [D47]. A match room has them
   * from matchmaking (the kinds every matched app declared). A private room allows the kinds every seat's app
   * declared on joining (none declared: the legacy three), unless its create options set them.
   */
  private gameRules(): GameRoomRuleOverrides {
    if (this.match || this.ruleOverrides.interferenceKinds !== undefined) return this.ruleOverrides;
    return {
      ...this.ruleOverrides,
      interferenceKinds: roomInterferenceKinds(this.seats.map((s) => s.interferenceKinds)),
    };
  }

  private startGame(): void {
    this.watchBlocks();
    const id = randomUUID();
    const seed = this.deps.random(2 ** 31);
    // Hook 5: a rated room's deps.ranked, a friends room's own; none for a dev room.
    const ranked = this.gameMaker();
    this.maker = ranked;
    const rules = this.gameRules();
    if (ranked === null) {
      return this.launch({
        id,
        mode: 'ranked',
        gameType: this.gameType,
        puzzle: this.deps.puzzles.pick(this.gameType),
        players: this.seats.map((s) => ({ id: s.playerId, name: s.name })),
        rules: defaultRules('ranked', this.gameType, rules),
        seed,
      });
    }
    // A rated game's config needs the database (puzzle, ratings). The room stays even if everyone leaves
    // meanwhile: they are in the game from here on [D32].
    this.phase = 'starting';
    this.autoDispose = false;
    const players = this.seats.map((s) => ({ id: s.playerId, name: s.name }));
    ranked
      .createConfig({ id, gameType: this.gameType, players, rules, seed })
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
    this.recorder = this.maker?.record(config) ?? null;
    this.game = new ServerGame({
      config,
      clock: { now: this.deps.now },
      scheduler: this.deps.scheduler,
      onUpdate: (update) => {
        this.recorder?.push(update);
        this.onGameUpdate(update);
        // The stealth bot hears the game after everyone was sent it.
        for (const bot of this.bots) bot.host.push(update);
      },
      onError: (error) => this.deps.log.error(`[game ${this.code}] error`, error),
    });
    this.recorder?.push({ events: this.game.events, state: this.game.state });
    this.seatBots(this.game);
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
    // Whoever left or dropped before the game (the countdown, a rated game being set up) is in it, away from
    // now on: one who left on purpose is disconnected (the grace starts now); a dropped seat has lost its
    // connection (the soft phase starts now [D42], then the grace), and may still come back with its
    // reconnection token.
    // A bot's seat is in the game, connected, from the start.
    for (const seat of this.seats) {
      if (seat.bot) continue;
      if (seat.sessionId === null) this.game.disconnect(seat.playerId);
      else if (seat.away) this.game.disconnect(seat.playerId, { soft: true });
    }
    this.deps.metrics.gameStarted();
    const who = this.seats.map((s) => s.playerId).join(', ');
    const rated = this.rated ? (this.bots.length > 0 ? ' (rated, stealth bot)' : ' (rated)') : '';
    this.deps.log.info(
      `[game ${this.code}] started${rated}: ${this.gameType}, ${who}, puzzle ${config.puzzle.id}`,
    );
  }

  /**
   * The stealth bot takes its seats in the game, before the start, so it hears it (stealth/seat.ts). Its RNG's
   * seed is private: HMAC of the server's secret and the game id, kept in the server's log only.
   */
  private seatBots(game: ServerGame): void {
    for (const seat of this.seats) {
      if (!seat.bot) continue;
      const bot = seatStealthBot({
        game,
        seat: seat.bot,
        secret: this.deps.stealth?.secret ?? fallbackSecret(),
        clock: { now: this.deps.now },
        scheduler: this.deps.scheduler,
        log: this.deps.log,
      });
      this.bots.push(bot);
      this.deps.log.info(`[game ${this.code}] stealth bot in seat ${seat.playerId} (seed ${bot.seed})`);
    }
  }

  private onGameUpdate({ events, state }: ServerGameUpdate): void {
    this.sendEvents(events.map(toPublicEvent));
    this.countConnections(events);
    if (state.status !== 'over' || this.phase === 'over') return;
    this.phase = 'over';
    // A match's players may search again once the result is stored, so the next search has the new rating.
    const match = this.match;
    if (match) void (this.recorder?.done ?? Promise.resolve()).then(() => match.over());
    // Only now (spec §21): for the replay.
    this.broadcastMessage({ type: 'solution', solution: state.config.puzzle.solution });
    // Whoever is connected now has the end; a player who is away (a seat held for a drop, or given up) gets it
    // on return, and the room waits for them until closeAt. Once everyone has it, an empty room closes now
    // rather than after closeAfterGameMs.
    const connected = new Set(this.clients.map((c) => c.sessionId));
    for (const seat of this.seats)
      if (seat.sessionId !== null && connected.has(seat.sessionId)) this.sawEnd.add(seat.playerId);
    this.closeAt = this.deps.now() + this.deps.closeAfterGameMs;
    this.autoDispose = this.everyoneSawEnd();
    this.deps.metrics.gameOver();
    const t = this.actionTimes.summary();
    const ranking = (state.result?.ranking ?? [])
      .map((r) => `${r.place}. ${r.playerId} ${r.score}`)
      .join(', ');
    const connections = this.connectionStats.summary();
    this.deps.log.info(
      `[game ${this.code}] over (${state.result?.reason}): ${ranking}; ` +
        `${t.count} actions, p50 ${t.p50Ms} ms, p95 ${t.p95Ms} ms, max ${t.maxMs} ms` +
        (connections ? `; ${connections}` : ''),
    );
    this.closeTimer = this.deps.scheduler.setTimeout(() => {
      this.closeTimer = null;
      this.disconnect().catch((error: unknown) => this.deps.log.error(`[game ${this.code}] close`, error));
    }, this.deps.closeAfterGameMs);
  }

  /**
   * The connections in this update's events [D42], for the server's measures and this game's summary: a lost
   * connection (the soft phase), a hard disconnect, a return from either, and a move made offline applied.
   */
  private countConnections(events: readonly GameEvent[]): void {
    const count = (change: ConnectionChange) => {
      this.connectionStats.connection(change);
      this.deps.metrics.connection(change);
    };
    for (const e of events) {
      switch (e.type) {
        case 'playerConnectionLost':
          count('soft');
          break;
        case 'playerDisconnected':
          this.hardAway.add(e.playerId);
          count('hard');
          break;
        case 'playerReconnected':
          count(this.hardAway.delete(e.playerId) ? 'backHard' : 'backInSoft');
          break;
        case 'placedCorrect':
        case 'placedWrong':
          if (e.offline) {
            this.connectionStats.offlineMove();
            this.deps.metrics.offlineMove();
          }
          break;
        default:
          break;
      }
    }
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
      // Back after the end: now they have it. The last one to get it lets the room close once it is empty.
      this.sawEnd.add(seat.playerId);
      if (this.everyoneSawEnd()) this.autoDispose = true;
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

  // -- blocks (spec §3.5) --------------------------------------------------------------------------------

  /**
   * From the game's start: the blocks among its players, stored and to come. Listening starts before the
   * stored ones are read, so a change meanwhile is not lost; a pair that changed meanwhile keeps the change.
   */
  private watchBlocks(): void {
    const blocks = this.deps.blocks;
    if (blocks === undefined || this.stopBlocks !== null) return;
    const players = new Set(this.seats.map((s) => s.playerId));
    const touched = new Set<string>();
    this.stopBlocks = blocks.subscribe((change) => {
      if (!players.has(change.blockerId) || !players.has(change.blockedId)) return;
      const key = muteKey(change.blockerId, change.blockedId);
      touched.add(key);
      if (change.blocked) this.mutes.add(key);
      else this.mutes.delete(key);
    });
    blocks
      .among([...players])
      .then((pairs) => {
        for (const p of pairs) {
          const key = muteKey(p.blockerId, p.blockedId);
          if (!touched.has(key)) this.mutes.add(key);
        }
      })
      .catch((error: unknown) => this.deps.log.error(`[game ${this.code}] blocks could not be read`, error));
  }

  /** The events to everyone; a reaction from a player someone blocked goes to that one muted. */
  private sendEvents(events: GameEvent[]): void {
    if (this.mutes.size === 0 || !events.some((e) => e.type === 'reaction')) {
      return this.broadcastMessage({ type: 'events', events });
    }
    for (const client of this.clients) {
      const viewer = this.seatOfSession(client.sessionId)?.playerId;
      const mine =
        viewer === undefined
          ? events
          : events.map((e) =>
              e.type === 'reaction' && this.mutes.has(muteKey(viewer, e.playerId))
                ? { ...e, emoji: MUTED_REACTION_EMOJI }
                : e,
            );
      this.sendTo(client, { type: 'events', events: mine });
    }
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
          if (admission.action.type === 'offlineMove' && reason && this.game) {
            // [D42] A move made offline that lost its cell (refused to him only, with no penalty). One that is
            // applied is counted from its event (countConnections), before a last cell's summary line.
            this.connectionStats.offlineMove(reason);
            this.deps.metrics.offlineMove(reason);
          }
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

/** The key of a block in a room: `blocker` doesn't see `blocked`'s reactions. */
const muteKey = (blocker: string, blocked: string) => `${blocker} ${blocked}`;

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
