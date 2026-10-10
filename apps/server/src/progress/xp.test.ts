import {
  type CellIndex,
  createRng,
  DEFAULT_PROGRESS_RULES,
  type Digit,
  type GameResult,
  levelFor,
  type RankEntry,
} from '@sudoku-fight/engine';
import { type MyProgress, PROGRESS_PATHS } from '@sudoku-fight/protocol';
import { asc } from 'drizzle-orm';

import { getUser } from '../admin/users';
import { DEFAULT_CHEAT_THRESHOLDS } from '../config';
import { xp } from '../db/schema';
import { type RankedGames, rankedGames, recordGameEnd, seatsOf } from '../persistence';
import { dbPuzzleSource } from '../puzzles';
import { call } from '../testing/accounts';
import { fakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { NEARLY_DONE } from '../testing/game';
import { startHttp, type TestHttp } from '../testing/http';
import { addAccounts, addPuzzles, recordingLog, T0, tableFor } from '../testing/ranked';
import { testTokens, type TestTokens } from '../testing/tokens';
import { addXp, outcomeOf, rankedXpGains } from './xp';

/**
 * Stage 12, spec §15: XP for ranked games, written with the ratings when the game ends (one transaction, once),
 * and the level it reaches. Games are played by the real ServerGame and stored by the real recorder.
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

let ranked: RankedGames;
beforeEach(async () => {
  await t.reset();
  await addAccounts(t.db, [
    { id: 'ana', name: 'Ana', rating: 1287, games: 12 },
    { id: 'ben', name: 'Ben', rating: 1305, games: 12 },
  ]);
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

const NEARLY_CELLS = [0, 13, 40, 80] as CellIndex[];

/** ana against ben on NEARLY_DONE: ana places three right digits, ben one after a mistake. ana wins. */
async function playedGame() {
  const config = await ranked.createConfig({
    id: 'g1',
    gameType: 'fast',
    players: [
      { id: 'ana', name: 'ANA' },
      { id: 'ben', name: 'BEN' },
    ],
    seed: 1,
  });
  const recorder = ranked.record(config);
  const table = tableFor(config, recorder);
  table.game.start();
  const [a, b, c, d] = NEARLY_CELLS as [CellIndex, CellIndex, CellIndex, CellIndex];
  table.move('ana', a);
  table.move('ben', b, 1500, ((table.answer(b) % 9) + 1) as Digit);
  table.scheduler.advance(1000);
  table.move('ben', b);
  table.move('ana', c);
  table.move('ana', d);
  expect(await recorder.done).toEqual({ ok: true, outcome: 'recorded' });
  return { config, state: table.game.state, events: table.game.events };
}

const xpRows = () => t.db.select().from(xp).orderBy(asc(xp.userId));

describe('XP at the end of a ranked game (spec §15)', () => {
  it('50 for the win, 20 for the loss, plus a point per correct move; stored with the level', async () => {
    const { state } = await playedGame();
    const result = state.result!;
    expect(result.stats.map((s) => [s.playerId, s.correct])).toEqual([
      ['ana', 3],
      ['ben', 1],
    ]);
    expect(await xpRows()).toEqual([
      { userId: 'ana', xp: 53, level: 1 },
      { userId: 'ben', xp: 21, level: 1 },
    ]);
  });

  it('is written once: recording the same end again changes nothing (the alreadyRecorded guard)', async () => {
    const { config, state, events } = await playedGame();
    const again = await recordGameEnd(t.db, {
      start: { config, startedAt: state.startedAt!, seats: seatsOf(config), ratingKey: 'fast' },
      state,
      unwritten: [],
      log: events,
      cheat: DEFAULT_CHEAT_THRESHOLDS,
    });
    expect(again).toBe('alreadyRecorded');
    expect((await xpRows()).map((r) => [r.userId, r.xp])).toEqual([
      ['ana', 53],
      ['ben', 21],
    ]);
  });

  it('adds to what a player has, and moves the stored level past 200 × n', async () => {
    await t.db.insert(xp).values({ userId: 'ana', xp: 180, level: 1 });
    await playedGame();
    expect((await xpRows())[0]).toEqual({ userId: 'ana', xp: 233, level: 2 });
    const progress = await call<MyProgress>(http.url, 'GET', PROGRESS_PATHS.myProgress, {
      token: await tokens.sign({ uid: 'uid-ana' }, clock.now()),
    });
    expect(progress.status).toBe(200);
    expect(progress.body).toEqual<MyProgress>({
      xp: 233,
      level: 2,
      xpIntoLevel: 33,
      xpForNext: 400,
      // 13 games in fast now (12 + this one): settled, 1304 → gold [D9].
      league: 'gold',
      leagueRating: 1304,
    });
    // The admin site's user page shows it too (stage 12).
    expect(await getUser(t.db, 'ana')).toMatchObject({ xp: 233, level: 2 });
    expect(await getUser(t.db, 'ben')).toMatchObject({ xp: 21, level: 1 });
  });
});

describe('rankedXpGains and outcomes', () => {
  const entry = (playerId: string, place: number, correct: number): RankEntry => ({
    playerId,
    seat: 0,
    place,
    score: 0,
    mistakes: 0,
    correct,
    status: 'active',
  });
  const resultOf = (ranking: RankEntry[]): GameResult => ({
    reason: 'boardComplete',
    durationMs: 1,
    ranking,
    ratingChanges: [],
    awards: [],
    stats: [],
  });

  it('§15 "מקום 1": a shared first place earns 50 + correct, though the card calls it a tie (./xp)', () => {
    expect(rankedXpGains(resultOf([entry('a', 1, 10), entry('b', 1, 12), entry('c', 3, 4)]))).toEqual([
      { playerId: 'a', xp: 60 },
      { playerId: 'b', xp: 62 },
      { playerId: 'c', xp: 24 },
    ]);
    expect(rankedXpGains(resultOf([entry('a', 1, 0), entry('b', 2, 0)]))).toEqual([
      { playerId: 'a', xp: 50 },
      { playerId: 'b', xp: 20 },
    ]);
    expect([outcomeOf(1, false), outcomeOf(1, true), outcomeOf(2, true), outcomeOf(4, false)]).toEqual([
      'win',
      'tie',
      'loss',
      'loss',
    ]);
  });

  it('counts correct moves from the engine stats when it has them', () => {
    const result = resultOf([entry('a', 1, 3)]);
    result.stats = [
      {
        playerId: 'a',
        correct: 7,
        mistakes: 0,
        pointsGained: 0,
        interferencesSent: 0,
        bestMove: null,
        avgThinkMs: null,
      },
    ];
    expect(rankedXpGains(result)).toEqual([{ playerId: 'a', xp: 57 }]);
  });

  it('addXp makes the row, adds, and keeps the level equal to levelFor()', async () => {
    await addXp(t.db, [{ userId: 'ben', xp: 0 }]); // nothing to add: no row
    expect(await xpRows()).toEqual([]);
    for (const gain of [150, 50, 400, 600, 1]) await addXp(t.db, [{ userId: 'ben', xp: gain }]);
    const [row] = await xpRows();
    expect(row).toEqual({ userId: 'ben', xp: 1201, level: levelFor(1201, DEFAULT_PROGRESS_RULES).level });
    expect(row!.level).toBe(4);
  });
});
