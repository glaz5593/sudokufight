/**
 * Stage 9's done criteria (work plan, "סיום"; spec §10, §11, §19–§21) end to end: the real server (Colyseus +
 * Express + an in-memory PGlite, one port, a free one) and fake clients (src/testing/fakeClient) that do what
 * the app does in a ranked game: sign in with a (development) token, registering the account the first time,
 * search in a matchmaking queue, connect to the match's room when found (D37: that is being ready), count
 * down, play like a bot, and read their stored rating back (GET /v1/me).
 *
 * - Two players find each other, play, and the database has the game (games, game_players, game_events,
 *   histories) with the ratings moved exactly by the engine's formula (rating += delta, games, provisional,
 *   peak); the admin API lists the game with its players and events; the solution reaches no client before
 *   the end, and only the admin API reads it from game_events.
 * - The range widens every 5 s and a lonely search ends with Match-Timeout after 60 s; "keep searching" lifts
 *   the cap.
 * - New opponents get priority: a player waits for a newcomer rather than replay a recent opponent who is a
 *   closer rating (original §7).
 * - A no-show after "found": the match is off, unrated, the other player back at the head of the queue.
 * - The same pair again (the 80% reset lets them meet): puzzle_history gives them the puzzle they haven't
 *   played.
 * - Both players drop in the 3-2-1 countdown: their seats are held [D32], they come back, and the game is
 *   played and rated.
 * - One search per account: a second queue is refused, and so is a search while the account's game runs.
 * - A server restart cuts a game short: the next boot ends it as 'serverRestart', unrated.
 * - RATING_OPTION=A: a normal 2-player game moves 'normal-2p', not 'normal'.
 *
 * The timings are scaled through the test config (createAppServer's matchmaking options): the range steps
 * every 250 ms (5 s ÷ 20), the timeout is 3 s (60 s ÷ 20), the ready check 2 s, the countdown 300 ms, the
 * grace 2 s; the fake players think 50 times faster than people. The ranked pool is loaded with the
 * db:seed-puzzles function: puzzles a few cells from the end, so games are short.
 *
 * FAKE_LOG=1 prints what the fake clients say.
 */
import type { AddressInfo } from 'node:net';

import { eloChanges, type GameConfig, type GameType } from '@sudoku-fight/engine';
import {
  type AdminGameDetail,
  type AdminGameRow,
  type AdminPage,
  devToken,
  MATCH_RANGE,
  MATCH_TIMEOUT_MS,
  matchmakingErrorOf,
  type MatchmakingServerMessage,
  matchRange,
  type MatchRangeRules,
  type QueueKey,
} from '@sudoku-fight/protocol';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { createAppServer } from '../src/app';
import {
  gameEvents,
  gamePlayers,
  games,
  opponentHistory,
  puzzleHistory,
  ratings,
  users,
} from '../src/db/schema';
import type { GamePuzzle } from '../src/game/puzzles';
import { DEFAULT_MATCHER } from '../src/matchmaking';
import { SERVER_RESTART } from '../src/persistence';
import { type BankPuzzle, seedRankedPuzzles } from '../src/puzzles';
import {
  createTestDb,
  getUrl,
  PUZZLE,
  quietLog,
  signedInAdmin,
  testConfig,
  type TestDb,
} from '../src/testing';
import {
  FakeClient,
  type FakeClientOptions,
  type FakeClientSummary,
  type FakeClientUpdate,
  type FakeQueueOptions,
} from '../src/testing/fakeClient';
import { testTokens, type TestTokens } from '../src/testing/tokens';

// ---------------------------------------------------------------------------------------------------------
// Scaled timings

const SCALE = 20;
const RANGE: MatchRangeRules = { ...MATCH_RANGE, stepMs: MATCH_RANGE.stepMs / SCALE };
const TIMEOUT_MS = MATCH_TIMEOUT_MS / SCALE;
const READY_MS = 2000;
const COUNTDOWN_MS = 300;
const GRACE_MS = 2000;

// ---------------------------------------------------------------------------------------------------------
// The ranked pool: real puzzles a few cells from the end (one solution each: every blank has 8 givens in its
// row), loaded the way `npm run db:seed-puzzles` does, with an offline one it must leave out.

const nearlyDone = (id: string, blanks: number[]): GamePuzzle => ({
  id,
  givens: [...PUZZLE.solution].map((d, i) => (blanks.includes(i) ? '0' : d)).join(''),
  solution: PUZZLE.solution,
});
const FAST_1 = nearlyDone('ranked-fast-1', [0, 13, 40, 80]);
const FAST_2 = nearlyDone('ranked-fast-2', [1, 14, 41, 79]);
const NORMAL_1 = nearlyDone('ranked-normal-1', [2, 15, 42, 78]);
/** The game the restart cuts short: a whole puzzle, played at a person's pace. */
const HARD_1: GamePuzzle = { ...PUZZLE, id: 'ranked-hard-1' };

const bankPuzzle = (p: GamePuzzle, gameType: GameType, pool: 'ranked' | 'offline'): BankPuzzle => ({
  ...p,
  gameType,
  techniques: ['nakedSingle'],
  givensCount: [...p.givens].filter((c) => c !== '0').length,
  source: 'ranked.e2e',
  pool,
});

// ---------------------------------------------------------------------------------------------------------
// The server (two in a row: RATING_OPTION B, then A after a restart, on one database)

const log = quietLog();
let t: TestDb;
let tokens: TestTokens;
let server: ReturnType<typeof createAppServer> | null = null;
let url = '';
/** Two accounts registered under RATING_OPTION B, for the game after the switch to A. */
let beforeSwitch: { oz: string; pia: string };

async function startServer(ratingOption: 'A' | 'B'): Promise<void> {
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig({ ratingOption }),
    db: t,
    tokens: tokens.verifier(Date.now),
    game: { log, closeAfterGameMs: 500 },
    matchmaking: {
      config: {
        tickMs: 25,
        matcher: { ...DEFAULT_MATCHER, range: RANGE, timeoutMs: TIMEOUT_MS },
        extendedTimeoutMs: TIMEOUT_MS,
        keepSearchingWindowMs: 2000,
        readyTimeoutMs: READY_MS,
        countdownMs: COUNTDOWN_MS,
        gameRules: { graceMs: GRACE_MS },
      },
    },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}

async function stopServer(): Promise<void> {
  const s = server;
  server = null;
  if (s === null) return;
  await s.gracefullyShutdown(false);
  s.transport.server?.closeAllConnections();
}

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  const result = await seedRankedPuzzles(t.db, [
    bankPuzzle(FAST_1, 'fast', 'ranked'),
    bankPuzzle(FAST_2, 'fast', 'ranked'),
    bankPuzzle(NORMAL_1, 'normal', 'ranked'),
    bankPuzzle(HARD_1, 'hard', 'ranked'),
    bankPuzzle(nearlyDone('offline-fast', [3, 16, 43, 77]), 'fast', 'offline'),
  ]);
  expect(result).toMatchObject({ ranked: 4, skipped: 1 });
  await startServer('B');
  const [oz, pia] = await Promise.all([register('Oz1'), register('Pia')]);
  beforeSwitch = { oz, pia };
}, 30_000);

afterAll(async () => {
  await Promise.all([...clients].map((c) => c.stop()));
  await stopServer();
  await t.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
}, 30_000);

// ---------------------------------------------------------------------------------------------------------
// Fake players

/** Fifty times a person's pace, no lock left to run out on purpose, a ping every 400 ms. */
const QUICK: Partial<FakeClientOptions> = {
  thinkScale: 0.02,
  botConfig: { lingerShare: 0 },
  pingEveryMs: 400,
};

const clients = new Set<FakeClient>();

afterEach(async () => {
  // Nobody left searching or playing into the next test.
  await Promise.all([...clients].map((c) => c.stop()));
  clients.clear();
});

interface Searcher {
  client: FakeClient;
  /** The matchmaking messages, from the very first, with the time they came. */
  messages: { m: MatchmakingServerMessage; at: number }[];
  /** When connect() was called. */
  startedAt: number;
}

async function searcher(
  name: string,
  queueKey: QueueKey,
  {
    queue,
    ...options
  }: Partial<Omit<FakeClientOptions, 'queue'>> & { queue?: Partial<FakeQueueOptions> } = {},
): Promise<Searcher> {
  const messages: Searcher['messages'] = [];
  const onUpdate = (u: FakeClientUpdate) => {
    if (u.kind === 'matchmaking') messages.push({ m: u.message, at: Date.now() });
  };
  const say = process.env.FAKE_LOG ? (line: string) => console.log(`[${name}] ${line}`) : undefined;
  const startedAt = Date.now();
  const client = await FakeClient.connect({
    url: url.replace('http', 'ws'),
    name,
    log: say,
    onUpdate,
    ...QUICK,
    ...options,
    queue: { queueKey, ...queue },
  });
  clients.add(client);
  return { client, messages, startedAt };
}

const of = <T extends MatchmakingServerMessage['type']>(s: Searcher, type: T) =>
  s.messages
    .map((x) => x.m)
    .filter((m): m is Extract<MatchmakingServerMessage, { type: T }> => m.type === type);

/** Resolves once `find` holds (it may be async), polling. */
async function until<T>(
  find: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  what: string,
  ms = 8000,
): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) {
    const found = await find();
    if (found) return found;
  }
  throw new Error(`no ${what} within ${ms} ms`);
}

/** What every finished game shows on each side: a whole mirror, the solution never seen before the end. */
function expectCleanGame(s: FakeClientSummary): void {
  expect(s.error).toBeNull();
  expect(s.outcome).toBe('over');
  expect(s.seqGaps).toBe(0);
  expect(s.leaks).toBe(0); // no snapshot of a running game carried the solution (spec §21)
  expect(s.solutionMatches).toBe(true); // it solved the givens itself; the server's came after the end
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

async function gamesOf(userId: string) {
  const ids = (
    await t.db.select({ id: gamePlayers.gameId }).from(gamePlayers).where(eq(gamePlayers.userId, userId))
  ).map((r) => r.id);
  if (ids.length === 0) return [];
  return t.db.select().from(games).where(inArray(games.id, ids)).orderBy(asc(games.startedAt));
}

const seatsOf = (gameId: string) =>
  t.db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId)).orderBy(asc(gamePlayers.seat));

/** The rating changes the engine's formula gives for the stored seats (spec §11.2), with `games` before. */
async function formulaFor(gameId: string, gamesBefore: Record<string, number>) {
  const seats = await seatsOf(gameId);
  return eloChanges(
    seats.map((s) => ({
      id: s.userId!,
      rating: s.ratingBefore!,
      games: gamesBefore[s.userId!]!,
      place: s.place!,
      abandoned: s.status === 'abandoned',
    })),
  );
}

// ---------------------------------------------------------------------------------------------------------

describe('RATING_OPTION=B (the default): one rating per game type', () => {
  let firstGame: { id: string; puzzleId: string; ana: string; ben: string } | null = null;

  it('two players find each other, play, and the ratings move by the formula; the admin API shows the game', async () => {
    const [ana, ben] = await Promise.all([
      searcher('Ana', 'fast-2p', { seed: 1 }),
      searcher('Ben', 'fast-2p', { seed: 2 }),
    ]);
    const [a, b] = await Promise.all([ana.client.done, ben.client.done]);
    expectCleanGame(a);
    expectCleanGame(b);

    // The match, as each side saw it.
    expect(a.match).toMatchObject({ queueKey: 'fast-2p', rematch: false, registered: true, cancelled: null });
    expect(a.match!.matchId).toBe(b.match!.matchId);
    expect(a.match!.opponents.map((p) => [p.id, p.name, p.rating, p.provisional])).toEqual([
      [b.playerId, 'Ben', 1200, true],
    ]);
    expect(a.match!.ranges[0]).toBe(50);
    expect(a.match!.ratingBefore).toMatchObject({ key: 'fast', rating: 1200, games: 0, provisional: true });
    expect(a.code).toBe(b.code); // the same game room

    // The game in the database (spec §19).
    const [game] = await gamesOf(a.playerId);
    expect(game).toMatchObject({ mode: 'ranked', gameType: 'fast', playerCount: 2, endReason: a.endReason });
    expect([FAST_1.id, FAST_2.id]).toContain(game!.puzzleId);
    expect(game!.endedAt).not.toBeNull();
    const seats = await seatsOf(game!.id);
    expect(seats.map((s) => s.userId)).toEqual(expect.arrayContaining([a.playerId, b.playerId]));
    expect(seats.map((s) => [s.ratingKey, s.ratingBefore])).toEqual([
      ['fast', 1200],
      ['fast', 1200],
    ]);

    // The ratings, exactly by the engine's formula: provisional (games < 10) so K = 64 [D23, D31].
    const formula = await formulaFor(game!.id, { [a.playerId]: 0, [b.playerId]: 0 });
    for (const change of formula) {
      const seat = seats.find((s) => s.userId === change.playerId)!;
      expect(seat.ratingAfter).toBe(change.after);
      expect(await ratingRow(change.playerId, 'fast')).toMatchObject({
        rating: 1200 + change.delta,
        games: 1,
        provisional: true,
        peak: Math.max(1200, change.after),
      });
      // As the result announced it, and as GET /v1/me read it back.
      const summary = change.playerId === a.playerId ? a : b;
      const { before, after, delta, provisional } = change;
      expect(summary.match!.rating).toEqual({ key: 'fast', before, after, delta, provisional });
      expect(summary.match!.ratingAfter).toMatchObject({ key: 'fast', rating: change.after, games: 1 });
    }
    // Equal ratings, K = 64: ±32 for a win and a loss, 0 for a draw (same place, spec §11.2).
    expect(Math.abs(formula[0]!.delta)).toBe(seats[0]!.place === seats[1]!.place ? 0 : 32);
    // Other keys stay.
    expect(await ratingRow(a.playerId, 'normal')).toMatchObject({ rating: 1200, games: 0 });

    // The histories: the puzzle played, the opponent met (no repeats, original §7, §32).
    const played = await t.db
      .select()
      .from(puzzleHistory)
      .where(inArray(puzzleHistory.userId, [a.playerId, b.playerId]));
    expect(played.map((p) => p.puzzleId)).toEqual([game!.puzzleId, game!.puzzleId]);
    const met = await t.db
      .select()
      .from(opponentHistory)
      .where(inArray(opponentHistory.userId, [a.playerId, b.playerId]))
      .orderBy(asc(opponentHistory.userId));
    expect(met.map((m) => [m.userId, m.opponentId, m.gameType]).sort()).toEqual(
      [
        [a.playerId, b.playerId, 'fast'],
        [b.playerId, a.playerId, 'fast'],
      ].sort(),
    );

    // Every event is stored, gameCreated with the solution (for the replay)...
    const events = await t.db
      .select()
      .from(gameEvents)
      .where(eq(gameEvents.gameId, game!.id))
      .orderBy(asc(gameEvents.seq));
    expect(events[0]!.type).toBe('gameCreated');
    expect((events[0]!.payload as { config: GameConfig }).config.puzzle.solution).toBe(PUZZLE.solution);
    expect(events.at(-1)!.type).toBe('gameOver');

    // ...and the admin API, behind its sign-in, is what reads it (spec §27.3).
    expect((await getUrl(`${url}/admin/api/games/${game!.id}`)).status).toBe(401);
    const admin = await signedInAdmin(url);
    const list = await admin.get<AdminPage<AdminGameRow>>('/games', { search: game!.id });
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: game!.id, mode: 'ranked', gameType: 'fast' });
    const after = new Map(formula.map((c) => [c.playerId, c.after]));
    expect(list.body.items[0]!.players).toEqual(
      seats.map((s): unknown =>
        expect.objectContaining({
          userId: s.userId,
          displayName: s.userId === a.playerId ? 'Ana' : 'Ben',
          seat: s.seat,
          place: s.place,
          ratingKey: 'fast',
          ratingBefore: 1200,
          ratingAfter: after.get(s.userId!),
        }),
      ),
    );
    const detail = await admin.get<AdminGameDetail>(`/games/${game!.id}`);
    expect(detail.body.events.map((e) => e.seq)).toEqual(events.map((e) => e.seq));
    expect(detail.body.events[0]!.type).toBe('gameCreated');

    firstGame = { id: game!.id, puzzleId: game!.puzzleId, ana: a.playerId, ben: b.playerId };
  }, 30_000);

  it('the range widens by 25 every 5 s (scaled) up to ±300; Match-Timeout after 60 s (scaled)', async () => {
    const cy = await searcher('Cyd', 'normal-2p');
    const s = await cy.client.done;
    expect(s.outcome).toBe('timeout');
    const searching = of(cy, 'searching');
    // One `searching` per widening: 50, 75, … 300, each the formula's range for its searching time.
    expect(searching[0]).toMatchObject({ elapsedMs: 0, range: 50, extended: false });
    for (const m of searching) expect(m.range).toBe(matchRange(m.elapsedMs, false, RANGE));
    const ranges = searching.map((m) => m.range);
    expect(ranges.at(-1)).toBe(300);
    for (let k = 1; k < ranges.length; k++) {
      expect(ranges[k]! - ranges[k - 1]!).toBeGreaterThan(0);
      expect((ranges[k]! - ranges[k - 1]!) % 25).toBe(0);
    }
    // The cap after (300 − 50) / 25 steps of 250 ms: 2.5 s (50 s unscaled).
    const capped = searching.find((m) => m.range === 300)!;
    expect(capped.elapsedMs).toBeGreaterThanOrEqual(10 * RANGE.stepMs);
    // Then the timeout, at the deadline: the app's Match-Timeout screen.
    const [timeout] = of(cy, 'timeout');
    expect(timeout).toMatchObject({ queueKey: 'normal-2p', range: 300, extended: false });
    expect(timeout!.elapsedMs).toBeGreaterThanOrEqual(TIMEOUT_MS);
    const timeoutAt = cy.messages.find((x) => x.m.type === 'timeout')!.at;
    expect(timeoutAt - cy.startedAt).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
    expect(s.match).toMatchObject({ timeouts: 1, matchId: null });

    // "Keep searching (no range limit)": the range goes on widening past the cap.
    const dee = await searcher('Dee', 'normal-2p', { queue: { keepSearching: true } });
    const beyond = await until(
      () => of(dee, 'searching').find((m) => m.extended && m.range > 300),
      'range > 300',
    );
    expect(beyond.range).toBe(matchRange(beyond.elapsedMs, true, RANGE));
    expect(of(dee, 'timeout')).toHaveLength(1);
    await dee.client.stop();
  }, 30_000);

  it('new opponents get priority: a player waits for a newcomer rather than replay a closer-rated opponent', async () => {
    // Three accounts: Eli and Fox met before in this game type; Gus is new to both, and 150 points away.
    const [eli, fox, gus] = await Promise.all(['Eli', 'Fox', 'Gus'].map((name) => register(name)));
    await t.db.update(ratings).set({ rating: 1350, peak: 1350 }).where(eq(ratings.userId, gus!));
    const metAt = new Date(Date.now() - 3_600_000);
    await t.db.insert(opponentHistory).values([
      { userId: eli!, opponentId: fox!, gameType: 'fast', playedAt: metAt },
      { userId: fox!, opponentId: eli!, gameType: 'fast', playedAt: metAt },
    ]);

    // Gus waits first; then Eli and Fox, the same rating: they could meet at once, but they met lately.
    const g = await searcher('Gus', 'fast-2p', { seed: 3 });
    const e = await searcher('Eli', 'fast-2p', { seed: 4 });
    const f = await searcher('Fox', 'fast-2p', { seed: 5 });
    const found = await until(() => of(e, 'found')[0], 'found for Eli');
    expect(found.players.map((p) => p.id).sort()).toEqual([eli, gus].sort());
    expect(found.rematch).toBe(false);
    // Fox was in the queue, in range, before Eli was matched, and got nothing.
    expect(of(f, 'searching')[0]!.serverTime).toBeLessThan(found.serverTime);
    expect(of(f, 'found')).toEqual([]);
    // Eli waited until the range reached Gus (150 points: 4 steps), passing over Fox at 0 points.
    expect(found.serverTime - of(e, 'searching')[0]!.serverTime).toBeGreaterThanOrEqual(
      4 * RANGE.stepMs - 50,
    );
    await f.client.stop();
    const [eDone, gDone] = await Promise.all([e.client.done, g.client.done]);
    expectCleanGame(eDone);
    expectCleanGame(gDone);
  }, 30_000);

  it('a no-show after "found": the match is off and unrated; the other player is back at the head of the queue', async () => {
    const hal = await searcher('Hal', 'fast-2p');
    const ivy = await searcher('Ivy', 'fast-2p', { queue: { noShow: true } });
    const i = await ivy.client.done;
    expect(i.outcome).toBe('cancelled');
    expect(i.match).toMatchObject({ cancelled: 'noShow' });
    expect(of(ivy, 'matchCancelled')[0]).toMatchObject({
      reason: 'noShow',
      missing: [i.playerId],
      requeued: false,
    });
    // Hal: told why, and searching again with his time so far (the ready check does not count).
    const back = await until(() => of(hal, 'searching').find((m) => m.requeued), 'requeued search');
    expect(of(hal, 'matchCancelled')[0]).toMatchObject({ missing: [i.playerId], requeued: true });
    expect(back.elapsedMs).toBeLessThan(READY_MS);
    // No game, so no rating moved and nothing was played [D37: the game starts only with everyone in].
    expect(await gamesOf(i.playerId)).toEqual([]);
    expect(await gamesOf(hal.client.playerId)).toEqual([]);
    expect(await ratingRow(i.playerId, 'fast')).toMatchObject({ rating: 1200, games: 0 });
    await hal.client.stop();
    // Not shut out: the no-show may search again.
    const again = await searcher('Ivy', 'fast-2p');
    expect(await until(() => of(again, 'searching')[0], 'searching again')).toMatchObject({
      queueKey: 'fast-2p',
    });
  }, 30_000);

  it('the same pair again: puzzle_history gives them the puzzle neither has played', async () => {
    expect(firstGame).not.toBeNull();
    const before = {
      ana: (await ratingRow(firstGame!.ana, 'fast'))!,
      ben: (await ratingRow(firstGame!.ben, 'fast'))!,
    };
    // Alone in the queue together: they have met, but they are all each other can meet (the 80% reset).
    const [ana, ben] = await Promise.all([searcher('Ana', 'fast-2p'), searcher('Ben', 'fast-2p')]);
    const [a, b] = await Promise.all([ana.client.done, ben.client.done]);
    expectCleanGame(a);
    expectCleanGame(b);
    expect(a.match!.registered).toBe(false);
    expect(a.match!.rematch).toBe(true);
    expect(a.match!.ratingBefore).toMatchObject({ rating: before.ana.rating, games: 1 });

    const second = (await gamesOf(firstGame!.ana)).at(-1)!;
    expect(second.id).not.toBe(firstGame!.id);
    expect(second.puzzleId).not.toBe(firstGame!.puzzleId);
    expect([FAST_1.id, FAST_2.id]).toContain(second.puzzleId);
    // The second game moved the ratings on from the first, by the formula with one game played.
    const formula = await formulaFor(second.id, { [firstGame!.ana]: 1, [firstGame!.ben]: 1 });
    for (const change of formula) {
      const was = change.playerId === firstGame!.ana ? before.ana : before.ben;
      expect(change.before).toBe(was.rating);
      expect(await ratingRow(change.playerId, 'fast')).toMatchObject({
        rating: was.rating + change.delta,
        games: 2,
        peak: Math.max(was.peak, was.rating + change.delta),
      });
    }
  }, 30_000);

  it('both players drop in the countdown: the seats are held [D32], they come back, the game is played and rated', async () => {
    // Jo is back before GO; Kai after it, while the game waits for him (two players: frozen).
    const [jo, kai] = await Promise.all([
      searcher('Jo1', 'fast-2p', { trouble: { dropInCountdownForMs: 50 } }),
      searcher('Kai', 'fast-2p', { trouble: { dropInCountdownForMs: COUNTDOWN_MS + 400 } }),
    ]);
    const [j, k] = await Promise.all([jo.client.done, kai.client.done]);
    expectCleanGame(j);
    expectCleanGame(k);
    expect(j.resyncs).toHaveLength(1);
    expect(k.resyncs).toHaveLength(1);
    expect(k.resyncs[0]!.via).toBe('reconnect'); // the seat was held for the reconnection token
    expect(j.ranking!.map((r) => r.status)).toEqual(['active', 'active']); // nobody abandoned
    const [game] = await gamesOf(j.playerId);
    expect(game!.endReason).toBe('boardComplete');
    expect(await ratingRow(j.playerId, 'fast')).toMatchObject({ games: 1 });
  }, 30_000);

  it('one search per account: a second queue is refused', async () => {
    const lu = await searcher('Lu1', 'hard-2p');
    // (The SDK warns that the refused connection closed.)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const error = await searcher('Lu1', 'normal-2p').then(
        () => 'joined',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(matchmakingErrorOf(error)).toBe('alreadyQueued');
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      warn.mockRestore();
    }
    // The first search is untouched.
    expect(lu.client.outcome).toBe('playing');
    await lu.client.stop();
  }, 30_000);

  it('a restart cuts a game short: the next boot ends it as serverRestart, unrated (then RATING_OPTION=A)', async () => {
    // A hard game at a person's pace: still running when the server goes down.
    const [mo, ned] = await Promise.all([
      searcher('Mo1', 'hard-2p', { thinkScale: 1 }),
      searcher('Ned', 'hard-2p', { thinkScale: 1 }),
    ]);
    await until(
      () => mo.client.state?.status === 'running' && ned.client.state?.status === 'running',
      'the game running',
    );
    const gameId = await until(
      async () => (await gamesOf(mo.client.playerId))[0]?.id,
      'the hard game stored as started',
    );

    // (The SDK warns about the closed connections, the new server about the game it ends.)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let warnings: string[];
    try {
      // One ranked game at a time: no search while it runs.
      const busy = await searcher('Mo1', 'fast-2p').then(
        () => 'joined',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(matchmakingErrorOf(busy)).toBe('alreadyQueued');
      expect(busy).toContain('in a ranked game that has not ended');

      await stopServer();
      await Promise.all([mo.client.stop(), ned.client.stop()]);
      // The rooms are gone with the process: the row says the game never ended.
      const [cut] = await t.db.select().from(games).where(eq(games.id, gameId));
      expect(cut!.endedAt).toBeNull();

      await startServer('A');
    } finally {
      warnings = warn.mock.calls.map((c) => String(c[0]));
      warn.mockRestore();
    }
    expect(warnings).toContainEqual(
      expect.stringContaining('cut short by the restart: ended as serverRestart'),
    );
    const [ended] = await t.db.select().from(games).where(eq(games.id, gameId));
    expect(ended).toMatchObject({ endReason: SERVER_RESTART });
    expect(ended!.endedAt).not.toBeNull();
    expect((await seatsOf(gameId)).map((s) => [s.ratingBefore, s.ratingAfter, s.place])).toEqual([
      [1200, null, null],
      [1200, null, null],
    ]);
    expect(await ratingRow(mo.client.playerId, 'hard')).toMatchObject({ rating: 1200, games: 0 });
    expect(await ratingRow(ned.client.playerId, 'hard')).toMatchObject({ rating: 1200, games: 0 });
  }, 30_000);
});

describe('RATING_OPTION=A (after the restart): one rating per game type and player count', () => {
  it("a normal 2-player game moves 'normal-2p', not 'normal'", async () => {
    // Accounts from before the switch (B: fast, normal, hard): their 'normal' rating is 1500, and stays.
    const { oz, pia } = beforeSwitch;
    await t.db
      .update(ratings)
      .set({ rating: 1500, peak: 1500, games: 20, provisional: false })
      .where(and(inArray(ratings.userId, [oz, pia]), eq(ratings.ratingKey, 'normal')));
    const normalBefore = await ratingRow(oz, 'normal');
    expect(await ratingRow(oz, 'normal-2p')).toBeUndefined();

    const [o, p] = await Promise.all([searcher('Oz1', 'normal-2p'), searcher('Pia', 'normal-2p')]);
    // The match is made on 'normal-2p': no row yet, so 1200 (not the 1500 of 'normal').
    expect(o.client.summary().match!.ratingBefore).toMatchObject({
      key: 'normal-2p',
      rating: 1200,
      games: 0,
    });
    const [od, pd] = await Promise.all([o.client.done, p.client.done]);
    expectCleanGame(od);
    expectCleanGame(pd);
    expect(od.match!.opponents[0]).toMatchObject({ name: 'Pia', rating: 1200 });

    const [game] = await gamesOf(oz);
    const seats = await seatsOf(game!.id);
    expect(seats.map((s) => s.ratingKey)).toEqual(['normal-2p', 'normal-2p']);
    const formula = await formulaFor(game!.id, { [oz]: 0, [pia]: 0 });
    for (const change of formula) {
      expect(await ratingRow(change.playerId, 'normal-2p')).toMatchObject({
        rating: 1200 + change.delta,
        games: 1,
        provisional: true,
      });
      const summary = change.playerId === oz ? od : pd;
      expect(summary.match!.rating).toMatchObject({ key: 'normal-2p', delta: change.delta });
      expect(summary.match!.ratingAfter).toMatchObject({ key: 'normal-2p', rating: change.after, games: 1 });
    }
    // 'normal' as it was: the same row, untouched.
    expect(await ratingRow(oz, 'normal')).toEqual(normalBefore);
    expect(log.errors).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------------------------------------

/** An account registered with the dev token the fake client of `name` uses; its users.id. */
async function register(name: string): Promise<string> {
  const res = await fetch(`${url}/v1/users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${devToken(`fake-${name}`)}`,
      'content-type': 'application/json',
      connection: 'close',
    },
    body: JSON.stringify({ displayName: name, avatarId: 'lava-lamp', country: 'IL' }),
  });
  expect(res.status).toBe(201);
  const me = (await res.json()) as { id: string };
  const [row] = await t.db.select({ id: users.id }).from(users).where(eq(users.id, me.id));
  return row!.id;
}
