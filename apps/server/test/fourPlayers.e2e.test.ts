/**
 * Stage 10's done criteria (work plan, "סיום"; spec §6.6, §6.7, §10, §11.2) end to end: the real server
 * (Colyseus + Express + an in-memory PGlite, one port, a free one) and fake clients (src/testing/fakeClient)
 * that sign in with (development) accounts and play like bots.
 *
 * - A rated private room of 4 (`create: { playerCount: 4, rated: true }`, the way two phones and two fake
 *   clients meet in development): one player surrenders [D36] and one leaves and never comes back
 *   (abandonment at the end of the grace, D32); the other two play the board to the end. The ranking is
 *   complete: the two still in by score, then the two who went out by the order of leaving, the first out
 *   last; the moment of an abandonment is the end of its grace, so the player who LEFT first ranks ABOVE the
 *   one who surrendered later in the game but before that grace ran out. The surrendered player's solved
 *   cells keep their colour. Every rating moved exactly by the pairwise Elo formula for 4 (K_pair = 32/(N−1),
 *   doubled while provisional, spec §11.2), in the database and in GET /v1/me.
 * - A ranked game of 3 through the matchmaking queue `fast-3p` (3 fake --queue clients): the match forms
 *   only when the group is full, the countdown waits for all three, and the ratings in the database are the
 *   engine's for 3 players.
 *
 * The timings are short: a grace of 1.5 s, a 300 ms countdown, players ten (4P) and fifty (3P) times faster
 * than people. FAKE_LOG=1 prints what the fake clients say.
 */
import type { AddressInfo } from 'node:net';

import { eloChanges, eloPairs, type GameType, leaveGuardsFor, type PairGuard } from '@sudoku-fight/engine';
import { MATCH_RANGE, type QueueKey } from '@sudoku-fight/protocol';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { createAppServer } from '../src/app';
import { gamePlayers, games, ratings } from '../src/db/schema';
import type { GamePuzzle } from '../src/game/puzzles';
import { DEFAULT_MATCHER } from '../src/matchmaking';
import { type BankPuzzle, seedRankedPuzzles } from '../src/puzzles';
import { createTestDb, PUZZLE, quietLog, testConfig, type TestDb } from '../src/testing';
import {
  FakeClient,
  type FakeClientOptions,
  type FakeClientSummary,
  type FakeQueueOptions,
} from '../src/testing/fakeClient';
import { testTokens, type TestTokens } from '../src/testing/tokens';

const GRACE_MS = 1500;
const COUNTDOWN_MS = 300;
const READY_MS = 3000;

// ---------------------------------------------------------------------------------------------------------
// The ranked pool: a whole puzzle for the game of 4 (it has to outlast the surrender and the grace), and one
// a few cells from the end for the game of 3.

/** Every blank has the other 8 of its row given: one solution, found by singles alone. */
const nearlyDone = (id: string, blanks: number[]): GamePuzzle => ({
  id,
  givens: [...PUZZLE.solution].map((d, i) => (blanks.includes(i) ? '0' : d)).join(''),
  solution: PUZZLE.solution,
});
const NORMAL_4P: GamePuzzle = { ...PUZZLE, id: 'four-normal-1' };
const FAST_3P = nearlyDone('three-fast-1', [0, 13, 40, 80, 27, 59]);

const bankPuzzle = (p: GamePuzzle, gameType: GameType): BankPuzzle => ({
  ...p,
  gameType,
  techniques: ['nakedSingle'],
  givensCount: [...p.givens].filter((c) => c !== '0').length,
  source: 'fourPlayers.e2e',
  pool: 'ranked',
});

// ---------------------------------------------------------------------------------------------------------
// The server

const log = quietLog();
let t: TestDb;
let tokens: TestTokens;
let server: ReturnType<typeof createAppServer>;
let url = '';

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  const seeded = await seedRankedPuzzles(t.db, [
    bankPuzzle(NORMAL_4P, 'normal'),
    bankPuzzle(FAST_3P, 'fast'),
  ]);
  expect(seeded).toMatchObject({ ranked: 2 });
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig(),
    db: t,
    tokens: tokens.verifier(Date.now),
    game: { log, closeAfterGameMs: 500 },
    matchmaking: {
      config: {
        tickMs: 25,
        matcher: { ...DEFAULT_MATCHER, range: MATCH_RANGE, timeoutMs: 10_000 },
        readyTimeoutMs: READY_MS,
        countdownMs: COUNTDOWN_MS,
        gameRules: { graceMs: GRACE_MS },
      },
    },
  });
  await server.listen(0);
  url = `ws://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await Promise.all([...clients].map((c) => c.stop()));
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await t.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
}, 30_000);

// ---------------------------------------------------------------------------------------------------------
// Fake players

const clients = new Set<FakeClient>();

afterEach(async () => {
  await Promise.all([...clients].map((c) => c.stop()));
  clients.clear();
});

async function player(name: string, options: Partial<FakeClientOptions>): Promise<FakeClient> {
  const say = process.env.FAKE_LOG ? (line: string) => console.log(`[${name}] ${line}`) : undefined;
  const client = await FakeClient.connect({
    url,
    name,
    log: say,
    botConfig: { lingerShare: 0 },
    pingEveryMs: 400,
    ...options,
  });
  clients.add(client);
  return client;
}

const queued = (name: string, queueKey: QueueKey, queue: Partial<FakeQueueOptions> = {}) =>
  player(name, { thinkScale: 0.02, queue: { queueKey, ...queue } });

/** What every finished game shows on a side that stayed: a whole mirror, no solution before the end. */
function expectCleanGame(s: FakeClientSummary): void {
  expect(s.error).toBeNull();
  expect(s.outcome).toBe('over');
  expect(s.seqGaps).toBe(0);
  expect(s.leaks).toBe(0);
  expect(s.solutionMatches).toBe(true);
}

// ---------------------------------------------------------------------------------------------------------
// The database

const ratingRow = async (userId: string, key: string) =>
  (
    await t.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.ratingKey, key)))
  )[0];

const seatsOf = (gameId: string) =>
  t.db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId)).orderBy(asc(gamePlayers.seat));

async function gameOf(userId: string) {
  const ids = (
    await t.db.select({ id: gamePlayers.gameId }).from(gamePlayers).where(eq(gamePlayers.userId, userId))
  ).map((r) => r.id);
  return (await t.db.select().from(games).where(inArray(games.id, ids)))[0];
}

/** The game's result is written in the background after gameOver: wait for its last rating. */
async function until<T>(find: () => Promise<T | undefined | null | false>, what: string, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
    const found = await find();
    if (found) return found;
  }
  throw new Error(`no ${what} within ${ms} ms`);
}

/**
 * The rating changes the engine's formula gives for the stored seats (spec §11.2), every player new, with the
 * leave guards the engine found in the final state (none: by place alone).
 */
async function formulaFor(gameId: string, guards: ReadonlyMap<string, readonly PairGuard[]> = new Map()) {
  const seats = await seatsOf(gameId);
  return eloChanges(
    seats.map((s) => ({
      id: s.userId!,
      rating: s.ratingBefore!,
      games: 0,
      place: s.place!,
      abandoned: s.status === 'abandoned',
      guards: guards.get(s.userId!) ?? [],
    })),
  );
}

// ---------------------------------------------------------------------------------------------------------

describe('a rated game of 4 (work plan stage 10, "סיום")', () => {
  it('surrender and abandonment rank after the active players by exit order; ratings by the formula for 4', async () => {
    const pace: Partial<FakeClientOptions> = { thinkScale: 0.1, account: {} };
    const ana = await player('Ana4', {
      ...pace,
      seed: 41,
      create: { playerCount: 4, rated: true, gameType: 'normal', rules: { graceMs: GRACE_MS } },
    });
    const code = ana.code;
    // Dan leaves first and never comes back: out at the END of his grace (spec §6.7).
    const dan = await player('Dan4', { ...pace, seed: 44, code, trouble: { leaveAfterMs: 150 } });
    // Cyd surrenders after Dan left, but before Dan's grace runs out: out first, so last (D36).
    const cyd = await player('Cyd4', { ...pace, seed: 43, code, trouble: { surrenderAfterMs: 700 } });
    const ben = await player('Ben4', { ...pace, seed: 42, code });

    const [a, b, c, d] = await Promise.all([ana.done, ben.done, cyd.done, dan.done]);
    expectCleanGame(a);
    expectCleanGame(b);
    // The surrendered player stays in the room and sees the end too; the leaver is gone.
    expectCleanGame(c);
    expect(d.outcome).toBe('left');
    expect(a.players).toBe(4);
    expect(a.endReason).toBe('boardComplete');

    // The full ranking, as every client that stayed saw it.
    const ranking = a.ranking!;
    expect(b.ranking).toEqual(ranking);
    expect(c.ranking).toEqual(ranking);
    expect(ranking).toHaveLength(4);
    const entry = (s: FakeClientSummary) => ranking.find((r) => r.playerId === s.playerId)!;
    expect(entry(c)).toMatchObject({ place: 4, status: 'surrendered' });
    expect(entry(d)).toMatchObject({ place: 3, status: 'abandoned' });
    // The two still in by score [D16]: places 1 and 2, or a shared 1.
    const active = [entry(a), entry(b)].sort((x, y) => x.place - y.place);
    expect(active.every((r) => r.status === 'active')).toBe(true);
    expect(active.map((r) => r.place)).toEqual(
      active[0]!.score === active[1]!.score && active[0]!.mistakes === active[1]!.mistakes ? [1, 1] : [1, 2],
    );
    expect(active[0]!.score).toBeGreaterThanOrEqual(active[1]!.score);

    // D36: the cells Cyd solved before leaving keep Cyd's colour (seat) to the end.
    const final = ana.state!;
    const cydSeat = final.players.find((p) => p.id === c.playerId)!.seat;
    expect(final.owner.filter((o) => o === cydSeat)).toHaveLength(c.correct!);
    expect(final.locks).toEqual([]);

    // The database: the game of 4, its seats as ranked, and every rating by the formula (K_pair = 64/3).
    const game = await gameOf(a.playerId);
    expect(game).toMatchObject({
      mode: 'ranked',
      gameType: 'normal',
      playerCount: 4,
      puzzleId: NORMAL_4P.id,
    });
    const seats = await until(async () => {
      const rows = await seatsOf(game!.id);
      return rows.every((s) => s.ratingAfter !== null) && rows;
    }, 'the rating changes');
    expect(seats.map((s) => [s.userId, s.place, s.status]).sort()).toEqual(
      ranking.map((r) => [r.playerId, r.place, r.status]).sort(),
    );
    // The leave guards (§11.2) as the engine finds them in the final state the phones hold: Dan is judged
    // at his drop, Cyd at his surrender.
    const guards = leaveGuardsFor(final);
    expect(final.players.find((p) => p.id === d.playerId)!.leaveStandings).toHaveLength(4);
    expect(final.players.find((p) => p.id === c.playerId)!.leaveStandings).toHaveLength(4);
    const formula = await formulaFor(game!.id, guards);
    for (const change of formula) {
      const seat = seats.find((s) => s.userId === change.playerId)!;
      expect(seat.ratingAfter).toBe(change.after);
      expect(await ratingRow(change.playerId, 'normal')).toMatchObject({
        rating: change.after,
        games: 1,
        provisional: true,
      });
    }
    expect(formula.every((x) => x.provisional)).toBe(true);
    // By place alone, everyone new at 1200 so every E is 0.5: the last −32, the one above him −11 (spec
    // §11.2, N = 4).
    const byPlace = await formulaFor(game!.id);
    const placeDelta = (s: FakeClientSummary) => byPlace.find((x) => x.playerId === s.playerId)!.delta;
    expect(placeDelta(c)).toBe(-32);
    expect(placeDelta(d)).toBe(-11);
    expect(placeDelta(a) + placeDelta(b)).toBe(43);
    // The guards only take: a loss from Cyd (a leaver in every pair), a gain from Ana and Ben (stayers in
    // every pair with a leaver). Dan is the leaver against Ana and Ben, the stayer against Cyd.
    const deltaOf = (s: FakeClientSummary) => formula.find((x) => x.playerId === s.playerId)!.delta;
    expect(deltaOf(c)).toBeGreaterThanOrEqual(placeDelta(c));
    expect(deltaOf(c)).toBeLessThanOrEqual(0);
    for (const s of [a, b]) expect(deltaOf(s)).toBeLessThanOrEqual(placeDelta(s));
    const kinds = (s: FakeClientSummary) => (guards.get(s.playerId) ?? []).map((g) => g.kind);
    expect(kinds(c).every((k) => k === 'noLoss')).toBe(true);
    expect([...kinds(a), ...kinds(b)].every((k) => k === 'noGain')).toBe(true);

    // Results-4P: the change against each opponent came to the phones with the result, as the engine split
    // it (eloPairs over the same seats), each player's pairs adding up to their change.
    const pairs = final.result!.ratingPairs!;
    expect(pairs).toHaveLength(4);
    // In the ranking's order, as the engine feeds them.
    const split = eloPairs(
      ranking.map((r) => {
        const x = seats.find((seat) => seat.userId === r.playerId)!;
        return {
          id: x.userId!,
          rating: x.ratingBefore!,
          games: 0,
          place: x.place!,
          abandoned: x.status === 'abandoned',
          guards: guards.get(x.userId!) ?? [],
        };
      }),
    );
    for (const mine of pairs) {
      expect(mine).toEqual(split.find((x) => x.playerId === mine.playerId));
      expect(mine.pairs).toHaveLength(3);
      const tenths = mine.pairs.reduce((sum, p) => sum + Math.round(p.delta * 10), 0);
      expect([mine.playerId, tenths]).toEqual([
        mine.playerId,
        formula.find((x) => x.playerId === mine.playerId)!.delta * 10,
      ]);
    }
    expect(ben.state!.result!.ratingPairs).toEqual(pairs);
  }, 45_000);
});

describe('a ranked game of 3 through matchmaking (fast-3p)', () => {
  it('three --queue clients find each other, play, and the database has the engine’s ratings for 3', async () => {
    const [eli, fay, gus] = await Promise.all([
      queued('Eli3', 'fast-3p', { avatarId: 'lava-lamp' }),
      queued('Fay3', 'fast-3p', { avatarId: 'maya', country: 'DE' }),
      queued('Gus3', 'fast-3p'),
    ]);
    const summaries = await Promise.all([eli.done, fay.done, gus.done]);
    for (const s of summaries) expectCleanGame(s);
    const [e, f] = summaries;

    // One match of three, in one room; each saw the other two.
    expect(new Set(summaries.map((s) => s.match!.matchId)).size).toBe(1);
    expect(new Set(summaries.map((s) => s.code)).size).toBe(1);
    for (const s of summaries) {
      expect(s.match).toMatchObject({ queueKey: 'fast-3p', registered: true, cancelled: null });
      expect(s.match!.opponents.map((p) => p.id).sort()).toEqual(
        summaries
          .filter((x) => x !== s)
          .map((x) => x.playerId)
          .sort(),
      );
      expect(s.players).toBe(3);
    }
    expect(f.match!.opponents.find((p) => p.id === e.playerId)).toMatchObject({
      name: 'Eli3',
      avatarId: 'lava-lamp',
    });
    expect(e.match!.opponents.find((p) => p.id === f.playerId)).toMatchObject({
      avatarId: 'maya',
      country: 'DE',
    });

    // The database: a game of 3 on the fast pool, and the formula for N = 3 (K_pair = 64/2), as announced.
    const game = await gameOf(e.playerId);
    expect(game).toMatchObject({ mode: 'ranked', gameType: 'fast', playerCount: 3, puzzleId: FAST_3P.id });
    const seats = await seatsOf(game!.id);
    expect(seats).toHaveLength(3);
    const formula = await formulaFor(game!.id);
    for (const change of formula) {
      const seat = seats.find((s) => s.userId === change.playerId)!;
      expect(seat.ratingAfter).toBe(change.after);
      expect(await ratingRow(change.playerId, 'fast')).toMatchObject({ rating: change.after, games: 1 });
      const summary = summaries.find((s) => s.playerId === change.playerId)!;
      const { before, after, delta, provisional } = change;
      expect(summary.match!.rating).toEqual({ key: 'fast', before, after, delta, provisional });
      expect(summary.match!.ratingAfter).toMatchObject({ key: 'fast', rating: after, games: 1 });
    }
    // Equal ratings: a clear winner gains 2 × 32 × 0.5 = 32; the sum is zero up to rounding.
    expect(Math.abs(formula.reduce((sum, x) => sum + x.delta, 0))).toBeLessThanOrEqual(1);
    const places = seats.map((s) => s.place).sort();
    if (places.join() === '1,2,3') {
      const deltas = [...formula].sort((x, y) => y.delta - x.delta).map((x) => x.delta);
      expect(deltas).toEqual([32, 0, -32]);
    }
  }, 30_000);
});
