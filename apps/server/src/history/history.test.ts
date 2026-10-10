import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  type CellIndex,
  createRng,
  type Digit,
  type GameEvent,
  type GameState,
  replay,
} from '@sudoku-fight/engine';
import {
  HISTORY_PATHS,
  type HistoryError,
  type HistoryGame,
  type HistoryPage,
  isHistoryPage,
  isReplayAnswer,
  type ReplayAnswer,
  replayPath,
} from '@sudoku-fight/protocol';
import { eq } from 'drizzle-orm';
import express from 'express';

import { DEFAULT_CHEAT_THRESHOLDS } from '../config';
import { gamePlayers, games, users } from '../db/schema';
import { type RankedGames, rankedGames } from '../persistence';
import { dbPuzzleSource } from '../puzzles';
import { call, type CallOptions } from '../testing/accounts';
import { fakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { NEARLY_DONE } from '../testing/game';
import { startHttp, type TestHttp } from '../testing/http';
import { addAccounts, addPuzzles, recordingLog, T0, tableFor } from '../testing/ranked';
import { testTokens, type TestTokens } from '../testing/tokens';
import { createHistoryRouter } from './router';

/**
 * Stage 11 on the server (spec §13, §14.1, §21): a player's ranked games, newest first and 20 a page, and the
 * replay of one of them with its full log. Games are played by the real ServerGame and stored by the real
 * recorder, on PGlite.
 */

let t: TestDb;
let tokens: TestTokens;
let http: TestHttp;
const clock = fakeClock(T0 + 3_600_000);

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  http = await startHttp({
    config: testConfig(),
    db: t.db,
    now: clock.now,
    tokens: tokens.verifier(clock.now),
    adminSiteDir: null,
  });
}, 30_000);
afterAll(async () => {
  await http.close();
  await t.close();
});

const NEARLY_CELLS = [0, 13, 40, 80] as CellIndex[];

let ranked: RankedGames;
beforeEach(async () => {
  await t.reset();
  await addAccounts(t.db, [
    { id: 'ana', name: 'Ana', rating: 1287, games: 12 },
    { id: 'ben', name: 'Ben', rating: 1305, games: 12 },
    { id: 'cid', name: 'Cid' },
  ]);
  await t.db.update(users).set({ avatarId: 'av07', country: 'IL' }).where(eq(users.id, 'ana'));
  await t.db.update(users).set({ avatarId: 'av12', country: 'DE' }).where(eq(users.id, 'ben'));
  await addPuzzles(t.db, [NEARLY_DONE]);
  ranked = rankedGames({
    db: t.db,
    ratingOption: 'B',
    cheat: DEFAULT_CHEAT_THRESHOLDS,
    puzzles: dbPuzzleSource({ db: t.db, rng: createRng(1) }),
    log: recordingLog(),
    recorder: { flushMs: 60_000, batchSize: 1000, retries: 3, retryDelayMs: 1 },
  });
});

/** A token of a test account (addAccounts gives `ana` the Firebase uid `uid-ana`). */
const tokenOf = (id: string) => tokens.sign({ uid: `uid-${id}` }, clock.now());

async function get<T>(path: string, who: string | null, options: CallOptions = {}) {
  return call<T>(http.url, 'GET', path, who === null ? options : { ...options, token: await tokenOf(who) });
}

/** ana against ben on NEARLY_DONE: ana fills three cells, ben one after a mistake. ana wins. */
async function playedGame(id = 'g1', players: string[] = ['ana', 'ben']) {
  const config = await ranked.createConfig({
    id,
    gameType: 'fast',
    players: players.map((p) => ({ id: p, name: p.toUpperCase() })),
    seed: 1,
  });
  const recorder = ranked.record(config);
  const table = tableFor(config, recorder);
  table.game.start();
  const [a, b, c, d] = NEARLY_CELLS as [CellIndex, CellIndex, CellIndex, CellIndex];
  const [first, second] = players as [string, string];
  table.move(first, a);
  table.move(second, b, 1500, ((table.answer(b) % 9) + 1) as Digit);
  table.scheduler.advance(1000);
  table.move(second, b);
  table.move(first, c);
  table.move(first, d);
  expect(await recorder.done).toMatchObject({ ok: true });
  return { config, state: table.game.state, events: table.game.events };
}

describe('GET /v1/me/games (spec §14.1)', () => {
  it("lists a player's finished game with every seat: name, avatar, country, place, score, rating change", async () => {
    const { state } = await playedGame();
    const answer = await get<HistoryPage>(HISTORY_PATHS.myGames, 'ana');
    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(isHistoryPage(answer.body)).toBe(true);
    const result = state.result!;
    const [anaRank, benRank] = ['ana', 'ben'].map((id) => result.ranking.find((r) => r.playerId === id)!);
    expect(answer.body).toEqual<HistoryPage>({
      nextCursor: null,
      games: [
        {
          id: 'g1',
          mode: 'ranked',
          gameType: 'fast',
          playerCount: 2,
          startedAt: T0,
          endedAt: state.endedAt!,
          endReason: 'boardComplete',
          mySeat: 0,
          players: [
            {
              seat: 0,
              userId: 'ana',
              displayName: 'Ana',
              avatarId: 'av07',
              country: 'IL',
              score: anaRank!.score,
              mistakes: 0,
              place: 1,
              status: 'active',
              ratingKey: 'fast',
              ratingBefore: 1287,
              ratingAfter: 1304,
            },
            {
              seat: 1,
              userId: 'ben',
              displayName: 'Ben',
              avatarId: 'av12',
              country: 'DE',
              score: benRank!.score,
              mistakes: 1,
              place: 2,
              status: 'active',
              ratingKey: 'fast',
              ratingBefore: 1305,
              ratingAfter: 1288,
            },
          ],
        },
      ],
    });
    // The same game for ben, from his seat.
    const ben = await get<HistoryPage>(HISTORY_PATHS.myGames, 'ben');
    expect(ben.body.games.map((g) => [g.id, g.mySeat])).toEqual([['g1', 1]]);
    // Someone who did not play in it has no games.
    expect((await get<HistoryPage>(HISTORY_PATHS.myGames, 'cid')).body).toEqual({
      games: [],
      nextCursor: null,
    });
  });

  it('leaves out a game that has not ended, and hides a deleted account', async () => {
    await playedGame('g1');
    // A second game: started and stored, but never over.
    const config = await ranked.createConfig({
      id: 'g2',
      gameType: 'fast',
      players: [
        { id: 'ana', name: 'ANA' },
        { id: 'cid', name: 'CID' },
      ],
      seed: 2,
    });
    const recorder = ranked.record(config);
    const table = tableFor(config, recorder);
    table.game.start();
    table.move('ana', NEARLY_CELLS[0]!);
    await recorder.flush();
    expect((await t.db.select().from(games)).map((g) => g.id).sort()).toEqual(['g1', 'g2']);

    await t.db
      .update(users)
      .set({ deletedAt: new Date(T0) })
      .where(eq(users.id, 'ben'));
    const answer = await get<HistoryPage>(HISTORY_PATHS.myGames, 'ana');
    expect(answer.body.games.map((g) => g.id)).toEqual(['g1']);
    expect(answer.body.games[0]!.players[1]).toMatchObject({
      userId: 'ben',
      displayName: null,
      avatarId: null,
      country: null,
    });
  });

  it('pages 20 at a time, newest first, without gaps or repeats (equal start times by id)', async () => {
    // 45 finished games of ana's, stored directly: some start at the same moment.
    for (let k = 0; k < 45; k++) {
      const id = `p${String(k).padStart(2, '0')}`;
      const startedAt = new Date(T0 + Math.floor(k / 3) * 60_000);
      await t.db.insert(games).values({
        id,
        mode: 'ranked',
        gameType: 'normal',
        playerCount: 2,
        puzzleId: NEARLY_DONE.id,
        rules: {},
        startedAt,
        endedAt: new Date(startedAt.getTime() + 30_000),
        endReason: 'boardComplete',
      });
      await t.db.insert(gamePlayers).values([
        { gameId: id, userId: 'ana', seat: 0, status: 'active', finalScore: k, mistakes: 0, place: 1 },
        { gameId: id, userId: 'cid', seat: 1, status: 'active', finalScore: 0, mistakes: 2, place: 2 },
      ]);
    }
    const seen: HistoryGame[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const path: string =
        cursor === null
          ? HISTORY_PATHS.myGames
          : `${HISTORY_PATHS.myGames}?cursor=${encodeURIComponent(cursor)}`;
      const page: HistoryPage = (await get<HistoryPage>(path, 'ana')).body;
      sizes.push(page.games.length);
      seen.push(...page.games);
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(sizes).toEqual([20, 20, 5]);
    const ids = seen.map((g) => g.id);
    expect(new Set(ids).size).toBe(45);
    // Newest first; equal start times by id, descending.
    const expected = Array.from({ length: 45 }, (_, k) => `p${String(k).padStart(2, '0')}`).sort((a, b) => {
      const ka = Math.floor(Number(a.slice(1)) / 3);
      const kb = Math.floor(Number(b.slice(1)) / 3);
      return kb - ka || (a < b ? 1 : -1);
    });
    expect(ids).toEqual(expected);
  });

  it('refuses a cursor it did not make', async () => {
    const answer = await get<HistoryError>(`${HISTORY_PATHS.myGames}?cursor=yesterday`, 'ana');
    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe('badRequest');
  });
});

describe('GET /v1/games/:id/replay (spec §13, §21)', () => {
  it('gives a player the whole log, solution included, and it replays to the very end of the game', async () => {
    const { state, events } = await playedGame();
    const answer = await get<ReplayAnswer>(replayPath('g1'), 'ben');
    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(isReplayAnswer(answer.body)).toBe(true);
    expect(answer.body.game).toMatchObject({ id: 'g1', mySeat: 1, playerCount: 2 });
    expect(answer.body.events).toEqual(JSON.parse(JSON.stringify(events)) as GameEvent[]);
    const first = answer.body.events[0]!;
    expect(first.type === 'gameCreated' && first.config.puzzle.solution).toBe(NEARLY_DONE.solution);

    const states: GameState[] = replay(answer.body.events);
    const last = states[states.length - 1]!;
    expect(last.status).toBe('over');
    expect(last.grid).toEqual(state.grid);
    expect(last.result).toEqual(JSON.parse(JSON.stringify(state.result)));
  });

  it('only for a player of the game, and only once it is over', async () => {
    await playedGame('g1');
    // cid did not play: the same answer as for a game that does not exist.
    expect((await get<HistoryError>(replayPath('g1'), 'cid')).body).toEqual({ error: 'notFound' });
    expect((await get<HistoryError>(replayPath('g1'), 'cid')).status).toBe(404);
    expect((await get<HistoryError>(replayPath('nope'), 'ana')).status).toBe(404);
    expect((await get<HistoryError>('/v1/games/a%20b/replay', 'ana')).status).toBe(400);

    const config = await ranked.createConfig({
      id: 'running',
      gameType: 'fast',
      players: [
        { id: 'ana', name: 'ANA' },
        { id: 'cid', name: 'CID' },
      ],
      seed: 3,
    });
    const recorder = ranked.record(config);
    tableFor(config, recorder).game.start();
    await recorder.flush();
    const running = await get<HistoryError>(replayPath('running'), 'cid');
    expect(running.status).toBe(409);
    expect(running.body.error).toBe('notFinished');
  });

  it('carries nobody’s private data: no email or sign-in id, and a deleted account’s name is gone from the log too', async () => {
    await t.db.update(users).set({ email: 'ben@example.com' }).where(eq(users.id, 'ben'));
    const { events } = await playedGame();
    const before = await get<ReplayAnswer>(replayPath('g1'), 'ana');
    const text = JSON.stringify(before.body);
    for (const secret of ['ben@example.com', 'uid-ben', 'uid-ana']) expect(text).not.toContain(secret);
    const created = (answer: ReplayAnswer) => {
      const first = answer.events[0]!;
      if (first.type !== 'gameCreated') throw new Error('the log starts with gameCreated');
      return first.config.players;
    };
    expect(created(before.body).map((p) => [p.id, p.name])).toEqual([
      ['ana', 'ANA'],
      ['ben', 'BEN'],
    ]);

    // Ben deletes his account (spec §3.3): his name leaves the seat and the log; the game still replays.
    await t.db
      .update(users)
      .set({ deletedAt: new Date(T0), displayName: 'deleted:x', email: null, firebaseUid: 'deleted:ben' })
      .where(eq(users.id, 'ben'));
    const after = await get<ReplayAnswer>(replayPath('g1'), 'ana');
    expect(after.status).toBe(200);
    expect(after.body.game.players[1]).toMatchObject({ userId: 'ben', displayName: null, avatarId: null });
    const seats = created(after.body);
    expect(seats.map((p) => [p.id, p.name])).toEqual([
      ['ana', 'ANA'],
      ['ben', undefined],
    ]);
    expect('name' in seats[1]!).toBe(false);
    expect(JSON.stringify(after.body)).not.toContain('BEN');
    const last = replay(after.body.events).at(-1)!;
    expect(last.status).toBe('over');
    expect(after.body.events.slice(1)).toEqual(JSON.parse(JSON.stringify(events.slice(1))) as GameEvent[]);
  });
});

describe('who may ask', () => {
  it('needs a sign-in, with an account', async () => {
    const none = await get<HistoryError>(HISTORY_PATHS.myGames, null);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    const bad = await get<HistoryError>(replayPath('g1'), null, { token: 'not-a-token' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('unauthorized');
    const stranger = await call<HistoryError>(http.url, 'GET', HISTORY_PATHS.myGames, {
      token: await tokens.sign({ uid: 'uid-nobody' }, clock.now()),
    });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error).toBe('notRegistered');
  });

  it('is off without a way to sign in (production without a Firebase project): 503 disabled', async () => {
    const app = express();
    app.use(
      createHistoryRouter({
        db: t.db,
        now: clock.now,
        tokens: tokens.verifier(clock.now, { projectId: null, devTokens: false }),
      }),
    );
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const answer = await call<HistoryError>(url, 'GET', HISTORY_PATHS.myGames, { token: 'dev:ana' });
      expect(answer.status).toBe(503);
      expect(answer.body.error).toBe('disabled');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('limits reads per account: 429 with Retry-After', async () => {
    const app = express();
    app.use(
      createHistoryRouter({
        db: t.db,
        now: clock.now,
        tokens: tokens.verifier(clock.now),
        historyLimits: { perIp: { limit: 100, windowMs: 60_000 }, reads: { limit: 2, windowMs: 60_000 } },
      }),
    );
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const token = await tokenOf('ana');
      const statuses: number[] = [];
      let retryAfter: string | null = null;
      for (let k = 0; k < 3; k++) {
        const answer = await call(url, 'GET', HISTORY_PATHS.myGames, { token });
        statuses.push(answer.status);
        retryAfter = answer.headers.get('retry-after');
      }
      expect(statuses).toEqual([200, 200, 429]);
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
