import {
  FAVORITE_INTERFERENCE_GAMES,
  type PlayerCard,
  playerPath,
  type ProgressError,
  type RatingSummary,
  type RecentResult,
} from '@sudoku-fight/protocol';
import { eq } from 'drizzle-orm';

import { achievements, gameEvents, userAchievements, users, xp } from '../db/schema';
import { call } from '../testing/accounts';
import { fakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { startHttp, type TestHttp } from '../testing/http';
import { addGamePuzzle, addStoredGame, type SeatResult, setRating } from '../testing/progress';
import { addAccounts, T0 } from '../testing/ranked';
import { testTokens, type TestTokens } from '../testing/tokens';
import { type CardResult, favoriteInterferenceOf, recentOf, statsOf } from './card';

/**
 * Stage 12: the player card (spec §14.3) from known games on PGlite: ratings with peak and trend, stats with
 * win streaks [D28] and the best move, the last 10 results, level and league, earned achievements.
 */

let t: TestDb;
let tokens: TestTokens;
let http: TestHttp;
let httpA: TestHttp;
const clock = fakeClock(T0 + 30 * 86_400_000);

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  const base = { db: t.db, now: clock.now, tokens: tokens.verifier(clock.now), adminSiteDir: null };
  [http, httpA] = await Promise.all([
    startHttp({ ...base, config: testConfig() }),
    startHttp({ ...base, config: testConfig({ ratingOption: 'A' }) }),
  ]);
}, 30_000);
afterAll(async () => {
  await Promise.all([http.close(), httpA.close()]);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await addGamePuzzle(t.db);
});

const tokenOf = (id: string) => tokens.sign({ uid: `uid-${id}` }, clock.now());

async function card(id: string, who = 'ana', server: TestHttp = http) {
  return call<PlayerCard>(server.url, 'GET', playerPath(id), { token: await tokenOf(who) });
}

const MIN = 60_000;

/**
 * ana's ranked games in 'normal' against ben, oldest first: W W L W W W T(shared first) L W, then one still
 * running, one cut short by a restart (no place), and a 3-player win in 'fast'. The rating moves +10 a win,
 * −10 a loss, 0 a tie, from 1200.
 */
async function anaGames() {
  await addAccounts(t.db, [
    { id: 'ana', name: 'Ana' },
    { id: 'ben', name: 'Ben' },
    { id: 'cid', name: 'Cid' },
  ]);
  const plan = ['W', 'W', 'L', 'W', 'W', 'W', 'T', 'L', 'W'] as const;
  let rating = 1200;
  for (const [k, r] of plan.entries()) {
    const after = rating + (r === 'W' ? 10 : r === 'L' ? -10 : 0);
    const anaSeat: SeatResult = {
      userId: 'ana',
      place: r === 'L' ? 2 : 1,
      score: 40 + k,
      mistakes: k % 3,
      bestMove: k === 4 ? 9.5 : k === 6 ? 9.5 : 5 + k / 10,
      ratingKey: 'normal',
      ratingBefore: rating,
      ratingAfter: after,
    };
    const benSeat: SeatResult = { userId: 'ben', place: r === 'W' ? 2 : 1, score: 30, ratingKey: 'normal' };
    await addStoredGame(t.db, {
      id: `n${k}`,
      endedAt: T0 + k * 10 * MIN,
      seats: k % 2 === 0 ? [anaSeat, benSeat] : [benSeat, anaSeat],
    });
    rating = after;
  }
  await addStoredGame(t.db, {
    id: 'f1',
    gameType: 'fast',
    endedAt: T0 + 100 * MIN,
    seats: [
      {
        userId: 'ana',
        place: 1,
        score: 61,
        mistakes: 0,
        bestMove: 7,
        ratingKey: 'fast',
        ratingBefore: 1200,
        ratingAfter: 1216,
      },
      { userId: 'ben', place: 2, score: 20 },
      { userId: 'cid', place: 3, score: 10 },
    ],
  });
  await addStoredGame(t.db, { id: 'running', endedAt: null, seats: [{ userId: 'ana', place: null }] });
  await addStoredGame(t.db, {
    id: 'restart',
    endedAt: T0 + 110 * MIN,
    endReason: 'serverRestart',
    seats: [
      { userId: 'ana', place: null, ratingKey: 'normal', ratingBefore: 1240 },
      { userId: 'ben', place: null },
    ],
  });
  await setRating(t.db, 'ana', 'normal', 1240, 9, 1240);
  await setRating(t.db, 'ana', 'fast', 1216, 11, 1216);
}

describe('GET /v1/players/:id (spec §14.3)', () => {
  it('stats over finished ranked games: wins, losses, win %, streaks, best move, mistakes', async () => {
    await anaGames();
    const answer = await card('ana', 'ben');
    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    // 10 finished: W W L W W W T L W W (oldest first; the fast game last). The tie is neither win nor loss.
    expect(answer.body.stats).toEqual({
      games: 10,
      wins: 7,
      losses: 2,
      winRate: 0.7,
      streak: 2,
      bestStreak: 3,
      // 9.5 twice (n4 and n6): the earlier one holds the record.
      bestMove: { points: 9.5, gameId: 'n4' },
      // Mistakes 0 1 2 0 1 2 0 1 2 and 0.
      avgMistakes: 0.9,
    });
  });

  it('the last 10 results, newest first, with outcome, rating change and time', async () => {
    await anaGames();
    const { body } = await card('ana');
    expect(body.recent).toHaveLength(10);
    expect(body.recent[0]).toEqual<RecentResult>({
      gameId: 'f1',
      gameType: 'fast',
      players: 3,
      place: 1,
      outcome: 'win',
      score: 61,
      ratingDelta: 16,
      endedAt: T0 + 100 * MIN,
    });
    expect(body.recent.map((r) => [r.gameId, r.outcome, r.ratingDelta])).toEqual([
      ['f1', 'win', 16],
      ['n8', 'win', 10],
      ['n7', 'loss', -10],
      ['n6', 'tie', 0],
      ['n5', 'win', 10],
      ['n4', 'win', 10],
      ['n3', 'win', 10],
      ['n2', 'loss', -10],
      ['n1', 'win', 10],
      ['n0', 'win', 10],
    ]);
  });

  it('every rating of the option with its peak and trend (B: 3 keys; a key never played shows the start)', async () => {
    await anaGames();
    const { body } = await card('ana');
    expect(body.ratings).toEqual<RatingSummary[]>([
      { key: 'fast', rating: 1216, peak: 1216, games: 11, provisional: false, trend: [1216] },
      {
        key: 'normal',
        rating: 1240,
        peak: 1240,
        games: 9,
        provisional: true,
        // After each of the nine games, oldest first (the one cut short moved nothing).
        trend: [1210, 1220, 1210, 1220, 1230, 1240, 1240, 1230, 1240],
      },
      { key: 'hard', rating: 1200, peak: 1200, games: 0, provisional: true, trend: [] },
    ]);
  });

  it('a trend keeps the last 20 games; option A shows all nine keys', async () => {
    await addAccounts(t.db, [
      { id: 'ana', option: 'A' },
      { id: 'ben', option: 'A' },
    ]);
    for (let k = 0; k < 25; k++)
      await addStoredGame(t.db, {
        id: `g${String(k).padStart(2, '0')}`,
        endedAt: T0 + k * MIN,
        seats: [
          { userId: 'ana', place: 1, ratingKey: 'normal-2p', ratingBefore: 1200 + k, ratingAfter: 1201 + k },
          { userId: 'ben', place: 2 },
        ],
      });
    await setRating(t.db, 'ana', 'normal-2p', 1225, 25);
    const { body } = await card('ana', 'ben', httpA);
    expect(body.ratings.map((r) => r.key)).toEqual([
      'fast-2p',
      'fast-3p',
      'fast-4p',
      'normal-2p',
      'normal-3p',
      'normal-4p',
      'hard-2p',
      'hard-3p',
      'hard-4p',
    ]);
    const normal = body.ratings.find((r) => r.key === 'normal-2p')!;
    expect(normal.trend).toEqual(Array.from({ length: 20 }, (_, k) => 1206 + k));
    expect(body.stats).toMatchObject({ games: 25, wins: 25, streak: 25, bestStreak: 25, bestMove: null });
    // Settled in normal-2p (25 games): a league [D9].
    expect(body.league).toBe('silver');
  });

  it('who: name, avatar, country, level from XP, league only after the provisional games; nothing private', async () => {
    await addAccounts(t.db, [{ id: 'ana', name: 'Ana', rating: 1300, games: 9 }, { id: 'ben' }]);
    await t.db
      .update(users)
      .set({ avatarId: 'lava-lamp', country: 'IL', email: 'ana@example.com' })
      .where(eq(users.id, 'ana'));
    await t.db.insert(xp).values({ userId: 'ana', xp: 1250, level: 4 });
    const { body } = await card('ana', 'ben');
    expect(body).toMatchObject({
      id: 'ana',
      displayName: 'Ana',
      avatarId: 'lava-lamp',
      country: 'IL',
      // 9 games in every key: still provisional (§11.3).
      league: null,
      // 1250 XP: 200 to level 2, 400 to level 3, 600 to level 4, 50 into it.
      level: 4,
      xp: 1250,
      stats: { games: 0, wins: 0, losses: 0, winRate: null, streak: 0, bestStreak: 0, bestMove: null },
      recent: [],
      achievements: [],
    });
    expect(body.stats.avgMistakes).toBeNull();
    const text = JSON.stringify(body);
    for (const secret of ['ana@example.com', 'uid-ana', 'firebase']) expect(text).not.toContain(secret);

    await setRating(t.db, 'ana', 'hard', 1300, 10);
    expect((await card('ana', 'ben')).body.league).toBe('gold');
  });

  it('"במשחק מאז": when the account was made (users.created_at)', async () => {
    await addAccounts(t.db, [{ id: 'ana' }, { id: 'ben' }]);
    const joined = Date.UTC(2026, 3, 12, 9, 30);
    await t.db
      .update(users)
      .set({ createdAt: new Date(joined) })
      .where(eq(users.id, 'ana'));
    expect((await card('ana', 'ben')).body.joinedAt).toBe(joined);
  });

  it('the favourite interference: the kind sent most in ranked games, with the count (Profile)', async () => {
    await anaGames();
    // Nobody interfered yet.
    expect((await card('ana', 'ben')).body.favoriteInterference).toBeNull();

    await interferences('n0', [
      ['ana', 'fireworks'],
      ['ana', 'fireworks'],
      ['ben', 'cats'],
      ['ben', 'cats'],
      ['ben', 'cats'],
    ]);
    await interferences('n5', [
      ['ana', 'cats'],
      ['ana', 'warp'],
    ]);
    // A practice game's (mode 'bot') and a running game's do not count.
    await addStoredGame(t.db, {
      id: 'practice',
      mode: 'bot',
      endedAt: T0 + 200 * MIN,
      seats: [
        { userId: 'ana', place: 1 },
        { userId: null, place: 2 },
      ],
    });
    await interferences('practice', [
      ['ana', 'warp'],
      ['ana', 'warp'],
      ['ana', 'warp'],
    ]);
    await interferences('running', [
      ['ana', 'warp'],
      ['ana', 'warp'],
    ]);
    expect((await card('ana', 'ben')).body.favoriteInterference).toEqual({ kind: 'fireworks', count: 2 });
    expect((await card('ben', 'ana')).body.favoriteInterference).toEqual({ kind: 'cats', count: 3 });

    // Equal counts (cats 2, fireworks 2): the one sent last. Cut short by a restart still counts.
    await interferences('restart', [['ana', 'cats']]);
    expect((await card('ana', 'ben')).body.favoriteInterference).toEqual({ kind: 'cats', count: 2 });
    await interferences('f1', [['ana', 'fireworks']]);
    expect((await card('ana', 'ben')).body.favoriteInterference).toEqual({ kind: 'fireworks', count: 3 });
  });

  it(`the favourite interference counts the last ${FAVORITE_INTERFERENCE_GAMES} ranked games only`, async () => {
    await addAccounts(t.db, [{ id: 'ana' }, { id: 'ben' }]);
    const seats = [
      { userId: 'ana', place: 1 },
      { userId: 'ben', place: 2 },
    ];
    await addStoredGame(t.db, { id: 'old', endedAt: T0, seats });
    await interferences('old', [['ana', 'warp']]);
    for (let k = 1; k < FAVORITE_INTERFERENCE_GAMES; k++)
      await addStoredGame(t.db, { id: `g${k}`, endedAt: T0 + k * MIN, seats });
    expect(await favoriteInterferenceOf(t.db, 'ana')).toEqual({ kind: 'warp', count: 1 });
    await addStoredGame(t.db, { id: 'newest', endedAt: T0 + 1000 * MIN, seats });
    expect(await favoriteInterferenceOf(t.db, 'ana')).toBeNull();
  }, 30_000);

  it('earned achievements, newest first (from user_achievements; the list itself awaits approval)', async () => {
    await addAccounts(t.db, [{ id: 'ana' }, { id: 'ben' }]);
    await t.db.insert(achievements).values([
      { id: 'a1', key: 'firstWin', nameHe: 'ניצחון ראשון', nameEn: 'First win', rule: {} },
      { id: 'a2', key: 'wins10', nameHe: '10 ניצחונות', nameEn: '10 wins', rule: {} },
    ]);
    await t.db.insert(userAchievements).values([
      { userId: 'ana', achievementId: 'a1', earnedAt: new Date(T0) },
      { userId: 'ana', achievementId: 'a2', earnedAt: new Date(T0 + MIN) },
      { userId: 'ben', achievementId: 'a1', earnedAt: new Date(T0) },
    ]);
    expect((await card('ana')).body.achievements).toEqual([
      { key: 'wins10', earnedAt: T0 + MIN },
      { key: 'firstWin', earnedAt: T0 },
    ]);
  });

  it('404 for no such player or a deleted one; 400 for a malformed id', async () => {
    await addAccounts(t.db, [{ id: 'ana' }, { id: 'gone', deleted: true }]);
    for (const id of ['nobody', 'gone']) {
      const answer = await call<ProgressError>(http.url, 'GET', playerPath(id), {
        token: await tokenOf('ana'),
      });
      expect([id, answer.status, answer.body.error]).toEqual([id, 404, 'notFound']);
    }
    const bad = await call<ProgressError>(http.url, 'GET', playerPath('a b'), {
      token: await tokenOf('ana'),
    });
    expect([bad.status, bad.body.error]).toEqual([400, 'badRequest']);
    // The caller needs an account too.
    const stranger = await call<ProgressError>(http.url, 'GET', playerPath('ana'), {
      token: await tokens.sign({ uid: 'uid-nobody' }, clock.now()),
    });
    expect([stranger.status, stranger.body.error]).toEqual([404, 'notRegistered']);
  });
});

/** Each stored interference a second after the one before (seq and time), across the whole file. */
let sentSoFar = 0;

/** `interference` events of a stored game, in the order given: [sender, kind]. */
async function interferences(gameId: string, sent: [string, string][]) {
  await t.db.insert(gameEvents).values(
    sent.map(([fromId, kind]) => {
      const n = ++sentSoFar;
      const targetId = fromId === 'ana' ? 'ben' : 'ana';
      return {
        gameId,
        seq: 1000 + n,
        tMs: T0 + n * 1000,
        type: 'interference',
        payload: { fromId, targetId, kind, cost: 2, endsAt: 0, score: 0, locks: [] },
      };
    }),
  );
}

describe('statsOf and recentOf (newest first)', () => {
  const result = (place: number, shared = false, extra: Partial<CardResult> = {}): CardResult => ({
    gameId: `g${place}${shared ? 's' : ''}`,
    gameType: 'normal',
    players: 2,
    place,
    shared,
    score: 0,
    mistakes: null,
    bestMove: null,
    ratingBefore: null,
    ratingAfter: null,
    endedAt: T0,
    ...extra,
  });

  it('a win streak [D28] ends at a tie or a loss; the best streak is the longest run', () => {
    // Newest first: W W T W W W L W
    const list = [1, 1, 0, 1, 1, 1, 2, 1].map((p) => (p === 0 ? result(1, true) : result(p)));
    expect(statsOf(list)).toMatchObject({ games: 8, wins: 6, losses: 1, streak: 2, bestStreak: 3 });
    expect(statsOf([result(2), result(1)])).toMatchObject({ streak: 0, bestStreak: 1, winRate: 0.5 });
    expect(statsOf([])).toEqual({
      games: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      streak: 0,
      bestStreak: 0,
      bestMove: null,
      avgMistakes: null,
    });
  });

  it('a shared first place is a tie; a shared later place is a loss; no rating change → null', () => {
    const recent = recentOf([
      result(1, true),
      result(2, true),
      result(3, false, { ratingBefore: 1200, ratingAfter: 1188 }),
    ]);
    expect(recent.map((r) => [r.outcome, r.ratingDelta])).toEqual([
      ['tie', null],
      ['loss', null],
      ['loss', -12],
    ]);
    expect(recentOf(Array.from({ length: 15 }, () => result(1)))).toHaveLength(10);
  });
});
