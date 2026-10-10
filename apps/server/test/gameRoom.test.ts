/**
 * Stage 7: the game room on the real server (Colyseus + Express + an in-memory PGlite, one port), with real
 * SDK clients over WebSocket. Two players join by code, play, drop and come back, abandon and surrender.
 *
 * Real time, so the rules that take time are shortened per room through the dev create options (a grace
 * period of a fraction of a second), and a finished room closes after 300 ms.
 */
import type { AddressInfo } from 'node:net';

import { CloseCode } from '@colyseus/core';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { ColyseusTestServer } from '@colyseus/testing';
import {
  type ClientAction,
  evolve,
  type GameEvent,
  type GameEventType,
  type GameState,
  publicState,
} from '@sudoku-fight/engine';
import {
  type ClientMessageType,
  GAME_ROOM_NAME,
  type GameRoomCreateOptions,
  type GameRoomError,
  gameRoomErrorOf,
  normalizeRoomCode,
  PROTOCOL_VERSION,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { GameMetrics, type GameMetricsReport } from '../src/game/metrics';
import type { GameRoom } from '../src/rooms/GameRoom';
import {
  digitAt,
  emptyCells,
  NEARLY_DONE,
  PUZZLE,
  quietLog,
  testConfig,
  testPuzzles,
  wrongDigitAt,
} from '../src/testing';

const log = quietLog();
const metrics = new GameMetrics();
const server = createAppServer({
  gracefullyShutdown: false,
  config: testConfig(),
  game: { puzzles: testPuzzles, log, metrics, closeAfterGameMs: 300 },
});
let colyseus: ColyseusTestServer;
let url = '';

beforeAll(async () => {
  await server.listen(0); // a free port
  const { port } = server.transport.server!.address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
  // ColyseusTestServer builds its SDK client from the port the server was asked for (0 here).
  Object.assign(server, { port });
  colyseus = new ColyseusTestServer(server);
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

// ---------------------------------------------------------------------------------------------------------
// A player: an SDK room and everything it received, in order.

const [C1, C2, C3, C4] = emptyCells(PUZZLE) as [number, number, number, number];
const nameOf = (id: string) => id[0]!.toUpperCase() + id.slice(1);

class Player {
  readonly messages: ServerMessage[] = [];
  /** The close code once the connection is gone. */
  left: number | null = null;
  seq = 0;
  private readonly waiters = new Set<() => void>();

  constructor(
    readonly room: SdkRoom,
    readonly id: string,
  ) {
    room.reconnection.enabled = false; // tests reconnect by hand
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

  /** Sends an action with the next clientSeq; returns the clientSeq. */
  act(action: ClientAction): number {
    const clientSeq = ++this.seq;
    this.room.send(action.type, { ...action, clientSeq });
    return clientSeq;
  }

  /** Sends anything (for the malformed and the duplicates). */
  raw(type: string, payload?: unknown): void {
    this.room.send(type, payload);
  }

  /** Every event received, in order. */
  get events(): GameEvent[] {
    return this.messages.flatMap((m) => (m.type === 'events' ? m.events : []));
  }

  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }

  /** Waits until `find` returns something truthy. */
  until<T>(find: () => T | undefined | null | false, what = 'a message', ms = 4000): Promise<T> {
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

  /** The n-th event of this type (1-based). */
  event<T extends GameEventType>(type: T, n = 1): Promise<Extract<GameEvent, { type: T }>> {
    return this.until(
      () => this.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)[n - 1],
      `${type} #${n}`,
    );
  }

  message<T extends ServerMessage['type']>(type: T, n = 1): Promise<Extract<ServerMessage, { type: T }>> {
    return this.until(() => this.of(type)[n - 1], `${type} message #${n}`);
  }

  /** A round trip: everything sent before it has been handled, and its answers are in. */
  async fence(): Promise<void> {
    const t = Math.random();
    this.raw('ping', { t });
    await this.until(() => this.of('pong').some((p) => p.t === t), 'pong');
  }

  /** The game as this client sees it: the last snapshot, moved on by the events after it. */
  mirror(): GameState {
    const at = this.messages.findLastIndex((m) => m.type === 'snapshot');
    let state = (this.messages[at] as Extract<ServerMessage, { type: 'snapshot' }>).state;
    for (const m of this.messages.slice(at + 1))
      if (m.type === 'events') for (const e of m.events) if (e.seq > state.seq) state = evolve(state, e);
    return state;
  }

  private notify(): void {
    for (const w of [...this.waiters]) w();
  }
}

const joinOptions = (id: string) => ({ devUserId: id, name: nameOf(id) });

async function create(id: string, options: Partial<GameRoomCreateOptions> = {}): Promise<Player> {
  const room = await colyseus.sdk.create(GAME_ROOM_NAME, { private: true, ...joinOptions(id), ...options });
  return new Player(room, id);
}

async function join(code: string, id: string): Promise<Player> {
  return new Player(await colyseus.sdk.joinById(code, joinOptions(id)), id);
}

/** Two players in a room; resolves once both have seen the game start. */
async function startTwo(options: Partial<GameRoomCreateOptions> = {}): Promise<[Player, Player]> {
  const ana = await create('ana', options);
  const ben = await join(ana.code, 'ben');
  await Promise.all([ana.event('gameStarted'), ben.event('gameStarted')]);
  return [ana, ben];
}

const roomOf = (code: string) => colyseus.getRoomById<GameRoom>(code);
const serverState = (code: string) => roomOf(code).currentGame!.state;

/** The refusal of a create or join: its GameRoomError and message. */
async function refusal(p: Promise<unknown>): Promise<{ error: GameRoomError | null; message: string }> {
  try {
    await p;
  } catch (e) {
    const message = (e as Error).message;
    return { error: gameRoomErrorOf(message), message };
  }
  throw new Error('expected a refusal');
}

const leaveAll = (...players: Player[]) =>
  Promise.all(players.filter((p) => p.left === null).map((p) => p.room.leave()));

// ---------------------------------------------------------------------------------------------------------

describe('a private room with a code', () => {
  it('has a 6-character code as its id, is not offered to join(), and shows who is in', async () => {
    const ana = await create('ana');
    expect(normalizeRoomCode(ana.code)).toBe(ana.code);
    expect(await ana.message('lobby')).toEqual({
      type: 'lobby',
      code: ana.code,
      gameType: 'fast',
      playerCount: 2,
      players: [{ id: 'ana', name: 'Ana' }],
      playerId: 'ana',
    });
    // Private: matchmaking calls never find it, only its code does.
    expect((await refusal(colyseus.sdk.join(GAME_ROOM_NAME, joinOptions('zed')))).message).toContain(
      'no rooms found',
    );
    // An action before the game: refused, to the sender.
    const seq = ana.act({ type: 'select', cell: C1 });
    expect(await ana.message('rejected')).toEqual({ type: 'rejected', clientSeq: seq, reason: 'notStarted' });

    const ben = await join(ana.code, 'ben');
    const lobby = await ana.message('lobby', 2);
    expect(lobby.players).toEqual([
      { id: 'ana', name: 'Ana' },
      { id: 'ben', name: 'Ben' },
    ]);
    expect((await ben.message('lobby')).playerId).toBe('ben');
    await leaveAll(ana, ben);
  });

  it('starts the game when the last seat is taken: a snapshot without the solution, then the start', async () => {
    const [ana, ben] = await startTwo();
    for (const p of [ana, ben]) {
      const snapshot = await p.message('snapshot');
      expect(snapshot).toMatchObject({ type: 'snapshot', protocol: PROTOCOL_VERSION, playerId: p.id });
      expect(snapshot.state.status).toBe('waiting');
      expect(snapshot.state.seq).toBe(1);
      expect(snapshot.state.config.puzzle).toEqual({ id: PUZZLE.id, givens: PUZZLE.givens, solution: '' });
      expect(snapshot.state.config.players.map((x) => x.id)).toEqual(['ana', 'ben']);
      expect(p.events[0]).toMatchObject({ type: 'gameStarted', seq: 2 });
    }
    // Snapshot first, then events: the order every client relies on.
    expect(ben.messages.map((m) => m.type)).toEqual(['lobby', 'snapshot', 'events']);
    await leaveAll(ana, ben);
  });

  it('a code of your own (dev), refused when taken', async () => {
    const ana = await create('ana', { code: 'tst-234' });
    expect(ana.code).toBe('TST234');
    expect(await refusal(create('ben', { code: 'TST234' }))).toMatchObject({ error: 'codeTaken' });
    await leaveAll(ana);
  });

  it('who may not get in', async () => {
    expect(await refusal(colyseus.sdk.create(GAME_ROOM_NAME, { private: true }))).toMatchObject({
      error: 'unauthenticated',
    });
    expect(await refusal(create('ana', { playerCount: 9 }))).toMatchObject({ error: 'badOptions' });
    expect(await refusal(colyseus.sdk.create(GAME_ROOM_NAME, joinOptions('ana')))).toMatchObject({
      error: 'badOptions', // no private: true
    });
    expect((await refusal(join('ZZZZZZ', 'ben'))).message).toContain('not found');

    const ana = await create('ana');
    expect(await refusal(join(ana.code, 'ana'))).toMatchObject({ error: 'alreadyInRoom' });
    const ben = await join(ana.code, 'ben');
    // Full and started: locked to everyone else.
    expect((await refusal(join(ana.code, 'cyd'))).message).toContain('locked');
    await leaveAll(ana, ben);
  });
});

describe('playing', () => {
  it('both players receive the same events, in order, and snapshot + events give the server state', async () => {
    const [ana, ben] = await startTwo();
    ana.act({ type: 'select', cell: C1 });
    ana.act({ type: 'place', cell: C1, digit: digitAt(PUZZLE, C1) });
    ben.act({ type: 'select', cell: C2 });
    ben.act({ type: 'place', cell: C2, digit: wrongDigitAt(PUZZLE, C2) });
    ben.act({ type: 'react', emoji: '😎' });
    await Promise.all([ana.event('reaction'), ben.event('reaction')]);
    await Promise.all([ana.fence(), ben.fence()]);

    expect(ana.events).toEqual(ben.events);
    expect(ana.events.map((e) => e.seq)).toEqual(ana.events.map((_, k) => k + 2)); // 2, 3, 4… no gaps
    expect(ana.events.map((e) => e.type)).toEqual([
      'gameStarted',
      'cellLocked',
      'placedCorrect',
      'cellLocked',
      'placedWrong',
      'cellReleased',
      'reaction',
    ]);
    const server = publicState(serverState(ana.code));
    expect(ana.mirror()).toEqual(server);
    expect(ben.mirror()).toEqual(server);
    await leaveAll(ana, ben);
  });

  it('the server checks and scores every digit (the client never has the solution)', async () => {
    const [ana, ben] = await startTwo();
    ana.act({ type: 'select', cell: C1 });
    ana.act({ type: 'place', cell: C1, digit: digitAt(PUZZLE, C1) });
    const correct = await ben.event('placedCorrect');
    expect(correct).toMatchObject({ playerId: 'ana', cell: C1, digit: digitAt(PUZZLE, C1) });
    expect(correct.points).toBeGreaterThanOrEqual(1.5);
    expect(correct.score).toBe(correct.points);

    ben.act({ type: 'select', cell: C2 });
    ben.act({ type: 'place', cell: C2, digit: wrongDigitAt(PUZZLE, C2) });
    expect(await ana.event('placedWrong')).toMatchObject({
      playerId: 'ben',
      penalty: 1,
      mistakes: 1,
      score: -1,
    });
    await leaveAll(ana, ben);
  });

  it('a refusal goes to its sender only', async () => {
    const [ana, ben] = await startTwo();
    ana.act({ type: 'select', cell: C1 });
    await ben.event('cellLocked');
    const seq = ben.act({ type: 'select', cell: C1 }); // ana holds it
    expect(await ben.message('rejected')).toEqual({ type: 'rejected', clientSeq: seq, reason: 'cellTaken' });
    // A malformed action with a readable clientSeq is answered too.
    ben.raw('place', { clientSeq: 77, cell: 'A1', digit: 3 });
    expect(await ben.message('rejected', 2)).toEqual({
      type: 'rejected',
      clientSeq: 77,
      reason: 'badAction',
    });
    await Promise.all([ana.fence(), ben.fence()]);
    expect(ana.of('rejected')).toEqual([]);
    expect(ana.events).toEqual(ben.events);
    await leaveAll(ana, ben);
  });

  it('drops a duplicate or old clientSeq (spec §21)', async () => {
    const [ana, ben] = await startTwo();
    ana.raw('select', { clientSeq: 50, cell: C3 });
    ana.raw('select', { clientSeq: 50, cell: C4 }); // the same clientSeq again: dropped
    ana.raw('release', { clientSeq: 49 }); // an old one: dropped
    await ana.fence();
    expect(ana.events.filter((e) => e.type === 'cellLocked')).toMatchObject([{ playerId: 'ana', cell: C3 }]);
    expect(ana.of('rejected')).toEqual([]);
    ana.raw('release', { clientSeq: 51 });
    expect(await ana.event('cellReleased')).toMatchObject({ cell: C3, reason: 'cancel' });
    await leaveAll(ana, ben);
  });

  it('answers ping with pong: the client time back, and the server time', async () => {
    const [ana, ben] = await startTwo();
    const before = Date.now();
    ana.raw('ping', { t: 1234.5 });
    const pong = await ana.message('pong');
    expect(pong).toEqual({ type: 'pong', t: 1234.5, serverTime: expect.any(Number) });
    expect(pong.serverTime).toBeGreaterThanOrEqual(before);
    expect(pong.serverTime).toBeLessThanOrEqual(Date.now());
    await leaveAll(ana, ben);
  });

  it('a flood is cut by the rate limit', async () => {
    const [ana, ben] = await startTwo();
    for (let t = 0; t < 12; t++) ana.raw('ping', { t });
    ana.act({ type: 'select', cell: C1 }); // still served: another type, another bucket
    await ana.event('cellLocked');
    await new Promise((r) => setTimeout(r, 100));
    expect(ana.of('pong').length).toBe(5); // the burst; the rest dropped without an answer
    expect(ana.left).toBeNull(); // over a limit now and then is not abuse yet
    await leaveAll(ana, ben);
  });

  it('a client that keeps sending junk or flooding is disconnected; for the game it dropped', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 600 } });
    for (let k = 0; k < 25; k++) ana.raw('place', { cell: 1 }); // no clientSeq: malformed
    await ana.until(() => ana.left !== null, 'the kick');
    expect(ana.left).toBe(CloseCode.WITH_ERROR);
    expect(await ben.event('playerDisconnected')).toMatchObject({ playerId: 'ana' });
    expect(log.lines.filter((l) => l.includes('ana disconnected: too many bad messages'))).toHaveLength(1);
    await leaveAll(ben);
  });

  it('three players: the game starts with the third, and goes on when one drops (no freeze)', async () => {
    const ana = await create('ana', { playerCount: 3, rules: { graceMs: 600 } });
    const ben = await join(ana.code, 'ben');
    expect(ana.events).toEqual([]);
    const cyd = await join(ana.code, 'cyd');
    await Promise.all([ana, ben, cyd].map((p) => p.event('gameStarted')));
    void ben.room.leave(false);
    await ana.event('playerDisconnected');
    cyd.act({ type: 'select', cell: C1 });
    expect(await ana.event('cellLocked')).toMatchObject({ playerId: 'cyd' });
    expect(ana.events.map((e) => e.type)).not.toContain('gamePaused');
    await leaveAll(ana, cyd);
  });
});

describe('the end of the game', () => {
  it('the solution never leaves the server before gameOver; then everyone gets it, and the room closes', async () => {
    const [ana, ben] = await startTwo({ gameType: 'normal' }); // NEARLY_DONE: four cells to go
    const cells = emptyCells(NEARLY_DONE);
    for (const [k, cell] of cells.entries()) {
      const p = k % 2 === 0 ? ana : ben;
      p.act({ type: 'select', cell });
      p.act({ type: 'place', cell, digit: digitAt(NEARLY_DONE, cell) });
      await ana.event('placedCorrect', k + 1);
    }
    const over = await ben.event('gameOver');
    expect(over.reason).toBe('boardComplete');
    for (const p of [ana, ben]) {
      const solution = await p.message('solution');
      expect(solution).toEqual({ type: 'solution', solution: NEARLY_DONE.solution });
      const overAt = p.messages.findIndex(
        (m) => m.type === 'events' && m.events.some((e) => e.type === 'gameOver'),
      );
      expect(overAt).toBeGreaterThan(0);
      for (const m of p.messages.slice(0, overAt))
        expect(JSON.stringify(m)).not.toContain(NEARLY_DONE.solution);
      expect(p.messages.indexOf(solution)).toBeGreaterThan(overAt);
    }
    // Closed after closeAfterGameMs.
    await Promise.all([ana, ben].map((p) => p.until(() => p.left !== null, 'the room to close')));
  });

  it('surrender: in two players, a loss at once', async () => {
    const [ana, ben] = await startTwo();
    ben.act({ type: 'surrender' });
    expect(await ana.event('playerSurrendered')).toMatchObject({ playerId: 'ben' });
    const over = await ana.event('gameOver');
    expect(over.reason).toBe('lastPlayerStanding');
    expect(over.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['ana', 1, 'active'],
      ['ben', 2, 'surrendered'],
    ]);
    expect(await ben.message('solution')).toEqual({ type: 'solution', solution: PUZZLE.solution });
    await Promise.all([ana, ben].map((p) => p.until(() => p.left !== null, 'the room to close')));
  });
});

describe('disconnects (spec §16.2)', () => {
  it('back within the grace: the other saw the drop and the freeze, and both are in sync again', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 3000 } });
    ana.act({ type: 'select', cell: C1 });
    await ben.event('cellLocked');
    const token = ben.room.reconnectionToken;
    ben.seq = 10;
    ben.act({ type: 'select', cell: C2 });
    await ana.event('cellLocked', 2);

    void ben.room.leave(false); // the connection drops (no goodbye)
    const dropped = await ana.event('playerDisconnected');
    expect(dropped.playerId).toBe('ben');
    expect(dropped.graceEndsAt - dropped.t).toBe(3000);
    expect(await ana.event('gamePaused')).toMatchObject({ reason: 'disconnect' });
    // Frozen for ana too: nobody gains from the drop.
    const seq = ana.act({ type: 'place', cell: C1, digit: digitAt(PUZZLE, C1) });
    expect(await ana.message('rejected')).toEqual({ type: 'rejected', clientSeq: seq, reason: 'paused' });

    const started = Date.now();
    const back = new Player(await colyseus.sdk.reconnect(token), 'ben');
    const snapshot = await back.message('snapshot');
    expect(snapshot.state.status).toBe('paused'); // the game as it is, then the events of the return
    expect(snapshot.state.config.puzzle.solution).toBe('');
    await back.event('gameResumed');
    expect(Date.now() - started).toBeLessThan(2000); // spec §18: back in sync within 2 s

    expect(await ana.event('playerReconnected')).toMatchObject({ playerId: 'ben' });
    const resumed = await ana.event('gameResumed');
    expect(resumed.reason).toBe('reconnect');
    expect(resumed.locks.map((l) => l.playerId).sort()).toEqual(['ana', 'ben']); // locks kept, moved on
    expect(back.mirror()).toEqual(publicState(serverState(ana.code)));

    // The same connection as far as clientSeq goes: an old one is still a duplicate, the next one works.
    back.seq = ben.seq;
    back.raw('release', { clientSeq: 5 });
    back.act({ type: 'release' });
    expect(await ana.event('cellReleased')).toMatchObject({ playerId: 'ben', reason: 'cancel' });
    await back.fence();
    expect(back.of('rejected')).toEqual([]);
    await leaveAll(ana, back);
  });

  it('not back in time: abandonment, and in two players the other wins [D8]', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 300 } });
    void ben.room.leave(false);
    await ana.event('playerDisconnected');
    expect(await ana.event('playerAbandoned')).toMatchObject({ playerId: 'ben' });
    const over = await ana.event('gameOver');
    expect(over.reason).toBe('lastPlayerStanding');
    expect(over.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['ana', 1, 'active'],
      ['ben', 2, 'abandoned'],
    ]);
    expect(await ana.message('solution')).toEqual({ type: 'solution', solution: PUZZLE.solution });
    await ana.until(() => ana.left !== null, 'the room to close');
  });

  it('leaving on purpose is a disconnect too [D32]: the grace runs, and the player may rejoin by code', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 3000 } });
    ben.seq = 40;
    await ben.room.leave(); // consented
    expect(await ana.event('playerDisconnected')).toMatchObject({ playerId: 'ben' });
    await ana.event('gamePaused');

    const again = await join(ana.code, 'ben');
    const snapshot = await again.message('snapshot');
    expect(snapshot).toMatchObject({ playerId: 'ben', state: { status: 'paused' } });
    await again.event('gameResumed');
    expect(await ana.event('playerReconnected')).toMatchObject({ playerId: 'ben' });
    // A fresh join counts clientSeq from scratch.
    again.act({ type: 'select', cell: C1 });
    expect(await ana.event('cellLocked')).toMatchObject({ playerId: 'ben', cell: C1 });
    expect(again.mirror()).toEqual(publicState(serverState(ana.code)));
    // Someone else still can't take the seat.
    expect((await refusal(join(ana.code, 'cyd'))).message).toContain('locked');
    await leaveAll(ana, again);
  });
});

describe('measures (spec §18)', () => {
  it('GET /dev/metrics: action handling times and the rest', async () => {
    const res = await fetch(`${url}/dev/metrics`, { headers: { connection: 'close' } });
    expect(res.status).toBe(200);
    const report = (await res.json()) as GameMetricsReport;
    expect(report.games.started).toBeGreaterThan(5);
    expect(report.actions.count).toBeGreaterThan(10);
    expect(report.actions.p95Ms).toBeLessThan(50);
    expect(report.dropped.duplicate).toBeGreaterThan(0);
    expect(report.dropped.rateLimited).toBeGreaterThan(0);
    expect(report.kicks).toBe(1);
    expect(report.pings).toBeGreaterThan(0);
    const types: ClientMessageType[] = ['select', 'place', 'react', 'surrender'];
    for (const t of types) expect(report.actions.byType[t]).toBeGreaterThan(0);
  });

  it('logged nothing unexpected', () => {
    expect(log.errors).toEqual([]);
  });
});
