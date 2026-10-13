/**
 * The contract between the app's progress code and this server (work plan stage 12, "סיום": "אחרי כמה משחקים,
 * ה־XP, ההישגים, הליגה והמיקום בטבלה מתעדכנים נכון"; achievements excepted: their list awaits Moshe's
 * approval, docs/ACHIEVEMENTS-PROPOSAL.md). End to end: the app's own progress API client
 * (apps/mobile/src/api/progressApi.ts, with its answer guards), its practice XP queue and sync
 * (src/progress/practiceQueue.ts, practiceSync.ts, practiceResult.ts) and its account client, all pure
 * TypeScript the phone runs, against the real server (Colyseus + Express + an in-memory PGlite, a free port).
 *
 * - Two accounts (development tokens, registered with the app's account client) play ranked games through
 *   fake clients (src/testing/fakeClient: matchmaking, the room, a bot's play): ten in 'fast', then one in
 *   'normal'. After each, the server's XP is the engine's xpForGame summed over the games (§15), the level
 *   levelFor() of it, and the ratings the results announced.
 * - No league after nine games in a key; after the tenth the league is leagueFor() of the settled key
 *   (§11.3 [D9]), on GET /v1/me/progress, the leaderboards and the cards alike.
 * - Practice XP [D41]: finished practices (played on the engine's LocalGameHost, as the phone does) go through
 *   the app's queue and sync; a resend, and the same id twice in one batch, count once; the server's XP is
 *   the ranked XP plus the practices' xpForGame, and the sync's last answer says the same.
 * - The leaderboards (§14.2): 'fast', 'normal' and 'general' (each player's best rated key) rank everyone by
 *   rating with shared ranks for equal ratings, over two pages walked by the server's cursor; my row is
 *   pinned with my exact rank; a player without a rated game has none; deleted accounts never show. The
 *   friends tab [D27] lists the opponent with their general row, and the invite link.
 * - A player card (§14.3) seen by the other player: every rating of option B with its peak and trend (the
 *   rating after each game, oldest first), the stats (games, wins, losses, win %, win streaks [D28], best
 *   move, mistakes per game), the last ten results, and nothing private (no email, no sign-in id).
 * - Errors come out of the app's client as its codes: notFound, notRegistered, badRequest.
 *
 * Timings are scaled as in appMatchmaking.contract.test.ts; the ranked pool holds puzzles a few cells from
 * the end. FAKE_LOG=1 prints what the fake clients say.
 */
import type { AddressInfo } from 'node:net';

import {
  defaultRules,
  type Digit,
  type GameConfig,
  type GameMode,
  type GameType,
  leagueFor,
  levelFor,
  LocalGameHost,
  ManualClock,
  ManualScheduler,
  type PlayerInfo,
  type RankEntry,
  xpForGame,
  botPlayer,
} from '@sudoku-fight/engine';
import {
  devToken,
  LEADERBOARD_PAGE_SIZE,
  type Leaderboard,
  type LeaderboardEntry,
  MATCH_RANGE,
  MATCH_TIMEOUT_MS,
  type MatchRangeRules,
  type MyProgress,
  type PlayerCard,
  playerPath,
  type PracticeResult,
  type PracticeResultsResponse,
  type QueueKey,
} from '@sudoku-fight/protocol';
import { and, asc, eq, isNotNull } from 'drizzle-orm';

// The app's code (pure TypeScript, no React Native): what the phone runs.
import { createAccountApi } from '../../mobile/src/api/accountApi';
import { createProgressApi, ProgressApiError, type ProgressApi } from '../../mobile/src/api/progressApi';
import type { KeyValueStore } from '../../mobile/src/auth/types';
import { createPracticeQueue } from '../../mobile/src/progress/practiceQueue';
import { type FinishedPractice, practiceResultOf } from '../../mobile/src/progress/practiceResult';
import { PracticeSync } from '../../mobile/src/progress/practiceSync';
import { createAppServer } from '../src/app';
import { gameEvents, gamePlayers, games, users } from '../src/db/schema';
import type { GamePuzzle } from '../src/game/puzzles';
import { DEFAULT_MATCHER } from '../src/matchmaking';
import { type BankPuzzle, seedRankedPuzzles } from '../src/puzzles';
import { createTestDb, PUZZLE, quietLog, testConfig, type TestDb } from '../src/testing';
import { FakeClient, type FakeClientOptions, type FakeClientSummary } from '../src/testing/fakeClient';
import { addAccounts } from '../src/testing/ranked';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------------------------------------
// Scaled timings (appMatchmaking.contract.test.ts's)

const SCALE = 20;
const RANGE: MatchRangeRules = { ...MATCH_RANGE, stepMs: MATCH_RANGE.stepMs / SCALE };
const TIMEOUT_MS = MATCH_TIMEOUT_MS / SCALE;
const INVITE_URL = 'https://sudoku-fight.example/invite';

// Real puzzles a few cells from the end (one solution each: every blank has 8 givens in its row).
const nearlyDone = (id: string, blanks: number[]): GamePuzzle => ({
  id,
  givens: [...PUZZLE.solution].map((d, i) => (blanks.includes(i) ? '0' : d)).join(''),
  solution: PUZZLE.solution,
});
const bankPuzzle = (p: GamePuzzle, gameType: GameType): BankPuzzle => ({
  ...p,
  gameType,
  techniques: ['nakedSingle'],
  givensCount: [...p.givens].filter((c) => c !== '0').length,
  source: 'appProgress.contract',
  pool: 'ranked',
});

// ---------------------------------------------------------------------------------------------------------
// The server, with 55 rated players already on the boards (two pages) and a deleted one above them all

const SEEDED = 55;
/** Seeded ratings: 1500 and up, two players at each (shared ranks), all with settled keys. */
const seededRating = (k: number) => 1500 + Math.floor(k / 2);
const seededId = (k: number) => `seed-${String(k).padStart(2, '0')}`;

const log = quietLog();
let t: TestDb;
let server: ReturnType<typeof createAppServer>;
let url = '';

beforeAll(async () => {
  t = await createTestDb();
  await seedRankedPuzzles(t.db, [
    bankPuzzle(nearlyDone('progress-fast-1', [0, 13, 40, 80, 22, 57]), 'fast'),
    bankPuzzle(nearlyDone('progress-fast-2', [1, 14, 41, 79, 23, 58]), 'fast'),
    bankPuzzle(nearlyDone('progress-fast-3', [2, 15, 42, 78, 24, 59]), 'fast'),
    bankPuzzle(nearlyDone('progress-fast-4', [3, 16, 43, 77, 25, 60]), 'fast'),
    bankPuzzle(nearlyDone('progress-normal-1', [4, 17, 44, 76, 26, 61]), 'normal'),
  ]);
  await addAccounts(t.db, [
    ...Array.from({ length: SEEDED }, (_, k) => ({
      id: seededId(k),
      name: `Seed${k}`,
      rating: seededRating(k),
      games: 12,
    })),
    { id: 'seed-gone', name: 'Gone', rating: 2000, games: 30, deleted: true },
  ]);
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig({ progress: { practiceXpDailyCap: 1500, inviteUrl: INVITE_URL } }),
    db: t,
    game: { log, closeAfterGameMs: 500 },
    matchmaking: {
      config: {
        tickMs: 25,
        matcher: { ...DEFAULT_MATCHER, range: RANGE, timeoutMs: TIMEOUT_MS },
        extendedTimeoutMs: TIMEOUT_MS,
        keepSearchingWindowMs: 2000,
        readyTimeoutMs: 3000,
        countdownMs: 300,
        gameRules: { graceMs: 2000 },
      },
    },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

const clients = new Set<FakeClient>();

afterAll(async () => {
  await Promise.all([...clients].map((c) => c.stop()));
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await t.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
}, 30_000);

// ---------------------------------------------------------------------------------------------------------
// The phone

/** A signed-in player: a development token (with an email, to see that it never leaks), registered. */
async function account(name: string, uid: string, country: 'IL' | 'US') {
  const email = `${uid}@private.example`;
  const token = devToken(uid, email);
  const getToken = () => Promise.resolve(token);
  const accounts = createAccountApi({
    baseUrl: url,
    getToken,
    fetch: (target, init) => fetch(target, init),
    timeoutMs: 10_000,
  });
  const me = await accounts.createUser({ displayName: name, avatarId: 'lava-lamp', country });
  const progress = createProgressApi({
    baseUrl: url,
    getToken,
    fetch: (target, init) => fetch(target, init),
    timeoutMs: 10_000,
  });
  return { name, uid, email, token, me, progress };
}

type Account = Awaited<ReturnType<typeof account>>;

/** The phone's key-value store (expo-sqlite/kv-store), in memory. */
function memoryKv(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(map.get(key) ?? null),
    setItem: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

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

// ---------------------------------------------------------------------------------------------------------
// Ranked games: both accounts search the same queue; each fake client plays like a bot, fifty times faster

const QUICK: Partial<FakeClientOptions> = {
  thinkScale: 0.02,
  botConfig: { lingerShare: 0 },
  pingEveryMs: 400,
  interfere: false,
  react: false,
};

interface PlayedGame {
  gameType: GameType;
  /** Each account's summary, by users.id. */
  summaries: Map<string, FakeClientSummary>;
  ranking: RankEntry[];
}

const played: PlayedGame[] = [];

async function rankedGame(
  players: readonly Account[],
  queueKey: QueueKey,
  seed: number,
): Promise<PlayedGame> {
  const searchers = await Promise.all(
    players.map(async (who, i) => {
      const client = await FakeClient.connect({
        url: url.replace('http', 'ws'),
        name: who.name,
        log: process.env.FAKE_LOG ? (line) => console.log(`[${who.name}] ${line}`) : undefined,
        ...QUICK,
        seed: seed * 10 + i,
        queue: { queueKey, token: who.token },
      });
      clients.add(client);
      return client;
    }),
  );
  const summaries = await Promise.all(searchers.map((c) => c.done));
  searchers.forEach((c) => clients.delete(c));
  for (const s of summaries) {
    expect(s.error).toBeNull();
    expect(s.outcome).toBe('over');
    expect(s.match?.registered).toBe(false); // the app's account client made the accounts
    // The result is stored (rating, XP, the game) by the time the client read its rating back.
    expect(s.match?.ratingAfter).toMatchObject({ rating: s.match!.rating!.after });
  }
  const game: PlayedGame = {
    gameType: summaries[0]!.match!.rating!.key as GameType,
    summaries: new Map(summaries.map((s) => [s.playerId, s])),
    ranking: summaries[0]!.ranking!,
  };
  played.push(game);
  return game;
}

/** The engine's XP for `userId`'s ranked games so far (§15): place 1 (shared too) 50, else 20; + correct. */
function rankedXp(userId: string): number {
  return played.reduce((sum, g) => {
    const me = g.ranking.find((r) => r.playerId === userId)!;
    return sum + xpForGame({ mode: 'ranked', won: me.place === 1, correct: me.correct });
  }, 0);
}

/** `userId`'s rating in `key` after the games so far (1200 before any). */
function ratingIn(userId: string, key: GameType): number {
  const last = played.filter((g) => g.gameType === key).at(-1);
  return last?.summaries.get(userId)?.match?.rating?.after ?? 1200;
}

const gamesIn = (key: GameType) => played.filter((g) => g.gameType === key).length;

// ---------------------------------------------------------------------------------------------------------
// Practice games, as the phone plays them (LocalGameHost on its clock) and reports them (session.ts onFinish)

const PRACTICE_BLANKS = [5, 18, 33, 47, 62, 70, 74, 39];
const PRACTICE_PUZZLE = nearlyDone('practice-puzzle', PRACTICE_BLANKS);

function practiceGame(
  mode: Extract<GameMode, 'solo' | 'bot'>,
  { endEarly = false, seed, startedAt }: { endEarly?: boolean; seed: number; startedAt: number },
): FinishedPractice {
  const clock = new ManualClock(startedAt);
  const scheduler = new ManualScheduler(clock);
  const players: PlayerInfo[] = mode === 'bot' ? [{ id: 'me' }, botPlayer(1)] : [{ id: 'me' }];
  const config: GameConfig = {
    // The id the app gives a practice (game/session.ts openPractice): letters, digits and '-'.
    id: `practice-${clock.now().toString(36)}-${seed.toString(36)}`,
    mode,
    gameType: 'fast',
    puzzle: { id: PRACTICE_PUZZLE.id, givens: PRACTICE_PUZZLE.givens, solution: PRACTICE_PUZZLE.solution },
    players,
    rules: defaultRules(mode, 'fast'),
    seed,
  };
  const host = new LocalGameHost({ config, playerId: 'me', clock, scheduler });
  if (endEarly) {
    scheduler.advance(2000);
    host.surrender(); // "End practice" (spec §6.6); against a bot, a surrender
  } else {
    for (const cell of PRACTICE_BLANKS) {
      if (host.state.status !== 'running') break;
      host.select(cell);
      scheduler.advance(1500);
      host.place(cell, Number(PRACTICE_PUZZLE.solution[cell]) as Digit);
      scheduler.advance(300);
    }
  }
  const state = host.state;
  expect(state.status).toBe('over');
  return {
    id: config.id,
    mode,
    gameType: config.gameType,
    playerId: 'me',
    result: state.result!,
    endedAt: state.endedAt ?? clock.now(),
  };
}

const practiceXpOf = (r: PracticeResult) =>
  xpForGame(
    r.mode === 'solo' ? { mode: 'solo' } : { mode: 'bot', won: r.outcome === 'win', correct: r.correct },
  );

// ---------------------------------------------------------------------------------------------------------
// The boards, as they should be

interface Rated {
  id: string;
  rating: number;
}

/** A board's rows in order (rating, best first; equal ratings by user id) with the ranks they share. */
function expectedBoard(rows: readonly Rated[]): { id: string; rating: number; rank: number }[] {
  return [...rows]
    .sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.rating > r.rating).length }));
}

const seededRows = (): Rated[] =>
  Array.from({ length: SEEDED }, (_, k) => ({ id: seededId(k), rating: seededRating(k) }));

/** Every page of a tab, through the app's client and the server's cursors. */
async function wholeBoard(api: ProgressApi, tab: 'general' | 'fast' | 'normal' | 'hard') {
  const pages: Leaderboard[] = [];
  let cursor: string | null = null;
  do {
    const page: Leaderboard = await api.leaderboard({ tab, cursor });
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null && pages.length < 10);
  return { pages, entries: pages.flatMap((p) => p.entries) };
}

const rowOf = (e: LeaderboardEntry) => ({ id: e.id, rating: e.rating, rank: e.rank });

/** Every key of a JSON value, at any depth. */
function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, into));
  else if (typeof value === 'object' && value !== null)
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysDeep(v, into);
    }
  return into;
}

// ---------------------------------------------------------------------------------------------------------

describe("the app's progress on the real server (stage 12 'סיום')", () => {
  let ana: Account;
  let ben: Account;
  let cy: Account;

  it('before any game: level 1, no XP, no league, not on any board; the friends tab is empty', async () => {
    [ana, ben, cy] = await Promise.all([
      account('AnaProg', 'contract-ana', 'IL'),
      account('BenProg', 'contract-ben', 'US'),
      account('CyProg', 'contract-cy', 'IL'),
    ]);
    expect(await ana.progress.myProgress()).toEqual<MyProgress>({
      xp: 0,
      level: 1,
      xpIntoLevel: 0,
      xpForNext: 200,
      league: null,
      leagueRating: null,
    });
    const general = await ana.progress.leaderboard({ tab: 'general' });
    expect(general.me).toBeNull();
    expect(general.entries.map((e) => e.id)).not.toContain(ana.me.id);
    expect(general.entries.map((e) => e.id)).not.toContain('seed-gone');
    const friends = await ana.progress.leaderboard({ tab: 'friends' });
    expect(friends).toMatchObject({
      tab: 'friends',
      entries: [],
      me: null,
      nextCursor: null,
      friends: { recentOpponents: [], inviteUrl: INVITE_URL },
    });
  });

  it('ten ranked games in fast: XP by the engine after each; the league shows after the tenth only', async () => {
    for (let g = 1; g <= 10; g++) {
      await rankedGame([ana, ben], 'fast-2p', g);
      if (g === 1 || g === 9 || g === 10) {
        for (const who of [ana, ben]) {
          const xp = rankedXp(who.me.id);
          const level = levelFor(xp);
          const rating = ratingIn(who.me.id, 'fast');
          expect(await who.progress.myProgress()).toEqual<MyProgress>({
            xp,
            level: level.level,
            xpIntoLevel: level.xpIntoLevel,
            xpForNext: level.xpForNext,
            // §11.3: none during the 10 provisional games of a key; then the best settled rating's [D9].
            league: g < 10 ? null : leagueFor(rating),
            leagueRating: g < 10 ? null : rating,
          });
        }
      }
    }
    expect(gamesIn('fast')).toBe(10);
  });

  it('one ranked game in normal: XP adds up; the league stays with the settled key', async () => {
    await rankedGame([ana, ben], 'normal-2p', 11);
    for (const who of [ana, ben]) {
      const progress = await who.progress.myProgress();
      expect(progress.xp).toBe(rankedXp(who.me.id));
      // 'normal' has one game: still provisional, so the league comes from 'fast' alone.
      expect(progress.leagueRating).toBe(ratingIn(who.me.id, 'fast'));
      expect(progress.league).toBe(leagueFor(ratingIn(who.me.id, 'fast')));
    }
  });

  it("practice XP through the app's queue and sync [D41]: counted once, added to the ranked XP", async () => {
    const answers: PracticeResultsResponse[] = [];
    const recording: ProgressApi = {
      ...ana.progress,
      sendPracticeResults: async (results) => {
        const answer = await ana.progress.sendPracticeResults(results);
        answers.push(answer);
        return answer;
      },
    };
    const progresses: MyProgress[] = [];
    const queue = createPracticeQueue(memoryKv());
    const sync = new PracticeSync({
      queue,
      owner: () => ana.uid,
      api: () => recording,
      onProgress: (_owner, progress) => progresses.push(progress),
      timers: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      random: () => 0.5,
    });
    const settled = () => until(async () => !sync.waiting && (await queue.size(ana.uid)) === 0, 'the sync');

    // Three finished practices: a whole solo board, a win against a bot, a solo practice ended early.
    const now = Date.now();
    const finished = [
      practiceGame('solo', { seed: 1, startedAt: now - 3_600_000 }),
      practiceGame('bot', { seed: 2, startedAt: now - 1_800_000 }),
      practiceGame('solo', { seed: 3, startedAt: now - 600_000, endEarly: true }),
    ];
    const results = finished.map((f) => practiceResultOf(f)!);
    expect(results.map((r) => [r.mode, r.outcome, r.correct])).toEqual([
      ['solo', 'completed', PRACTICE_BLANKS.length],
      ['bot', 'win', PRACTICE_BLANKS.length],
      ['solo', 'ended', 0],
    ]);
    for (const r of results) expect(await sync.enqueue(r)).toBe(true);
    await settled();
    const practiceXp = results.reduce((sum, r) => sum + practiceXpOf(r), 0);
    expect(practiceXp).toBe(10 + (50 + PRACTICE_BLANKS.length) + 10);
    expect(answers.reduce((n, a) => n + a.accepted, 0)).toBe(3);

    // The phone sends the bot game again (say its answer was lost): a duplicate, no XP.
    expect(await sync.enqueue(results[1]!)).toBe(true);
    await settled();
    expect(answers.at(-1)).toMatchObject({ accepted: 0, duplicates: 1 });
    // The same id twice in one batch: once.
    const lost = practiceResultOf(
      practiceGame('bot', { seed: 4, startedAt: now - 300_000, endEarly: true }),
    )!;
    expect(lost.outcome).toBe('loss');
    const twice = await ana.progress.sendPracticeResults([lost, lost]);
    expect(twice).toMatchObject({ accepted: 1, duplicates: 1, rejected: 0 });

    const total = rankedXp(ana.me.id) + practiceXp + practiceXpOf(lost);
    const level = levelFor(total);
    const expected: MyProgress = {
      xp: total,
      level: level.level,
      xpIntoLevel: level.xpIntoLevel,
      xpForNext: level.xpForNext,
      league: leagueFor(ratingIn(ana.me.id, 'fast')),
      leagueRating: ratingIn(ana.me.id, 'fast'),
    };
    expect(twice.progress).toEqual(expected);
    expect(await ana.progress.myProgress()).toEqual(expected);
    // What the sync handed the app (the cached progress) was the server's at the time.
    expect(progresses.at(-1)!.xp).toBe(total - practiceXpOf(lost));
    // Ben's XP is his ranked XP alone: practice is per account.
    expect((await ben.progress.myProgress()).xp).toBe(rankedXp(ben.me.id));
  });

  it('the leaderboards rank everyone by rating, over pages, with my row pinned (§14.2)', async () => {
    const mine = (who: Account, key: GameType) => ({ id: who.me.id, rating: ratingIn(who.me.id, key) });
    const general = (who: Account) => ({
      id: who.me.id,
      rating: Math.max(ratingIn(who.me.id, 'fast'), ratingIn(who.me.id, 'normal')),
    });
    const boards = {
      fast: expectedBoard([...seededRows(), mine(ana, 'fast'), mine(ben, 'fast')]),
      normal: expectedBoard([...seededRows(), mine(ana, 'normal'), mine(ben, 'normal')]),
      general: expectedBoard([...seededRows(), general(ana), general(ben)]),
      // Nobody of the two played 'hard': the seeded players alone.
      hard: expectedBoard(seededRows()),
    };

    const seenBy: Partial<Record<keyof typeof boards, LeaderboardEntry[]>> = {};
    for (const tab of ['fast', 'normal', 'general', 'hard'] as const) {
      const { pages, entries } = await wholeBoard(ana.progress, tab);
      seenBy[tab] = entries;
      expect(entries.map(rowOf)).toEqual(boards[tab]);
      // Pages of 50, the next one by the server's cursor (sent back by the app as it came).
      expect(pages.map((p) => p.entries.length)).toEqual([
        LEADERBOARD_PAGE_SIZE,
        boards[tab].length - LEADERBOARD_PAGE_SIZE,
      ]);
      expect(pages[0]).toMatchObject({ tab, players: null, friends: null });
      expect(pages[0]!.ratingKey).toBe(tab === 'general' ? null : tab);
      // My pinned row: on every page, my exact rank (not on page 1 here), or none without a rated game.
      const me = boards[tab].find((r) => r.id === ana.me.id);
      for (const page of pages) {
        if (me === undefined) expect(page.me).toBeNull();
        else expect(page.me && rowOf(page.me)).toEqual(me);
      }
    }

    // The pinned row speaks of me as the board does: name, country, level, league, games.
    const fast = await ana.progress.leaderboard({ tab: 'fast' });
    const xp = (await ana.progress.myProgress()).xp;
    expect(fast.me).toMatchObject({
      id: ana.me.id,
      displayName: 'AnaProg',
      avatarId: 'lava-lamp',
      country: 'IL',
      level: levelFor(xp).level,
      league: leagueFor(ratingIn(ana.me.id, 'fast')),
      games: 10,
      provisional: false,
    });
    // A row's games and provisional are its key's: one game in 'normal'.
    expect(seenBy.normal!.find((e) => e.id === ana.me.id)).toMatchObject({ games: 1, provisional: true });
    expect(seenBy.general!.find((e) => e.id === ben.me.id)).toMatchObject({ displayName: 'BenProg' });

    // Cy has no rated game: no pinned row, but the same board.
    const seen = await wholeBoard(cy.progress, 'general');
    expect(seen.entries.map(rowOf)).toEqual(boards.general);
    expect(seen.pages.every((p) => p.me === null)).toBe(true);
  });

  it('the friends tab [D27]: the recent opponent with their general row, and the invite link', async () => {
    const friends = await ana.progress.leaderboard({ tab: 'friends' });
    const benGeneral = Math.max(ratingIn(ben.me.id, 'fast'), ratingIn(ben.me.id, 'normal'));
    const general = await wholeBoard(cy.progress, 'general');
    expect(friends.friends).toEqual({
      recentOpponents: [
        expect.objectContaining({
          id: ben.me.id,
          displayName: 'BenProg',
          country: 'US',
          rating: benGeneral,
          rank: general.entries.find((e) => e.id === ben.me.id)!.rank,
        }),
      ],
      inviteUrl: INVITE_URL,
    });
    expect(friends.me && rowOf(friends.me)).toEqual(rowOf(general.entries.find((e) => e.id === ana.me.id)!));
    // Cy never played: the empty state, with the invite button.
    expect((await cy.progress.leaderboard({ tab: 'friends' })).friends).toEqual({
      recentOpponents: [],
      inviteUrl: INVITE_URL,
    });
  });

  it("Ana's card, as Ben sees it (§14.3): ratings with trend and peak, stats, the last 10, nothing private", async () => {
    const card: PlayerCard = await ben.progress.player(ana.me.id);
    const xp = (await ana.progress.myProgress()).xp;
    expect(card).toMatchObject({
      id: ana.me.id,
      displayName: 'AnaProg',
      avatarId: 'lava-lamp',
      country: 'IL',
      league: leagueFor(ratingIn(ana.me.id, 'fast')),
      level: levelFor(xp).level,
      xp,
      achievements: [],
    });

    // Every rating of option B: the trend is the rating after each game, oldest first; the peak its highest.
    const afters = (key: GameType) =>
      played.filter((g) => g.gameType === key).map((g) => g.summaries.get(ana.me.id)!.match!.rating!.after);
    expect(card.ratings).toEqual([
      {
        key: 'fast',
        rating: ratingIn(ana.me.id, 'fast'),
        peak: Math.max(1200, ...afters('fast')),
        games: 10,
        provisional: false,
        trend: afters('fast'),
      },
      {
        key: 'normal',
        rating: ratingIn(ana.me.id, 'normal'),
        peak: Math.max(1200, ...afters('normal')),
        games: 1,
        provisional: true,
        trend: afters('normal'),
      },
      { key: 'hard', rating: 1200, peak: 1200, games: 0, provisional: true, trend: [] },
    ]);

    // The stats, from the results the games announced (newest first): win = place 1 alone; a shared place
    // 1 is a tie; win streaks [D28].
    const mineNewestFirst = [...played].reverse().map((g) => {
      const me = g.ranking.find((r) => r.playerId === ana.me.id)!;
      const shared = g.ranking.some((r) => r.playerId !== me.playerId && r.place === me.place);
      return {
        g,
        me,
        outcome: me.place !== 1 ? 'loss' : shared ? 'tie' : 'win',
      };
    });
    const outcomes = mineNewestFirst.map((x) => x.outcome);
    const wins = outcomes.filter((o) => o === 'win').length;
    let streak = 0;
    while (outcomes[streak] === 'win') streak++;
    let bestStreak = 0;
    outcomes.reduce((run, o) => {
      const next = o === 'win' ? run + 1 : 0;
      bestStreak = Math.max(bestStreak, next);
      return next;
    }, 0);
    const mistakes = mineNewestFirst.map((x) => x.me.mistakes);
    expect(card.stats).toMatchObject({
      games: 11,
      wins,
      losses: outcomes.filter((o) => o === 'loss').length,
      winRate: wins / 11,
      streak,
      bestStreak,
    });
    expect(card.stats.avgMistakes).toBeCloseTo(mistakes.reduce((a, b) => a + b, 0) / 11, 6);

    // Ana's ranked games, in the order they were played (the ids the card's results point at).
    const stored = await t.db
      .select({ id: games.id, bestMove: gamePlayers.bestMovePoints })
      .from(gamePlayers)
      .innerJoin(games, eq(games.id, gamePlayers.gameId))
      .where(and(eq(gamePlayers.userId, ana.me.id), isNotNull(games.endedAt)))
      .orderBy(asc(games.endedAt));
    expect(stored).toHaveLength(11);
    const best = Math.max(...stored.map((s) => s.bestMove ?? 0));
    expect(card.stats.bestMove).toEqual({
      points: best,
      gameId: stored.find((s) => s.bestMove === best)!.id,
    });
    expect(best).toBeGreaterThan(0);

    // "במשחק מאז" (Profile): the account's creation, through the app's guard.
    const [account] = await t.db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, ana.me.id));
    expect(card.joinedAt).toBe(account!.createdAt.getTime());
    // "ההפרעה האהובה": these clients never interfere, so none yet. Two fireworks and a warp sent in her last
    // game (stored as the engine's events are) make fireworks her favourite.
    expect(card.favoriteInterference).toBeNull();
    const last = stored[stored.length - 1]!.id;
    await t.db.insert(gameEvents).values(
      (['fireworks', 'warp', 'fireworks'] as const).map((kind, k) => ({
        gameId: last,
        seq: 100_000 + k,
        tMs: Date.now() + k,
        type: 'interference',
        payload: {
          fromId: ana.me.id,
          targetId: ben.me.id,
          kind,
          cost: 2 ** (k + 1),
          endsAt: 0,
          score: 0,
          locks: [],
        },
      })),
    );
    expect((await ben.progress.player(ana.me.id)).favoriteInterference).toEqual({
      kind: 'fireworks',
      count: 2,
    });
    expect((await ana.progress.player(ben.me.id)).favoriteInterference).toBeNull();

    // The last 10 results, newest first.
    const storedNewestFirst = [...stored].reverse();
    expect(card.recent).toEqual(
      mineNewestFirst.slice(0, 10).map(({ g, me, outcome }, i) => ({
        gameId: storedNewestFirst[i]!.id,
        gameType: g.gameType,
        players: 2,
        place: me.place,
        outcome,
        score: me.score,
        ratingDelta: g.summaries.get(ana.me.id)!.match!.rating!.delta,
        endedAt: expect.any(Number),
      })),
    );
    const times = card.recent.map((r) => r.endedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));

    // Public data only: no email, no sign-in id, anywhere in the card or the boards.
    for (const path of [playerPath(ana.me.id), '/v1/leaderboard?tab=fast', '/v1/leaderboard?tab=friends']) {
      const res = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${ben.token}` } });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      const keys = keysDeep(JSON.parse(text));
      for (const secret of ['email', 'emailVerified', 'firebaseUid', 'uid', 'deletedAt', 'nextRenameAt'])
        expect(keys.has(secret)).toBe(false);
      for (const who of [ana, ben]) {
        expect(text).not.toContain(who.email);
        expect(text).not.toContain(who.uid);
      }
    }
  });

  it("errors come out of the app's client as its codes", async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: unknown) => (e instanceof ProgressApiError ? `${e.code}:${e.status}` : String(e)),
      );
    // No such player, and a deleted one.
    expect(await code(cy.progress.player('no-such-player'))).toBe('notFound:404');
    expect(await code(cy.progress.player('seed-gone'))).toBe('notFound:404');
    // A cursor this server did not make.
    expect(await code(cy.progress.leaderboard({ tab: 'fast', cursor: 'not-a-cursor' }))).toBe(
      'badRequest:400',
    );
    // Signed in, but no account yet (D24: registration first).
    const stranger = createProgressApi({
      baseUrl: url,
      getToken: () => Promise.resolve(devToken('contract-stranger')),
      fetch: (target, init) => fetch(target, init),
      timeoutMs: 10_000,
    });
    expect(await code(stranger.myProgress())).toBe('notRegistered:404');
  });
});
