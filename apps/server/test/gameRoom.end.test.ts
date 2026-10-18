/**
 * The end of a game and a player who was away when it came (Moshe's device test of 1.0.0, 15.10.2026: the
 * opponent gave up, or he did, and his screen went black). The room of a finished game stays until every
 * player has had the end, up to closeAfterGameMs: back by the reconnection token or by code, a player who was
 * away gets the finished snapshot and the solution, and with them the result. Once everyone has had it, an
 * empty room closes at once, as before.
 *
 * The real server (Colyseus + Express + an in-memory PGlite, one port) with real SDK clients over WebSocket,
 * a short soft phase [D42] and grace per room (dev create options) and a finished room's ceiling of 4 s.
 */
import type { AddressInfo } from 'node:net';

import { matchMaker } from '@colyseus/core';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { ColyseusTestServer } from '@colyseus/testing';
import type { ClientAction, GameEvent, GameEventType } from '@sudoku-fight/engine';
import {
  GAME_ROOM_NAME,
  type GameRoomCreateOptions,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { GameMetrics } from '../src/game/metrics';
import { PUZZLE, quietLog, testConfig, testPuzzles } from '../src/testing';

const CLOSE_AFTER_GAME_MS = 4000;
/** A dropped player's seat is held for the soft phase of a lost connection [D42] and the grace after it. */
const SOFT_GRACE_MS = 400;
const GRACE_MS = 800;

const log = quietLog();
const metrics = new GameMetrics();
const server = createAppServer({
  gracefullyShutdown: false,
  config: testConfig(),
  game: { puzzles: testPuzzles, log, metrics, closeAfterGameMs: CLOSE_AFTER_GAME_MS },
});
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  await server.listen(0);
  const { port } = server.transport.server!.address() as AddressInfo;
  Object.assign(server, { port });
  colyseus = new ColyseusTestServer(server);
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

const nameOf = (id: string) => id[0]!.toUpperCase() + id.slice(1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A player: an SDK room and everything it received, in order. */
class Player {
  readonly messages: ServerMessage[] = [];
  left: number | null = null;
  seq = 0;
  private readonly waiters = new Set<() => void>();

  constructor(
    readonly room: SdkRoom,
    readonly id: string,
  ) {
    room.reconnection.enabled = false; // the tests come back by hand
    for (const type of SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m: ServerMessage) => {
        this.messages.push(m);
        this.notify();
      });
    room.onLeave((code: number) => {
      this.left = code;
      this.notify();
    });
  }

  get code(): string {
    return this.room.roomId;
  }

  act(action: ClientAction): void {
    this.room.send(action.type, { ...action, clientSeq: ++this.seq });
  }

  get events(): GameEvent[] {
    return this.messages.flatMap((m) => (m.type === 'events' ? m.events : []));
  }

  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }

  until<T>(find: () => T | undefined | null | false, what: string, ms = 4000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const check = () => {
        const found = find();
        if (!found) return;
        done();
        resolve(found);
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`${this.id}: no ${what} within ${ms} ms`));
      }, ms);
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
      };
      this.waiters.add(check);
      check();
    });
  }

  event<T extends GameEventType>(type: T): Promise<Extract<GameEvent, { type: T }>> {
    return this.until(
      () => this.events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type),
      type,
    );
  }

  message<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    return this.until(() => this.of(type)[0], `${type} message`);
  }

  private notify(): void {
    for (const w of [...this.waiters]) w();
  }
}

const joinOptions = (id: string) => ({ devUserId: id, name: nameOf(id) });

async function startTwo(options: Partial<GameRoomCreateOptions> = {}): Promise<[Player, Player]> {
  const room = await colyseus.sdk.create(GAME_ROOM_NAME, {
    private: true,
    ...joinOptions('ana'),
    rules: { graceMs: GRACE_MS, softGraceMs: SOFT_GRACE_MS },
    ...options,
  });
  const ana = new Player(room, 'ana');
  const ben = new Player(await colyseus.sdk.joinById(ana.code, joinOptions('ben')), 'ben');
  await Promise.all([ana.event('gameStarted'), ben.event('gameStarted')]);
  return [ana, ben];
}

const roomAlive = (code: string) => matchMaker.getLocalRoomById(code) !== undefined;

/** Waits until the room has gone (disposed); resolves with how long that took. */
async function roomGone(code: string, ms: number): Promise<number> {
  const started = Date.now();
  while (roomAlive(code)) {
    if (Date.now() - started > ms) throw new Error(`room ${code} still open after ${ms} ms`);
    await sleep(50);
  }
  return Date.now() - started;
}

describe('a finished game’s room and a player who was away', () => {
  it('away when the game ended, back by code after the token’s time: the finished game and the solution', async () => {
    const [ana, ben] = await startTwo();
    const code = ana.code;
    void ana.room.leave(false); // ana's phone goes dark (no goodbye)
    await ben.event('playerConnectionLost'); // only a mark: the game goes on [D42]
    ben.act({ type: 'surrender' });
    expect(await ben.event('gameOver')).toMatchObject({ reason: 'lastPlayerStanding' });
    await ben.message('solution');
    await ben.room.leave();
    // ana's seat was held for her soft phase and grace (+ 1 s); that is long gone, and the room still waits for
    // her.
    await sleep(SOFT_GRACE_MS + GRACE_MS + 1500);
    expect(roomAlive(code)).toBe(true);

    const back = new Player(await colyseus.sdk.joinById(code, joinOptions('ana')), 'ana');
    const snapshot = await back.message('snapshot');
    expect(snapshot.state.status).toBe('over');
    expect(snapshot.state.result?.ranking.map((r) => [r.playerId, r.place])).toEqual([
      ['ana', 1],
      ['ben', 2],
    ]);
    expect(await back.message('solution')).toEqual({ type: 'solution', solution: PUZZLE.solution });
    // Everyone has had the end: once she leaves, the room closes at once (not at the ceiling).
    await back.room.leave();
    expect(await roomGone(code, 2500)).toBeLessThan(2500);
  });

  it('a drop after the end keeps the seat: back with the reconnection token, the end again', async () => {
    const [ana, ben] = await startTwo();
    const code = ana.code;
    ben.act({ type: 'surrender' });
    await Promise.all([ana.message('solution'), ben.message('solution')]);
    const token = ana.room.reconnectionToken;
    void ana.room.leave(false);
    await ben.room.leave();
    await sleep(1500);
    expect(roomAlive(code)).toBe(true);

    const back = new Player(await colyseus.sdk.reconnect(token), 'ana');
    expect((await back.message('snapshot')).state.status).toBe('over');
    expect(await back.message('solution')).toEqual({ type: 'solution', solution: PUZZLE.solution });
    await back.room.leave();
    await roomGone(code, 2500);
  });

  it('everyone had the end and left: the room closes at once, not after closeAfterGameMs', async () => {
    const [ana, ben] = await startTwo();
    const code = ana.code;
    ben.act({ type: 'surrender' });
    await Promise.all([ana.message('solution'), ben.message('solution')]);
    await Promise.all([ana.room.leave(), ben.room.leave()]);
    expect(await roomGone(code, 2500)).toBeLessThan(2000);
    // And a late join finds nothing.
    await expect(colyseus.sdk.joinById(code, joinOptions('ana'))).rejects.toThrow();
  });

  it('closeAfterGameMs is the ceiling: a player who never comes back does not keep the room', async () => {
    const [ana, ben] = await startTwo();
    const code = ana.code;
    void ana.room.leave(false);
    await ben.event('playerDisconnected'); // after her soft phase [D42]: the grace runs when the game ends
    ben.act({ type: 'surrender' });
    await ben.message('solution');
    const overAt = Date.now();
    await ben.room.leave();
    await sleep(CLOSE_AFTER_GAME_MS - 1000);
    expect(roomAlive(code)).toBe(true);
    await roomGone(code, 3000);
    expect(Date.now() - overAt).toBeLessThan(CLOSE_AFTER_GAME_MS + 2000);
  }, 15_000);

  it('logged nothing unexpected', () => {
    expect(log.errors).toEqual([]);
  });
});
