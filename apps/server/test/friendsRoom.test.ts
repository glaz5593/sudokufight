/**
 * Playing with friends (1.0.4; docs/handoff/2026-10-19/friends-room.md §3–§5, §7.1, §10) on the real server in
 * production (Colyseus + Express + an in-memory PGlite, one port), with Firebase-style tokens of real accounts
 * and SDK clients that do what the app does: POST /v1/rooms or /v1/rooms/join for a ticket, then
 * `consumeSeatReservation`.
 *
 * - The room's id is not its code; nobody gets in without a ticket (no joinById by code or by id, no create by
 *   a client), and the dev rooms stay closed in production.
 * - The lobby: the seats with their cards, the host, the host's commands (and their refusals, to the sender
 *   only), a kick, a block, the host passing on, the room closing.
 * - A drop holds the seat (away); back with the reconnection token, or without it through a new ticket (the
 *   same seat; the earlier connection is told `otherDevice`). `start` needs the host's yes for an away seat.
 * - `start`: the countdown, the game at GO, played to the end: no rating moved, stored as games.mode
 *   'friends', with puzzle_history and opponent_history.
 * - The lobby commands are rate limited.
 *
 * Its own file: Colyseus's matchmaker is one per process (one per Jest worker).
 */
import type { AddressInfo } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import type { ClientAction, GameEvent, GameEventType } from '@sudoku-fight/engine';
import {
  ACCOUNT_PATHS,
  blockPath,
  FRIEND_CODE_PATTERN,
  FRIENDS_PATHS,
  FRIENDS_ROOM_NAME,
  type FriendRoomTicket,
  type FriendsError,
  GAME_ROOM_NAME,
  gameRoomErrorOf,
  type Me,
  MODERATION_PATHS,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';
import { and, eq, isNotNull } from 'drizzle-orm';

import { createAppServer } from '../src/app';
import { games, opponentHistory, puzzleHistory, ratings, userAchievements } from '../src/db/schema';
import {
  createTestDb,
  digitAt,
  NEARLY_DONE,
  quietLog,
  testConfig,
  testPuzzles,
  type TestDb,
} from '../src/testing';
import { call, fighter } from '../src/testing/accounts';
import { FakeClient } from '../src/testing/fakeClient';
import { addPuzzles } from '../src/testing/ranked';
import { testTokens, type TestTokens } from '../src/testing/tokens';

const COUNTDOWN_MS = 200;
const COMMANDS = { limit: 6, windowMs: 60_000 };

let t: TestDb;
let tokens: TestTokens;
let server: ReturnType<typeof createAppServer>;
let url = '';
const log = quietLog();

interface Account {
  token: string;
  me: Me;
}
const accounts = new Map<string, Account>();

beforeAll(async () => {
  t = await createTestDb();
  // The ranked pool, before the server starts: a game four moves from the end, of each type.
  await addPuzzles(t.db, [NEARLY_DONE], { gameType: 'fast' });
  await addPuzzles(t.db, [{ ...NEARLY_DONE, id: 'nearly-done-normal' }], { gameType: 'normal' });
  await addPuzzles(t.db, [{ ...NEARLY_DONE, id: 'nearly-done-hard' }], { gameType: 'hard' });
  tokens = await testTokens();
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig({ nodeEnv: 'production' }),
    db: t,
    tokens: tokens.verifier(Date.now, { devTokens: false }),
    game: { puzzles: testPuzzles, log, closeAfterGameMs: 300 },
    friends: { rules: { countdownMs: COUNTDOWN_MS, commandLimit: COMMANDS } },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
  for (const name of ['Ana', 'Ben', 'Cy', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo']) {
    // Ben's email is not verified: a friends room takes him anyway [D85b].
    const token = await tokens.sign(
      { uid: `fb-${name}`, email: `${name.toLowerCase()}@example.com`, emailVerified: name !== 'Ben' },
      Date.now(),
    );
    const res = await call<Me>(url, 'POST', ACCOUNT_PATHS.users, {
      token,
      body: fighter({ displayName: `${name}_Pal`, avatarId: 'noam', country: 'IL' }),
      headers: { connection: 'close' },
    });
    expect(res.status).toBe(201);
    accounts.set(name, { token, me: res.body });
  }
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await t.close();
  await new Promise((r) => setTimeout(r, 1100));
});

const account = (name: string): Account => accounts.get(name)!;
const idOf = (name: string): string => account(name).me.id;

function sdk(name?: string): Client {
  const client = new Client(url);
  if (name !== undefined) client.auth.token = account(name).token;
  return client;
}

async function post<T>(name: string, path: string, body: unknown) {
  return call<T>(url, 'POST', path, { token: account(name).token, body, headers: { connection: 'close' } });
}

async function createRoom(name: string, body: object = {}): Promise<FriendRoomTicket> {
  const res = await post<FriendRoomTicket>(name, FRIENDS_PATHS.rooms, body);
  expect(res.status).toBe(201);
  return res.body;
}

async function ticketTo(name: string, code: string): Promise<FriendRoomTicket> {
  const res = await post<FriendRoomTicket>(name, FRIENDS_PATHS.join, { code });
  if (res.status !== 200)
    throw new Error(`join ${code} as ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function refusalOf(name: string, code: string): Promise<[number, string]> {
  const res = await post<FriendsError>(name, FRIENDS_PATHS.join, { code });
  return [res.status, res.body.error];
}

/** A connection to a friends room and everything it received. */
class Seat {
  readonly messages: ServerMessage[] = [];
  left: number | null = null;
  private seq = 0;
  private readonly waiters = new Set<() => void>();

  constructor(
    readonly room: SdkRoom,
    readonly name: string,
  ) {
    room.reconnection.enabled = false;
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

  static async enter(name: string, ticket: FriendRoomTicket): Promise<Seat> {
    return new Seat(await sdk(name).consumeSeatReservation(ticket.reservation), name);
  }

  get id(): string {
    return idOf(this.name);
  }

  send(type: string, payload: unknown = {}): void {
    this.room.send(type, payload);
  }

  act(action: ClientAction): void {
    this.room.send(action.type, { ...action, clientSeq: ++this.seq });
  }

  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }

  get lobby(): Extract<ServerMessage, { type: 'lobby' }> | undefined {
    return this.of('lobby').at(-1);
  }

  get events(): GameEvent[] {
    return this.messages.flatMap((m) => (m.type === 'events' ? m.events : []));
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
        reject(new Error(`${this.name}: no ${what} within ${ms} ms`));
      }, ms);
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
      };
      this.waiters.add(check);
      check();
    });
  }

  /** The last `lobby` once it satisfies `test`. */
  lobbyWhere(test: (l: Extract<ServerMessage, { type: 'lobby' }>) => boolean, what: string) {
    return this.until(() => {
      const l = this.lobby;
      return l !== undefined && test(l) ? l : undefined;
    }, what);
  }

  event<T extends GameEventType>(type: T): Promise<Extract<GameEvent, { type: T }>> {
    return this.until(
      () => this.events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type),
      type,
    );
  }

  async fence(): Promise<void> {
    const at = Math.random();
    this.send('ping', { t: at });
    await this.until(() => this.of('pong').some((p) => p.t === at), 'pong');
  }

  private notify(): void {
    for (const w of [...this.waiters]) w();
  }
}

const ids = (seat: Seat) => seat.lobby?.players.map((p) => p.id) ?? [];

async function leaveAll(...seats: Seat[]): Promise<void> {
  await Promise.all(seats.filter((s) => s.left === null).map((s) => s.room.leave().catch(() => undefined)));
}

describe('a friends room in production (1.0.4)', () => {
  it('opens with POST /v1/rooms; its id is not its code; nobody gets in without a ticket', async () => {
    const ticket = await createRoom('Ana');
    const { code } = ticket.room;
    expect(code).toMatch(FRIEND_CODE_PATTERN);
    expect(ticket.reservation.name).toBe(FRIENDS_ROOM_NAME);
    expect(ticket.reservation.roomId).not.toBe(code);
    expect(ticket.room).toMatchObject({ gameType: 'normal', players: 1, maxPlayers: 4, state: 'lobby' });

    // The code is no room's id; the room's id, and a create, are refused to a client.
    await expect(sdk('Ben').joinById(code)).rejects.toThrow();
    const byId = await sdk('Ben')
      .joinById(ticket.reservation.roomId)
      .then(
        () => null,
        (e: Error) => e.message,
      );
    expect(gameRoomErrorOf(byId ?? '')).toBe('badOptions');
    const created = await sdk('Ben')
      .create(FRIENDS_ROOM_NAME, {})
      .then(
        () => null,
        (e: Error) => e.message,
      );
    expect(gameRoomErrorOf(created ?? '')).toBe('badOptions');
    // The dev rooms with a code stay closed in production.
    const dev = await sdk('Ben')
      .create(GAME_ROOM_NAME, { private: true })
      .then(
        () => null,
        (e: Error) => e.message,
      );
    expect(gameRoomErrorOf(dev ?? '')).toBe('badOptions');

    const ana = await Seat.enter('Ana', ticket);
    const lobby = await ana.until(() => ana.lobby, 'lobby');
    expect(lobby).toEqual({
      type: 'lobby',
      code,
      gameType: 'normal',
      playerCount: 4,
      players: [{ id: ana.id, name: 'Ana_Pal', avatarId: 'noam', country: 'IL', rating: null, away: false }],
      playerId: ana.id,
      hostId: ana.id,
      minPlayers: 2,
      maxPlayers: 4,
    });
    await leaveAll(ana);
    // Everyone left: the room closes, and its code says so for a while.
    expect(
      await (async () => {
        for (let k = 0; k < 40; k++) {
          const [status, error] = await refusalOf('Ben', code);
          if (error === 'roomClosed') return status;
          await new Promise((r) => setTimeout(r, 50));
        }
        return null;
      })(),
    ).toBe(410);
  });

  it('join, the host’s commands, a kick, the start, and a game stored unrated as friends', async () => {
    const ticket = await createRoom('Ana');
    const { code } = ticket.room;
    const ana = await Seat.enter('Ana', ticket);
    // Ben's email is not verified [D85b].
    const ben = await Seat.enter('Ben', await ticketTo('Ben', code));
    await ana.lobbyWhere((l) => l.players.length === 2, 'Ben in the lobby');
    expect(ids(ana)).toEqual([ana.id, ben.id]);
    expect((await ben.lobbyWhere((l) => l.players.length === 2, 'the lobby')).hostId).toBe(ana.id);

    // Not the host: refused to Ben only.
    ben.send('start');
    expect(await ben.until(() => ben.of('lobbyRefused')[0], 'lobbyRefused')).toEqual({
      type: 'lobbyRefused',
      command: 'start',
      reason: 'notHost',
    });
    // [D82] The host picks the game type; everyone sees it.
    ana.send('setGameType', { gameType: 'fast' });
    await ben.lobbyWhere((l) => l.gameType === 'fast', 'the new game type');
    ana.send('setGameType', { gameType: 'turbo' });
    expect((await ana.until(() => ana.of('lobbyRefused')[0], 'badCommand')).reason).toBe('badCommand');

    // [D85a] A kick: out with `kicked`, and no way back.
    const cy = await Seat.enter('Cy', await ticketTo('Cy', code));
    await ana.lobbyWhere((l) => l.players.length === 3, 'Cy in the lobby');
    ana.send('kick', { playerId: cy.id });
    expect(await cy.until(() => cy.of('roomClosed')[0], 'roomClosed')).toEqual({
      type: 'roomClosed',
      reason: 'kicked',
    });
    await cy.until(() => cy.left !== null, 'the kicked connection to close');
    await ana.lobbyWhere((l) => l.players.length === 2, 'Cy out');
    expect(await refusalOf('Cy', code)).toEqual([403, 'kicked']);

    // Start: 3… 2… 1…, then the game at GO.
    ana.send('start');
    const countdown = await ben.until(() => ben.of('countdown')[0], 'countdown');
    expect(countdown.startsAt - countdown.serverTime).toBeLessThanOrEqual(COUNTDOWN_MS);
    await Promise.all([ana.event('gameStarted'), ben.event('gameStarted')]);
    const snapshot = ana.of('snapshot')[0]!;
    expect(snapshot.state.config.players).toEqual([
      { id: ana.id, name: 'Ana_Pal' },
      { id: ben.id, name: 'Ben_Pal' },
    ]);
    expect(snapshot.state.config.puzzle.id).toBe(NEARLY_DONE.id);
    expect(snapshot.state.config.puzzle.solution).not.toBe(NEARLY_DONE.solution);
    // Nobody else gets in now.
    expect(await refusalOf('Dan', code)).toEqual([409, 'gameStarted']);
    ana.send('setGameType', { gameType: 'hard' });
    expect((await ana.until(() => ana.of('lobbyRefused')[1], 'gameStarted')).reason).toBe('gameStarted');

    const ratingsBefore = await t.db.select().from(ratings);
    for (const cell of [0, 13, 40, 80]) {
      ana.act({ type: 'select', cell });
      await ana.until(() => ana.events.some((e) => e.type === 'cellLocked' && e.cell === cell), 'the lock');
      ana.act({ type: 'place', cell, digit: digitAt(NEARLY_DONE, cell) });
      await ana.until(
        () => ana.events.some((e) => e.type === 'placedCorrect' && e.cell === cell),
        'the digit',
      );
    }
    const over = await ben.event('gameOver');
    expect(over.ratingChanges ?? []).toEqual([]);

    const game = await until(
      async () =>
        (
          await t.db
            .select()
            .from(games)
            .where(and(isNotNull(games.endedAt), eq(games.mode, 'friends')))
        )[0],
      'the friends game, stored',
    );
    expect(game).toMatchObject({
      mode: 'friends',
      gameType: 'fast',
      playerCount: 2,
      endReason: 'boardComplete',
    });
    expect(await t.db.select().from(ratings)).toEqual(ratingsBefore);
    const played = await t.db.select().from(puzzleHistory).where(eq(puzzleHistory.puzzleId, NEARLY_DONE.id));
    expect(played.map((r) => r.userId).sort()).toEqual([ana.id, ben.id].sort());
    // [D81b] Friends become each other's recent opponents.
    const met = await t.db.select().from(opponentHistory).where(eq(opponentHistory.userId, ben.id));
    expect(met.map((r) => r.opponentId)).toEqual([ana.id]);
    // No achievements from a friends game.
    expect(await t.db.select().from(userAchievements)).toEqual([]);
    await leaveAll(ana, ben, cy);
  });

  it('a drop holds the seat; back by token, or by a new ticket (the same seat); start without an away seat', async () => {
    const ticket = await createRoom('Dan');
    const { code } = ticket.room;
    const dan = await Seat.enter('Dan', ticket);
    let eve = await Seat.enter('Eve', await ticketTo('Eve', code));
    await dan.lobbyWhere((l) => l.players.length === 2, 'Eve in');

    // A drop (no goodbye): the seat is held, away [D84a].
    let token = eve.room.reconnectionToken;
    void eve.room.leave(false);
    await dan.lobbyWhere((l) => l.players[1]?.away === true, 'Eve away');
    dan.send('start');
    expect((await dan.until(() => dan.of('lobbyRefused')[0], 'refused')).reason).toBe('notEnoughPlayers');
    // Back with the reconnection token.
    eve = new Seat(await sdk().reconnect(token), 'Eve');
    await dan.lobbyWhere((l) => l.players[1]?.away === false, 'Eve back');

    // The app closed (no token): a new ticket takes the same seat; the host stays the host.
    void eve.room.leave(false);
    await dan.lobbyWhere((l) => l.players[1]?.away === true, 'Eve away again');
    eve = await Seat.enter('Eve', await ticketTo('Eve', code));
    const back = await dan.lobbyWhere((l) => l.players[1]?.away === false, 'Eve in again');
    expect(back.players.map((p) => p.id)).toEqual([dan.id, eve.id]);
    expect(back.hostId).toBe(dan.id);

    // Another device while connected: the earlier connection is told, and closed.
    const earlier = eve;
    eve = await Seat.enter('Eve', await ticketTo('Eve', code));
    expect(await earlier.until(() => earlier.of('roomClosed')[0], 'otherDevice')).toEqual({
      type: 'roomClosed',
      reason: 'otherDevice',
    });
    await earlier.until(() => earlier.left !== null, 'the earlier connection to close');
    await eve.until(() => eve.lobby, 'the lobby on the new device');
    expect(ids(dan)).toEqual([dan.id, eve.id]);

    // [D83] Fay is away: start needs the host's yes for her.
    const fay = await Seat.enter('Fay', await ticketTo('Fay', code));
    await dan.lobbyWhere((l) => l.players.length === 3, 'Fay in');
    token = fay.room.reconnectionToken;
    void fay.room.leave(false);
    await dan.lobbyWhere((l) => l.players[2]?.away === true, 'Fay away');
    dan.send('start');
    expect(await dan.until(() => dan.of('lobbyRefused')[1], 'playersAway')).toEqual({
      type: 'lobbyRefused',
      command: 'start',
      reason: 'playersAway',
      away: [fay.id],
    });
    dan.send('start', { withoutAway: [fay.id] });
    await Promise.all([dan.event('gameStarted'), eve.event('gameStarted')]);
    expect(dan.of('snapshot')[0]!.state.config.players.map((p) => p.id)).toEqual([dan.id, eve.id]);
    // Fay, back: her seat is gone, and the game started without her.
    await expect(sdk().reconnect(token)).rejects.toThrow();
    expect(await refusalOf('Fay', code)).toEqual([409, 'gameStarted']);
    // A player of the game who left gets a ticket back into it.
    await eve.room.leave();
    const again = await Seat.enter('Eve', await ticketTo('Eve', code));
    await again.until(() => again.of('snapshot')[0], 'the game again');
    // Done: Dan gives up, and the game is stored before the server goes.
    dan.act({ type: 'surrender' });
    await again.event('gameOver');
    const gameId = dan.of('snapshot')[0]!.state.config.id;
    const stored = await until(
      async () =>
        (
          await t.db
            .select()
            .from(games)
            .where(and(eq(games.id, gameId), isNotNull(games.endedAt)))
        )[0],
      'the game, stored',
    );
    expect(stored).toMatchObject({ mode: 'friends', endReason: 'lastPlayerStanding' });
    await leaveAll(dan, again);
  });

  it('the host leaves: the earliest of the others is the host [D84b]', async () => {
    const ticket = await createRoom('Gus');
    const { code } = ticket.room;
    const gus = await Seat.enter('Gus', ticket);
    const hal = await Seat.enter('Hal', await ticketTo('Hal', code));
    const ivy = await Seat.enter('Ivy', await ticketTo('Ivy', code));
    await ivy.lobbyWhere((l) => l.players.length === 3, 'everyone in');
    await gus.room.leave();
    const after = await ivy.lobbyWhere((l) => l.players.length === 2, 'Gus out');
    expect(after.hostId).toBe(hal.id);
    // The new host runs the room.
    ivy.send('setGameType', { gameType: 'hard' });
    expect((await ivy.until(() => ivy.of('lobbyRefused')[0], 'notHost')).reason).toBe('notHost');
    hal.send('setGameType', { gameType: 'hard' });
    await ivy.lobbyWhere((l) => l.gameType === 'hard', 'hard');
    await leaveAll(hal, ivy);
  });

  it('[D85c] a block inside the lobby: the blocked one is out, told only "removed"', async () => {
    const ticket = await createRoom('Jo');
    const { code } = ticket.room;
    const jo = await Seat.enter('Jo', ticket);
    const ivy = await Seat.enter('Ivy', await ticketTo('Ivy', code));
    await jo.lobbyWhere((l) => l.players.length === 2, 'Ivy in');
    const res = await post('Jo', MODERATION_PATHS.blocks, {
      playerId: ivy.id,
    });
    expect(res.status).toBe(201);
    expect(await ivy.until(() => ivy.of('roomClosed')[0], 'removed')).toEqual({
      type: 'roomClosed',
      reason: 'removed',
    });
    await jo.lobbyWhere((l) => l.players.length === 1, 'Ivy out');
    // Back with the code: "no such room", like a wrong code; the one who blocked is told why.
    expect(await refusalOf('Ivy', code)).toEqual([404, 'notFound']);
    await call(url, 'DELETE', blockPath(ivy.id), {
      token: account('Jo').token,
      headers: { connection: 'close' },
    });
    await leaveAll(jo, ivy);
  });

  it('rate limits the host’s commands (start, setGameType and kick together)', async () => {
    const ticket = await createRoom('Hal');
    const hal = await Seat.enter('Hal', ticket);
    await hal.until(() => hal.lobby, 'the lobby');
    const burst: [string, object][] = [
      ['setGameType', { gameType: 'fast' }],
      ['kick', { playerId: idOf('Ivy') }],
      ['start', {}],
      ['setGameType', { gameType: 'hard' }],
      ['kick', { playerId: idOf('Ivy') }],
      ['start', {}],
      ['start', {}],
    ];
    expect(burst).toHaveLength(COMMANDS.limit + 1);
    for (const [type, payload] of burst) hal.send(type, payload);
    await hal.fence();
    expect(hal.of('lobbyRefused').map((r) => [r.command, r.reason])).toEqual([
      ['kick', 'badCommand'],
      ['start', 'notEnoughPlayers'],
      ['kick', 'badCommand'],
      ['start', 'notEnoughPlayers'],
      ['start', 'tooManyRequests'],
    ]);
    expect(hal.lobby?.gameType).toBe('hard');
    await leaveAll(hal);
  });

  it('the fake client (--friends <code>) joins with its token, waits for the host, and plays to the end', async () => {
    const ticket = await createRoom('Gus');
    const gus = await Seat.enter('Gus', ticket);
    const fake = await FakeClient.connect({
      url,
      name: 'Jo_Pal',
      friends: ticket.room.code,
      account: { token: account('Jo').token },
      thinkScale: 0.02,
      interfere: false,
      react: false,
      seed: 7,
    });
    await gus.lobbyWhere((l) => l.players.length === 2, 'the fake client in the lobby');
    gus.send('start');
    const summary = await fake.done;
    expect(summary).toMatchObject({ outcome: 'over', playerId: idOf('Jo'), place: 1, players: 2 });
    await leaveAll(gus);
  });

  it('logged nothing unexpected', () => {
    expect(log.errors).toEqual([]);
  });
});

async function until<T>(find: () => Promise<T | undefined | null>, what: string, ms = 5000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
    const found = await find();
    if (found !== undefined && found !== null) return found;
  }
  throw new Error(`no ${what} within ${ms} ms`);
}
