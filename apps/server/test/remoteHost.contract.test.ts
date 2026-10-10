/**
 * The contract between the app's online game and this server (work plan stage 7, spec §16.2, §18, §21), end
 * to end: the app's own RemoteGameHost and OnlineSession (apps/mobile/src/net and src/game, pure TypeScript,
 * the very code the phone runs; only the React Native wiring is left out) against the real server (Colyseus +
 * Express + an in-memory PGlite, a free port), through the GameHost interface the screens use.
 *
 * - A whole two-player game between two hosts, each solving from the givens with the engine's solver (the
 *   server never sends the solution of a running game): both end with the server's exact final state and
 *   result, and the solution arrives only after the end.
 * - A drop of 1 s (the socket dies and the network is down for a second): 'reconnecting', the other side sees
 *   the freeze, and once the network is back the host is in sync within 2 s (spec §18).
 * - A drop past the (shortened) grace: the other host wins by abandonment [D8], and the dropped one gives up.
 * - The app in the background (AppState): a disconnect; back in the foreground it reconnects at once.
 * - The round trip measured on 200 pings, and its p95 reported (the same machine, so tiny; the device
 *   checks measure it against staging).
 *
 * The server's ping limit is raised for the 200 pings; every other limit is the default.
 * FAKE_LOG=1 prints what the hosts say.
 */
import type { AddressInfo } from 'node:net';

import { matchMaker } from '@colyseus/core';
import type { WebSocketClient } from '@colyseus/ws-transport';
import { type Digit, type GameState, publicState, toView } from '@sudoku-fight/engine';

// The app's code (pure TypeScript, no React Native): what the phone runs.
import { OnlineSession } from '../../mobile/src/game/onlineSession';
import { createOnlineClient, type OnlineClient } from '../../mobile/src/net/onlineClient';
import {
  type AppStateLike,
  type OnlineStatus,
  RemoteGameHost,
  type RemoteHostOptions,
} from '../../mobile/src/net/remoteGameHost';
import { createAppServer } from '../src/app';
import type { Identity } from '../src/auth';
import { DEFAULT_MESSAGE_LIMITS } from '../src/game/gate';
import { GameMetrics } from '../src/game/metrics';
import { bankPuzzleSource } from '../src/game/puzzles';
import type { GameRoom } from '../src/rooms/GameRoom';
import { quietLog, testConfig } from '../src/testing';
import { solveGivens } from '../src/testing/fakeClient';

const log = quietLog();
let draws = 0;
const server = createAppServer({
  gracefullyShutdown: false,
  config: testConfig(),
  game: {
    // Real puzzles: the bank's (the offline pool outside production), in a fixed order.
    puzzles: bankPuzzleSource({ nodeEnv: 'test', random: (n) => (draws++ * 7919) % n }),
    log,
    metrics: new GameMetrics(),
    closeAfterGameMs: 1000,
    // 100 pings a second for the 200-sample round trip; the actions keep their limits (spec §21).
    limits: { ...DEFAULT_MESSAGE_LIMITS, ping: { limit: 100, windowMs: 1000 } },
    maxMessagesPerSecond: 200,
  },
});
let url = '';

beforeAll(async () => {
  await server.listen(0);
  url = `ws://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

const hosts = new Set<RemoteGameHost>();
afterEach(() => {
  for (const h of hosts) h.close();
  hosts.clear();
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

// ---- the phone ------------------------------------------------------------------------------------------

/** The phone's network, with a switch: while down, every call fails at once as `fetch` does offline. */
interface Net {
  client: OnlineClient;
  down(): void;
  up(): void;
  /** The reconnection tokens the host used (bearer secrets: they must never reach a log). */
  tokens: string[];
}

function netOf(inner: OnlineClient): Net {
  let isDown = false;
  const tokens: string[] = [];
  const offline = () => Promise.reject(new TypeError('Network request failed'));
  return {
    tokens,
    down: () => void (isDown = true),
    up: () => void (isDown = false),
    client: {
      create: (options) => (isDown ? offline() : inner.create(options)),
      join: (code) => (isDown ? offline() : inner.join(code)),
      reconnect: (token) => {
        tokens.push(token);
        return isDown ? offline() : inner.reconnect(token);
      },
      consumeSeatReservation: (reservation) =>
        isDown ? offline() : inner.consumeSeatReservation(reservation),
    },
  };
}

function fakeAppState() {
  const listeners = new Set<(state: string) => void>();
  const appState: AppStateLike & { set(state: string): void } = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    set: (state) => listeners.forEach((l) => l(state)),
  };
  return appState;
}

let ids = 0;

interface Phone {
  host: RemoteGameHost;
  net: Net;
  /** Every status the host went through. */
  statuses: OnlineStatus[];
  lines: string[];
  tracked: { name: string; props: Record<string, unknown> }[];
}

function phone(
  name: string,
  {
    appState = null,
    options = {},
  }: { appState?: AppStateLike | null; options?: Partial<RemoteHostOptions> } = {},
): Phone {
  const devUserId = `app-${name.toLowerCase()}-${++ids}`;
  const net = netOf(
    createOnlineClient({ endpoint: url, identity: () => Promise.resolve({ kind: 'dev', devUserId, name }) }),
  );
  const lines: string[] = [];
  const tracked: Phone['tracked'] = [];
  const host = new RemoteGameHost({
    client: net.client,
    clock: { now: () => Date.now() },
    scheduler: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    appState,
    track: (n, props) => tracked.push({ name: n, props }),
    log: (line) => {
      lines.push(line);
      if (process.env.FAKE_LOG) console.log(`[${name}] ${line}`);
    },
    options,
  });
  hosts.add(host);
  const statuses: OnlineStatus[] = [];
  host.subscribeOnline((info) => statuses.push(info.status));
  return { host, net, statuses, lines, tracked };
}

/** Waits until `done()` (checked every 10 ms). */
async function until(done: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Plays like a person through the GameHost interface, faster: lock an empty cell nobody holds, then its
 * answer, worked out from the givens with the engine's solver (test only: the server never sends it).
 * The pace stays under the server's limits (spec §21).
 */
function drive(host: RemoteGameHost, everyMs = 110): () => void {
  let solution: string | null = null;
  const timer = setInterval(() => {
    if (host.online.status !== 'live' || !host.online.hasGame) return;
    const v = host.getView();
    if (v.status !== 'running') return;
    solution ??= solveGivens(host.game!.config.puzzle.givens).solution;
    const me = v.players.find((p) => p.id === v.me)!;
    if (me.lock) return host.place(me.lock.cell, Number(solution[me.lock.cell]) as Digit);
    if (host.pendingCell !== null) return;
    const held = new Set(v.players.flatMap((p) => (p.lock ? [p.lock.cell] : [])));
    const cooling = new Set(v.cooldowns.map((c) => c.cell));
    const cell = v.grid.findIndex((d, i) => d === 0 && !held.has(i) && !cooling.has(i));
    if (cell >= 0) host.select(cell);
  }, everyMs);
  return () => clearInterval(timer);
}

/** A room made by `a` (its code), joined by `b`; resolves once the game runs on both. */
async function table(a: Phone, b: Phone, rules: Record<string, unknown> = {}) {
  const code = await a.host.create({
    gameType: 'fast',
    playerCount: 2,
    rules: { interferenceMs: 300, ...rules },
  });
  const room = matchMaker.getLocalRoomById(code) as GameRoom;
  await b.host.join(code.toLowerCase().replace(/^(...)/, '$1-')); // as typed: "abc-234"
  await until(
    () => [a, b].every((p) => p.host.online.status === 'live' && p.host.getView().status === 'running'),
    'the start',
  );
  return { code, room };
}

/** The server's side of a host's connection. */
function socketOf(room: GameRoom, host: RemoteGameHost): WebSocketClient {
  const client = room.clients.find((c) => (c.auth as Identity).userId === host.playerId);
  if (!client) throw new Error(`${host.playerId} has no connection`);
  return client as unknown as WebSocketClient;
}

const serverState = (room: GameRoom): GameState => publicState(room.currentGame!.state);

/** The host holds exactly the server's game, and draws it as the engine would (spec §18: evolve + toView). */
function expectInSync(host: RemoteGameHost, room: GameRoom): void {
  const final = serverState(room);
  expect(host.game).toEqual(final);
  const at = host.serverNow();
  expect(toView(host.game!, host.playerId, at)).toEqual(toView(final, host.playerId, at));
}

const inSync = (host: RemoteGameHost, room: GameRoom) =>
  host.online.status === 'live' && host.game?.seq === room.currentGame!.state.seq;

// ---------------------------------------------------------------------------------------------------------

describe("the app's RemoteGameHost on the real server", () => {
  it('two hosts play a whole game: both end with the server’s exact state and result', async () => {
    const a = phone('Moshe');
    const b = phone('Nina');
    // Host A as the game screen holds it: in an OnlineSession (its analytics).
    const tracked: { name: string; props: Record<string, unknown> }[] = [];
    const session = new OnlineSession({
      host: a.host,
      request: {
        kind: 'create',
        options: { gameType: 'fast', playerCount: 2, rules: { interferenceMs: 300 } },
      },
      track: (name, props) => tracked.push({ name, props }),
    });
    await session.ready;
    const code = session.host.roomCode!;
    const room = matchMaker.getLocalRoomById(code) as GameRoom;
    await b.host.join(code);
    await until(
      () => [a, b].every((p) => p.host.online.hasGame && p.host.getView().status === 'running'),
      'the start',
    );
    // Spec §21: no solution while the game runs.
    expect(a.host.game!.config.puzzle.solution).toBe('');
    expect(b.host.getView().solution).toBeNull();

    const stops = [drive(a.host), drive(b.host, 130)];
    await until(() => [a, b].every((p) => p.host.getView().status === 'over'), 'the end', 60_000);
    stops.forEach((stop) => stop());
    await until(() => a.host.solution !== null && b.host.solution !== null, 'the solution');

    const final = serverState(room);
    expect(final.status).toBe('over');
    expect(final.result?.reason).toBe('boardComplete');
    for (const p of [a, b]) {
      expectInSync(p.host, room);
      const view = p.host.getView();
      expect(view.result).toEqual(final.result);
      expect(view.solution).toBe(final.config.puzzle.solution);
      expect(p.host.solution).toBe(final.config.puzzle.solution);
    }
    const [first, second] = final.result!.ranking;
    expect(first!.score).toBeGreaterThanOrEqual(second!.score);
    expect(first!.correct + second!.correct).toBe(
      [...final.config.puzzle.givens].filter((d) => d === '0').length,
    );

    // The measures of spec §18 were taken along the way.
    for (const p of [a, b]) {
      const m = p.host.metrics.summary();
      expect(m.action.count).toBeGreaterThan(5);
      expect(m.action.p95).toBeLessThan(150);
      expect(m.c2s.count).toBeGreaterThan(0);
      expect(m.s2c.count).toBeGreaterThan(0);
      expect(Math.abs(p.host.sync.offsetMs)).toBeLessThan(50); // one machine, one clock
    }
    // The session's analytics (spec §22): one start, one end, with this player's result.
    const mine = final.result!.ranking.find((r) => r.playerId === a.host.playerId)!;
    expect(tracked).toEqual([
      { name: 'game_start', props: { mode: 'ranked', type: 'fast', players: 2 } },
      {
        name: 'game_end',
        props: {
          mode: 'ranked',
          result: mine.place === 1 ? (first!.score === second!.score ? 'tie' : 'win') : 'loss',
          score: mine.score,
          mistakes: mine.mistakes,
          durationSec: Math.round(final.result!.durationMs / 1000),
        },
      },
    ]);
    // The room closes after the game; the host says why.
    await until(() => a.host.online.status === 'closed', 'the room closing', 5000);
    expect(a.host.online.closeReason).toBe('gameOver');
  }, 90_000);

  it('a drop of 1 s: reconnecting, the other sees the freeze, and back in sync within 2 s', async () => {
    const a = phone('Moshe');
    const b = phone('Nina');
    const { room } = await table(a, b, { graceMs: 15_000 });
    const stop = drive(a.host);
    await until(() => a.host.getView().players.some((p) => p.correct > 0), 'a move');
    stop();
    await until(() => inSync(b.host, room), 'b current');

    b.net.down();
    socketOf(room, b.host).ref.terminate();
    await until(() => b.host.online.status === 'reconnecting', 'reconnecting', 2000);
    // Spec §16.2: the other side's game freezes, and it sees the countdown of the server's grace.
    await until(() => a.host.getView().status === 'paused', 'the freeze', 2000);
    const away = a.host.getView().players.find((p) => p.id === b.host.playerId)!;
    expect(away.connected).toBe(false);
    expect(away.graceEndsAt).not.toBeNull();
    expect(away.graceEndsAt! - a.host.serverNow()).toBeGreaterThan(13_000);
    expect(a.host.online.status).toBe('live');

    await new Promise((r) => setTimeout(r, 1000));
    expect(b.host.online.reconnect?.attempt).toBeGreaterThanOrEqual(2); // "ניסיון 2"
    const upAt = Date.now();
    b.net.up();
    await until(() => inSync(b.host, room) && b.host.metrics.sync.count === 1, 'in sync again', 2000);
    const syncedMs = Date.now() - upAt;
    expect(syncedMs).toBeLessThan(2000);
    expectInSync(b.host, room);
    await until(
      () => a.host.getView().status === 'running' && inSync(a.host, room),
      'the game resumed',
      2000,
    );
    expect(b.statuses).toContain('reconnecting');
    expect(b.tracked).toContainEqual({
      name: 'reconnect',
      props: { durationMs: expect.any(Number), success: true },
    });
    console.log(
      `[stage 7] back in sync ${syncedMs} ms after the network returned; reconnect ` +
        `${b.host.metrics.reconnect.summary().last} ms, sync ${b.host.metrics.sync.summary().last} ms`,
    );
    // The reconnection token is a bearer secret: never in a log.
    expect(b.net.tokens.length).toBeGreaterThan(0);
    for (const token of b.net.tokens) expect(b.lines.join('\n')).not.toContain(token);
  }, 30_000);

  it('a drop past the grace: the other host wins by abandonment, the dropped one gives up', async () => {
    const a = phone('Moshe');
    const b = phone('Nina', { options: { serverNoticeMs: 0 } });
    const { room } = await table(a, b, { graceMs: 1500 });

    b.net.down();
    socketOf(room, b.host).ref.terminate();
    await until(() => a.host.getView().status === 'over', 'the abandonment', 5000);
    const view = a.host.getView();
    expect(view.result?.reason).toBe('lastPlayerStanding');
    expect(view.players.find((p) => p.id === b.host.playerId)?.status).toBe('abandoned');
    expect(view.result?.ranking.find((r) => r.playerId === a.host.playerId)?.place).toBe(1);
    await until(() => a.host.solution !== null, 'the solution after the end');
    expectInSync(a.host, room);

    await until(() => b.host.online.status === 'closed', 'giving up', 6000);
    expect(b.host.online.closeReason).toBe('lostConnection');
    expect(b.tracked).toContainEqual({
      name: 'reconnect',
      props: { durationMs: expect.any(Number), success: false },
    });
  }, 30_000);

  it('the app in the background is a disconnect; back in the foreground it reconnects at once', async () => {
    const app = fakeAppState();
    const a = phone('Moshe', { appState: app });
    const b = phone('Nina');
    const { room } = await table(a, b, { graceMs: 15_000 });

    app.set('background');
    expect(a.host.online.status).toBe('reconnecting');
    expect(a.host.online.reconnect).toMatchObject({ cause: 'background', attempt: 0 });
    await until(() => b.host.getView().status === 'paused', 'the freeze', 3000);
    await new Promise((r) => setTimeout(r, 500));
    // Still waiting: nothing is tried while in the background.
    expect(a.net.tokens).toEqual([]);

    const activeAt = Date.now();
    app.set('active');
    await until(() => inSync(a.host, room) && a.host.metrics.sync.count === 1, 'in sync again', 2000);
    expect(Date.now() - activeAt).toBeLessThan(2000);
    await until(() => b.host.getView().status === 'running', 'the game resumed', 2000);
    expectInSync(a.host, room);
  }, 30_000);

  it('the round trip on 200 pings: p95 reported (spec §18; staging is checked on the phones)', async () => {
    const c = phone('Aiko', {
      options: { pingEveryMs: 10, pingLimit: { limit: 100, windowMs: 1000 }, clock: { rttWindow: 200 } },
    });
    await c.host.create({ gameType: 'fast', playerCount: 2 });
    await until(() => c.host.sync.rtt.total >= 200, '200 pongs', 15_000);
    const rtt = c.host.sync.rtt.summary();
    console.log(
      `[stage 7] RTT over ${rtt.count} pings: p50 ${rtt.p50} ms, p95 ${rtt.p95} ms, max ${rtt.max} ms`,
    );
    expect(rtt.count).toBe(200);
    expect(rtt.p95).not.toBeNull();
    expect(rtt.p95!).toBeLessThan(150);
    expect(Math.abs(c.host.sync.offsetMs)).toBeLessThan(50);
  }, 30_000);
});
