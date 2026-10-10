/**
 * Stage 7 end to end: the real server (Colyseus + Express + an in-memory PGlite) on a free port, and fake
 * clients (src/testing/fakeClient) that play over WebSocket the way people do: the engine bot's think times
 * and mistakes (sped up 50 times), within the server's rate limits, solving the puzzle themselves from the
 * givens because the server never sends the solution of a running game.
 *
 * - A full two-player game on a real bank puzzle: both clients end with the server's exact final state, and
 *   the ranking is the engine's ranking of it.
 * - A drop of 1 s: the other side sees the freeze, the dropped client comes back with its reconnection token,
 *   and both are in sync within 2 s (spec §18).
 * - A connection that dies by itself (the server's socket is cut): the client reconnects on its own.
 * - A client that leaves for good, or stays away longer than the grace (airplane mode), is abandoned after
 *   the (shortened) grace, and the other wins [D8, D32].
 * - A code that is no room: a clear refusal.
 * - The command line (scripts/fake-client.ts) creates a room, prints its code, plays and prints a summary.
 *
 * FAKE_LOG=1 prints what the fake clients say.
 */
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { matchMaker } from '@colyseus/core';
import type { WebSocketClient } from '@colyseus/ws-transport';
import { type GameEvent, type GameEventType, publicState, rankPlayers, replay } from '@sudoku-fight/engine';

import { createAppServer } from '../src/app';
import type { Identity } from '../src/auth';
import { GameMetrics } from '../src/game/metrics';
import { bankPuzzleSource } from '../src/game/puzzles';
import type { ServerGame } from '../src/game/serverGame';
import type { GameRoom } from '../src/rooms/GameRoom';
import { quietLog, testConfig } from '../src/testing';
import {
  FakeClient,
  type FakeClientOptions,
  type FakeClientSummary,
  type FakeResync,
} from '../src/testing/fakeClient';

const log = quietLog();
const metrics = new GameMetrics();
// Real puzzles: the bank's 'fast' ones (the offline pool outside production), in a fixed order.
let draws = 0;
const server = createAppServer({
  gracefullyShutdown: false,
  config: testConfig(),
  game: {
    puzzles: bankPuzzleSource({ nodeEnv: 'test', random: (n) => (draws++ * 7919) % n }),
    log,
    metrics,
    closeAfterGameMs: 1000,
  },
});
let url = '';

beforeAll(async () => {
  await server.listen(0); // a free port
  const { port } = server.transport.server!.address() as AddressInfo;
  url = `ws://127.0.0.1:${port}`;
}, 30_000);

afterAll(async () => {
  await Promise.all([...clients].map((c) => c.stop()));
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

// ---------------------------------------------------------------------------------------------------------

/** Fifty times a person's pace, no lock left to run out on purpose (8 s each), a ping every 400 ms. */
const QUICK: Partial<FakeClientOptions> = {
  thinkScale: 0.02,
  botConfig: { lingerShare: 0 },
  pingEveryMs: 400,
};

const clients = new Set<FakeClient>();

async function connect(options: Omit<FakeClientOptions, 'url'>): Promise<FakeClient> {
  const say = process.env.FAKE_LOG ? (line: string) => console.log(`[${options.name}] ${line}`) : undefined;
  const client = await FakeClient.connect({ url, log: say, ...QUICK, ...options });
  clients.add(client);
  return client;
}

type CreateOptions = NonNullable<FakeClientOptions['create']>;

/** Two fake players in a new room; resolves once the game has started on the server. */
async function pair(
  create: CreateOptions,
  ana: Partial<FakeClientOptions> = {},
  ben: Partial<FakeClientOptions> = {},
): Promise<{ ana: FakeClient; ben: FakeClient; game: ServerGame; room: GameRoom }> {
  const a = await connect({ name: 'Ana', seed: 11, create, ...ana });
  const room = matchMaker.getLocalRoomById(a.code) as GameRoom;
  const b = await connect({ name: 'Ben', seed: 22, code: a.code, ...ben });
  // The game starts in the room's onJoin of the last player, before the join is answered.
  return { ana: a, ben: b, game: room.currentGame!, room };
}

/** The events a client applies, with the wall time it got them. */
function eventLog(client: FakeClient): { e: GameEvent; at: number }[] {
  const seen: { e: GameEvent; at: number }[] = [];
  client.onUpdate((u) => {
    if (u.kind === 'events') for (const e of u.events) seen.push({ e, at: Date.now() });
  });
  return seen;
}

const first = (seen: { e: GameEvent; at: number }[], type: GameEventType) =>
  seen.find((x) => x.e.type === type);

function nextResync(client: FakeClient): Promise<FakeResync> {
  return new Promise((resolve) => {
    const off = client.onUpdate((u) => {
      if (u.kind !== 'resynced') return;
      off();
      resolve(u.resync);
    });
  });
}

/** What every finished client must show: a whole mirror, measures taken, its own solution confirmed. */
function expectHealthy(s: FakeClientSummary): void {
  expect(s.error).toBeNull();
  expect(s.seqGaps).toBe(0);
  expect(s.leaks).toBe(0);
  expect(s.solutionMatches).toBe(true);
  expect(s.rtt.count).toBeGreaterThan(0);
  expect(s.rtt.p95Ms).toBeLessThan(150); // spec §18 (here: the same machine)
  expect(s.actions.count).toBeGreaterThan(0);
  expect(s.actions.p95Ms).toBeLessThan(150);
  expect(s.clockOffsetMs).not.toBeNull();
  expect(Math.abs(s.clockOffsetMs!)).toBeLessThan(50); // one clock on one machine
}

const emptyCount = (givens: string) => [...givens].filter((c) => c === '0').length;

/** Waits until `done()` (checked every 20 ms). */
async function until(done: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ---------------------------------------------------------------------------------------------------------

describe('fake players on the real server', () => {
  it('play a full two-player game: the server ranks it, and both hold its exact final state', async () => {
    const { ana, ben, game } = await pair({ rules: { interferenceMs: 300 } });
    const [a, b] = await Promise.all([ana.done, ben.done]);

    for (const s of [a, b]) {
      expect(s.outcome).toBe('over');
      expect(s.endReason).toBe('boardComplete');
      expect(s.status).toBe('active');
      expect(s.resyncs).toEqual([]);
      expectHealthy(s);
    }
    // The server's final state, solution included now (spec §21: after the end), is what both hold.
    const final = publicState(game.state);
    expect(final.status).toBe('over');
    expect(ana.state).toEqual(final);
    expect(ben.state).toEqual(final);
    expect(final.grid.join('')).toBe(final.config.puzzle.solution);
    expect(ana.solution).toBe(final.config.puzzle.solution);

    // The ranking: the engine's own, by score; each client reports its line of it.
    const ranking = final.result!.ranking;
    expect(ranking).toEqual(rankPlayers(final));
    expect(ranking.map((r) => r.playerId).sort()).toEqual([ana.playerId, ben.playerId].sort());
    expect(ranking[0]!.score).toBeGreaterThanOrEqual(ranking[1]!.score);
    for (const [client, s] of [
      [ana, a],
      [ben, b],
    ] as const) {
      const line = ranking.find((r) => r.playerId === client.playerId)!;
      expect([s.place, s.score, s.mistakes, s.correct]).toEqual([
        line.place,
        line.score,
        line.mistakes,
        line.correct,
      ]);
      expect(s.ranking).toEqual(ranking);
    }
    // Every empty cell was solved by one of them.
    expect(a.correct! + b.correct!).toBe(emptyCount(final.config.puzzle.givens));
  }, 40_000);

  it('a drop of 1 s: the other sees the freeze, the dropped one comes back, and both are in sync within 2 s', async () => {
    const { ana, ben, game } = await pair(
      { rules: { graceMs: 3000, interferenceMs: 300 } },
      { trouble: { dropAfterMs: 800, dropForMs: 1000 } },
    );
    const benSaw = eventLog(ben);
    const back = await nextResync(ana);

    expect(back.via).toBe('reconnect');
    expect(back.downMs).toBeGreaterThanOrEqual(1000);
    expect(back.syncMs).toBeLessThan(2000); // spec §18: back in sync within 2 s
    // Ben saw the drop and the freeze, then the return, within 2 s of Ana trying to come back.
    const dropped = first(benSaw, 'playerDisconnected')!;
    expect(dropped.e).toMatchObject({ playerId: ana.playerId });
    expect(first(benSaw, 'gamePaused')).toBeDefined();
    const resumed = first(benSaw, 'gameResumed')!;
    expect(resumed.e).toMatchObject({ reason: 'reconnect' });
    expect(resumed.at - back.startedAt).toBeLessThan(2000);

    // In sync: at the seq where Ana was whole again, Ana, Ben and the server's own log agree exactly.
    const serverThen = publicState(replay(game.events)[back.seq - 1]!);
    expect(ana.mirror.stateAt(back.seq)).toEqual(serverThen);
    expect(ben.mirror.stateAt(back.seq)).toEqual(serverThen);
    expect(serverThen.status).toBe('running');

    // And they play on to the end, still in step with the server.
    const [a, b] = await Promise.all([ana.done, ben.done]);
    expect([a.outcome, b.outcome]).toEqual(['over', 'over']);
    expect(a.endReason).toBe('boardComplete');
    expect(a.resyncs).toHaveLength(1);
    expect(b.resyncs).toEqual([]);
    for (const s of [a, b]) expectHealthy(s);
    const final = publicState(game.state);
    expect(ana.state).toEqual(final);
    expect(ben.state).toEqual(final);
  }, 40_000);

  it('a player who leaves for good is abandoned after the grace, and the other wins [D8, D32]', async () => {
    const { ana, ben, game } = await pair(
      { rules: { graceMs: 1000 } },
      {},
      { trouble: { leaveAfterMs: 600 } },
    );
    const anaSaw = eventLog(ana);
    const [a, b] = await Promise.all([ana.done, ben.done]);

    expect(b.outcome).toBe('left');
    expect(b.ranking).toBeNull(); // gone before the end
    expect(a.outcome).toBe('over');
    expect(a.endReason).toBe('lastPlayerStanding');
    expect(a.place).toBe(1);
    expect(a.ranking!.map((r) => [r.playerId, r.place, r.status])).toEqual([
      [ana.playerId, 1, 'active'],
      [ben.playerId, 2, 'abandoned'],
    ]);
    // The grace ran on the server, from the leave to the abandonment (stamped at the deadline).
    const dropped = first(anaSaw, 'playerDisconnected')!.e as Extract<
      GameEvent,
      { type: 'playerDisconnected' }
    >;
    const abandoned = first(anaSaw, 'playerAbandoned')!.e;
    expect(dropped.graceEndsAt - dropped.t).toBe(1000);
    expect(abandoned.t).toBe(dropped.graceEndsAt);
    expectHealthy(a);
    expect(ana.state).toEqual(publicState(game.state));
  }, 30_000);

  it('a connection that dies by itself: the client reconnects on its own, and they finish in step', async () => {
    const { ana, ben, game, room } = await pair({ rules: { graceMs: 3000, interferenceMs: 300 } });
    const back = nextResync(ana);
    await until(() => game.events.filter((e) => e.type === 'placedCorrect').length > 4, 'a few moves');
    // The network fails: Ana's socket is cut on the server's side, with no close handshake (1006 for Ana).
    const socket = room.clients.find((c) => (c.auth as Identity).userId === ana.playerId)!;
    (socket as unknown as WebSocketClient).ref.terminate();

    const r = await back;
    expect(r.via).toBe('reconnect');
    expect(r.syncMs).toBeLessThan(2000);
    const [a, b] = await Promise.all([ana.done, ben.done]);
    expect([a.outcome, b.outcome]).toEqual(['over', 'over']);
    expect(a.endReason).toBe('boardComplete');
    expect(a.resyncs).toHaveLength(1);
    for (const s of [a, b]) expectHealthy(s);
    expect(ana.state).toEqual(publicState(game.state));
    expect(ben.state).toEqual(publicState(game.state));
  }, 40_000);

  it('away longer than the grace (airplane mode): abandoned, the other wins, and there is no way back', async () => {
    const { ana, ben } = await pair(
      { rules: { graceMs: 1000 } },
      { trouble: { dropAfterMs: 300, dropForMs: 2500 } },
    );
    const [a, b] = await Promise.all([ana.done, ben.done]);

    expect(b).toMatchObject({ outcome: 'over', endReason: 'lastPlayerStanding', place: 1 });
    expect(b.ranking!.map((r) => [r.playerId, r.status])).toEqual([
      [ben.playerId, 'active'],
      [ana.playerId, 'abandoned'],
    ]);
    expectHealthy(b);
    // By the time Ana is back, her seat and the room are gone.
    expect(a.outcome).toBe('lostConnection');
    expect(a.error).toContain('could not come back');
    expect(a.resyncs).toEqual([]);
  }, 30_000);

  it('a code that is no room: refused, with the reason', async () => {
    await expect(connect({ name: 'Zed', code: 'ZZZ-ZZZ' })).rejects.toThrow('not found');
    await expect(connect({ name: 'Zed', code: 'nope' })).rejects.toThrow('not a room code');
  });

  it('the command line: creates a room, prints its code, plays, surrenders and prints a JSON summary', async () => {
    const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
    const args = ['scripts/fake-client.ts', '--url', url, '--create', '--name', 'Cli1', '--speed', '50'];
    args.push('--surrender-after', '1', '--seed', '7', '--json', '--ping-every', '300');
    const child = spawn(process.execPath, [tsx, ...args], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'development' },
    });
    try {
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no room code within 15 s:\n${out}\n${err}`)),
          15_000,
        );
        const look = () => {
          const m = /room code ([A-Z0-9]{6}) /.exec(out);
          if (!m) return;
          clearTimeout(timer);
          resolve(m[1]!);
        };
        child.stdout.on('data', look);
        void exited.then(() => reject(new Error(`exited before the code:\n${out}\n${err}`)));
      });

      const ana = await connect({ name: 'Ana', code });
      const [a, exitCode] = await Promise.all([ana.done, exited]);
      expect(err).toBe('');
      expect(exitCode).toBe(0);
      const json = out.trim().split('\n').at(-1)!;
      const cli = JSON.parse(json) as FakeClientSummary;
      expect(cli).toMatchObject({
        name: 'Cli1',
        playerId: 'fake-Cli1',
        code,
        outcome: 'over',
        endReason: 'lastPlayerStanding',
        place: 2,
        status: 'surrendered',
        solutionMatches: true,
        seed: 7,
        level: 3,
      });
      expect(cli.rtt.count).toBeGreaterThan(0);
      expect(a.place).toBe(1);
      expect(a.ranking!.map((r) => r.status)).toEqual(['active', 'surrendered']);
    } finally {
      if (child.exitCode === null) child.kill();
    }
  }, 40_000);
});

describe('what the server saw', () => {
  it('the fake players kept to the rate limits and the clientSeq rules, and nothing failed', () => {
    const report = metrics.report();
    expect(report.games.over).toBe(report.games.started);
    expect(report.dropped).toEqual({ unknownType: 0, malformed: 0, rateLimited: 0, duplicate: 0 });
    expect(report.kicks).toBe(0);
    expect(report.actions.count).toBeGreaterThan(100);
    expect(report.actions.p95Ms).toBeLessThan(50);
    expect(log.errors).toEqual([]);
  });
});
