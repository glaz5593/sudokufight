/**
 * The stealth bot on the real server (Colyseus + Express + an in-memory PGlite, one port), with real SDK clients
 * of registered accounts (stealth-bot.md §4, §7, §12) [D90, D92, D94, D95]. Two games, one after the other:
 * 1. Ana and Ben, two people, meet in `fast-2p` and play (the switch off);
 * 2. Cy searches alone with the switch on: after the drawn wait a persona is "found" (made on demand in the
 *    database), its seat "connects" on its own, the engine's bot plays it in the game room, and the game is rated
 *    and stored as any (games.stealth for the admin only).
 * Then the wire test: everything Cy's app received has the shapes of what Ana's app received from a person
 * (matchmaking and game room, message by message), and nothing in it says "bot". The one difference is D95's,
 * by design: while a persona is within reach, `searching` leaves out `nextRange` (as an older server did).
 *
 * The server is put together here as createAppServer does (app.ts), with the stealth bot wired in: its settings
 * shortened for real time (a 300 ms wait, a 200 ms "connect", a 200 ms countdown) and a quick pace.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import { createRng, type GameEvent, INTERFERENCE_KINDS, type PaceHistory } from '@sudoku-fight/engine';
import {
  ACCOUNT_PATHS,
  devToken,
  GAME_ROOM_NAME,
  MATCHMAKING_ROOM_NAME,
  MATCHMAKING_SERVER_MESSAGE_TYPES,
  type MatchmakingServerMessage,
  type Me,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';
import { and, eq, inArray } from 'drizzle-orm';

import { gameDepsFor } from '../src/app';
import { DEFAULT_STEALTH_BOT } from '../src/config';
import { gamePlayers, games, users } from '../src/db/schema';
import { configureHttp } from '../src/http';
import {
  colyseusMatchGames,
  createMatchmakingRoom,
  dbMatchmakingStore,
  DEFAULT_MATCHMAKING,
  MATCHMAKING_ROOM_DEFAULTS,
  matchmakingIdentityVerifier,
  MatchmakingService,
} from '../src/matchmaking';
import { BlockWatch } from '../src/moderation/watch';
import { createGameRoom, systemScheduler } from '../src/rooms/GameRoom';
import { dbPersonaSource, StealthMatcher } from '../src/stealth/match';
import { dbStealthSwitchStore, StealthSwitch } from '../src/stealth/switch';
import {
  createTestDb,
  digitAt,
  emptyCells,
  NEARLY_DONE,
  quietLog,
  testConfig,
  testPuzzles,
  type TestDb,
} from '../src/testing';
import { call, fighter } from '../src/testing/accounts';
import { addPuzzles } from '../src/testing/ranked';
import { testTokens, type TestTokens } from '../src/testing/tokens';

let t: TestDb;
let tokens: TestTokens;
let server: ReturnType<typeof defineServer>;
let stealthSwitch: StealthSwitch;
let url = '';
const log = quietLog();

/** A quick player: an ordinary move of 3 s in each of his last games (the bot's floor). */
const quickPace = (gameType: 'fast' | 'normal' | 'hard'): PaceHistory => ({
  gameType,
  games: Array.from({ length: 5 }, () => ({
    gameType,
    paceMs: 3000,
    paceMoves: 30,
    digits: 30,
    mistakes: 0,
  })),
  stealthWins: [],
});

beforeAll(async () => {
  t = await createTestDb();
  tokens = await testTokens();
  const config = testConfig();
  const db = t.db;
  const verifier = tokens.verifier(Date.now);
  stealthSwitch = new StealthSwitch({ available: true, store: dbStealthSwitchStore(db), now: Date.now, log });
  const stealth = new StealthMatcher({
    settings: {
      ...DEFAULT_STEALTH_BOT,
      enabled: true,
      afterMs: { min: 300, max: 300 },
      readyAfterMs: { min: 200, max: 200 },
      personaPoolMax: 10,
    },
    switch: stealthSwitch,
    personas: dbPersonaSource(db, {
      ratingOption: config.ratingOption,
      poolMax: 10,
      rng: createRng(3),
      now: Date.now,
    }),
    pace: { history: (_userId, gameType) => Promise.resolve(quickPace(gameType)) },
    random: randomInt,
    now: Date.now,
    log,
  });
  const matchmaking = new MatchmakingService({
    store: dbMatchmakingStore(db),
    games: colyseusMatchGames(),
    ratingOption: config.ratingOption,
    now: Date.now,
    scheduler: systemScheduler,
    newId: randomUUID,
    log,
    config: { ...DEFAULT_MATCHMAKING, tickMs: 50, readyTimeoutMs: 4000, countdownMs: 200 },
    stealth,
  });
  const blockWatch = new BlockWatch();
  const gameDeps = gameDepsFor(
    config,
    {
      puzzles: testPuzzles,
      log,
      closeAfterGameMs: 500,
      matches: matchmaking,
      stealth: { secret: 'the-stealth-secret-of-this-test-0123456789' },
    },
    { tokens: verifier, db, blockWatch },
  );
  server = defineServer({
    greet: false,
    gracefullyShutdown: false,
    transport: new WebSocketTransport({ server: createServer() }),
    rooms: {
      [GAME_ROOM_NAME]: defineRoom(createGameRoom(gameDeps)),
      [MATCHMAKING_ROOM_NAME]: defineRoom(
        createMatchmakingRoom({
          service: matchmaking,
          identity: matchmakingIdentityVerifier({ config, tokens: verifier, db }),
          log,
          ...MATCHMAKING_ROOM_DEFAULTS,
        }),
      ),
    },
    express: (app) => configureHttp(app, { config, db, now: Date.now, tokens: verifier, blockWatch }),
  });
  server.onShutdown(() => matchmaking.close());
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
  await addPuzzles(t.db, [NEARLY_DONE], { gameType: 'fast' });
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await t.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
}, 15_000);

// ---------------------------------------------------------------------------------------------------------

async function player(uid: string, displayName: string): Promise<{ me: Me; client: Client }> {
  const token = devToken(uid);
  const res = await call<Me>(url, 'POST', ACCOUNT_PATHS.users, {
    token,
    body: fighter({ displayName }),
    headers: { connection: 'close' },
  });
  expect(res.status).toBe(201);
  const client = new Client(url);
  client.auth.token = token;
  return { me: res.body, client };
}

class Inbox<M extends { type: string }> {
  readonly messages: M[] = [];
  private seq = 0;
  constructor(
    readonly room: SdkRoom,
    types: readonly string[],
  ) {
    room.reconnection.enabled = false;
    for (const type of types) room.onMessage(type, (m: M) => this.messages.push(m));
  }
  of<T extends M['type']>(type: T): Extract<M, { type: T }>[] {
    return this.messages.filter((m): m is Extract<M, { type: T }> => m.type === type);
  }
  async until<T>(find: () => T | undefined | null | false, what: string, ms = 10_000): Promise<T> {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 15))) {
      const found = find();
      if (found) return found;
    }
    throw new Error(`no ${what} within ${ms} ms; got ${this.messages.map((m) => m.type).join(', ')}`);
  }
  message<T extends M['type']>(type: T, n = 1): Promise<Extract<M, { type: T }>> {
    return this.until(() => this.of(type)[n - 1], `${type} #${n}`);
  }
  send(action: { type: string } & Record<string, unknown>): void {
    this.room.send(action.type, { ...action, clientSeq: ++this.seq });
  }
}

type Search = Inbox<MatchmakingServerMessage>;
type Game = Inbox<ServerMessage>;

const eventsOf = (g: Game): GameEvent[] => g.of('events').flatMap((m) => m.events);
const actor = (e: GameEvent): string | undefined =>
  'playerId' in e ? e.playerId : 'fromId' in e ? (e as { fromId: string }).fromId : undefined;

async function search(client: Client): Promise<Search> {
  const room = await client.joinOrCreate(MATCHMAKING_ROOM_NAME, {
    queueKey: 'fast-2p',
    interferenceKinds: [...INTERFERENCE_KINDS],
  });
  return new Inbox<MatchmakingServerMessage>(room, MATCHMAKING_SERVER_MESSAGE_TYPES);
}

async function enter(
  client: Client,
  found: Extract<MatchmakingServerMessage, { type: 'found' }>,
): Promise<Game> {
  const room = await client.consumeSeatReservation(found.reservation);
  return new Inbox<ServerMessage>(room, SERVER_MESSAGE_TYPES);
}

/** Places the right digit in each of `cells` not filled yet, one at a time (a cell the other holds: later). */
async function fill(game: Game, cells: readonly number[]): Promise<void> {
  const filled = () => new Set(eventsOf(game).flatMap((e) => (e.type === 'placedCorrect' ? [e.cell] : [])));
  const over = () => eventsOf(game).some((e) => e.type === 'gameOver');
  for (let round = 0; round < 40 && !over(); round++) {
    const cell = cells.find((c) => !filled().has(c));
    if (cell === undefined) return;
    const before = game.messages.length;
    game.send({ type: 'select', cell });
    game.send({ type: 'place', cell, digit: digitAt(NEARLY_DONE, cell) });
    await game.until(
      () => filled().has(cell) || over() || game.messages.slice(before).some((m) => m.type === 'rejected'),
      `cell ${cell}`,
    );
    if (!filled().has(cell)) await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * The shape of a value: its type; an object's keys (sorted) and their shapes; an array's element shapes, each
 * once. Numbers, strings and ids differ from game to game; the shape is what an app could tell apart.
 */
function shape(v: unknown): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    const each = [...new Set(v.map((x) => JSON.stringify(shape(x))))].sort();
    return each.map((s) => JSON.parse(s) as unknown);
  }
  if (typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, shape((v as Record<string, unknown>)[k])]),
    );
  return typeof v;
}

/** Each kind of message once, by its type: the shapes of all of that type (a union). */
function shapesByType(messages: readonly { type: string }[]): Record<string, unknown> {
  const by: Record<string, unknown[]> = {};
  for (const m of messages) (by[m.type] ??= []).push(m);
  return Object.fromEntries(Object.entries(by).map(([type, list]) => [type, shape(list)]));
}

/** The opponent's events, by type: their shapes. */
function opponentEventShapes(game: Game, opponentId: string): Record<string, unknown> {
  return shapesByType(eventsOf(game).filter((e) => actor(e) === opponentId));
}

// ---------------------------------------------------------------------------------------------------------

describe('the stealth bot on the server', () => {
  let human: { search: Search; game: Game; opponentId: string };
  let stealth: { search: Search; game: Game; opponentId: string; meId: string };

  it('off: two people meet and play as always (the human game to compare with)', async () => {
    expect((await stealthSwitch.state()).on).toBe(false);
    const ana = await player('st_ana', 'St_Ana');
    const ben = await player('st_ben', 'St_Ben');
    const anaSearch = await search(ana.client);
    const benSearch = await search(ben.client);
    const [fa, fb] = await Promise.all([anaSearch.message('found'), benSearch.message('found')]);
    const anaGame = await enter(ana.client, fa);
    await new Promise((r) => setTimeout(r, 250)); // the other one "connects" a moment later
    const benGame = await enter(ben.client, fb);
    await anaSearch.message('started');
    await anaGame.until(() => eventsOf(anaGame).some((e) => e.type === 'gameStarted'), 'gameStarted');
    const cells = emptyCells(NEARLY_DONE);
    await fill(benGame, cells.slice(0, 1));
    await fill(anaGame, cells);
    await anaGame.message('solution');
    human = { search: anaSearch, game: anaGame, opponentId: ben.me.id };
    await benGame.room.leave().catch(() => undefined);
  }, 30_000);

  it('on: alone after the wait, a persona is found, connects by itself, and plays its seat; rated (D92)', async () => {
    await stealthSwitch.set(true, 'admin@example.com');
    const cy = await player('st_cy', 'St_Cy');
    const cySearch = await search(cy.client);
    const first = await cySearch.message('searching');
    // [D95] A persona can be made within his reach: no "nobody else is searching".
    expect(first).not.toHaveProperty('nextRange');
    const found = await cySearch.message('found');
    const persona = found.players.find((p) => p.id !== cy.me.id)!;
    // An id like a person's, never a practice bot's (the app's playerIdentity: /^bot-\d$/).
    expect(persona.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(persona.id).not.toMatch(/^bot-\d$/);
    const [row] = await t.db.select().from(users).where(eq(users.id, persona.id));
    expect(row).toMatchObject({ kind: 'persona', displayName: persona.name });

    const cyGame = await enter(cy.client, found);
    // The persona is in on its own ("connected"), the countdown, GO.
    await cySearch.until(() => cySearch.of('ready').find((r) => r.ready.length === 2), 'both ready');
    await cySearch.message('started');
    const snapshot = await cyGame.message('snapshot');
    expect(snapshot.state.players.map((p) => p.id)).toEqual([cy.me.id, persona.id]);
    expect(snapshot.state.config.rules.interferenceKinds).toEqual([...INTERFERENCE_KINDS]);
    // The solution stays on the server until the end, as in any ranked game (spec §21).
    expect(JSON.stringify(snapshot)).not.toContain(NEARLY_DONE.solution);
    // The bot plays its seat: a digit of its own, through the engine.
    await cyGame.until(
      () => eventsOf(cyGame).some((e) => e.type === 'placedCorrect' && e.playerId === persona.id),
      'the bot’s move',
      15_000,
    );
    await fill(cyGame, emptyCells(NEARLY_DONE));
    const over = await cyGame.until(
      () =>
        eventsOf(cyGame).find((e): e is Extract<GameEvent, { type: 'gameOver' }> => e.type === 'gameOver'),
      'gameOver',
    );
    // [D92] Rated as usual, both seats.
    expect(over.ratingChanges?.map((c) => c.playerId).sort()).toEqual([cy.me.id, persona.id].sort());
    expect((await cyGame.message('solution')).solution).toBe(NEARLY_DONE.solution);
    stealth = { search: cySearch, game: cyGame, opponentId: persona.id, meId: cy.me.id };

    // Stored like any ranked game; marked for the admin site only.
    const rows = await waitFor(async () => {
      const r = await t.db
        .select({ id: games.id, stealth: games.stealth, endedAt: games.endedAt })
        .from(games)
        .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
        .where(and(eq(gamePlayers.userId, persona.id)));
      return r.length > 0 && r[0]!.endedAt !== null ? r : null;
    });
    expect(rows[0]!.stealth).toBe(true);
    const seats = await t.db
      .select({
        userId: gamePlayers.userId,
        before: gamePlayers.ratingBefore,
        after: gamePlayers.ratingAfter,
      })
      .from(gamePlayers)
      .where(inArray(gamePlayers.gameId, [rows[0]!.id]));
    expect(seats.every((s) => s.after !== null && s.after !== s.before)).toBe(true);
    const [humanGame] = await t.db
      .select({ stealth: games.stealth })
      .from(games)
      .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
      .where(eq(gamePlayers.userId, human.opponentId));
    expect(humanGame!.stealth).toBe(false);
  }, 40_000);

  it('the wire: what Cy’s app got has the shapes of what Ana’s got from a person; nothing says "bot"', () => {
    // Matchmaking: the same messages, the same shapes (`found` and its players' profiles included), but for
    // D95's `searching` without `nextRange`.
    const mmHuman = shapesByType(human.search.messages.filter((m) => m.type !== 'searching'));
    const mmStealth = shapesByType(stealth.search.messages.filter((m) => m.type !== 'searching'));
    expect(Object.keys(mmStealth).sort()).toEqual(Object.keys(mmHuman).sort());
    expect(mmStealth).toEqual(mmHuman);
    const searchingKeys = (s: Search) =>
      [...new Set(s.of('searching').flatMap((m) => Object.keys(m)))].sort();
    expect(searchingKeys(stealth.search)).toEqual(
      searchingKeys(human.search).filter((k) => k !== 'nextRange'),
    );

    // The game room: lobby, countdown, snapshot, solution… the same shapes.
    const roomShapes = (g: Game) =>
      shapesByType(g.messages.filter((m) => m.type !== 'events' && m.type !== 'pong'));
    expect(roomShapes(stealth.game)).toEqual(roomShapes(human.game));
    // The opponent's events: each kind the bot made has the shape of a person's of that kind.
    const fromPerson = opponentEventShapes(human.game, human.opponentId);
    const fromBot = opponentEventShapes(stealth.game, stealth.opponentId);
    for (const type of Object.keys(fromPerson))
      if (type in fromBot) expect(fromBot[type]).toEqual(fromPerson[type]);
    expect(fromBot).toHaveProperty('placedCorrect');
    expect(fromBot).toHaveProperty('cellLocked');
    // The end of the game: the same shape.
    const endOf = (g: Game) => shape(eventsOf(g).find((e) => e.type === 'gameOver'));
    expect(endOf(stealth.game)).toEqual(endOf(human.game));

    // Nothing anywhere says what the opponent is.
    const everything = JSON.stringify([stealth.search.messages, stealth.game.messages]);
    expect(everything).not.toMatch(/isBot|persona|stealth|"bot-\d"/i);
  });
});

async function waitFor<T>(find: () => Promise<T | null>, ms = 5000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    const found = await find();
    if (found !== null) return found;
  }
  throw new Error('not in time');
}
