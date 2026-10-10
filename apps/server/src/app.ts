import { randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ENGINE_VERSION, type Scheduler } from '@sudoku-fight/engine';
import { MATCHMAKING_ROOM_NAME, PROTOCOL_VERSION } from '@sudoku-fight/protocol';

import { roomIdentityVerifier } from './accounts/identity';
import { defaultIdentityVerifier } from './auth';
import { type TokenVerifier, tokenVerifierFor } from './auth/firebaseToken';
import { DEFAULT_PORT, loadConfig, type ServerConfig } from './config';
import { createDb, type Database, type Db } from './db';
import { bankPuzzleSource } from './game/puzzles';
import { configureHttp, type HttpDeps } from './http';
import { guardHttpServer } from './http/guard';
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
import { rankedGames } from './persistence';
import { dbPuzzleSource, rankedPoolSizes } from './puzzles';
import { EchoRoom } from './rooms/EchoRoom';
import {
  consoleGameLog,
  createGameRoom,
  type GameRoomDeps,
  gameRoomDeps,
  systemScheduler,
} from './rooms/GameRoom';

/**
 * The game server (spec §17, §18), all on one port:
 * - Colyseus: the WebSocket transport, the `game` room (rooms/GameRoom, stage 7), the `echo` room for the
 *   round-trip check, GET /health, and outside production GET /dev/metrics (action handling times); the
 *   `matchmaking` room (stage 9: src/matchmaking), whose matches open rated `game` rooms.
 * - Express (src/http): POST /v1/events (stage 7א), and the admin site next.
 * - The database (src/db): opened and migrated before the server listens, closed on shutdown.
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
 * after its last answer, 3–4.5 s here, and only then does its grace start (spec §16.2). The stage 7 checks
 * need that well under 5 s: 5 s of airplane mode must show the other player "Reconnecting… 15", and 20 s must
 * end in abandonment (15 s of grace after the drop is noticed). A healthy connection answers within a round
 * trip; it takes 3 s without any answer to be cut (a stall that long is a drop, and the app reconnects).
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
}

/** What the game room needs to know players by their accounts (stage 8). */
export interface GameAccounts {
  tokens: TokenVerifier;
  db: Db | (() => Db);
}

/**
 * The game room's dependencies for these settings. With `accounts`, players are known by their accounts
 * (roomIdentityVerifier), and rated rooms have the database (persistence/rankedGames: ranked-pool puzzles
 * without repeats, ratings, the game stored); without, players are known by auth/identity's
 * defaultIdentityVerifier and rated rooms are refused (no database).
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
            }),
      ...overrides,
    },
  );
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
}: AppServerOptions = {}) {
  let database = injected;
  const openDb = (): Db => {
    if (database === undefined) throw new Error('The database is not open yet');
    return database.db;
  };
  // Ranked games (stage 9): one matchmaking for the process; its matches open rated game rooms.
  const matchmaking = new MatchmakingService({
    store: dbMatchmakingStore(openDb),
    games: colyseusMatchGames(),
    ratingOption: config.ratingOption,
    now: matchmakingOptions.now ?? game?.now ?? Date.now,
    scheduler: matchmakingOptions.scheduler ?? game?.scheduler ?? systemScheduler,
    newId: randomUUID,
    log: game?.log ?? consoleGameLog,
    config: { ...DEFAULT_MATCHMAKING, ...matchmakingOptions.config },
  });
  const gameDeps = gameDepsFor(config, { matches: matchmaking, ...game }, { tokens, db: openDb });
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
      echo: defineRoom(EchoRoom),
    },
    routes: createRouter({
      health: createEndpoint('/health', { method: 'GET' }, async () => Promise.resolve(health())),
      // Cheap numbers for the debug screen and load checks; not in production.
      devMetrics: createEndpoint('/dev/metrics', { method: 'GET' }, async (ctx) => {
        if (config.nodeEnv === 'production') throw ctx.error('NOT_FOUND');
        return Promise.resolve(gameDeps.metrics.report());
      }),
    }),
    // Colyseus runs these in order inside listen(): beforeListen, then express.
    beforeListen: async () => {
      database ??= await createDb(config);
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
      configureHttp(app, { config, db: database.db, now, telemetryLimits, tokens });
    },
  });
  server.onShutdown(async () => {
    matchmaking.close();
    if (injected === undefined) await database?.close();
  });
  return server;
}
