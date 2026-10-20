import {
  type CellIndex,
  createRng,
  type Digit,
  eloChanges,
  type GameConfig,
  type GameEvent,
  type GameState,
  type GameType,
  leaveGuardsFor,
  movePace,
  type RankEntry,
} from '@sudoku-fight/engine';
import { isHistoryGame } from '@sudoku-fight/protocol';
import { and, asc, eq } from 'drizzle-orm';

import { getGame, listGames } from '../admin/games';
import { getUser } from '../admin/users';
import { DEFAULT_CHEAT_THRESHOLDS, type CheatThresholds } from '../config';
import type { Db } from '../db';
import {
  cheatFlags,
  gameEvents,
  gamePlayers,
  games,
  levelXpDays,
  opponentHistory,
  personas,
  practiceResults,
  puzzleHistory,
  ratings,
  userAchievements,
  users,
  xp,
} from '../db/schema';
import { listUserGames, readReplay } from '../history/store';
import { practiceXpUsedOn } from '../progress/practice';
import { dbPuzzleSource } from '../puzzles';
import { createTestDb, NEARLY_DONE, PUZZLE, type TestDb } from '../testing';
import {
  addAccounts,
  addPuzzles,
  recordingLog,
  standInPuzzles,
  T0,
  tableFor,
  type TestAccount,
} from '../testing/ranked';
import {
  endInterruptedGames,
  paceOf,
  type RankedGames,
  rankedGames,
  recordGameEnd,
  type RecordOutcome,
  seatsOf,
  SERVER_RESTART,
} from '.';

/**
 * Stage 9: ranked games stored and rated (spec §11, §19, §20, §21), on PGlite. Games are played by the real
 * ServerGame on a manual clock; the recorder writes them as GameRoom has it do.
 */

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
beforeEach(() => t.reset());
afterAll(() => t.close());

const NORMAL_NEARLY_DONE = { ...NEARLY_DONE, id: 'nearly-done-normal' };

interface Setup {
  accounts?: TestAccount[];
  option?: 'A' | 'B';
  cheat?: CheatThresholds;
  batchSize?: number;
  db?: Db;
  /** PRACTICE_XP_DAILY_CAP for friends games (1.0.4). */
  practiceXpDailyCap?: number;
}

async function setup({
  accounts,
  option = 'B',
  cheat = DEFAULT_CHEAT_THRESHOLDS,
  batchSize,
  db,
  practiceXpDailyCap,
}: Setup = {}) {
  await addAccounts(
    t.db,
    accounts ?? [
      { id: 'ana', rating: 1287, games: 12 },
      { id: 'ben', rating: 1305, games: 12 },
    ],
  );
  await addPuzzles(t.db, [NEARLY_DONE]);
  await addPuzzles(t.db, [NORMAL_NEARLY_DONE], { gameType: 'normal' });
  const log = recordingLog();
  const ranked = rankedGames({
    db: db ?? t.db,
    ratingOption: option,
    cheat,
    puzzles: dbPuzzleSource({ db: t.db, rng: createRng(1) }),
    log,
    recorder: { flushMs: 60_000, batchSize: batchSize ?? 1000, retries: 3, retryDelayMs: 1 },
    ...(practiceXpDailyCap === undefined ? null : { practiceXpDailyCap }),
  });
  return { ranked, log };
}

const players = (...ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() }));

async function newGame(
  ranked: RankedGames,
  ids: string[],
  { id = 'g1', gameType = 'fast' }: { id?: string; gameType?: GameType } = {},
) {
  const config = await ranked.createConfig({ id, gameType, players: players(...ids), seed: 1 });
  const recorder = ranked.record(config);
  const table = tableFor(config, recorder);
  table.game.start();
  return { config, recorder, table };
}

const NEARLY_CELLS = [0, 13, 40, 80] as CellIndex[];

const rating = async (userId: string, key: string) =>
  (
    await t.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.ratingKey, key)))
  )[0];

const seatsRows = (gameId: string) =>
  t.db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId)).orderBy(asc(gamePlayers.seat));

/**
 * What the engine says the changes are, for this ranking and these ratings before the game, with the leave
 * guards (spec §11.2) the engine found in the final state.
 */
function engineChanges(config: GameConfig, ranking: RankEntry[], state: GameState) {
  const guards = leaveGuardsFor(state);
  return eloChanges(
    ranking.map((r) => ({
      id: r.playerId,
      rating: config.players[r.seat]!.rating!,
      games: config.players[r.seat]!.ratedGames!,
      place: r.place,
      abandoned: r.status === 'abandoned',
      guards: guards.get(r.playerId) ?? [],
    })),
  );
}

describe('a ranked game, stored (spec §19)', () => {
  it('a full two-player game: games, game_players, every event, histories, and the ratings by the engine', async () => {
    const { ranked } = await setup();
    const { config, recorder, table } = await newGame(ranked, ['ana', 'ben']);
    expect(config.puzzle).toEqual(NEARLY_DONE);
    expect(config.players).toEqual([
      { id: 'ana', name: 'ANA', rating: 1287, ratedGames: 12 },
      { id: 'ben', name: 'BEN', rating: 1305, ratedGames: 12 },
    ]);

    const [a, b, c, d] = NEARLY_CELLS as [CellIndex, CellIndex, CellIndex, CellIndex];
    table.move('ana', a);
    // A wrong digit from ben (a mistake, then the cell is free again).
    const wrongDigit = ((table.answer(b) % 9) + 1) as Digit;
    table.move('ben', b, 1500, wrongDigit);
    table.scheduler.advance(1000); // the re-lock wait after a release [D2]
    table.move('ben', b);
    table.move('ana', c);
    table.move('ana', d);
    expect(table.game.isOver).toBe(true);
    const result = table.game.state.result!;

    expect(await recorder.done).toEqual<RecordOutcome>({ ok: true, outcome: 'recorded' });
    const bestMoveOf = (id: string) => result.stats.find((s) => s.playerId === id)!.bestMove!.points;
    const paceColumns = (id: string) => {
      const pace = movePace(table.game.events, id)!;
      return { paceMs: Math.round(pace.baseMs), paceMoves: pace.moves, paceDigits: pace.digits };
    };

    const [game] = await t.db.select().from(games).where(eq(games.id, 'g1'));
    expect(game).toEqual({
      id: 'g1',
      mode: 'ranked',
      gameType: 'fast',
      playerCount: 2,
      puzzleId: NEARLY_DONE.id,
      rules: config.rules,
      startedAt: new Date(T0),
      endedAt: new Date(table.game.state.endedAt!),
      endReason: 'boardComplete',
      stealth: false,
    });

    // 1287 beat 1305: +17 and −17 (spec §11.2's example; K = 32, neither provisional).
    expect(result.ratingChanges.map((ch) => [ch.playerId, ch.delta])).toEqual([
      ['ana', 17],
      ['ben', -17],
    ]);
    expect(await seatsRows('g1')).toEqual([
      {
        gameId: 'g1',
        userId: 'ana',
        seat: 0,
        finalScore: result.ranking[0]!.score,
        mistakes: 0,
        place: 1,
        status: 'active',
        ratingKey: 'fast',
        ratingBefore: 1287,
        ratingAfter: 1304,
        bestMovePoints: bestMoveOf('ana'),
        xp: 53, // 1.0.4: the seat's XP (50 for the win, a point per correct move)
        ...paceColumns('ana'), // the stealth bot's yardstick [D96]: each person's pace in a ranked game
      },
      {
        gameId: 'g1',
        userId: 'ben',
        seat: 1,
        finalScore: result.ranking[1]!.score,
        mistakes: 1,
        place: 2,
        status: 'active',
        ratingKey: 'fast',
        ratingBefore: 1305,
        ratingAfter: 1288,
        bestMovePoints: bestMoveOf('ben'),
        xp: 21,
        ...paceColumns('ben'),
      },
    ]);
    // Stage 12: each seat's best move is stored for the player card (spec §14.3).
    expect(bestMoveOf('ana')).toBeGreaterThan(0);
    expect(await rating('ana', 'fast')).toMatchObject({
      rating: 1304,
      games: 13,
      provisional: false,
      peak: 1304,
    });
    expect(await rating('ben', 'fast')).toMatchObject({ rating: 1288, games: 13, peak: 1305 });
    expect(await rating('ana', 'normal')).toMatchObject({ rating: 1287, games: 12 });

    // Every event, in seq order, as the engine made it: gameCreated keeps the solution (for the replay).
    const rows = await t.db
      .select()
      .from(gameEvents)
      .where(eq(gameEvents.gameId, 'g1'))
      .orderBy(asc(gameEvents.seq));
    expect(rows.map((r) => r.seq)).toEqual(table.game.events.map((e) => e.seq));
    expect(rows.map((r) => r.type)).toEqual(table.game.events.map((e) => e.type));
    expect(rows[0]).toMatchObject({ type: 'gameCreated', tMs: T0 });
    expect((rows[0]!.payload as { config: GameConfig }).config.puzzle.solution).toBe(NEARLY_DONE.solution);
    const replayed = rows.map(
      (r) => ({ ...(r.payload as object), seq: r.seq, t: r.tMs, type: r.type }) as GameEvent,
    );
    expect(replayed).toEqual(table.game.events);
    expect(rows.at(-1)!.type).toBe('gameOver');

    // History from the start: the puzzle is played, the opponent met (in this game type).
    expect(
      (await t.db.select().from(puzzleHistory).orderBy(asc(puzzleHistory.userId))).map((r) => [
        r.userId,
        r.puzzleId,
        r.playedAt.getTime(),
      ]),
    ).toEqual([
      ['ana', NEARLY_DONE.id, T0],
      ['ben', NEARLY_DONE.id, T0],
    ]);
    expect(
      (await t.db.select().from(opponentHistory).orderBy(asc(opponentHistory.userId))).map((r) => [
        r.userId,
        r.opponentId,
        r.gameType,
      ]),
    ).toEqual([
      ['ana', 'ben', 'fast'],
      ['ben', 'ana', 'fast'],
    ]);
    expect(await t.db.select().from(cheatFlags)).toEqual([]);
  });

  it('events go in small batches while the game runs; the row has no end until it ends', async () => {
    await addPuzzles(t.db, [PUZZLE]);
    const { ranked } = await setup({ batchSize: 3 });
    const config = await ranked.createConfig({
      id: 'g2',
      gameType: 'fast',
      players: players('ana', 'ben'),
      seed: 1,
    });
    const fullConfig = { ...config, puzzle: PUZZLE }; // the long one: it won't end here
    const recorder = ranked.record(fullConfig);
    const table = tableFor(fullConfig, recorder);
    table.game.start();
    for (let k = 0; k < 4; k++) table.move(k % 2 ? 'ben' : 'ana', table.empty()[0]!);
    await recorder.flush();

    const rows = await t.db.select().from(gameEvents).where(eq(gameEvents.gameId, 'g2'));
    expect(rows).toHaveLength(table.game.events.length);
    const [game] = await t.db.select().from(games).where(eq(games.id, 'g2'));
    expect(game).toMatchObject({ startedAt: new Date(T0), endedAt: null, endReason: null });
    expect((await seatsRows('g2')).map((p) => [p.userId, p.status, p.place, p.ratingBefore])).toEqual([
      ['ana', 'active', null, 1287],
      ['ben', 'active', null, 1305],
    ]);

    // The room goes away mid-game: what was played is kept, and the game is not counted.
    table.move('ana', table.empty()[0]!);
    recorder.close();
    expect(await recorder.done).toMatchObject({ ok: false, unfinished: true });
    expect(await t.db.select().from(gameEvents).where(eq(gameEvents.gameId, 'g2'))).toHaveLength(
      table.game.events.length,
    );
    expect(await rating('ana', 'fast')).toMatchObject({ games: 12 });
    table.game.close();
  });

  it('surrender in a two-player game is a normal loss [D32, D8]', async () => {
    const { ranked } = await setup();
    const { config, recorder, table } = await newGame(ranked, ['ana', 'ben']);
    table.move('ana', NEARLY_CELLS[0]!);
    // Both moved and ben trails (a wrong digit): no leave guard holds (§11.2).
    const wrong = ((table.answer(NEARLY_CELLS[1]!) % 9) + 1) as Digit;
    table.move('ben', NEARLY_CELLS[1]!, 2000, wrong);
    table.game.act('ben', { type: 'surrender' });
    expect(await recorder.done).toMatchObject({ ok: true });
    const result = table.game.state.result!;
    expect(result.reason).toBe('lastPlayerStanding');
    expect((await seatsRows('g1')).map((p) => [p.userId, p.place, p.status, p.ratingAfter])).toEqual([
      ['ana', 1, 'active', 1304],
      ['ben', 2, 'surrendered', 1288],
    ]);
    expect(engineChanges(config, result.ranking, table.game.state).map((ch) => ch.after)).toEqual([
      1304, 1288,
    ]);
    const [game] = await t.db.select().from(games);
    expect(game!.endReason).toBe('lastPlayerStanding');
  });

  it('abandonment (the grace runs out) before any move of the leaver: a full win, and no loss for him; both games count [D32, D8, §11.2]', async () => {
    const { ranked } = await setup();
    const { recorder, table } = await newGame(ranked, ['ana', 'ben']);
    table.move('ana', NEARLY_CELLS[0]!);
    table.game.disconnect('ben');
    table.scheduler.advance(table.game.state.config.rules.graceMs + 10);
    expect(table.game.isOver).toBe(true);
    expect(await recorder.done).toMatchObject({ ok: true });
    expect((await seatsRows('g1')).map((p) => [p.userId, p.place, p.status, p.ratingAfter])).toEqual([
      ['ana', 1, 'active', 1304],
      ['ben', 2, 'abandoned', 1305],
    ]);
    expect(await rating('ana', 'fast')).toMatchObject({ rating: 1304, games: 13 });
    expect(await rating('ben', 'fast')).toMatchObject({ rating: 1305, games: 13 });
  });

  it('a leaver who was ahead: no rating moves either way, and the game still counts for both (§11.2)', async () => {
    const { ranked } = await setup();
    const { recorder, table } = await newGame(ranked, ['ana', 'ben']);
    table.move('ben', NEARLY_CELLS[0]!);
    const wrong = ((table.answer(NEARLY_CELLS[1]!) % 9) + 1) as Digit;
    table.move('ana', NEARLY_CELLS[1]!, 2000, wrong); // ana moved, and trails
    table.game.act('ben', { type: 'surrender' });
    expect(await recorder.done).toMatchObject({ ok: true });
    const result = table.game.state.result!;
    expect(result.ratingChanges.map((c) => [c.playerId, c.delta])).toEqual([
      ['ana', 0],
      ['ben', 0],
    ]);
    expect(result.ratingPairs!.map((p) => [p.playerId, p.pairs[0]!.guard])).toEqual([
      ['ana', 'opponentLeftAhead'],
      ['ben', 'leftNotBehind'],
    ]);
    expect((await seatsRows('g1')).map((p) => [p.userId, p.place, p.ratingBefore, p.ratingAfter])).toEqual([
      ['ana', 1, 1287, 1287],
      ['ben', 2, 1305, 1305],
    ]);
    expect(await rating('ana', 'fast')).toMatchObject({ rating: 1287, games: 13 });
    expect(await rating('ben', 'fast')).toMatchObject({ rating: 1305, games: 13 });
  });

  it.each([3, 4])(
    '%i players: every pair is a mini-match, K_pair = 32/(N−1), the same engine function',
    async (n) => {
      const ids = ['ana', 'ben', 'cal', 'dan'].slice(0, n);
      const { ranked } = await setup({
        accounts: ids.map((id, k) => ({ id, rating: 1250 + 40 * k, games: 15 })),
      });
      const { config, recorder, table } = await newGame(ranked, ids);
      // ana fills two cells, ben and cal one each; with four, dan surrenders first (ranks last).
      if (n === 4) table.game.act('dan', { type: 'surrender' });
      table.move('ana', NEARLY_CELLS[0]!);
      table.move('ben', NEARLY_CELLS[1]!);
      table.move('cal', NEARLY_CELLS[2]!);
      table.move('ana', NEARLY_CELLS[3]!);
      expect(await recorder.done).toMatchObject({ ok: true });

      const ranking = table.game.state.result!.ranking;
      // With four, dan left before anyone moved: the leave guards (§11.2) hold all his pairs at 0.
      const expected = engineChanges(config, ranking, table.game.state);
      expect(table.game.state.result!.ratingChanges).toEqual(expected);
      // K_pair = 32 / (N − 1): with nobody provisional the deltas sum to (about) zero, and each is at most 32.
      expect(Math.abs(expected.reduce((s, ch) => s + ch.delta, 0))).toBeLessThanOrEqual(n);
      expect(expected.every((ch) => Math.abs(ch.delta) <= 32)).toBe(true);

      const stored = await seatsRows('g1');
      for (const ch of expected) {
        const seat = stored.find((p) => p.userId === ch.playerId)!;
        expect([seat.ratingBefore, seat.ratingAfter]).toEqual([ch.before, ch.after]);
        expect(await rating(ch.playerId, 'fast')).toMatchObject({ rating: ch.after, games: 16 });
      }
      expect(stored.find((p) => p.userId === 'ana')!.place).toBe(1);
      if (n === 4)
        expect(stored.find((p) => p.userId === 'dan')).toMatchObject({ place: 4, status: 'surrendered' });
      // Every account met every other in this game type.
      expect(await t.db.select().from(opponentHistory)).toHaveLength(n * (n - 1));
    },
  );

  it('provisional [D23]: a key’s first 10 games move it with K doubled, the 11th with K = 32', async () => {
    const { ranked } = await setup({ accounts: [{ id: 'ana' }, { id: 'ben' }] });
    for (let game = 1; game <= 11; game++) {
      const { config, recorder, table } = await newGame(ranked, ['ana', 'ben'], { id: `g${game}` });
      const winner = game % 2 ? 'ana' : 'ben';
      for (const cell of NEARLY_CELLS) table.move(winner, cell);
      expect(await recorder.done).toMatchObject({ ok: true, outcome: 'recorded' });
      const changes = table.game.state.result!.ratingChanges;
      const before = config.players.find((p) => p.id === winner)!;
      const k = before.ratedGames! < 10 ? 64 : 32;
      const e =
        1 / (1 + 10 ** ((config.players.find((p) => p.id !== winner)!.rating! - before.rating!) / 400));
      expect(changes.find((ch) => ch.playerId === winner)!.delta).toBe(Math.round(k * (1 - e)));
      expect(changes.every((ch) => ch.provisional === game <= 10)).toBe(true);
      if (game === 1) expect(changes.map((ch) => ch.delta)).toEqual([32, -32]); // 64 × ½
      const row = await rating(winner, 'fast');
      expect(row).toMatchObject({
        games: game,
        provisional: game < 10,
        rating: changes.find((ch) => ch.playerId === winner)!.after,
      });
    }
  });

  it("option A [D7]: a 2-player normal game moves 'normal-2p', not 'normal' (stage 9 done criterion)", async () => {
    const { ranked } = await setup({
      option: 'A',
      accounts: [
        { id: 'ana', option: 'A', rating: 1200, games: 0 },
        { id: 'ben', option: 'A', rating: 1200, games: 0 },
      ],
    });
    // A 'normal' row too (as if the server had run with option B before): it must stay as it is.
    await t.db.insert(ratings).values(
      ['ana', 'ben'].map((userId) => ({
        userId,
        ratingKey: 'normal',
        rating: 1500,
        games: 20,
        provisional: false,
        peak: 1500,
      })),
    );
    const { config, recorder, table } = await newGame(ranked, ['ana', 'ben'], { gameType: 'normal' });
    expect(config.rules.rating.option).toBe('A');
    expect(config.puzzle.id).toBe(NORMAL_NEARLY_DONE.id);
    expect(config.players.map((p) => p.rating)).toEqual([1200, 1200]); // normal-2p's, not normal's 1500
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    expect(await recorder.done).toMatchObject({ ok: true });

    expect(await rating('ana', 'normal-2p')).toMatchObject({ rating: 1232, games: 1, provisional: true });
    expect(await rating('ben', 'normal-2p')).toMatchObject({ rating: 1168, games: 1 });
    expect(await rating('ana', 'normal')).toMatchObject({ rating: 1500, games: 20 });
    expect(await rating('ana', 'normal-3p')).toMatchObject({ rating: 1200, games: 0 });
    expect((await seatsRows('g1')).map((p) => p.ratingKey)).toEqual(['normal-2p', 'normal-2p']);
  });
});

describe('recording is idempotent: a retry never counts a game twice', () => {
  it('recording the end again changes nothing', async () => {
    const { ranked } = await setup();
    const { config, recorder, table } = await newGame(ranked, ['ana', 'ben']);
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    expect(await recorder.done).toMatchObject({ ok: true, outcome: 'recorded' });
    const again = await recordGameEnd(t.db, {
      start: { config, startedAt: T0, seats: seatsOf(config), ratingKey: 'fast' },
      state: table.game.state,
      unwritten: table.game.events,
      log: table.game.events,
      cheat: DEFAULT_CHEAT_THRESHOLDS,
    });
    expect(again).toBe('alreadyRecorded');
    expect(await rating('ana', 'fast')).toMatchObject({ rating: 1304, games: 13 });
    expect(await t.db.select().from(gameEvents)).toHaveLength(table.game.events.length);
    expect(await t.db.select().from(puzzleHistory)).toHaveLength(2);
  });

  it('a failed start is tried again, and an end whose answer was lost counts once', async () => {
    let calls = 0;
    const flaky = Object.create(t.db) as Db;
    flaky.transaction = (async (fn: Parameters<Db['transaction']>[0]) => {
      calls++;
      if (calls === 1) throw new Error('connection lost'); // the start, first try
      const out = await t.db.transaction(fn);
      if (calls === 3) throw new Error('connection lost after commit'); // the end, first try: it did commit
      return out;
    }) as Db['transaction'];
    const { ranked, log } = await setup({ db: flaky });
    const { recorder, table } = await newGame(ranked, ['ana', 'ben']);
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    // The second try of the end finds the game recorded: nothing is counted twice.
    expect(await recorder.done).toEqual({ ok: true, outcome: 'alreadyRecorded' });
    expect(calls).toBe(4);
    expect(log.lines.filter((l) => l.includes('failed (try 1 of 3)'))).toHaveLength(2);
    expect(await rating('ana', 'fast')).toMatchObject({ rating: 1304, games: 13 });
    expect(await rating('ben', 'fast')).toMatchObject({ rating: 1288, games: 13 });
    expect(await t.db.select().from(gameEvents)).toHaveLength(table.game.events.length);
  });

  it('a failure in the middle of the end (the ratings): all of it rolls back, and the retry counts it once', async () => {
    let failed = false;
    const flaky = Object.create(t.db) as Db;
    // The end's transaction: games ended and the seats written, then the connection dies on the ratings.
    flaky.transaction = (async (fn: Parameters<Db['transaction']>[0]) =>
      t.db.transaction(async (tx) => {
        const midway = new Proxy(tx, {
          get(target, prop) {
            const value: unknown = Reflect.get(target, prop, target);
            if (prop !== 'insert' || typeof value !== 'function') return value;
            return (table: unknown) => {
              if (table === ratings && !failed) {
                failed = true;
                throw new Error('connection reset in the middle of the transaction');
              }
              return (value as (t: unknown) => unknown).call(target, table);
            };
          },
        });
        return fn(midway);
      })) as Db['transaction'];
    const { ranked, log } = await setup({ db: flaky });
    const { recorder, table } = await newGame(ranked, ['ana', 'ben']);
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    expect(await recorder.done).toEqual({ ok: true, outcome: 'recorded' });
    expect(failed).toBe(true);
    expect(log.lines.filter((l) => l.includes('end failed (try 1 of 3)'))).toHaveLength(1);
    // Once: the games row, the seats and the ratings of the second try only.
    expect(await rating('ana', 'fast')).toMatchObject({ rating: 1304, games: 13 });
    expect(await rating('ben', 'fast')).toMatchObject({ rating: 1288, games: 13 });
    expect((await seatsRows('g1')).map((s) => [s.ratingBefore, s.ratingAfter, s.place])).toEqual([
      [1287, 1304, 1],
      [1305, 1288, 2],
    ]);
    const [game] = await t.db.select().from(games).where(eq(games.id, 'g1'));
    expect(game).toMatchObject({ endReason: 'boardComplete', endedAt: new Date(table.game.state.endedAt!) });
    expect(await t.db.select().from(gameEvents)).toHaveLength(table.game.events.length);
  });

  it('a database that stays away: the end is given up on after the last try, and logged', async () => {
    const broken = Object.create(t.db) as Db;
    broken.transaction = () => Promise.reject(new Error('down'));
    const { ranked, log } = await setup({ db: broken });
    const { recorder, table } = await newGame(ranked, ['ana', 'ben']);
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    const done = await recorder.done;
    expect(done.ok).toBe(false);
    expect(log.errors).toHaveLength(2); // the start and the end
    expect(await rating('ana', 'fast')).toMatchObject({ games: 12 });
  });
});

describe('anomaly flags (spec §21)', () => {
  /** ana places 25 digits after `fastMs` each, ben the rest after 3 s. */
  async function fastGame(cheat?: CheatThresholds, fastMs = 600) {
    await addPuzzles(t.db, [PUZZLE]);
    const { ranked } = await setup({ cheat });
    const config = {
      ...(await ranked.createConfig({ id: 'g1', gameType: 'fast', players: players('ana', 'ben'), seed: 1 })),
      puzzle: PUZZLE,
    };
    const recorder = ranked.record(config);
    const table = tableFor(config, recorder);
    table.game.start();
    table.fillAll(
      (k) => (k < 25 ? 'ana' : 'ben'),
      (k) => (k < 25 ? fastMs : 3000),
    );
    expect(await recorder.done).toMatchObject({ ok: true });
  }

  it('20 consecutive correct moves averaging under 1.2 s: a cheat_flags row, nothing blocked', async () => {
    await fastGame();
    const flags = await t.db.select().from(cheatFlags);
    expect(flags).toEqual([
      expect.objectContaining({ userId: 'ana', gameId: 'g1', reason: 'fastThinking', value: 600 }),
    ]);
    // Rated as any game: no automatic action in V1.
    expect(await rating('ana', 'fast')).toMatchObject({ games: 13 });
    // The admin site shows it on the user's page.
    const [game] = await t.db.select().from(games);
    expect((await getUser(t.db, 'ana'))!.cheatFlags).toEqual([
      { gameId: 'g1', reason: 'fastThinking', value: 600, createdAt: game!.endedAt!.getTime() },
    ]);
    expect((await getUser(t.db, 'ben'))!.cheatFlags).toEqual([]);
  });

  it('thresholds from the settings: 30 moves under 0.7 s are not reached by 25', async () => {
    await fastGame({ thinkMs: 700, moves: 30 });
    expect(await t.db.select().from(cheatFlags)).toEqual([]);
  });

  it('a normal pace is not flagged', async () => {
    await fastGame(undefined, 1300);
    expect(await t.db.select().from(cheatFlags)).toEqual([]);
  });
});

describe('a server restart: the games it cut short (stage 9 review)', () => {
  it('ends every game still running as serverRestart, unrated; finished games are left as they are', async () => {
    const { ranked } = await setup();
    // g1: finished and rated.
    const first = await newGame(ranked, ['ana', 'ben'], { id: 'g1' });
    for (const cell of NEARLY_CELLS) first.table.move('ana', cell);
    await first.recorder.done;
    // g2: running when the server stopped: its start and some events are stored, no end.
    const second = await newGame(ranked, ['ana', 'ben'], { id: 'g2' });
    second.table.move('ben', NEARLY_CELLS[0]!);
    await second.recorder.flush();
    const before = await t.db.select().from(ratings).orderBy(asc(ratings.userId), asc(ratings.ratingKey));

    const at = new Date(T0 + 3_600_000);
    expect(await endInterruptedGames(t.db, at)).toEqual(['g2']);
    const rows = await t.db.select().from(games).orderBy(asc(games.id));
    expect(rows.map((g) => [g.id, g.endReason, g.endedAt?.getTime()])).toEqual([
      ['g1', 'boardComplete', first.table.game.state.endedAt],
      ['g2', SERVER_RESTART, at.getTime()],
    ]);
    // Nobody's rating moved, and the seats have no result.
    expect(await t.db.select().from(ratings).orderBy(asc(ratings.userId), asc(ratings.ratingKey))).toEqual(
      before,
    );
    expect((await seatsRows('g2')).map((s) => [s.status, s.place, s.ratingBefore, s.ratingAfter])).toEqual([
      ['active', null, 1304, null],
      ['active', null, 1288, null],
    ]);
    // What was written stays, for the admin site.
    expect((await t.db.select().from(gameEvents).where(eq(gameEvents.gameId, 'g2'))).length).toBeGreaterThan(
      0,
    );
    // Again (the next boot): nothing left to end.
    expect(await endInterruptedGames(t.db, at)).toEqual([]);
    second.recorder.close();
    expect(await second.recorder.done).toMatchObject({ ok: false, unfinished: true });
  });

  it('an end that comes after the restart ended the row is not written over it, and rates nobody', async () => {
    const { ranked } = await setup();
    const { recorder, table } = await newGame(ranked, ['ana', 'ben']);
    await recorder.flush();
    await endInterruptedGames(t.db, new Date(T0 + 1000));
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    // The row is ended already: the late end is not written over it, and no rating moves.
    expect(await recorder.done).toEqual({ ok: true, outcome: 'alreadyRecorded' });
    expect(await rating('ana', 'fast')).toMatchObject({ rating: 1287, games: 12 });
  });
});

describe('the admin site shows real ranked games (spec §27.3)', () => {
  it('in the games list, the game detail (players, events) and the user detail', async () => {
    const { ranked } = await setup();
    const { recorder, table } = await newGame(ranked, ['ana', 'ben']);
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    await recorder.done;

    const list = await listGames(t.db, { page: 1, pageSize: 50 });
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      id: 'g1',
      mode: 'ranked',
      gameType: 'fast',
      endReason: 'boardComplete',
      players: [
        expect.objectContaining({
          userId: 'ana',
          displayName: 'ana',
          place: 1,
          ratingBefore: 1287,
          ratingAfter: 1304,
        }),
        expect.objectContaining({
          userId: 'ben',
          displayName: 'ben',
          place: 2,
          ratingBefore: 1305,
          ratingAfter: 1288,
        }),
      ],
    });
    const detail = await getGame(t.db, 'g1');
    expect(detail!.events.map((e) => e.seq)).toEqual(table.game.events.map((e) => e.seq));

    const ana = await getUser(t.db, 'ana');
    expect(ana!.games).toBe(1);
    expect(ana!.stats).toMatchObject({ games: 1, wins: 1, losses: 0 });
    expect(ana!.recentGames[0]).toMatchObject({
      gameId: 'g1',
      place: 1,
      ratingKey: 'fast',
      ratingAfter: 1304,
    });
    expect(ana!.ratings.find((r) => r.key === 'fast')).toMatchObject({ rating: 1304, games: 13 });
  });
});

// ---------------------------------------------------------------------------------------------------------
// A friends room's game (1.0.4; friends-room.md §4, §7.1) [D81a]

/** A friends room's game between `ids` on NEARLY_DONE (fast): the engine's ranked rules, nobody rated. */
async function newFriendsGame(ranked: RankedGames, ids: string[], id = 'f1') {
  const config = await ranked.createFriendsConfig({
    id,
    gameType: 'fast',
    players: players(...ids),
    seed: 1,
  });
  const recorder = ranked.recordFriends(config);
  const table = tableFor(config, recorder);
  table.game.start();
  return { config, recorder, table };
}

/** `first` wins against `second`: 3 right digits (50 + 3), against a mistake then 1 right digit (20 + 1). */
function playNearlyDone(table: ReturnType<typeof tableFor>, first = 'ana', second = 'ben') {
  const [a, b, c, d] = NEARLY_CELLS as [CellIndex, CellIndex, CellIndex, CellIndex];
  table.move(first, a);
  table.move(second, b, 1500, ((table.answer(b) % 9) + 1) as Digit);
  table.scheduler.advance(1000);
  table.move(second, b);
  table.move(first, c);
  table.move(first, d);
  expect(table.game.isOver).toBe(true);
}

const xpRows = async () =>
  (await t.db.select().from(xp).orderBy(asc(xp.userId))).map((r) => [r.userId, r.xp] as const);
const HOUR_MS = 3_600_000;
const T0_DAY = Math.floor(T0 / (24 * HOUR_MS));

/** A practice result of ana's, as POST /v1/me/practice-results stores it. */
const practiceRow = (id: string, endedAt: number, earned: number) => ({
  userId: 'ana',
  id,
  mode: 'bot' as const,
  gameType: 'fast',
  outcome: 'win',
  correct: 10,
  endedAt: new Date(endedAt),
  xp: earned,
});

describe('a friends room’s game (1.0.4) [D81a]', () => {
  it('is stored like a ranked game, as mode friends: no rating anywhere, histories, the replay, XP; no achievements', async () => {
    const { ranked } = await setup();
    const { config, recorder, table } = await newFriendsGame(ranked, ['ana', 'ben']);
    // The engine's ranked rules, a puzzle of the ranked pool, and nobody with a rating.
    expect(config).toMatchObject({ mode: 'ranked', gameType: 'fast', puzzle: NEARLY_DONE });
    expect(config.rules).toEqual(
      (await ranked.createConfig({ id: 'x', gameType: 'fast', players: players('ana', 'ben'), seed: 1 }))
        .rules,
    );
    expect(config.players).toEqual([
      { id: 'ana', name: 'ANA' },
      { id: 'ben', name: 'BEN' },
    ]);
    const allRatings = () => t.db.select().from(ratings).orderBy(asc(ratings.userId), asc(ratings.ratingKey));
    const ratingsBefore = await allRatings();

    playNearlyDone(table);
    expect(table.game.state.result!.ratingChanges).toEqual([]);
    expect(await recorder.done).toEqual<RecordOutcome>({ ok: true, outcome: 'recorded' });

    const [game] = await t.db.select().from(games).where(eq(games.id, 'f1'));
    expect(game).toMatchObject({
      mode: 'friends',
      gameType: 'fast',
      playerCount: 2,
      endReason: 'boardComplete',
    });
    expect(
      (await seatsRows('f1')).map((s) => [
        s.userId,
        s.place,
        s.ratingKey,
        s.ratingBefore,
        s.ratingAfter,
        s.xp,
      ]),
    ).toEqual([
      ['ana', 1, null, null, null, 53],
      ['ben', 2, null, null, null, 21],
    ]);
    expect(await allRatings()).toEqual(ratingsBefore);
    expect(await xpRows()).toEqual([
      ['ana', 53],
      ['ben', 21],
    ]);
    // Seen and met: the puzzle does not come back to them in ranked, and they are each other's recent opponents.
    expect((await t.db.select().from(puzzleHistory)).map((h) => [h.userId, h.puzzleId]).sort()).toEqual([
      ['ana', NEARLY_DONE.id],
      ['ben', NEARLY_DONE.id],
    ]);
    expect((await t.db.select().from(opponentHistory)).map((h) => [h.userId, h.opponentId]).sort()).toEqual([
      ['ana', 'ben'],
      ['ben', 'ana'],
    ]);
    expect(await t.db.select().from(gameEvents).where(eq(gameEvents.gameId, 'f1'))).toHaveLength(
      table.game.events.length,
    );
    expect(await t.db.select().from(userAchievements)).toEqual([]);

    // The history: 'ranked' with friends: true (an app before 1.0.4 still reads the page); the replay is there.
    const page = await listUserGames(t.db, 'ben', null);
    expect(page.games).toHaveLength(1);
    expect(page.games[0]).toMatchObject({ id: 'f1', mode: 'ranked', friends: true, mySeat: 1 });
    expect(page.games[0]!.players.map((p) => [p.ratingKey, p.ratingBefore, p.ratingAfter])).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
    expect(isHistoryGame(page.games[0])).toBe(true);
    const replay = await readReplay(t.db, 'f1', 'ana');
    expect(replay.kind === 'found' && replay.events.length).toBe(table.game.events.length);

    // The admin site's filter.
    expect((await listGames(t.db, { page: 1, pageSize: 50, mode: 'friends' })).total).toBe(1);
    expect((await listGames(t.db, { page: 1, pageSize: 50, mode: 'ranked' })).total).toBe(0);
  });

  it('recording the end again changes nothing, and a rating key passed with it is ignored', async () => {
    const { ranked } = await setup();
    const { config, recorder, table } = await newFriendsGame(ranked, ['ana', 'ben']);
    playNearlyDone(table);
    await recorder.done;
    const endOf = (cfg: typeof config, tb: typeof table) =>
      recordGameEnd(t.db, {
        start: { config: cfg, startedAt: T0, seats: seatsOf(cfg), ratingKey: 'fast', friends: true },
        state: tb.game.state,
        unwritten: tb.game.events,
        log: tb.game.events,
        cheat: DEFAULT_CHEAT_THRESHOLDS,
      });
    expect(await endOf(config, table)).toBe('alreadyRecorded');
    expect(await xpRows()).toEqual([
      ['ana', 53],
      ['ben', 21],
    ]);

    // Written straight, with a rating key (a caller's mistake): still unrated.
    const second = await ranked.createFriendsConfig({
      id: 'f2',
      gameType: 'fast',
      players: players('ana', 'ben'),
      seed: 2,
    });
    const tb = tableFor(second);
    tb.game.start();
    playNearlyDone(tb);
    expect(await endOf(second, tb)).toBe('recorded');
    expect((await seatsRows('f2')).map((s) => [s.ratingKey, s.ratingBefore, s.ratingAfter])).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
    expect(await rating('ana', 'fast')).toMatchObject({ rating: 1287, games: 12 });
    expect((await t.db.select().from(games).where(eq(games.id, 'f2')))[0]?.mode).toBe('friends');
  });

  it('XP within the daily practice cap: practice and levels of that UTC day count first; the day before does not', async () => {
    const { ranked } = await setup({ practiceXpDailyCap: 100 });
    // ana used 80 of today's 100 (practice 60, levels 20); yesterday's 100 were yesterday's.
    await t.db
      .insert(practiceResults)
      .values([practiceRow('p1', T0 - HOUR_MS, 60), practiceRow('p0', T0 - 13 * HOUR_MS, 100)]);
    await t.db.insert(levelXpDays).values({ userId: 'ana', day: T0_DAY, xp: 20 });
    expect(await practiceXpUsedOn(t.db, 'ana', T0_DAY)).toBe(80);

    const { recorder, table } = await newFriendsGame(ranked, ['ana', 'ben']);
    playNearlyDone(table);
    await recorder.done;
    // ana earned 53 and gets the 20 left; ben, with nothing used, all 21.
    expect((await seatsRows('f1')).map((s) => [s.userId, s.xp])).toEqual([
      ['ana', 20],
      ['ben', 21],
    ]);
    expect(await xpRows()).toEqual([
      ['ana', 20],
      ['ben', 21],
    ]);
    // The friends game counts in its day's cap from now on, and only in that day's.
    expect(await practiceXpUsedOn(t.db, 'ana', T0_DAY)).toBe(100);
    expect(await practiceXpUsedOn(t.db, 'ben', T0_DAY)).toBe(21);
    expect(await practiceXpUsedOn(t.db, 'ben', T0_DAY - 1)).toBe(0);
    expect(await practiceXpUsedOn(t.db, 'ben', T0_DAY + 1)).toBe(0);
    // A ranked game is not practice: the cap neither cuts its XP nor counts it.
    const rankedGame = await newGame(ranked, ['ana', 'ben'], { id: 'g1' });
    playNearlyDone(rankedGame.table);
    await rankedGame.recorder.done;
    expect((await seatsRows('g1')).map((s) => s.xp)).toEqual([53, 21]);
    expect(await practiceXpUsedOn(t.db, 'ana', T0_DAY)).toBe(100);
    expect(await xpRows()).toEqual([
      ['ana', 73],
      ['ben', 42],
    ]);
  });

  it('two games ending at once never pass the cap together; a full cap still stores the game, with 0 XP', async () => {
    const { ranked } = await setup({
      practiceXpDailyCap: 100,
      accounts: [
        { id: 'ana', rating: 1287, games: 12 },
        { id: 'ben', rating: 1305, games: 12 },
        { id: 'cid', rating: 1250, games: 12 },
      ],
    });
    // Two games of ana's, played out but not recorded yet: both ends at once.
    const configs = await Promise.all([
      ranked.createFriendsConfig({ id: 'f1', gameType: 'fast', players: players('ana', 'ben'), seed: 1 }),
      ranked.createFriendsConfig({ id: 'f2', gameType: 'fast', players: players('ana', 'cid'), seed: 2 }),
    ]);
    const tables = configs.map((config) => tableFor(config));
    for (const tb of tables) tb.game.start();
    playNearlyDone(tables[0]!, 'ana', 'ben');
    playNearlyDone(tables[1]!, 'ana', 'cid');
    const ends = configs.map((config, k) =>
      recordGameEnd(t.db, {
        start: { config, startedAt: T0, seats: seatsOf(config), ratingKey: null, friends: true },
        state: tables[k]!.game.state,
        unwritten: tables[k]!.game.events,
        log: tables[k]!.game.events,
        cheat: DEFAULT_CHEAT_THRESHOLDS,
        xpDailyCap: 100,
      }),
    );
    expect(await Promise.all(ends)).toEqual(['recorded', 'recorded']);
    // ana won both (53 each): 100 in all, the second end cut to what was left.
    const anaSeats = [...(await seatsRows('f1')), ...(await seatsRows('f2'))].filter(
      (s) => s.userId === 'ana',
    );
    expect(anaSeats.map((s) => s.xp!).sort((a, b) => b - a)).toEqual([53, 47]);
    expect(await xpRows()).toEqual([
      ['ana', 100],
      ['ben', 21],
      ['cid', 21],
    ]);

    // A third game the same day: stored, in the history, 0 XP for ana.
    const third = await newFriendsGame(ranked, ['ana', 'ben'], 'f3');
    playNearlyDone(third.table);
    expect(await third.recorder.done).toEqual<RecordOutcome>({ ok: true, outcome: 'recorded' });
    expect((await seatsRows('f3')).map((s) => [s.userId, s.xp])).toEqual([
      ['ana', 0],
      ['ben', 21],
    ]);
    expect((await xpRows())[0]).toEqual(['ana', 100]);
    expect((await listUserGames(t.db, 'ana', null)).games.map((g) => g.id).sort()).toEqual([
      'f1',
      'f2',
      'f3',
    ]);
  });
});

describe('a game against a stealth bot (stealth-bot.md §7) [D90, D92, D96]', () => {
  /** Makes `id` (an account of the setup) a persona: users.kind and its personas row. */
  async function makePersona(id: string) {
    await t.db.update(users).set({ kind: 'persona' }).where(eq(users.id, id));
    await t.db.insert(personas).values({ userId: id, temperament: 'quiet', createdAt: new Date(T0) });
  }

  it('is a ranked game in every way a player sees (seats, ratings, XP, opponents), marked stealth; the puzzle and the flags are the person’s alone', async () => {
    await addPuzzles(t.db, [PUZZLE]);
    // Every correct move flags: the person is checked, the persona never (a quick bot is no cheat).
    const { ranked } = await setup({ cheat: { thinkMs: 10_000, moves: 1 } });
    await makePersona('ben');
    const config = {
      ...(await ranked.createConfig({ id: 'g1', gameType: 'fast', players: players('ana', 'ben'), seed: 1 })),
      puzzle: PUZZLE,
    };
    // Nothing in the config says which seat is the bot (it goes to the app in gameCreated).
    expect(config.players).toEqual([
      { id: 'ana', name: 'ANA', rating: 1287, ratedGames: 12 },
      { id: 'ben', name: 'BEN', rating: 1305, ratedGames: 12 },
    ]);
    const recorder = ranked.record(config);
    const table = tableFor(config, recorder);
    table.game.start();
    // A wrong digit from ana first, then they take turns.
    const first = table.empty()[0]!;
    table.move('ana', first, 4000, ((table.answer(first) % 9) + 1) as Digit);
    table.scheduler.advance(1000);
    table.fillAll(
      (k) => (k % 2 === 0 ? 'ana' : 'ben'),
      (k) => 3000 + (k % 5) * 700,
    );
    expect(await recorder.done).toEqual<RecordOutcome>({ ok: true, outcome: 'recorded' });
    const result = table.game.state.result!;

    const [game] = await t.db.select().from(games).where(eq(games.id, 'g1'));
    expect(game).toMatchObject({ mode: 'ranked', stealth: true, endReason: 'boardComplete' });

    // Both seats, each with its account; both rated in the key, both with XP.
    const seats = await seatsRows('g1');
    expect(seats.map((s) => [s.userId, s.ratingKey, s.ratingBefore])).toEqual([
      ['ana', 'fast', 1287],
      ['ben', 'fast', 1305],
    ]);
    for (const seat of seats) {
      const change = result.ratingChanges.find((c) => c.playerId === seat.userId)!;
      expect(seat.ratingAfter).toBe(change.after);
      expect(seat.xp).toBeGreaterThan(0);
    }
    expect(await rating('ana', 'fast')).toMatchObject({ games: 13 });
    expect(await rating('ben', 'fast')).toMatchObject({ games: 13 });
    expect((await t.db.select().from(xp).orderBy(asc(xp.userId))).map((r) => [r.userId, r.xp > 0])).toEqual([
      ['ana', true],
      ['ben', true],
    ]);

    // The pace: the person's, as the engine measures it; never the persona's.
    const pace = movePace(table.game.events, 'ana')!;
    expect(pace.mistakes).toBe(1);
    expect(seats[0]).toMatchObject({
      paceMs: Math.round(pace.baseMs),
      paceMoves: pace.moves,
      paceDigits: pace.digits,
      mistakes: 1,
    });
    const anaStats = result.stats.find((s) => s.playerId === 'ana')!;
    expect(seats[0]!.paceDigits).toBe(seats[0]!.mistakes! + anaStats.correct);
    expect(seats[1]).toMatchObject({ paceMs: null, paceMoves: null, paceDigits: null });

    // The puzzle is the person's alone; both met each other (the friends tab, and no repeat persona).
    expect((await t.db.select().from(puzzleHistory)).map((r) => r.userId)).toEqual(['ana']);
    expect(
      (await t.db.select().from(opponentHistory).orderBy(asc(opponentHistory.userId))).map((r) => [
        r.userId,
        r.opponentId,
      ]),
    ).toEqual([
      ['ana', 'ben'],
      ['ben', 'ana'],
    ]);
    // Flags: the person only.
    expect((await t.db.select().from(cheatFlags)).map((f) => f.userId)).toEqual(['ana']);
  });

  it('the puzzle is picked by the person’s history alone (a persona that plays a lot uses up nothing)', async () => {
    const [other] = standInPuzzles(1, 'fast-other');
    await addPuzzles(t.db, [other!]);
    const { ranked } = await setup();
    await makePersona('ben');
    // ana played NEARLY_DONE long ago; ben (were his history read) played the other one since.
    await t.db.insert(puzzleHistory).values([
      { userId: 'ana', puzzleId: NEARLY_DONE.id, playedAt: new Date(T0 - 10 * 86_400_000) },
      { userId: 'ben', puzzleId: other!.id, playedAt: new Date(T0 - 86_400_000) },
    ]);
    const config = await ranked.createConfig({
      id: 'g1',
      gameType: 'fast',
      players: players('ana', 'ben'),
      seed: 1,
    });
    expect(config.puzzle.id).toBe(other!.id);

    // Between two people, both histories count: the one played longest ago.
    await t.db.update(users).set({ kind: 'person' }).where(eq(users.id, 'ben'));
    const between = await ranked.createConfig({
      id: 'g2',
      gameType: 'fast',
      players: players('ana', 'ben'),
      seed: 1,
    });
    expect(between.puzzle.id).toBe(NEARLY_DONE.id);
  });

  it('a game between people is not stealth; a friends game stores no pace (ranked only, D96)', async () => {
    const { ranked } = await setup();
    const { recorder, table } = await newFriendsGame(ranked, ['ana', 'ben']);
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    expect(await recorder.done).toMatchObject({ ok: true });
    const [game] = await t.db.select().from(games);
    expect(game).toMatchObject({ mode: 'friends', stealth: false });
    expect((await seatsRows('f1')).map((s) => [s.userId, s.paceMs, s.paceMoves, s.paceDigits])).toEqual([
      ['ana', null, null, null],
      ['ben', null, null, null],
    ]);
  });

  it('a person who entered no digit has no pace (null), and a log the engine can’t read never fails the end', async () => {
    const { ranked } = await setup();
    const { recorder, table } = await newGame(ranked, ['ana', 'ben']);
    for (const cell of NEARLY_CELLS) table.move('ana', cell);
    expect(await recorder.done).toMatchObject({ ok: true });
    const [ana, ben] = await seatsRows('g1');
    expect(ana!.paceMs).toBeGreaterThan(0);
    expect(ana).toMatchObject({ paceMoves: 4, paceDigits: 4 });
    expect(ben).toMatchObject({ paceMs: null, paceMoves: null, paceDigits: null });

    const events = table.game.events;
    expect(paceOf(events, 'ana')).toEqual(movePace(events, 'ana'));
    expect(paceOf([], 'ana')).toBeNull();
    expect(paceOf(events.slice(1), 'ana')).toBeNull(); // not from gameCreated
    expect(paceOf(events, 'nobody')).toBeNull();
    expect(paceOf([{ type: 'gameCreated' } as unknown as GameEvent, ...events.slice(1)], 'ana')).toBeNull();
  });
});
