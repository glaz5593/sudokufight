/**
 * Stage 7 review: nasty clients against the real game room (spec §18, §21: the server is authoritative, and
 * one bad client must not hurt the room, the other players or the process).
 *
 * - Garbage on the wire: thousands of random, mutated and hostile frames go through Colyseus's own frame
 *   decoder and the room's handler; nothing throws, nothing is polluted, the room keeps serving, and the
 *   solution never leaves before gameOver.
 * - A frame over 4 KB, a deep payload, a flood, odd protocol frames, requests: each costs at most the sender's
 *   connection, which for the game is a drop it can come back from.
 * - Seats and tokens: a full room, a started game, forged and used reconnection tokens, and what a stolen one
 *   can do (a bearer secret: noted for stage 8).
 * - Leaving and the grace: everybody leaves (the game is kept), a reconnection that dies half way, a return
 *   just after the grace ran out, coming back after the end. A connection that drops gets the soft phase of
 *   [D42] first (here a short one, then the grace); leaving on purpose does not.
 * - Memory: after many games every room is closed and no game timer is left.
 */
import type { AddressInfo } from 'node:net';

import {
  type Client as ServerClient,
  ClientState,
  CloseCode,
  getMessageBytes,
  matchMaker,
  Protocol,
} from '@colyseus/core';
import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import type { WebSocketClient } from '@colyseus/ws-transport';
import {
  createRng,
  evolve,
  type GameEvent,
  type GameEventType,
  type GameState,
  publicState,
  type Rng,
  type Scheduler,
} from '@sudoku-fight/engine';
import {
  GAME_ROOM_NAME,
  type GameRoomCreateOptions,
  type GameRoomError,
  gameRoomErrorOf,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { createAppServer, HEARTBEAT } from '../src/app';
import { MessageGate } from '../src/game/gate';
import { GameMetrics } from '../src/game/metrics';
import { type GameRoom, systemScheduler } from '../src/rooms/GameRoom';
import { digitAt, emptyCells, PUZZLE, quietLog, testConfig, testPuzzles } from '../src/testing';

// ---------------------------------------------------------------------------------------------------------
// The server, with a scheduler that counts the game's timers and can hold them back.

/** System timers, counted; while `hold` is on, new ones wait for release() (an engine timer running late). */
class CountingScheduler implements Scheduler {
  hold = false;
  private readonly armed = new Set<object>();
  private readonly held: { handle: { timer?: NodeJS.Timeout }; fn: () => void; ms: number }[] = [];

  /** Timers set and neither fired nor cleared. */
  get pending(): number {
    return this.armed.size;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const handle: { timer?: NodeJS.Timeout } = {};
    this.armed.add(handle);
    if (this.hold) this.held.push({ handle, fn, ms });
    else this.arm(handle, fn, ms);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    const h = handle as { timer?: NodeJS.Timeout };
    if (h.timer !== undefined) systemScheduler.clearTimeout(h.timer);
    this.armed.delete(h);
  }

  release(): void {
    this.hold = false;
    for (const { handle, fn, ms } of this.held.splice(0))
      if (this.armed.has(handle)) this.arm(handle, fn, ms);
  }

  private arm(handle: { timer?: NodeJS.Timeout }, fn: () => void, ms: number): void {
    handle.timer = systemScheduler.setTimeout(() => {
      this.armed.delete(handle);
      fn();
    }, ms) as NodeJS.Timeout;
  }
}

const log = quietLog();
const metrics = new GameMetrics();
const scheduler = new CountingScheduler();
const server = createAppServer({
  gracefullyShutdown: false,
  config: testConfig(),
  game: { puzzles: testPuzzles, log, metrics, scheduler, closeAfterGameMs: 300 },
});
let sdk: Client;

beforeAll(async () => {
  await server.listen(0); // a free port
  const { port } = server.transport.server!.address() as AddressInfo;
  sdk = new Client(`http://127.0.0.1:${port}`);
}, 30_000);

afterAll(async () => {
  scheduler.release();
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

// ---------------------------------------------------------------------------------------------------------
// A player: an SDK room and everything it received, in order.

const [C1, C2] = emptyCells(PUZZLE) as [number, number];
/** Short graces everywhere, so every room of this file closes soon after its test. */
const GRACE_MS = 600;
/** And a short soft phase of a lost connection before them [D42] (the default is 10 s). */
const SOFT_GRACE_MS = 200;

async function until(done: () => boolean, what: string, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

class Player {
  readonly messages: ServerMessage[] = [];
  left: number | null = null;
  seq = 0;

  constructor(
    readonly room: SdkRoom,
    readonly id: string,
  ) {
    room.reconnection.enabled = false; // tests reconnect by hand
    for (const type of SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m: ServerMessage) => {
        this.messages.push(m);
      });
    room.onLeave((code: number) => {
      this.left = code;
    });
  }

  get code(): string {
    return this.room.roomId;
  }

  get events(): GameEvent[] {
    return this.messages.flatMap((m) => (m.type === 'events' ? m.events : []));
  }

  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }

  act(type: string, payload: Record<string, unknown> = {}): void {
    this.room.send(type, { ...payload, clientSeq: ++this.seq });
  }

  /** Waits for the n-th event of this type (1-based). */
  async event(type: GameEventType, n = 1): Promise<void> {
    await until(() => this.events.filter((e) => e.type === type).length >= n, `${this.id}: ${type} #${n}`);
  }

  async snapshot(): Promise<Extract<ServerMessage, { type: 'snapshot' }>> {
    await until(() => this.of('snapshot').length > 0, `${this.id}: a snapshot`);
    return this.of('snapshot')[0]!;
  }

  /** Everything sent before it has been handled (`ms`: how long the answer may take). */
  async fence(ms?: number): Promise<void> {
    const t = Math.random();
    this.room.send('ping', { t });
    await until(() => this.of('pong').some((p) => p.t === t), `${this.id}: pong`, ms);
  }

  async gone(): Promise<number> {
    await until(() => this.left !== null, `${this.id}: the close`);
    return this.left!;
  }

  /** The last snapshot moved on by the events after it. */
  mirror(): GameState {
    const at = this.messages.findLastIndex((m) => m.type === 'snapshot');
    let state = (this.messages[at] as Extract<ServerMessage, { type: 'snapshot' }>).state;
    for (const m of this.messages.slice(at + 1))
      if (m.type === 'events') for (const e of m.events) if (e.seq > state.seq) state = evolve(state, e);
    return state;
  }

  /** Every message received before the game was over (or all of them). */
  beforeGameOver(): ServerMessage[] {
    const over = this.messages.findIndex(
      (m) => m.type === 'events' && m.events.some((e) => e.type === 'gameOver'),
    );
    return over < 0 ? this.messages : this.messages.slice(0, over);
  }
}

const joinOptions = (id: string) => ({ devUserId: id, name: id[0]!.toUpperCase() + id.slice(1) });

async function create(id: string, options: Partial<GameRoomCreateOptions> = {}): Promise<Player> {
  const { rules, ...rest } = options;
  const room = await sdk.create(GAME_ROOM_NAME, {
    private: true,
    ...joinOptions(id),
    ...rest,
    rules: { graceMs: GRACE_MS, softGraceMs: SOFT_GRACE_MS, ...rules },
  });
  return new Player(room, id);
}

const join = async (code: string, id: string) => new Player(await sdk.joinById(code, joinOptions(id)), id);

async function startTwo(options: Partial<GameRoomCreateOptions> = {}): Promise<[Player, Player]> {
  const ana = await create('ana', options);
  const ben = await join(ana.code, 'ben');
  await Promise.all([ana.event('gameStarted'), ben.event('gameStarted')]);
  return [ana, ben];
}

const roomOf = (code: string) => matchMaker.getLocalRoomById(code) as GameRoom | undefined;

/** The server side of a player's connection. */
function serverClient(p: Player): ServerClient {
  const client = roomOf(p.code)!.clients.find((c) => c.sessionId === p.room.sessionId);
  if (!client) throw new Error(`${p.id} has no connection in the room`);
  return client;
}

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

/** A Colyseus frame: ROOM_DATA with a type and a msgpack payload, as the SDK sends it. */
const dataFrame = (type: string | number, payload?: unknown) =>
  getMessageBytes.raw(Protocol.ROOM_DATA, type, payload);

const solutionLeaked = (p: Player) =>
  p.beforeGameOver().some((m) => JSON.stringify(m).includes(PUZZLE.solution));

// ---------------------------------------------------------------------------------------------------------
// Hostile frames

const HOSTILE_TYPES: (string | number)[] = [
  'select',
  'release',
  'place',
  'interfere',
  'react',
  'surrender',
  'ping',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'valueOf',
  '*',
  '',
  'start',
  'disconnect',
  'reconnect',
  0,
  -1,
  7,
  2 ** 40,
];
const HOSTILE_KEYS = [
  'type',
  'clientSeq',
  'cell',
  'digit',
  'targetId',
  'kind',
  'emoji',
  't',
  'playerId',
  '__proto__',
  'constructor',
  'prototype',
];

function hostileValue(rng: Rng, depth = 0): unknown {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length)]!;
  switch (Math.floor(rng.next() * (depth > 2 ? 6 : 9))) {
    case 0:
      return pick([undefined, null, true, false]);
    case 1:
      return pick([0, 1, -1, 80, 81, 9, 10, 2 ** 31, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 1e300, 0.5, 4.000001]);
    case 2:
      return pick([NaN, Infinity, -Infinity, -0]);
    case 3:
      return Math.floor(rng.next() * 100);
    case 4: {
      const chars = ['a', 'Z', '0', '😎', '\u0000', '‮', '"', '\\', 'א', ' '];
      return Array.from({ length: Math.floor(rng.next() * 24) }, () => pick(chars)).join('');
    }
    case 5:
      return new Uint8Array(Math.floor(rng.next() * 16)).map(() => Math.floor(rng.next() * 256));
    case 6:
      return Array.from({ length: Math.floor(rng.next() * 4) }, () => hostileValue(rng, depth + 1));
    default: {
      // Own keys, even "__proto__": the way a decoder would hand them over.
      const o: Record<string, unknown> = {};
      for (const key of HOSTILE_KEYS)
        if (rng.next() < 0.35)
          Object.defineProperty(o, key, {
            value: key === '__proto__' ? { polluted: true } : hostileValue(rng, depth + 1),
            enumerable: true,
            writable: true,
            configurable: true,
          });
      return o;
    }
  }
}

/** One frame: random bytes, a hostile ROOM_DATA, a mutilated one, bytes, a request, or a plausible action. */
function hostileFrame(rng: Rng, seq: { n: number }): Buffer {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length)]!;
  const bytes = (n: number) => Buffer.from(Array.from({ length: n }, () => Math.floor(rng.next() * 256)));
  switch (Math.floor(rng.next() * 7)) {
    case 0: {
      // Anything at all, but LEAVE_ROOM (it would end the session: its own test below).
      const frame = bytes(Math.floor(rng.next() * 48));
      if (frame.length > 0 && (frame[0]! & 31) === Protocol.LEAVE_ROOM) frame[0] = Protocol.ROOM_DATA;
      return frame;
    }
    case 1:
      return dataFrame(pick(HOSTILE_TYPES), hostileValue(rng));
    case 2: {
      // A good frame, cut short or with bytes flipped.
      const frame = dataFrame(pick(HOSTILE_TYPES), hostileValue(rng));
      if (rng.next() < 0.5) return frame.subarray(0, 1 + Math.floor(rng.next() * frame.length));
      for (let k = 0; k < 3; k++)
        frame[1 + Math.floor(rng.next() * (frame.length - 1))] = Math.floor(rng.next() * 256);
      if ((frame[0]! & 31) === Protocol.LEAVE_ROOM) frame[0] = Protocol.ROOM_DATA;
      return frame;
    }
    case 3:
      return getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, pick(HOSTILE_TYPES), undefined, bytes(12));
    case 4:
      return Buffer.concat([Buffer.from([Protocol.ROOM_REQUEST]), bytes(Math.floor(rng.next() * 32))]);
    default: {
      // Plausible actions (some legal), so the engine is exercised too.
      const type = pick(['select', 'place', 'release', 'interfere', 'react', 'ping'] as const);
      const cell = Math.floor(rng.next() * 81);
      const payloads = {
        select: { cell },
        place: { cell, digit: 1 + Math.floor(rng.next() * 9) },
        release: {},
        interfere: { targetId: pick(['ben', 'ana', 'zed']), kind: pick(['blur', 'freeze', 'shake', 'x']) },
        react: { emoji: pick(['😎', '👍', 'x']) },
        ping: { t: rng.next() },
      };
      return dataFrame(type, type === 'ping' ? payloads.ping : { ...payloads[type], clientSeq: ++seq.n });
    }
  }
}

describe('garbage on the wire', () => {
  it('thousands of hostile frames through Colyseus and the room: nothing throws, the room keeps serving, and the solution stays on the server', async () => {
    const [ana, ben] = await startTwo();
    const room = roomOf(ana.code)!;
    // Let everything reach the handler: no flood cut, no abuse kick, no rate limits.
    room.maxMessagesPerSecond = Infinity;
    const wide = { limit: 1e9, windowMs: 1000 };
    const limits = {
      select: wide,
      release: wide,
      place: wide,
      interfere: wide,
      react: wide,
      surrender: wide,
      offlineMove: wide,
      ping: wide,
    };
    Object.assign(room, { gate: new MessageGate({ now: Date.now, limits, abuseLimit: wide }) });
    const onMessage = (room as unknown as { _onMessage(c: ServerClient, b: Buffer): void })._onMessage.bind(
      room,
    );
    const client = serverClient(ana);

    const rng = createRng(20261009);
    const seq = { n: 0 };
    const thrown: unknown[] = [];
    const before = metrics.report();
    // Colyseus prints every frame it could not decode (and goes on): thousands of lines, kept out of the run.
    const quiet = (['error', 'warn', 'log', 'info'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      for (let k = 0; k < 5000; k++) {
        try {
          onMessage(client, hostileFrame(rng, seq));
        } catch (error) {
          thrown.push(error);
        }
      }
    } finally {
      for (const spy of quiet) spy.mockRestore();
    }
    expect(thrown).toEqual([]);
    expect(log.errors).toEqual([]); // the room's handler and the engine never failed
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // It reached the room and the engine, not only the decoder.
    const after = metrics.report();
    expect(after.actions.count - before.actions.count).toBeGreaterThan(500);
    expect(after.dropped.malformed - before.dropped.malformed).toBeGreaterThan(500);
    expect(after.dropped.unknownType - before.dropped.unknownType).toBeGreaterThan(200);

    // Ben is unharmed and in step with the server; the solution went nowhere before the end. Ben has thousands
    // of events to take in, and the game's own timers (a hit's 5 s, a lock's time) may move it on meanwhile:
    // under a loaded machine, wait for him to catch up with the server's latest event rather than race it.
    await ben.fence(15_000);
    expect(ben.events.some((e) => e.type === 'cellLocked' && e.playerId === 'ana')).toBe(true);
    const game = room.currentGame!;
    await until(() => game.isOver || ben.mirror().seq === game.state.seq, 'ben: in step', 15_000);
    if (!game.isOver) expect(ben.mirror()).toEqual(publicState(game.state));
    expect(solutionLeaked(ana) || solutionLeaked(ben)).toBe(false);
    for (const m of ana.of('rejected')) expect(JSON.stringify(m)).not.toContain(PUZZLE.solution);
    await leaveAll(ana, ben);
  }, 45_000);

  it('a frame over 4 KB closes the sender only: for the game a drop, and it comes back with its token', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 3000 } });
    const token = ana.room.reconnectionToken;
    ana.room.connection.send(dataFrame('react', { clientSeq: 1, emoji: 'x'.repeat(5000) }));
    expect(await ana.gone()).toBe(1009); // ws: message too big
    await ben.event('playerDisconnected');
    await ben.event('gamePaused');

    const back = new Player(await sdk.reconnect(token), 'ana');
    await back.event('gameResumed');
    await Promise.all([back.fence(), ben.fence()]);
    const server = publicState(roomOf(ben.code)!.currentGame!.state);
    expect(back.mirror()).toEqual(server);
    expect(ben.mirror()).toEqual(server);
    await leaveAll(back, ben);
  });

  it('a payload nested thousands deep is malformed, not a crash', async () => {
    const [ana, ben] = await startTwo();
    const deep = Buffer.concat([dataFrame('place'), Buffer.alloc(3500, 0x91), Buffer.from([0xc0])]);
    ana.room.connection.send(deep);
    await ana.fence(); // decoded, and dropped as malformed
    // A truncated one: Colyseus can't decode it and closes the sender (for the game, a drop).
    ana.room.connection.send(Buffer.concat([dataFrame('select'), Buffer.alloc(3500, 0x81 /* map of 1 */)]));
    await ana.gone();
    await ben.event('playerDisconnected');
    await ben.fence();
    expect(ben.mirror()).toEqual(publicState(roomOf(ben.code)!.currentGame!.state));
    expect(log.errors).toEqual([]);
    await leaveAll(ben);
  });

  it('a flood over 40 messages a second: Colyseus cuts the sender, and for the game it dropped', async () => {
    const [ana, ben] = await startTwo();
    for (let k = 0; k < 60; k++) ana.room.send('ping', { t: k });
    expect(await ana.gone()).toBe(CloseCode.WITH_ERROR);
    await ben.event('playerDisconnected');
    await ben.fence();
    await leaveAll(ben);
  });

  it('types named after Object.prototype, and own __proto__ keys, are dropped and pollute nothing', async () => {
    const [ana, ben] = await startTwo();
    const before = metrics.report().dropped.unknownType;
    for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])
      ana.room.send(type, { clientSeq: 99 });
    ana.room.connection.send(
      dataFrame('select', JSON.parse(`{"clientSeq": 100, "cell": ${C1}, "__proto__": {"polluted": true}}`)),
    );
    await ana.fence();
    expect(metrics.report().dropped.unknownType - before).toBe(5);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(ana.left).toBeNull();
    await leaveAll(ana, ben);
  });

  it('requests never reach the game (Colyseus answers them), and odd protocol frames do no harm', async () => {
    const [ana, ben] = await startTwo();
    await expect(
      ana.room.request('place', { clientSeq: 1, cell: C1, digit: digitAt(PUZZLE, C1) }),
    ).rejects.toThrow(/handler/);
    // JOIN_ROOM again, once joined: ignored.
    ana.room.connection.send(Buffer.from([Protocol.JOIN_ROOM]));
    await ana.fence();
    expect(ana.events.map((e) => e.type)).toEqual(['gameStarted']);
    // LEAVE_ROOM: a consented leave; for the game a disconnect, and the player may rejoin by code.
    ana.room.connection.send(Buffer.from([Protocol.LEAVE_ROOM]));
    await ana.gone();
    await ben.event('playerDisconnected');
    const again = await join(ben.code, 'ana');
    await again.event('gameResumed');
    await leaveAll(again, ben);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('seats and tokens', () => {
  it('a full room is locked; a started game takes back only its own players', async () => {
    const [ana, ben] = await startTwo();
    expect((await refusal(join(ana.code, 'cyd'))).message).toContain('locked');
    // A seat frees up (ben leaves on purpose): the room is open again, but only to ben.
    await ben.room.leave();
    await ana.event('playerDisconnected');
    expect(await refusal(join(ana.code, 'cyd'))).toMatchObject({ error: 'gameStarted' });
    expect(await refusal(join(ana.code, 'ana'))).toMatchObject({ error: 'alreadyInRoom' });
    const again = await join(ana.code, 'ben');
    await again.event('gameResumed');
    await leaveAll(ana, again);
  });

  it('the snapshot of a return says which clientSeq to go on from: kept by a reconnection, 0 after a rejoin', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 3000 } });
    expect(ben.of('snapshot')[0]!.lastClientSeq).toBe(0);
    ben.room.send('select', { clientSeq: 7, cell: C2 });
    await ana.event('cellLocked');
    const token = ben.room.reconnectionToken;
    void ben.room.leave(false);
    await ana.event('playerDisconnected');

    // An app that restarted and lost its count: the snapshot tells it where the server is.
    const back = new Player(await sdk.reconnect(token), 'ben');
    await back.event('gameResumed');
    expect(back.of('snapshot')[0]!.lastClientSeq).toBe(7);
    back.room.send('release', { clientSeq: 1 }); // from scratch: a duplicate, dropped
    back.room.send('release', { clientSeq: 8 }); // above it: taken
    await back.event('cellReleased');
    expect(back.events.filter((e) => e.type === 'cellReleased')).toHaveLength(1);

    await back.room.leave();
    await ana.event('playerDisconnected', 2);
    const again = await join(ana.code, 'ben');
    expect((await again.snapshot()).lastClientSeq).toBe(0);
    await leaveAll(ana, again);
  });

  it('a forged reconnection token is refused, and a used one cannot be used again', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 3000 } });
    const token = ben.room.reconnectionToken;
    await refusal(sdk.reconnect(`${ana.code}:not-a-token`));
    await refusal(sdk.reconnect(`ZZZZZZ:${token.split(':')[1]}`));
    void ben.room.leave(false);
    await ana.event('playerDisconnected');
    const back = new Player(await sdk.reconnect(token), 'ben');
    await back.event('gameResumed');
    // The token was spent: a second use fails (and does not disturb the player).
    await refusal(sdk.reconnect(token));
    await back.fence();
    expect(back.left).toBeNull();
    await leaveAll(ana, back);
  });

  it('a reconnection token is a bearer secret: whoever holds it takes the seat (a note for stage 8)', async () => {
    // Colyseus answers a reconnect with the token of a live connection by closing that connection and handing
    // the seat over (a client that comes back before the server saw it drop). The identity stays the seat's.
    const [ana, ben] = await startTwo({ rules: { graceMs: 3000 } });
    const stolen = ben.room.reconnectionToken;
    const thief = new Player(await sdk.reconnect(stolen), 'thief');
    await ben.gone();
    const snapshot = await thief.snapshot();
    expect(snapshot.playerId).toBe('ben');
    expect(snapshot.state.config.puzzle.solution).toBe('');
    // The game saw a short drop of ben, not a new player.
    await ana.event('playerReconnected');
    await Promise.all([ana.fence(), thief.fence()]);
    expect(thief.mirror()).toEqual(publicState(roomOf(ana.code)!.currentGame!.state));
    await leaveAll(ana, thief);
  });

  it('coming back after the end: by code while the room is open (the result, the solution once); then refused', async () => {
    const [ana, ben] = await startTwo();
    const token = ana.room.reconnectionToken;
    await ana.room.leave(); // on purpose, during the game
    ben.act('surrender'); // ben gives up: ana wins although away
    await ben.event('gameOver');
    const again = await join(ben.code, 'ana');
    await until(() => again.of('solution').length > 0, 'the solution');
    const snapshot = again.of('snapshot')[0]!;
    expect(snapshot.state.status).toBe('over');
    expect(snapshot.state.result!.ranking[0]).toMatchObject({ playerId: 'ana', place: 1 });
    await again.fence();
    expect(again.of('solution')).toEqual([{ type: 'solution', solution: PUZZLE.solution }]);
    // closeAfterGameMs later the room is gone: no way in, by code or token.
    await Promise.all([again.gone(), ben.gone()]);
    expect((await refusal(join(ben.code, 'ana'))).message).toContain('not found');
    expect((await refusal(sdk.reconnect(token))).message).toMatch(/disposed|expired/);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('leaving and the grace (spec §16.2)', () => {
  it('a phone that goes silent (airplane mode: no goodbye, no answers) is noticed within 4.5 s, and its soft phase starts then', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 15_000, softGraceMs: 10_000 } }); // the defaults
    const { pingInterval, pingMaxRetries } = HEARTBEAT;
    // The transport ticks at this interval and cuts after these retries (app.ts hands it HEARTBEAT).
    expect(server.transport).toMatchObject({ pingIntervalMS: pingInterval, pingMaxRetries });
    // From the server's side, airplane mode is a socket whose pongs stop coming. The heartbeat's ticks on it are
    // counted (its pings, then the cut), not timed: a loaded machine runs timers late, but not more often.
    const socket = (serverClient(ana) as WebSocketClient).ref;
    let pings = 0;
    let cut = false;
    const ping = socket.ping.bind(socket);
    const terminate = socket.terminate.bind(socket);
    socket.ping = (...args: Parameters<typeof socket.ping>) => {
      pings++;
      ping(...args);
    };
    socket.terminate = () => {
      cut = true;
      terminate();
    };
    socket.removeAllListeners('pong');
    await until(
      () => ben.events.some((e) => e.type === 'playerConnectionLost'),
      'the drop',
      4 * pingInterval * (pingMaxRetries + 1),
    );
    // Cut by the heartbeat on its (pingMaxRetries + 1)-th tick at the latest: at most pingMaxRetries pings
    // without an answer, then terminate(). On time, that is within pingInterval * (pingMaxRetries + 1) ms.
    expect(cut).toBe(true);
    expect(pings).toBeLessThanOrEqual(pingMaxRetries);
    // The device checks time airplane mode from the moment the network dies [D42]: about 5 s shows the other
    // player only the mark, about 14 s "Reconnecting… 15", about 30 s ends in abandonment. So the drop must be
    // noticed well before 5 s.
    expect(pingInterval * (pingMaxRetries + 1)).toBeLessThan(5000);
    const lost = ben.events.find((e) => e.type === 'playerConnectionLost')!;
    expect(lost.type === 'playerConnectionLost' && lost.softEndsAt - lost.t).toBe(10_000);
    // A mark only: the game goes on (the grace and the freeze come at the soft phase's end).
    expect(roomOf(ben.code)!.currentGame!.state.status).toBe('running');
    expect(await ana.gone()).toBe(1006); // cut, not closed
    ben.act('surrender'); // end it here, rather than 25 s later
    await ben.event('gameOver');
    await leaveAll(ben);
  }, 30_000);

  it('both players leave on purpose: the game is kept; one comes back by code and wins when the other is out', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 1500 } });
    await ana.room.leave();
    await ben.room.leave();
    // Nobody is connected, and the room is still there, its game paused.
    const room = roomOf(ana.code)!;
    expect(room.clients.length).toBe(0);
    expect(room.currentGame!.state.status).toBe('paused');
    const again = await join(ana.code, 'ana');
    await until(() => again.events.some((e) => e.type === 'playerReconnected'), 'the return');
    await until(() => again.events.some((e) => e.type === 'gameOver'), 'the end', 4000);
    const over = again.events.find((e) => e.type === 'gameOver')!;
    expect(over.type === 'gameOver' && over.ranking.map((r) => [r.playerId, r.status])).toEqual([
      ['ana', 'active'],
      ['ben', 'abandoned'],
    ]);
    await again.gone(); // and then the room closes
    await until(() => roomOf(ana.code) === undefined, 'the room to go');
  });

  it('nobody comes back: the graces end the game, and the room closes', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 300 } });
    const code = ana.code;
    await Promise.all([ana.room.leave(), ben.room.leave()]);
    expect(roomOf(code)).toBeDefined();
    await until(() => roomOf(code) === undefined, 'the room to close', 3000);
  });

  it('a reconnection whose socket dies half way (Colyseus calls onLeave): the engine sees the drop, and the game freezes', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 3000 } });
    const room = roomOf(ana.code)!;
    // What Colyseus does when the socket of a reconnection closes after onReconnect: onLeave, not onDrop.
    const client = serverClient(ben);
    client.state = ClientState.RECONNECTING;
    await (room as unknown as { _onLeave(c: ServerClient, code: number): Promise<void> })._onLeave(
      client,
      CloseCode.FAILED_TO_RECONNECT,
    );
    // Not a goodbye: a lost connection, its soft phase first [D42], then the grace and the freeze.
    await ana.event('playerConnectionLost');
    expect(ana.events.find((e) => e.type === 'playerConnectionLost')).toMatchObject({ playerId: 'ben' });
    await ana.event('playerDisconnected');
    await ana.event('gamePaused');
    expect(room.currentGame!.state.players.find((p) => p.id === 'ben')!.connected).toBe(false);
    // The seat is free for ben (only): back by code.
    ben.room.connection.close();
    const again = await join(ana.code, 'ben');
    await again.event('gameResumed');
    await leaveAll(ana, again);
  });

  it('back just after the grace ran out, before the engine timer fired: a snapshot, the abandonment, one solution', async () => {
    const [ana, ben] = await startTwo({ rules: { graceMs: 300 } });
    const token = ben.room.reconnectionToken;
    scheduler.hold = true; // the engine's timers will be late: the soft phase's end [D42], then the grace's
    let back: Player;
    try {
      void ben.room.leave(false);
      await ana.event('playerConnectionLost');
      // Just past the grace that follows the soft phase (the server's clock is this process's): Colyseus holds
      // the seat RECONNECT_SLACK_MS (1 s) more, so the sooner the return starts after it, the more of that it has.
      const lost = ana.events.find((e) => e.type === 'playerConnectionLost')!;
      const graceEndsAt = lost.type === 'playerConnectionLost' ? lost.softEndsAt + 300 : 0;
      await until(() => Date.now() > graceEndsAt + 20, 'the end of the grace');
      back = new Player(await sdk.reconnect(token), 'ben');
      await until(() => back.of('solution').length > 0, 'the solution');
    } finally {
      scheduler.release();
    }
    await Promise.all([back.fence(), ana.fence()]);
    expect(back.messages[0]!.type).toBe('snapshot');
    // Both late timers run before the return is taken, in order: the hard phase, then the abandonment.
    expect(back.events.map((e) => e.type)).toEqual([
      'playerDisconnected',
      'gamePaused',
      'playerAbandoned',
      'gameOver',
    ]);
    expect(back.of('solution')).toHaveLength(1);
    expect(ana.of('solution')).toHaveLength(1);
    expect(back.mirror().result?.ranking.map((r) => r.playerId)).toEqual(['ana', 'ben']);
    await Promise.all([back.gone(), ana.gone()]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('memory', () => {
  it('after many games every room is closed and no game timer is left', async () => {
    await until(() => metrics.report().rooms.open === 0, 'the earlier rooms to close', 10_000);
    const rounds = 12;
    for (let k = 0; k < rounds; k++) {
      const [ana, ben] = await startTwo();
      ana.act('select', { cell: C1 }); // a lock timer, running when the game ends
      if (k % 3 === 0)
        void ben.room.leave(false); // a drop: a grace timer too
      else if (k % 3 === 1) await ben.room.leave(); // a consented leave
      ana.act('surrender');
      await until(() => ana.events.some((e) => e.type === 'gameOver'), 'the end');
      await ana.gone();
    }
    await until(() => metrics.report().rooms.open === 0, 'every room to close', 10_000);
    expect(scheduler.pending).toBe(0);
    expect(log.errors).toEqual([]);
  }, 30_000);

  it('a refused create does not count as a room (open rooms stay right)', async () => {
    const open = metrics.report().rooms.open;
    const ana = await create('ana', { code: 'ABC234' });
    expect(await refusal(create('ben', { playerCount: 9 }))).toMatchObject({ error: 'badOptions' });
    expect(await refusal(create('ben', { code: 'ABC234' }))).toMatchObject({ error: 'codeTaken' });
    expect(metrics.report().rooms.open).toBe(open + 1);
    await ana.room.leave();
    await until(() => metrics.report().rooms.open === open, 'the room to close');
  });
});
