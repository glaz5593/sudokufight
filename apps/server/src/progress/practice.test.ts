import {
  MAX_PRACTICE_RESULTS,
  type MyProgress,
  type PracticeResult,
  type PracticeResultsResponse,
  PROGRESS_PATHS,
  type ProgressError,
} from '@sudoku-fight/protocol';
import { asc } from 'drizzle-orm';

import { practiceResults, xp } from '../db/schema';
import { call, type CallOptions } from '../testing/accounts';
import { fakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { startHttp, type TestHttp } from '../testing/http';
import { addAccounts, T0 } from '../testing/ranked';
import { testTokens, type TestTokens } from '../testing/tokens';
import { PRACTICE_BODY_BYTES } from './router';

/**
 * Stage 12, D41: practice results sent by the phone (queued while offline) for their XP: each counted once,
 * bounded (plausible times, a daily cap), validated; and GET /v1/me/progress.
 */

let t: TestDb;
let tokens: TestTokens;
let http: TestHttp;
let capped: TestHttp;
let limited: TestHttp;
const clock = fakeClock(T0); // 2026-10-09 12:00 UTC
const H = 3_600_000;
const DAY = 24 * H;

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  const base = {
    config: testConfig(),
    db: t.db,
    now: clock.now,
    tokens: tokens.verifier(clock.now),
    adminSiteDir: null,
    // Room for every request of this file (the clock does not move, so buckets never refill).
    progressLimits: {
      perIp: { limit: 10_000, windowMs: 60_000 },
      reads: { limit: 10_000, windowMs: 60_000 },
      writes: { limit: 10_000, windowMs: 60_000 },
    },
  };
  [http, capped, limited] = await Promise.all([
    startHttp(base),
    startHttp({ ...base, progress: { practiceXpDailyCap: 100 } }),
    startHttp({
      ...base,
      progressLimits: {
        perIp: { limit: 100, windowMs: 60_000 },
        reads: { limit: 100, windowMs: 60_000 },
        writes: { limit: 2, windowMs: 60_000 },
      },
    }),
  ]);
}, 30_000);
afterAll(async () => {
  await Promise.all([http.close(), capped.close(), limited.close()]);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  clock.set(T0);
  await addAccounts(t.db, [{ id: 'ana' }, { id: 'ben' }]);
});

const tokenOf = (id: string) => tokens.sign({ uid: `uid-${id}` }, clock.now());

async function send<T = PracticeResultsResponse>(
  body: unknown,
  { who = 'ana', server = http, ...options }: { who?: string; server?: TestHttp } & CallOptions = {},
) {
  return call<T>(server.url, 'POST', PROGRESS_PATHS.practiceResults, {
    body,
    ...options,
    token: await tokenOf(who),
  });
}

const result = (id: string, over: Partial<PracticeResult> = {}): PracticeResult => ({
  id,
  mode: 'bot',
  gameType: 'normal',
  outcome: 'win',
  correct: 30,
  endedAt: T0 - H,
  ...over,
});

const stored = () =>
  t.db
    .select()
    .from(practiceResults)
    .orderBy(asc(practiceResults.userId), asc(practiceResults.endedAt), asc(practiceResults.id));

const xpOf = async (userId: string) =>
  (await t.db.select().from(xp).orderBy(asc(xp.userId))).find((r) => r.userId === userId)?.xp ?? 0;

describe('POST /v1/me/practice-results (D41)', () => {
  it('stores each result with its XP: solo 10; bot 50 for a win, 20 otherwise, plus a point per correct move', async () => {
    const batch = [
      result('s1', { mode: 'solo', outcome: 'completed', correct: 60, endedAt: T0 - 4 * H }),
      result('b1', { endedAt: T0 - 3 * H }),
      result('b2', { outcome: 'loss', correct: 12, endedAt: T0 - 2 * H }),
      result('b3', { outcome: 'tie', correct: 5, gameType: 'hard', endedAt: T0 - H }),
    ];
    const answer = await send({ results: batch });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.body).toEqual<PracticeResultsResponse>({
      accepted: 4,
      duplicates: 0,
      rejected: 0,
      progress: { xp: 147, level: 1, xpIntoLevel: 147, xpForNext: 200, league: null, leagueRating: null },
    });
    expect((await stored()).map((r) => [r.id, r.mode, r.gameType, r.outcome, r.correct, r.xp])).toEqual([
      ['s1', 'solo', 'normal', 'completed', 60, 10],
      ['b1', 'bot', 'normal', 'win', 30, 80],
      ['b2', 'bot', 'normal', 'loss', 12, 32],
      ['b3', 'bot', 'hard', 'tie', 5, 25],
    ]);
    const [first] = await stored();
    expect(first).toMatchObject({ userId: 'ana', endedAt: new Date(T0 - 4 * H), receivedAt: new Date(T0) });

    const progress = await call<MyProgress>(http.url, 'GET', PROGRESS_PATHS.myProgress, {
      token: await tokenOf('ana'),
    });
    expect(progress.body).toEqual(answer.body.progress);
  });

  it('counts a result once: a resend, or the same id twice, is a duplicate; ids are per player', async () => {
    const batch = [result('a1'), result('a2', { endedAt: T0 - 2 * H })];
    expect((await send({ results: batch })).body).toMatchObject({ accepted: 2, duplicates: 0 });
    // The phone sends the queue again (the answer was lost): nothing more.
    expect((await send({ results: batch })).body).toMatchObject({
      accepted: 0,
      duplicates: 2,
      progress: { xp: 160 },
    });
    expect((await send({ results: [result('a3'), result('a3')] })).body).toMatchObject({
      accepted: 1,
      duplicates: 1,
    });
    expect(await xpOf('ana')).toBe(240);
    // Another player's phone may use the same id.
    expect((await send({ results: [result('a1')] }, { who: 'ben' })).body).toMatchObject({
      accepted: 1,
      duplicates: 0,
    });
    expect(await xpOf('ben')).toBe(80);
    expect(await stored()).toHaveLength(4);
  });

  it('refuses implausible times: ended in the future (beyond 5 minutes of clock skew) or over 30 days ago', async () => {
    const answer = await send({
      results: [
        result('soon', { endedAt: T0 + 4 * 60_000 }),
        result('future', { endedAt: T0 + 6 * 60_000 }),
        result('month', { endedAt: T0 - 29 * DAY }),
        result('old', { endedAt: T0 - 31 * DAY }),
      ],
    });
    expect(answer.body).toMatchObject({ accepted: 2, duplicates: 0, rejected: 2 });
    expect((await stored()).map((r) => r.id)).toEqual(['month', 'soon']);
    // Refused ones are not stored, so they are refused again, not counted as duplicates.
    expect((await send({ results: [result('old', { endedAt: T0 - 31 * DAY })] })).body).toMatchObject({
      accepted: 0,
      duplicates: 0,
      rejected: 1,
    });
    expect(await xpOf('ana')).toBe(160);
  });

  it('caps practice XP per UTC day (PRACTICE_XP_DAILY_CAP); results past it are kept, with the XP that fit', async () => {
    const answer = await send(
      {
        results: [
          result('d3', { mode: 'solo', outcome: 'completed', endedAt: T0 - H }), // 10, after the cap: 0
          result('d1', { endedAt: T0 - 3 * H }), // 80
          result('d2', { endedAt: T0 - 2 * H }), // 80, 20 of it fits
          result('y1', { endedAt: T0 - 13 * H }), // 80, the day before (Oct 8, 23:00 UTC): its own cap
        ],
      },
      { server: capped },
    );
    expect(answer.body).toMatchObject({ accepted: 4, duplicates: 0, rejected: 0, progress: { xp: 180 } });
    expect((await stored()).map((r) => [r.id, r.xp])).toEqual([
      ['y1', 80],
      ['d1', 80],
      ['d2', 20],
      ['d3', 0],
    ]);
    // A later batch the same day earns nothing more; a resend stays a duplicate.
    expect((await send({ results: [result('d4'), result('d1')] }, { server: capped })).body).toMatchObject({
      accepted: 1,
      duplicates: 1,
      progress: { xp: 180 },
    });
    // The next day starts again.
    clock.set(T0 + DAY);
    expect(
      (await send({ results: [result('n1', { endedAt: T0 + DAY - H })] }, { server: capped })).body,
    ).toMatchObject({
      accepted: 1,
      progress: { xp: 260 },
    });
  });

  it('refuses a malformed batch whole (400), and stores nothing of it', async () => {
    const bad: [string, unknown][] = [
      ['too many', { results: Array.from({ length: MAX_PRACTICE_RESULTS + 1 }, (_, k) => result(`r${k}`)) }],
      ['correct over 81', { results: [result('x', { correct: 82 })] }],
      ['negative correct', { results: [result('x', { correct: -1 })] }],
      ['fractional correct', { results: [result('x', { correct: 1.5 })] }],
      ['ranked is not practice', { results: [{ ...result('x'), mode: 'ranked' }] }],
      ['unknown type', { results: [{ ...result('x'), gameType: 'easy' }] }],
      ['unknown outcome', { results: [{ ...result('x'), outcome: 'draw' }] }],
      ['a bad id', { results: [result('a b')] }],
      ['a long id', { results: [result('x'.repeat(65))] }],
      ['an extra field', { results: [{ ...result('x'), xp: 5000 }] }],
      ['a missing field', { results: [{ id: 'x', mode: 'solo' }] }],
      ['no results', {}],
      ['not an object', [result('x')]],
      ['time as text', { results: [{ ...result('x'), endedAt: String(T0) }] }],
    ];
    for (const [what, body] of bad) {
      const answer = await send<ProgressError>(body);
      expect([what, answer.status, answer.body.error]).toEqual([what, 400, 'badRequest']);
    }
    const notJson = await send<ProgressError>(undefined, { raw: '{"results": [' });
    expect([notJson.status, notJson.body.error]).toEqual([400, 'badRequest']);
    const huge = await send<ProgressError>(undefined, {
      raw: JSON.stringify({ results: [], pad: 'x'.repeat(PRACTICE_BODY_BYTES) }),
    });
    expect([huge.status, huge.body.error]).toEqual([413, 'tooLarge']);
    expect(await stored()).toEqual([]);
    // Up to MAX_PRACTICE_RESULTS is fine, and an empty batch just answers the progress.
    const full = await send({
      results: Array.from({ length: MAX_PRACTICE_RESULTS }, (_, k) =>
        result(`r${k}`, { mode: 'solo', outcome: 'ended', endedAt: T0 - k * 60_000 }),
      ),
    });
    expect(full.body).toMatchObject({ accepted: MAX_PRACTICE_RESULTS, progress: { xp: 500 } });
    expect((await send({ results: [] })).body).toMatchObject({ accepted: 0, progress: { xp: 500 } });
  });

  it('needs an account; batches are rate limited per account (429 with Retry-After)', async () => {
    const none = await call<ProgressError>(http.url, 'POST', PROGRESS_PATHS.practiceResults, {
      body: { results: [] },
    });
    expect([none.status, none.body.error]).toEqual([401, 'unauthorized']);
    const stranger = await call<ProgressError>(http.url, 'POST', PROGRESS_PATHS.practiceResults, {
      body: { results: [result('x')] },
      token: await tokens.sign({ uid: 'uid-nobody' }, clock.now()),
    });
    expect([stranger.status, stranger.body.error]).toEqual([404, 'notRegistered']);

    const statuses: number[] = [];
    for (let k = 0; k < 3; k++) statuses.push((await send({ results: [] }, { server: limited })).status);
    expect(statuses).toEqual([200, 200, 429]);
    const last = await send<ProgressError>({ results: [] }, { server: limited });
    expect(last.body.error).toBe('tooManyRequests');
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /v1/me/progress', () => {
  it('XP, level and league: no league while every key is provisional, then the best settled rating [D9]', async () => {
    const token = await tokenOf('ben');
    const get = async () =>
      (await call<MyProgress>(http.url, 'GET', PROGRESS_PATHS.myProgress, { token })).body;
    expect(await get()).toEqual<MyProgress>({
      xp: 0,
      level: 1,
      xpIntoLevel: 0,
      xpForNext: 200,
      league: null,
      leagueRating: null,
    });
    await t.db.insert(xp).values({ userId: 'ben', xp: 650, level: 3 });
    await addAccounts(t.db, [{ id: 'cid', rating: 1420, games: 10 }]);
    expect(await get()).toMatchObject({ xp: 650, level: 3, xpIntoLevel: 50, xpForNext: 600, league: null });
    const cid = await call<MyProgress>(http.url, 'GET', PROGRESS_PATHS.myProgress, {
      token: await tokenOf('cid'),
    });
    expect(cid.body).toMatchObject({ league: 'diamond', leagueRating: 1420 });
  });
});
