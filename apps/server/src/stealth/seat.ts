import { createHmac, randomBytes } from 'node:crypto';

import {
  type Action,
  type ActionResult,
  attachBot,
  type BotHandle,
  type BotHost,
  type BotHostUpdate,
  type BotProfile,
  type BotTrace,
  type Clock,
  createRng,
  type GameState,
  type GameType,
  INTERFERENCE_KINDS,
  type InterferenceKind,
  paceFromHistory,
  type PaceHistory,
  type PlayerAction,
  type Scheduler,
  stealthBotConfig,
  stealthBotLevel,
} from '@sudoku-fight/engine';

import type { Db } from '../db';
import type { ServerGame, ServerGameUpdate } from '../game/serverGame';
import type { GameRoomLog } from '../rooms/GameRoom';
import { paceHistoryOf } from './pace';

/**
 * The stealth bot's seat in a ranked game room (stealth-bot.md §5, §7) [D90, D96–D98]: the engine's bot
 * (packages/engine/src/bot) playing a persona's seat of the server's game, with no socket.
 *
 * - The level, built once when matchmaking seats it (stealthLevelFor): the opponent's own pace from his last
 *   ranked games on the server (game_players.pace_*, ./pace.ts, the engine's paceFromHistory) [D96]; his mistake
 *   rate [D97a]; no reactions [D97b]; it never starts an interference and hits back for each one it received,
 *   2–20 s after it ended, with the kinds its persona's level has unlocked [D98, D17].
 * - It connects like a person's app: `readyAfterMs` (0.3–1.5 s, drawn by matchmaking) after its room opens, the
 *   room seats it and tells matchmaking it is in (D37: connected = ready), so the `lobby` and `ready` messages
 *   come as they do for a person.
 * - In the game it reads the server's state and acts through ServerGame.act like any player (ServerBotHost): the
 *   server stays authoritative, and every action is checked by the engine. Its seat never disconnects, never
 *   surrenders and never leaves.
 * - Its RNG has a private seed (privateBotSeed: HMAC of the server's secret and the game id), never the game's
 *   public seed, which goes to the apps in gameCreated: a tampered app could compute the bot's moves from that.
 *   The same secret and game id give the same bot, so a game still replays.
 * Nothing of this is sent: the persona's seat, events and profile have a person's shapes.
 */

/** A persona's seat, as matchmaking hands it to the game room in the match's setup (matchmaking/ranked.ts). */
export interface StealthBotSeat {
  /** The persona's users.id: an id like a person's (a UUID). */
  userId: string;
  name: string;
  /** What it plays by in this game: built for its opponent (stealthLevelFor). */
  level: BotProfile;
  /** It connects to the room this long after the room opens (D37: then it is ready). */
  readyAfterMs: number;
}

/** What the game room needs to seat a bot. */
export interface StealthSeatDeps {
  /** STEALTH_BOT_SECRET (config.stealth.secret): the key of the bots' private seeds. */
  secret: string;
}

/**
 * [D17] The level that opens each interference: the app's own table (apps/mobile/src/screens/game/arsenal/
 * config.ts INTERFERENCE_UNLOCK_LEVELS), which a persona follows too, so a level-1 persona never sends a level-3
 * interference. A test keeps the two equal.
 */
export const PERSONA_KIND_UNLOCK_LEVELS: Readonly<Record<InterferenceKind, number>> = {
  fireworks: 0,
  cats: 0,
  warp: 0,
  scramble: 2,
  ink: 3,
  keypad: 4,
};

/** [D17, D98] The kinds a persona of `level` may send, in the engine's order (the game's kinds still decide). */
export function personaKinds(level: number): InterferenceKind[] {
  const reached = Number.isFinite(level) && level >= 1 ? level : 1;
  return INTERFERENCE_KINDS.filter((kind) => reached >= PERSONA_KIND_UNLOCK_LEVELS[kind]);
}

/** A person's pace history, as the stealth bot is built from it (./pace.ts paceHistoryOf). */
export interface StealthPaceSource {
  history(userId: string, gameType: GameType): Promise<PaceHistory>;
}

export function dbStealthPace(db: Db | (() => Db)): StealthPaceSource {
  const database = typeof db === 'function' ? db : () => db;
  return { history: (userId, gameType) => paceHistoryOf(database(), userId, gameType) };
}

/** What the level is built from (D96, D97a): no history at all gives the defaults (14 s a move, 8% mistakes). */
export const NO_PACE_HISTORY = (gameType: GameType): PaceHistory => ({
  gameType,
  games: [],
  stealthWins: [],
});

/**
 * [D96, D97a, D97b, D98] The level of the bot against `userId` in a game of `gameType`, for a persona of
 * `personaLevel`. A history that can't be read gives the defaults (logged): the bot is never what keeps a
 * player from a game.
 */
export async function stealthLevelFor(
  pace: StealthPaceSource,
  userId: string,
  gameType: GameType,
  personaLevel: number,
  log: Pick<GameRoomLog, 'error'>,
): Promise<BotProfile> {
  let history: PaceHistory;
  try {
    history = await pace.history(userId, gameType);
  } catch (error) {
    log.error(`[stealth] the pace of ${userId} could not be read; the defaults stand in`, error);
    history = NO_PACE_HISTORY(gameType);
  }
  return stealthBotLevel({ ...paceFromHistory(history), kinds: personaKinds(personaLevel) });
}

/**
 * The bot's private seed (stealth-bot.md §7): a 32-bit number from HMAC-SHA256(secret, game id). Not derived
 * from the game's public seed, so an app that has the config learns nothing of the bot's draws.
 */
export function privateBotSeed(secret: string, gameId: string): number {
  return createHmac('sha256', secret).update(`stealth-bot:${gameId}`).digest().readUInt32BE(0);
}

/** A secret for the process, when the room has none (a server wired without config.stealth). */
let processSecret: string | null = null;
export function fallbackSecret(): string {
  processSecret ??= randomBytes(32).toString('hex');
  return processSecret;
}

/**
 * The server's game as the engine bot's host (packages/engine BotHost): the full state (solution included: it
 * never leaves the server), each update the room gets from the game (push(), in order), and the bot's actions
 * through ServerGame.act, so the engine checks them as anyone's. It acts only as its own player, and only with
 * a player's actions (never start, disconnect or reconnect). After close() it hears nothing more.
 */
export class ServerBotHost implements BotHost {
  private readonly listeners = new Set<(update: BotHostUpdate) => void>();
  private closed = false;

  constructor(
    private readonly game: ServerGame,
    readonly botId: string,
  ) {}

  get state(): GameState {
    return this.game.state;
  }

  subscribe(listener: (update: BotHostUpdate) => void): () => void {
    if (!this.closed) this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(action: Action): ActionResult {
    if (!isPlayerAction(action) || action.playerId !== this.botId)
      return { state: this.game.state, events: [], rejected: 'badAction' };
    // Throws when the game is closed (the room is gone): the bot stops.
    const { playerId, ...rest } = action;
    return this.game.act(playerId, rest);
  }

  /** An update of the game, as the room got it (ServerGame's onUpdate). */
  push(update: ServerGameUpdate): void {
    if (this.closed || update.events.length === 0) return;
    const message: BotHostUpdate = { kind: 'events', events: update.events };
    for (const listener of [...this.listeners]) listener(message);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}

const PLAYER_ACTION_TYPES: ReadonlySet<string> = new Set<PlayerAction['type']>([
  'select',
  'release',
  'place',
  'interfere',
  'react',
  'surrender',
  'offlineMove',
]);

/** A player's action (not the host's start, disconnect, reconnect, pause or resume). */
function isPlayerAction(action: Action): action is PlayerAction {
  return PLAYER_ACTION_TYPES.has(action.type);
}

export interface SeatStealthBotOptions {
  game: ServerGame;
  seat: StealthBotSeat;
  secret: string;
  clock: Clock;
  scheduler: Scheduler;
  log: GameRoomLog;
  /** For tests: every trace of the bot. */
  onTrace?: (trace: BotTrace) => void;
}

/** A seated bot: its host gets the game's updates (push), and stop() detaches it. */
export interface SeatedBot {
  readonly host: ServerBotHost;
  readonly seed: number;
  stop(): void;
}

/**
 * Seats the engine's bot in `seat` of `game` (before game.start(), so it hears the start). The game room pushes
 * every update of the game to `host` and calls stop() when it closes; the bot stops by itself at gameOver.
 */
export function seatStealthBot(options: SeatStealthBotOptions): SeatedBot {
  const { game, seat, log } = options;
  const host = new ServerBotHost(game, seat.userId);
  const seed = privateBotSeed(options.secret, game.state.config.id);
  const where = `[game ${game.state.config.id}]`;
  const handle: BotHandle = attachBot(host, {
    botId: seat.userId,
    level: seat.level,
    clock: options.clock,
    scheduler: options.scheduler,
    rng: createRng(seed),
    config: stealthBotConfig(),
    onTrace: (trace) => {
      options.onTrace?.(trace);
      // The server's log only (never a client): what a person looking into a report would want.
      if (trace.type === 'error') log.warn(`${where} stealth bot: ${String(trace.error)}`);
      else if (trace.type === 'retaliationDropped')
        log.info(`${where} stealth bot let a ${trace.kind} go (no chance by the end of its window)`);
    },
  });
  return {
    host,
    seed,
    stop: () => {
      handle.detach();
      host.close();
    },
  };
}
