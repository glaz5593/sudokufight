/**
 * Stage 9: matchmaking on the real server (Colyseus + Express + an in-memory PGlite, one port), with real
 * SDK clients signed in with development tokens of registered accounts. Two players join the `fast-2p` queue,
 * both get a seat reservation in the same rated game room, connect (D37: ready), count down and play; a
 * search is cancelled; a lonely search times out and goes on with "keep searching"; a no-show cancels the
 * match and sends the other player back to the head of the queue.
 *
 * Real time, so the timings are shortened: a 50 ms round, an 800 ms timeout, a 1.5 s ready check and a
 * 200 ms countdown.
 */
import type { AddressInfo } from 'node:net';

import { CloseCode } from '@colyseus/core';
import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import { ColyseusTestServer } from '@colyseus/testing';
import {
  ACCOUNT_PATHS,
  devToken,
  MATCHMAKING_ROOM_NAME,
  MATCHMAKING_SERVER_MESSAGE_TYPES,
  type MatchmakingError,
  matchmakingErrorOf,
  type MatchmakingServerMessage,
  type Me,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { DEFAULT_MATCHER } from '../src/matchmaking';
import type { GameRoom } from '../src/rooms/GameRoom';
import { createTestDb, NEARLY_DONE, quietLog, testConfig, testPuzzles, type TestDb } from '../src/testing';
import { call, fighter } from '../src/testing/accounts';
import { addPuzzles } from '../src/testing/ranked';
import { testTokens } from '../src/testing/tokens';

let t: TestDb;
let server: ReturnType<typeof createAppServer>;
let colyseus: ColyseusTestServer;
let url = '';

const TIMEOUT_MS = 800;
const READY_MS = 1500;
const COUNTDOWN_MS = 200;

beforeAll(async () => {
  t = await createTestDb();
  const tokens = await testTokens();
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig(),
    db: t,
    tokens: tokens.verifier(Date.now),
    game: { puzzles: testPuzzles, log: quietLog(), closeAfterGameMs: 300 },
    matchmaking: {
      config: {
        tickMs: 50,
        matcher: { ...DEFAULT_MATCHER, timeoutMs: TIMEOUT_MS },
        extendedTimeoutMs: TIMEOUT_MS,
        keepSearchingWindowMs: 2000,
        readyTimeoutMs: READY_MS,
        countdownMs: COUNTDOWN_MS,
      },
    },
  });
  await server.listen(0);
  const { port } = server.transport.server!.address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
  // ColyseusTestServer builds its SDK client from the port the server was asked for (0 here).
  Object.assign(server, { port });
  colyseus = new ColyseusTestServer(server);
  // The ranked pool: one fast puzzle (a rated room takes its puzzle from the database).
  await addPuzzles(t.db, [NEARLY_DONE], { gameType: 'fast' });
}, 30_000);

afterAll(async () => {
  // A cancelled match's room lingers until its unused seat reservation runs out (about a second).
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await t.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
}, 15_000);

// ---------------------------------------------------------------------------------------------------------

/** A registered account and an SDK client signed in with its development token. */
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

/** An SDK room and everything it received, in order; `M` is the room's message union. */
class Inbox<M extends { type: string }> {
  readonly messages: M[] = [];
  left: number | null = null;
  private readonly waiters = new Set<() => void>();

  constructor(
    readonly room: SdkRoom,
    types: readonly string[],
  ) {
    room.reconnection.enabled = false;
    for (const type of types)
      room.onMessage(type, (m: M) => {
        this.messages.push(m);
        this.notify();
      });
    room.onLeave((code: number) => {
      this.left = code;
      this.notify();
    });
  }

  of<T extends M['type']>(type: T): Extract<M, { type: T }>[] {
    return this.messages.filter((m): m is Extract<M, { type: T }> => m.type === type);
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
        reject(new Error(`no ${what} within ${ms} ms; got ${this.messages.map((m) => m.type).join(', ')}`));
      }, ms);
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
      };
      this.waiters.add(check);
      check();
    });
  }

  message<T extends M['type']>(type: T, n = 1): Promise<Extract<M, { type: T }>> {
    return this.until(() => this.of(type)[n - 1], `${type} #${n}`);
  }

  closed(): Promise<number> {
    return this.until(() => (this.left === null ? null : { code: this.left }), 'close').then((l) => l.code);
  }

  private notify(): void {
    for (const w of [...this.waiters]) w();
  }
}

type Search = Inbox<MatchmakingServerMessage>;

async function search(client: Client, queueKey: unknown = 'fast-2p'): Promise<Search> {
  const room = await client.joinOrCreate(MATCHMAKING_ROOM_NAME, { queueKey });
  return new Inbox<MatchmakingServerMessage>(room, MATCHMAKING_SERVER_MESSAGE_TYPES);
}

async function enter(client: Client, found: Extract<MatchmakingServerMessage, { type: 'found' }>) {
  const room = await client.consumeSeatReservation(found.reservation);
  return new Inbox<ServerMessage>(room, SERVER_MESSAGE_TYPES);
}

/** The MatchmakingError of a refused join (or the whole message when it has none). */
async function refusal(p: Promise<SdkRoom>): Promise<string> {
  try {
    const room = await p;
    await room.leave();
  } catch (e) {
    const message = (e as Error).message;
    const error: MatchmakingError | null = matchmakingErrorOf(message);
    return error ?? message;
  }
  throw new Error('expected a refusal');
}

const leave = async (...inboxes: Inbox<{ type: string }>[]) => {
  await Promise.all(inboxes.filter((i) => i.left === null).map((i) => i.room.leave().catch(() => undefined)));
};

// ---------------------------------------------------------------------------------------------------------

describe('matchmaking', () => {
  it('two players in the queue get seats in the same rated room, count down, and play', async () => {
    const ana = await player('mm_ana', 'MM_Ana');
    const ben = await player('mm_ben', 'MM_Ben');
    const anaSearch = await search(ana.client);
    expect(await anaSearch.message('searching')).toMatchObject({
      queueKey: 'fast-2p',
      rating: 1200,
      elapsedMs: 0,
      range: 50,
      extended: false,
    });
    const benSearch = await search(ben.client);

    const [a, b] = await Promise.all([anaSearch.message('found'), benSearch.message('found')]);
    expect(a.reservation.roomId).toBe(b.reservation.roomId);
    expect(a.reservation.sessionId).not.toBe(b.reservation.sessionId);
    expect(a.matchId).toBe(b.matchId);
    expect(a.playerId).toBe(ana.me.id);
    expect(b.playerId).toBe(ben.me.id);
    expect(a.players.map((p) => [p.id, p.name, p.rating, p.provisional])).toEqual([
      [ana.me.id, 'MM_Ana', 1200, true],
      [ben.me.id, 'MM_Ben', 1200, true],
    ]);
    expect(a.rematch).toBe(false);

    const roomId = a.reservation.roomId;
    const setup = colyseus.getRoomById<GameRoom>(roomId).matchSetup;
    expect(setup).toMatchObject({ matchId: a.matchId, gameType: 'fast', playerCount: 2, ratingKey: 'fast' });

    // D37: connecting is being ready.
    const anaGame = await enter(ana.client, a);
    await anaSearch.until(() => anaSearch.of('ready').find((r) => r.ready.length === 1), 'ready 1');
    const benGame = await enter(ben.client, b);
    const countdown = await benSearch.message('countdown');
    expect(countdown.startsAt - countdown.serverTime).toBe(COUNTDOWN_MS);
    expect(anaSearch.of('ready').at(-1)!.ready).toEqual([ana.me.id, ben.me.id]);
    // Nothing of the board before GO.
    expect(anaGame.of('snapshot')).toEqual([]);

    expect(await anaSearch.message('started')).toEqual({ type: 'started', matchId: a.matchId, roomId });
    expect(await anaSearch.closed()).toBe(CloseCode.CONSENTED);
    expect(await benSearch.closed()).toBe(CloseCode.CONSENTED);
    // GO: the game, rated, with the ranked pool's puzzle and the players in the match's order.
    const snapshot = await anaGame.message('snapshot');
    expect(snapshot.state.config).toMatchObject({ mode: 'ranked', gameType: 'fast' });
    expect(snapshot.state.config.puzzle.id).toBe(NEARLY_DONE.id);
    expect(snapshot.state.players.map((p) => p.id)).toEqual([ana.me.id, ben.me.id]);
    await benGame.until(
      () => benGame.of('events').some((m) => m.events.some((e) => e.type === 'gameStarted')),
      'gameStarted',
    );
    await leave(anaGame, benGame);
  });

  it('cancel: `cancelled`, then the server closes the connection', async () => {
    const cy = await player('mm_cy', 'MM_Cy');
    const s = await search(cy.client);
    await s.message('searching');
    s.room.send('cancel', { type: 'cancel' });
    expect(await s.message('cancelled')).toEqual({ type: 'cancelled' });
    expect(await s.closed()).toBe(CloseCode.CONSENTED);
    // Free to search again.
    const again = await search(cy.client);
    await again.message('searching');
    await leave(again);
  });

  it('a lonely search ends with `timeout`; "keep searching" goes on without the cap', async () => {
    const dan = await player('mm_dan', 'MM_Dan');
    const s = await search(dan.client, 'hard-2p');
    const started = Date.now();
    const timeout = await s.message('timeout');
    expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT_MS - 100);
    expect(timeout).toMatchObject({ queueKey: 'hard-2p', range: 50, extended: false });
    expect(timeout.elapsedMs).toBeGreaterThanOrEqual(TIMEOUT_MS);
    expect(s.left).toBeNull(); // the connection waits for the player's choice

    s.room.send('keepSearching', { type: 'keepSearching' });
    const more = await s.until(() => s.of('searching').find((m) => m.extended), 'an extended search');
    expect(more.timeoutAt - more.serverTime).toBe(TIMEOUT_MS);
    await leave(s);
  });

  it('a no-show: the match is off, the other player is back at the head of the queue', async () => {
    const eve = await player('mm_eve', 'MM_Eve');
    const fay = await player('mm_fay', 'MM_Fay');
    const eveSearch = await search(eve.client, 'normal-2p');
    const faySearch = await search(fay.client, 'normal-2p');
    const found = await eveSearch.message('found');
    await faySearch.message('found');
    const eveGame = await enter(eve.client, found); // Fay never comes

    const fayCancel = await faySearch.message('matchCancelled', 1);
    expect(fayCancel).toMatchObject({ reason: 'noShow', missing: [fay.me.id], requeued: false });
    expect(await faySearch.closed()).toBe(CloseCode.CONSENTED);

    expect(await eveSearch.message('matchCancelled')).toMatchObject({ missing: [fay.me.id], requeued: true });
    expect(
      await eveSearch.until(() => eveSearch.of('searching').find((m) => m.requeued), 'requeued search'),
    ).toMatchObject({ queueKey: 'normal-2p' });
    // The game room closes.
    expect(await eveGame.closed()).toBe(CloseCode.CONSENTED);
    await leave(eveSearch);
  });

  it('is for registered players only, in the open queues', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const gil = await player('mm_gil', 'MM_Gil');
      // No token: the development identity of the dev rooms does not count here.
      const anonymous = new Client(url).joinOrCreate(MATCHMAKING_ROOM_NAME, {
        queueKey: 'fast-2p',
        devUserId: 'gil',
        name: 'Gil',
      });
      expect(await refusal(anonymous)).toBe('unauthenticated');
      // A token without an account.
      const stranger = new Client(url);
      stranger.auth.token = devToken('mm_nobody');
      expect(await refusal(stranger.joinOrCreate(MATCHMAKING_ROOM_NAME, { queueKey: 'fast-2p' }))).toBe(
        'unauthenticated',
      );
      expect(await refusal(search(gil.client, 'fast').then((s) => s.room))).toBe('badQueue');
      expect(await refusal(search(gil.client, 'fast-5p').then((s) => s.room))).toBe('badQueue');
      // One search per account. The 3–4 player queues are open (stage 10).
      const first = await search(gil.client, 'fast-3p');
      expect(await first.message('searching')).toMatchObject({ queueKey: 'fast-3p' });
      expect(await refusal(search(gil.client, 'hard-2p').then((s) => s.room))).toBe('alreadyQueued');
      await leave(first);
    } finally {
      warn.mockRestore();
    }
  });
});
