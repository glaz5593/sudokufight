/**
 * Stage 9: rated rooms on the real server (Colyseus + Express + an in-memory PGlite, one port), with real SDK
 * clients signed in with development tokens. Two accounts play a rated game; the room takes the puzzle from
 * the ranked pool in the database, the players' ratings into the game, records the game while it runs, and at
 * the end the database has the game, its players and events, and both ratings moved by the formula (spec §11,
 * §19, §20). A rated room with a player who has no account can't start, and closes.
 */
import type { AddressInfo } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import { type ClientAction, eloChanges, type GameConfig, type GameEvent } from '@sudoku-fight/engine';
import {
  ACCOUNT_PATHS,
  devToken,
  GAME_ROOM_NAME,
  type Me,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';
import { and, asc, eq, isNotNull } from 'drizzle-orm';

import { createAppServer } from '../src/app';
import { gameEvents, gamePlayers, games, puzzleHistory, ratings } from '../src/db/schema';
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
import { addPuzzles } from '../src/testing/ranked';
import { testTokens } from '../src/testing/tokens';

let t: TestDb;
let server: ReturnType<typeof createAppServer>;
let url = '';
const log = quietLog();

beforeAll(async () => {
  t = await createTestDb();
  const tokens = await testTokens();
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig(),
    db: t,
    tokens: tokens.verifier(Date.now),
    game: { puzzles: testPuzzles, log, closeAfterGameMs: 300 },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
  // The ranked pool: one fast puzzle, four cells from the end.
  await addPuzzles(t.db, [NEARLY_DONE], { gameType: 'fast' });
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await t.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

async function register(token: string, displayName: string): Promise<Me> {
  const res = await call<Me>(url, 'POST', ACCOUNT_PATHS.users, {
    token,
    body: fighter({ displayName }),
    headers: { connection: 'close' },
  });
  expect(res.status).toBe(201);
  return res.body;
}

function clientWith(token?: string): Client {
  const client = new Client(url);
  if (token !== undefined) client.auth.token = token;
  return client;
}

/** An SDK room and what it received. */
class Seat {
  readonly messages: ServerMessage[] = [];
  left: number | null = null;
  private seq = 0;

  constructor(readonly room: SdkRoom) {
    room.reconnection.enabled = false;
    for (const type of SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m: ServerMessage) => this.messages.push(m));
    room.onLeave((code: number) => {
      this.left = code;
    });
  }

  act(action: ClientAction): void {
    this.room.send(action.type, { ...action, clientSeq: ++this.seq });
  }

  get events(): GameEvent[] {
    return this.messages.flatMap((m) => (m.type === 'events' ? m.events : []));
  }

  async until<T>(find: () => T | undefined | null | false, what: string, ms = 5000): Promise<T> {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 15))) {
      const found = find();
      if (found) return found;
    }
    throw new Error(`no ${what} within ${ms} ms`);
  }

  event(type: GameEvent['type'], n = 1): Promise<GameEvent> {
    return this.until(() => this.events.filter((e) => e.type === type)[n - 1], `${type} #${n}`);
  }
}

async function until<T>(find: () => Promise<T | undefined | null>, what: string, ms = 5000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
    const found = await find();
    if (found !== undefined && found !== null) return found;
  }
  throw new Error(`no ${what} within ${ms} ms`);
}

describe('rated rooms (stage 9)', () => {
  it('two accounts play a rated game: it is stored, and both ratings move by the formula', async () => {
    const anaToken = devToken('ana_uid');
    const benToken = devToken('ben_uid');
    const ana = await register(anaToken, 'Ana_Dev');
    const ben = await register(benToken, 'Ben_Dev');

    const anaSeat = new Seat(
      await clientWith(anaToken).create(GAME_ROOM_NAME, { private: true, rated: true }),
    );
    const benSeat = new Seat(await clientWith(benToken).joinById(anaSeat.room.roomId));
    await Promise.all([anaSeat.event('gameStarted'), benSeat.event('gameStarted')]);

    // The game the clients got: the ranked puzzle, without its solution, and each player's rating.
    const snapshot = anaSeat.messages.find(
      (m): m is Extract<ServerMessage, { type: 'snapshot' }> => m.type === 'snapshot',
    );
    const config = snapshot!.state.config;
    expect(config.puzzle.id).toBe(NEARLY_DONE.id);
    expect(config.puzzle.solution).not.toBe(NEARLY_DONE.solution);
    expect(config.players).toEqual([
      { id: ana.id, name: 'Ana_Dev', rating: 1200, ratedGames: 0 },
      { id: ben.id, name: 'Ben_Dev', rating: 1200, ratedGames: 0 },
    ]);

    for (const [k, cell] of [0, 13, 40, 80].entries()) {
      anaSeat.act({ type: 'select', cell });
      await anaSeat.event('cellLocked', k + 1);
      anaSeat.act({ type: 'place', cell, digit: digitAt(NEARLY_DONE, cell) });
      await anaSeat.event('placedCorrect', k + 1);
    }
    await benSeat.event('gameOver');

    // Written in the background, in one transaction with the ratings.
    const game = await until(
      async () => (await t.db.select().from(games).where(isNotNull(games.endedAt)))[0],
      'a recorded game',
    );
    expect(game).toMatchObject({
      mode: 'ranked',
      gameType: 'fast',
      playerCount: 2,
      endReason: 'boardComplete',
    });

    // Both provisional (K = 64) and equal: the winner +32, the loser −32 (spec §11.2).
    const expected = eloChanges([
      { id: ana.id, rating: 1200, games: 0, place: 1 },
      { id: ben.id, rating: 1200, games: 0, place: 2 },
    ]);
    expect(expected.map((c) => c.after)).toEqual([1232, 1168]);
    const players = await t.db
      .select()
      .from(gamePlayers)
      .where(eq(gamePlayers.gameId, game.id))
      .orderBy(asc(gamePlayers.seat));
    expect(players.map((p) => [p.userId, p.place, p.ratingKey, p.ratingBefore, p.ratingAfter])).toEqual([
      [ana.id, 1, 'fast', 1200, 1232],
      [ben.id, 2, 'fast', 1200, 1168],
    ]);
    for (const [id, after] of [
      [ana.id, 1232],
      [ben.id, 1168],
    ] as const) {
      const [row] = await t.db
        .select()
        .from(ratings)
        .where(and(eq(ratings.userId, id), eq(ratings.ratingKey, 'fast')));
      expect(row).toMatchObject({ rating: after, games: 1, provisional: true });
    }
    expect(await t.db.select().from(puzzleHistory)).toHaveLength(2);

    // Every event is on the server, the solution included (for the replay), the same ones the clients saw.
    const stored = await t.db
      .select()
      .from(gameEvents)
      .where(eq(gameEvents.gameId, game.id))
      .orderBy(asc(gameEvents.seq));
    expect(stored[0]!.type).toBe('gameCreated');
    expect((stored[0]!.payload as { config: GameConfig }).config.puzzle.solution).toBe(NEARLY_DONE.solution);
    expect(stored.slice(1).map((e) => e.seq)).toEqual(anaSeat.events.map((e) => e.seq));
    expect(log.lines.some((l) => l.includes('started (rated)'))).toBe(true);
  });

  it('a rated room needs every player signed in with an account: without, it closes', async () => {
    // No token: the development identity (stage 7), which is not an account.
    const anaSeat = new Seat(
      await clientWith().create(GAME_ROOM_NAME, {
        private: true,
        rated: true,
        devUserId: 'ana',
        name: 'Ana',
      }),
    );
    const benSeat = new Seat(
      await clientWith().joinById(anaSeat.room.roomId, { devUserId: 'ben', name: 'Ben' }),
    );
    await anaSeat.until(() => anaSeat.left !== null && benSeat.left !== null, 'the room to close');
    expect(anaSeat.events).toEqual([]);
    expect(log.lines.some((l) => l.includes('the ranked game could not start'))).toBe(true);
    expect(log.errors.some((e) => e instanceof Error && e.name === 'NotRatedError')).toBe(true);
  });
});
