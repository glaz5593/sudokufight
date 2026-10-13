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
  ACCOUNT_PATHS,
  type AdminGameDetail,
  HISTORY_PATHS,
  type HistoryError,
  type HistoryGame,
  type HistoryPage,
  isHistoryPage,
  isReplayAnswer,
  LEGACY_AVATAR_MAP,
  type ReplayAnswer,
  replayPath,
} from '@sudoku-fight/protocol';
import { and, asc, eq, sql } from 'drizzle-orm';
import express from 'express';

import { DEFAULT_CHEAT_THRESHOLDS } from '../config';
import { gameEvents, gamePlayers, games, users } from '../db/schema';
import { anonymizeLoggedNames, type RankedGames, rankedGames } from '../persistence';
import { dbPuzzleSource } from '../puzzles';
import { call, type CallOptions } from '../testing/accounts';
import { signedInAdmin } from '../testing/admin';
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
  await t.db.update(users).set({ avatarId: 'lava-lamp', country: 'IL' }).where(eq(users.id, 'ana'));
  await t.db.update(users).set({ avatarId: 'maya', country: 'DE' }).where(eq(users.id, 'ben'));
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
              avatarId: 'lava-lamp',
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
              avatarId: 'maya',
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

  it('shows an old avatar id still in a row as its replacement, and an unknown one as none', async () => {
    await playedGame();
    await t.db.update(users).set({ avatarId: 'av49' }).where(eq(users.id, 'ana'));
    await t.db.update(users).set({ avatarId: 'av36' }).where(eq(users.id, 'ben'));
    const page = await get<HistoryPage>(HISTORY_PATHS.myGames, 'ana');
    expect(isHistoryPage(page.body)).toBe(true);
    expect(page.body.games[0]!.players.map((p) => [p.userId, p.avatarId])).toEqual([
      ['ana', LEGACY_AVATAR_MAP.av49],
      ['ben', null],
    ]);
    const replayed = await get<ReplayAnswer>(replayPath('g1'), 'ben');
    expect(isReplayAnswer(replayed.body)).toBe(true);
    expect(replayed.body.game.players[0]!.avatarId).toBe('owl');
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

describe('deleting an account takes its name out of the stored logs (spec §3.3, DECISIONS-PENDING 1.9)', () => {
  /** Every stored event as its raw JSON text, by game and seq. */
  const rawLogs = async () =>
    t.db
      .select({
        gameId: gameEvents.gameId,
        seq: gameEvents.seq,
        text: sql<string>`${gameEvents.payload}::text`,
      })
      .from(gameEvents)
      .orderBy(asc(gameEvents.gameId), asc(gameEvents.seq));
  /** The names of a stored gameCreated, seat by seat. */
  const loggedNames = async (gameId: string) => {
    const [row] = await t.db
      .select({ payload: gameEvents.payload })
      .from(gameEvents)
      .where(eq(gameEvents.gameId, gameId))
      .orderBy(asc(gameEvents.seq))
      .limit(1);
    const { players } = (row!.payload as { config: { players: { id: string; name?: string }[] } }).config;
    return players.map((p) => [p.id, p.name]);
  };
  const anonymousName = async (id: string) => {
    const [row] = await t.db.select().from(users).where(eq(users.id, id));
    expect(row!.deletedAt).not.toBeNull();
    return row!.displayName;
  };
  const deleteAccount = async (id: string) =>
    call<HistoryError>(http.url, 'DELETE', ACCOUNT_PATHS.me, { token: await tokenOf(id) });

  it('every game of the account: its seat gets the anonymous name; others, and other games, keep theirs', async () => {
    await playedGame('g1', ['ana', 'ben']);
    await playedGame('g2', ['ben', 'cid']);
    await playedGame('g3', ['ana', 'cid']);
    const before = await rawLogs();
    expect(before.some((r) => r.text.includes('"BEN"'))).toBe(true);

    expect((await deleteAccount('ben')).status).toBe(204);
    const anonymous = await anonymousName('ben');
    expect(anonymous).toMatch(/^deleted:/);

    // No stored event has the old name any more: not the one in the logs, nor the account's.
    const after = await rawLogs();
    for (const old of ['"BEN"', '"Ben"']) expect(after.filter((r) => r.text.includes(old))).toEqual([]);
    expect(await loggedNames('g1')).toEqual([
      ['ana', 'ANA'],
      ['ben', anonymous],
    ]);
    expect(await loggedNames('g2')).toEqual([
      ['ben', anonymous],
      ['cid', 'CID'],
    ]);
    // Only the two gameCreated events changed; everything else is as it was, byte for byte.
    const changed = after.filter((r, k) => r.text !== before[k]!.text);
    expect(changed.map((r) => [r.gameId, r.seq])).toEqual([
      ['g1', 1],
      ['g2', 1],
    ]);

    // The replay a player gets: Ben's seat and his entry in the log have no name ("שחקן" in the app).
    const replayed = await get<ReplayAnswer>(replayPath('g1'), 'ana');
    expect(replayed.status).toBe(200);
    expect(replayed.body.game.players[1]).toMatchObject({ userId: 'ben', displayName: null });
    const first = replayed.body.events[0]!;
    if (first.type !== 'gameCreated') throw new Error('the log starts with gameCreated');
    expect(first.config.players.map((p) => [p.id, p.name])).toEqual([
      ['ana', 'ANA'],
      ['ben', undefined],
    ]);
    const replayText = JSON.stringify(replayed.body);
    for (const hidden of ['BEN', anonymous]) expect(replayText).not.toContain(hidden);
    expect(replay(replayed.body.events).at(-1)!.status).toBe('over');

    // The admin site: the anonymous name, for the seat and in the log alike.
    const admin = await signedInAdmin(http.url);
    const detail = await admin.get<AdminGameDetail>('/games/g1');
    expect(detail.status).toBe(200);
    expect(detail.body.players.map((p) => [p.userId, p.displayName])).toEqual([
      ['ana', 'Ana'],
      ['ben', anonymous],
    ]);
    const logged = detail.body.events[0]!.payload as { config: { players: { name?: string }[] } };
    expect(logged.config.players.map((p) => p.name)).toEqual(['ANA', anonymous]);
    expect(JSON.stringify(detail.body)).not.toContain('BEN');

    // Deleting again: no account any more (404), and nothing changes.
    const again = await deleteAccount('ben');
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('notRegistered');
    expect(await anonymizeLoggedNames(t.db, { userId: 'ben' })).toBe(0);
    expect(await rawLogs()).toEqual(after);
    expect(await anonymousName('ben')).toBe(anonymous);
  });

  it('a game still running: its log, written after the deletions, gets the anonymous names too', async () => {
    const config = await ranked.createConfig({
      id: 'live',
      gameType: 'fast',
      players: [
        { id: 'ben', name: 'BEN' },
        { id: 'ana', name: 'ANA' },
        { id: 'cid', name: 'CID' },
      ],
      seed: 4,
    });
    const recorder = ranked.record(config);
    const table = tableFor(config, recorder);
    table.game.start();
    table.move('ana', NEARLY_CELLS[0]!);
    // The events wait for their batch (a minute here): none is stored when Ben and Cid delete their accounts.
    expect(await rawLogs()).toEqual([]);
    expect((await deleteAccount('ben')).status).toBe(204);
    expect((await deleteAccount('cid')).status).toBe(204);

    await recorder.flush();
    expect((await rawLogs()).filter((r) => /BEN|CID/.test(r.text))).toEqual([]);
    // Two deleted seats in one log: both get their own anonymous name.
    expect(await loggedNames('live')).toEqual([
      ['ben', await anonymousName('ben')],
      ['ana', 'ANA'],
      ['cid', await anonymousName('cid')],
    ]);
  });

  it('deleted mid-game, its log already stored: the name goes at once, and the game plays on to its end', async () => {
    // Two logged names with the same beginning: only the deleted seat's changes.
    const config = await ranked.createConfig({
      id: 'mid',
      gameType: 'fast',
      players: [
        { id: 'ana', name: 'BENITA' },
        { id: 'ben', name: 'BEN' },
      ],
      seed: 1,
    });
    const recorder = ranked.record(config);
    const table = tableFor(config, recorder);
    table.game.start();
    const [a, b, c, d] = NEARLY_CELLS as [CellIndex, CellIndex, CellIndex, CellIndex];
    table.move('ana', a);
    await recorder.flush();
    expect(await loggedNames('mid')).toEqual([
      ['ana', 'BENITA'],
      ['ben', 'BEN'],
    ]);

    expect((await deleteAccount('ben')).status).toBe(204);
    const anonymous = await anonymousName('ben');
    expect(await loggedNames('mid')).toEqual([
      ['ana', 'BENITA'],
      ['ben', anonymous],
    ]);
    // Still running: no replay yet, for anyone.
    expect((await get<HistoryError>(replayPath('mid'), 'ana')).status).toBe(409);

    table.move('ben', b);
    table.move('ana', c);
    table.move('ana', d);
    expect(await recorder.done).toMatchObject({ ok: true, outcome: 'recorded' });
    const stored = await rawLogs();
    expect(stored).toHaveLength(table.game.events.length);
    expect(stored.filter((r) => r.text.includes('"BEN"'))).toEqual([]);
    expect(await loggedNames('mid')).toEqual([
      ['ana', 'BENITA'],
      ['ben', anonymous],
    ]);

    // The other player's replay: the whole game, her own name, none for Ben.
    const replayed = await get<ReplayAnswer>(replayPath('mid'), 'ana');
    expect(replayed.status).toBe(200);
    expect(replayed.body.events).toHaveLength(table.game.events.length);
    const first = replayed.body.events[0]!;
    if (first.type !== 'gameCreated') throw new Error('the log starts with gameCreated');
    expect(first.config.players.map((p) => [p.id, p.name])).toEqual([
      ['ana', 'BENITA'],
      ['ben', undefined],
    ]);
    expect(JSON.stringify(replayed.body)).not.toContain(anonymous);
    expect(replay(replayed.body.events).at(-1)!.status).toBe('over');
  });

  it('a game without a deleted account, a seat logged with no name or as someone else, is left as it is', async () => {
    await playedGame('g1', ['ana', 'cid']);
    await playedGame('g2', ['ana', 'ben']);
    const deleteRow = (id: string) =>
      t.db
        .update(users)
        .set({ deletedAt: new Date(T0), displayName: `deleted:${id}` })
        .where(eq(users.id, id));
    /** Changes the players of a stored gameCreated, as a log that does not match its seats might have them. */
    const editLog = async (gameId: string, edit: (players: { id: string; name?: string }[]) => void) => {
      const created = and(eq(gameEvents.gameId, gameId), eq(gameEvents.seq, 1));
      const [row] = await t.db.select().from(gameEvents).where(created);
      const payload = row!.payload as { config: { players: { id: string; name?: string }[] } };
      edit(payload.config.players);
      await t.db.update(gameEvents).set({ payload }).where(created);
    };

    // A seat whose logged player is not the seat's account: the anonymous name never goes on someone else.
    await editLog('g2', (players) => {
      players[1]!.id = 'someone';
    });
    // Ben is deleted, and played only g2; nobody in g1 is deleted.
    await deleteRow('ben');
    expect(await anonymizeLoggedNames(t.db, { userId: 'ben' })).toBe(0);
    expect(await anonymizeLoggedNames(t.db, { gameId: 'g1' })).toBe(0);
    expect(await anonymizeLoggedNames(t.db, { gameId: 'g2' })).toBe(0);
    expect(await loggedNames('g2')).toEqual([
      ['ana', 'ANA'],
      ['someone', 'BEN'],
    ]);

    // A seat logged without a name (a bot's, say) gets none: there was no name to replace.
    await editLog('g1', (players) => {
      delete players[1]!.name;
    });
    await deleteRow('cid');
    expect(await anonymizeLoggedNames(t.db, { userId: 'cid' })).toBe(0);
    expect(await loggedNames('g1')).toEqual([
      ['ana', 'ANA'],
      ['cid', undefined],
    ]);
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
