import { randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ENGINE_VERSION, type Scheduler } from '@sudoku-fight/engine';
import {
  FRIENDS_ROOM_NAME,
  type GameRoomRuleOverrides,
  MATCHMAKING_ROOM_NAME,
  PROTOCOL_VERSION,
} from '@sudoku-fight/protocol';

import { roomIdentityVerifier } from './accounts/identity';
import { defaultIdentityVerifier } from './auth';
import { type TokenVerifier, tokenVerifierFor } from './auth/firebaseToken';
import { DEFAULT_PORT, loadConfig, type ServerConfig } from './config';
import { createDb, type Database, type Db } from './db';
import type { FriendsRules } from './friends/options';
import { FriendRoomsService } from './friends/service';
import { dbFriendsStore } from './friends/store';
import { bankPuzzleSource } from './game/puzzles';
import { configureHttp, type HttpDeps } from './http';
import { guardHttpServer } from './http/guard';
import { roomBlocks } from './moderation/store';
import { BlockWatch } from './moderation/watch';
import {
  colyseusMatchGames,
  createMatchmakingRoom,
  dbMatchmakingStore,
  DEFAULT_MATCHMAKING,
  MATCHMAKING_ROOM_DEFAULTS,
  type MatchmakingConfig,
  matchmakingIdentityVerifier,
  MatchmakingService,
} from './matchmaking';
import { endInterruptedGames, rankedGames } from './persistence';
import { dbPuzzleSource, rankedPoolSizes } from './puzzles';
import { EchoRoom } from './rooms/EchoRoom';
import { colyseusFriendsRooms, createFriendsRoom, friendsGameMaker } from './rooms/FriendsRoom';
import {
  consoleGameLog,
  createGameRoom,
  type GameRoomDeps,
  gameRoomDeps,
  type GameRoomLog,
  systemScheduler,
} from './rooms/GameRoom';
import { serverStealthMatcher, type StealthMatcher } from './stealth/match';
import type { StealthSeatDeps } from './stealth/seat';
import { dbStealthSwitchStore, StealthSwitch } from './stealth/switch';

/**
 * The game server (spec §17, §18), all on one port:
 * - Colyseus: the WebSocket transport, the `game` room (rooms/GameRoom, stage 7), the `echo` room for the
 *   round-trip check, GET /health, and outside production GET /dev/metrics (action handling times); the
 *   `matchmaking` room (stage 9: src/matchmaking), whose matches open rated `game` rooms.
 * - The `friends` room (1.0.4, rooms/FriendsRoom): playing with friends, opened by the friends service
 *   (src/friends/service: codes, tickets, blocks) for POST /v1/rooms and entered with its tickets; the service
 *   goes to the HTTP routes too (src/friends/router), and on a shutdown it tells every waiting room first.
 * - The stealth bot (src/stealth; stealth-bot.md §7, §8) [D90]: OFF unless STEALTH_BOT_ENABLED, and then off
 *   until an admin turns its switch on (serverStealth). One switch for the process: matchmaking reads it on every
 *   round, the admin API turns it, with no restart.
 * - Express (src/http): POST /v1/events (stage 7א), and the admin site next.
 * - The database (src/db): opened and migrated before the server listens, closed on shutdown. Ranked games
 *   left running by the previous process are ended then (persistence endInterruptedGames: 'serverRestart').
 *
 * A factory, because defineServer() has side effects as soon as it runs (transport, matchmaker, and with
 * gracefullyShutdown the process signal handlers). Tests pass gracefullyShutdown: false.
 */

export { DEFAULT_PORT };

export interface HealthReport {
  ok: true;
  engine: string;
  protocol: number;
}

export const health = (): HealthReport => ({ ok: true, engine: ENGINE_VERSION, protocol: PROTOCOL_VERSION });

/**
 * The WebSocket heartbeat. The server pings every connection each `pingInterval` ms, and cuts one that has
 * not answered `pingMaxRetries` pings in a row. A phone that goes silent without closing its socket (airplane
 * mode, a dead network: no FIN reaches the server) is noticed (pingMaxRetries, pingMaxRetries + 1] intervals
 * after its last answer, 3–4.5 s here, and only then does its soft phase start (spec §16.2) [D42]: 10 s in
 * which the other players see only a mark and the game goes on, then the 15 s grace of [D4]. So, from the
 * moment the network dies: about 5 s of airplane mode shows the others only the mark; about 14 s shows them
 * "Reconnecting… 15" (and freezes a two-player game); about 28–30 s ends in abandonment. A healthy connection
 * answers within a round trip; it takes 3 s without any answer to be cut (a stall that long is a drop, and the
 * app reconnects). The soft phase now absorbs such false drops (nobody sees them but as a mark), so the
 * heartbeat could be relaxed later (DECISIONS-PENDING 3.3).
 */
export const HEARTBEAT = { pingInterval: 1500, pingMaxRetries: 2 } as const;

export interface AppServerOptions {
  gracefullyShutdown?: boolean;
  /** Default: loadConfig() from the environment. */
  config?: ServerConfig;
  /** An open database (tests). The caller closes it. Default: opened from `config` before listening. */
  db?: Database;
  /** The clock for the HTTP routes (default Date.now). */
  now?: () => number;
  /** Passed through to the HTTP routes (tests: small rate limits). */
  telemetryLimits?: HttpDeps['telemetryLimits'];
  /**
   * The game room's dependencies (tests: a fixed puzzle, a quiet log, small limits). Default: the accounts'
   * identity verifier (accounts/identity roomIdentityVerifier), the puzzle bank, the system clock and timers.
   */
  game?: Partial<GameRoomDeps>;
  /**
   * Checks ID tokens, for the HTTP routes and the game room alike (one cache of Google's keys). Default:
   * tokenVerifierFor(config); tests pass one with their own keys (testing/tokens).
   */
  tokens?: TokenVerifier;
  /**
   * Matchmaking (stage 9): settings to override (tests: a short timeout and countdown), and its clock and
   * timers (default: the game room's).
   */
  matchmaking?: { config?: Partial<MatchmakingConfig>; now?: () => number; scheduler?: Scheduler };
  /**
   * Playing with friends (1.0.4): rules to override (tests: a few codes, a short hold), rule overrides for its
   * games (tests: a short grace), and the codes' RNG (default crypto.randomInt).
   */
  friends?: {
    rules?: Partial<FriendsRules>;
    gameRules?: GameRoomRuleOverrides;
    random?: (n: number) => number;
  };
}

/** What the game room needs to know players by their accounts (stage 8). */
export interface GameAccounts {
  tokens: TokenVerifier;
  db: Db | (() => Db);
  /**
   * Where the block routes tell blocks and unblocks (spec §3.5), for the rooms that mute reactions; the
   * HTTP routes must get the same one. Default: one of the rooms' own (they hear only the stored blocks).
   */
  blockWatch?: BlockWatch;
}

/**
 * The game room's dependencies for these settings. With `accounts`, players are known by their accounts
 * (roomIdentityVerifier), rated rooms have the database (persistence/rankedGames: ranked-pool puzzles
 * without repeats, ratings, the game stored), and blocks mute reactions (spec §3.5); without, players are
 * known by auth/identity's defaultIdentityVerifier, rated rooms are refused (no database) and nothing is muted.
 */
export function gameDepsFor(
  config: ServerConfig,
  overrides: Partial<GameRoomDeps> = {},
  accounts?: GameAccounts,
): GameRoomDeps {
  return gameRoomDeps(
    config.nodeEnv,
    {
      identity:
        overrides.identity ??
        (accounts === undefined
          ? defaultIdentityVerifier(config)
          : roomIdentityVerifier({ config, tokens: accounts.tokens, db: accounts.db })),
      puzzles: overrides.puzzles ?? bankPuzzleSource({ nodeEnv: config.nodeEnv }),
    },
    {
      ranked:
        accounts === undefined
          ? undefined
          : rankedGames({
              db: accounts.db,
              ratingOption: config.ratingOption,
              cheat: config.cheat,
              puzzles: dbPuzzleSource({ db: accounts.db, rng: { next: () => randomInt(2 ** 32) / 2 ** 32 } }),
              log: overrides.log ?? consoleGameLog,
              // A friends game's XP shares the practice day's cap (1.0.4) [D81a].
              practiceXpDailyCap: config.progress?.practiceXpDailyCap,
            }),
      blocks:
        accounts === undefined ? undefined : roomBlocks(accounts.db, accounts.blockWatch ?? new BlockWatch()),
      ...overrides,
    },
  );
}

/** The stealth bot as one server process has it (serverStealth). */
export interface ServerStealth {
  /**
   * Its switch (src/stealth/switch.ts), shared by matchmaking (isOn, every round) and the admin API (GET
   * /admin/api/stealth, POST /admin/api/stealth/switch). Not `available` unless STEALTH_BOT_ENABLED: then it is
   * off whatever is stored, and the admin site shows no switch.
   */
  switch: StealthSwitch;
  /** Matchmaking's side (stealth/match.ts); undefined unless STEALTH_BOT_ENABLED: matchmaking as before it. */
  matcher: StealthMatcher | undefined;
  /** The game rooms' (the key of the bot's private seed); undefined without settings (as in tests). */
  seats: StealthSeatDeps | undefined;
}

/**
 * [D90] The stealth bot for these settings (config.stealth, from STEALTH_BOT_* and STEALTH_PERSONA_POOL_MAX).
 * Built OFF: with STEALTH_BOT_ENABLED false (the default everywhere) there is no matcher, so matchmaking never
 * asks anything of it and no persona is ever made or seated; with it true, the bot still waits for an admin to
 * turn its switch on (no row in server_settings is off).
 */
export function serverStealth(
  config: ServerConfig,
  db: Db | (() => Db),
  { log, now }: { log: GameRoomLog; now: () => number },
): ServerStealth {
  const settings = config.stealth;
  const stealthSwitch = new StealthSwitch({
    available: settings?.enabled === true,
    store: dbStealthSwitchStore(db),
    now,
    log,
  });
  return {
    switch: stealthSwitch,
    matcher: serverStealthMatcher({
      settings,
      db,
      ratingOption: config.ratingOption,
      switch: stealthSwitch,
      log,
      now,
    }),
    seats: settings === undefined ? undefined : { secret: settings.secret },
  };
}

export function createAppServer({
  gracefullyShutdown = true,
  config = loadConfig(),
  db: injected,
  now = Date.now,
  telemetryLimits,
  game,
  tokens = tokenVerifierFor(config, now),
  matchmaking: matchmakingOptions = {},
  friends: friendsOptions = {},
}: AppServerOptions = {}) {
  let database = injected;
  const openDb = (): Db => {
    if (database === undefined) throw new Error('The database is not open yet');
    return database.db;
  };
  const matchmakingNow = matchmakingOptions.now ?? game?.now ?? Date.now;
  const log = game?.log ?? consoleGameLog;
  // The stealth bot [D90]: off unless STEALTH_BOT_ENABLED and the admin switch both say on.
  const stealth = serverStealth(config, openDb, { log, now: matchmakingNow });
  // Ranked games (stage 9): one matchmaking for the process; its matches open rated game rooms.
  const matchmaking = new MatchmakingService({
    store: dbMatchmakingStore(openDb),
    games: colyseusMatchGames(),
    ratingOption: config.ratingOption,
    now: matchmakingNow,
    scheduler: matchmakingOptions.scheduler ?? game?.scheduler ?? systemScheduler,
    newId: randomUUID,
    log,
    config: { ...DEFAULT_MATCHMAKING, ...matchmakingOptions.config },
    stealth: stealth.matcher,
  });
  // Blocks and unblocks (spec §3.5): told by the HTTP routes, heard by the game rooms.
  const blockWatch = new BlockWatch();
  const gameDeps = gameDepsFor(
    config,
    { matches: matchmaking, ...(stealth.seats && { stealth: stealth.seats }), ...game },
    { tokens, db: openDb, blockWatch },
  );
  // Playing with friends (1.0.4): one service for the process, shared by the HTTP routes and the rooms. Its
  // games are stored through the ranked games' persistence (unrated, games.mode 'friends').
  const ranked = gameDeps.ranked;
  const friendRooms =
    ranked === undefined
      ? undefined
      : new FriendRoomsService({
          store: dbFriendsStore(openDb, config.ratingOption),
          opener: colyseusFriendsRooms(),
          now: gameDeps.now,
          random: friendsOptions.random ?? randomInt,
          newId: randomUUID,
          log: gameDeps.log,
          rules: friendsOptions.rules,
          gameRules: friendsOptions.gameRules,
        });
  const server = defineServer({
    greet: false,
    gracefullyShutdown,
    // Our own HTTP server, guarded: a malformed Host or X-Forwarded-Proto must not reach Colyseus (http/guard).
    transport: new WebSocketTransport({ server: guardHttpServer(createServer()), ...HEARTBEAT }),
    rooms: {
      game: defineRoom(createGameRoom(gameDeps)),
      [MATCHMAKING_ROOM_NAME]: defineRoom(
        createMatchmakingRoom({
          service: matchmaking,
          identity: matchmakingIdentityVerifier({ config, tokens, db: openDb }),
          log: gameDeps.log,
          ...MATCHMAKING_ROOM_DEFAULTS,
        }),
      ),
      ...(friendRooms === undefined || ranked === undefined
        ? {}
        : {
            [FRIENDS_ROOM_NAME]: defineRoom(
              createFriendsRoom(gameDeps, { claims: friendRooms, games: friendsGameMaker(ranked) }),
            ),
          }),
      echo: defineRoom(EchoRoom),
    },
    routes: createRouter({
      health: createEndpoint('/health', { method: 'GET' }, async () => Promise.resolve(health())),
      // Cheap numbers for the debug screen and load checks; not in production.
      devMetrics: createEndpoint('/dev/metrics', { method: 'GET' }, async (ctx) => {
        if (config.nodeEnv === 'production') throw ctx.error('NOT_FOUND');
        return Promise.resolve({ ...gameDeps.metrics.report(), friends: friendRooms?.report() ?? null });
      }),
    }),
    // Colyseus runs these in order inside listen(): beforeListen, then express.
    beforeListen: async () => {
      database ??= await createDb(config);
      // Games that were running when the server stopped are gone with their rooms: ended, unrated.
      const interrupted = await endInterruptedGames(database.db, new Date(now()));
      if (interrupted.length > 0)
        console.warn(
          `[server] ${interrupted.length} ranked game(s) cut short by the restart: ended as serverRestart, ` +
            `no rating change (${interrupted.join(', ')})`,
        );
      if (config.nodeEnv !== 'test') {
        const sizes = await rankedPoolSizes(database.db);
        const empty = Object.entries(sizes).filter(([, n]) => n === 0);
        if (empty.length > 0)
          console.warn(
            `[server] no ranked puzzles for ${empty.map(([t]) => t).join(', ')}: ranked games of that type ` +
              `can't start. Load the pool with npm run db:seed-puzzles.`,
          );
      }
    },
    express: (app) => {
      if (database === undefined) throw new Error('The database must be open before the HTTP routes');
      configureHttp(app, {
        config,
        db: database.db,
        now,
        telemetryLimits,
        tokens,
        blockWatch,
        friendRooms,
        stealthSwitch: stealth.switch,
      });
    },
  });
  // An update: every friends room still waiting is told "roomClosed" (serverRestart) before the rooms go.
  server.onBeforeShutdown(async () => {
    await friendRooms?.shutdown();
  });
  server.onShutdown(async () => {
    matchmaking.close();
    if (injected === undefined) await database?.close();
  });
  return server;
}
