import { LEVEL_RULES, levelIdOf, maxLevel } from '@sudoku-fight/engine';
import {
  type LevelBest,
  type LevelsSyncResponse,
  MAX_LEVEL_PLAYS,
  MAX_LEVELS_PER_REQUEST,
  type MyLevels,
  type MyProgress,
  type PracticeResult,
  type PracticeResultsResponse,
  PROGRESS_PATHS,
  type ProgressError,
} from '@sudoku-fight/protocol';
import { asc } from 'drizzle-orm';

import { ConfigError, loadConfig } from '../config';
import { levelXpDays, userLevels, xp } from '../db/schema';
import { call, type CallOptions } from '../testing/accounts';
import { fakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { startHttp, type TestHttp } from '../testing/http';
import { addAccounts, T0 } from '../testing/ranked';
import { testTokens, type TestTokens } from '../testing/tokens';
import { utcDayOf } from './levels';
import { LEVELS_BODY_BYTES } from './router';
import { progressSettings } from './settings';

/**
 * Staged practice on the server (1.0.2; spec §5.3.7, §15) [D55, D57]: PUT and GET /v1/me/levels keep the best
 * of every level at the max ever sent, and pay level XP from what is stored: each star once, a gate once,
 * within practice's daily cap, the rest on a later day (levelXpCarryOver).
 */

let t: TestDb;
let tokens: TestTokens;
let http: TestHttp;
let capped: TestHttp;
let noCarry: TestHttp;
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
    // Room for every request of this file (the clock does not move much, so buckets never refill).
    progressLimits: {
      perIp: { limit: 10_000, windowMs: 60_000 },
      reads: { limit: 10_000, windowMs: 60_000 },
      writes: { limit: 10_000, windowMs: 60_000 },
    },
  };
  [http, capped, noCarry, limited] = await Promise.all([
    startHttp(base),
    startHttp({ ...base, progress: { practiceXpDailyCap: 100 } }),
    startHttp({ ...base, progress: { practiceXpDailyCap: 100, levelXpCarryOver: false } }),
    startHttp({
      ...base,
      progressLimits: {
        perIp: { limit: 100, windowMs: 60_000 },
        reads: { limit: 2, windowMs: 60_000 },
        writes: { limit: 2, windowMs: 60_000 },
      },
    }),
  ]);
}, 30_000);
afterAll(async () => {
  await Promise.all([http.close(), capped.close(), noCarry.close(), limited.close()]);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  clock.set(T0);
  await addAccounts(t.db, [{ id: 'ana' }, { id: 'ben' }, { id: 'gone', deleted: true }]);
});

const tokenOf = (id: string) => tokens.sign({ uid: `uid-${id}` }, clock.now());

type Who = { who?: string; server?: TestHttp } & CallOptions;

async function put<T = LevelsSyncResponse>(
  levels: unknown,
  { who = 'ana', server = http, ...options }: Who = {},
) {
  return call<T>(server.url, 'PUT', PROGRESS_PATHS.myLevels, {
    body: levels === undefined ? undefined : { levels },
    ...options,
    token: await tokenOf(who),
  });
}

async function get<T = MyLevels>({ who = 'ana', server = http, ...options }: Who = {}) {
  return call<T>(server.url, 'GET', PROGRESS_PATHS.myLevels, { ...options, token: await tokenOf(who) });
}

/** Level n's best. */
const lv = (n: number, stars: number, plays = 1) => ({ id: levelIdOf(n), stars, plays }) as LevelBest;

const stored = async () =>
  (await t.db.select().from(userLevels).orderBy(asc(userLevels.userId), asc(userLevels.levelId))).map((r) => [
    r.userId,
    r.levelId,
    r.bestStars,
    r.plays,
  ]);

const xpOf = async (userId: string) =>
  (await t.db.select().from(xp)).find((r) => r.userId === userId)?.xp ?? 0;

const paidDays = async (userId: string) =>
  (await t.db.select().from(levelXpDays).orderBy(asc(levelXpDays.day)))
    .filter((r) => r.userId === userId)
    .map((r) => [r.day, r.xp]);

const myProgress = async (who = 'ana', server = http) =>
  (await call<MyProgress>(server.url, 'GET', PROGRESS_PATHS.myProgress, { token: await tokenOf(who) })).body;

/** A practice result worth 80 XP (a bot game won, 30 correct moves). */
const practice = (id: string, endedAt = T0 - H): PracticeResult => ({
  id,
  mode: 'bot',
  gameType: 'normal',
  outcome: 'win',
  correct: 30,
  endedAt,
});

async function sendPractice(results: PracticeResult[], server = http, who = 'ana') {
  return call<PracticeResultsResponse>(server.url, 'POST', PROGRESS_PATHS.practiceResults, {
    body: { results },
    token: await tokenOf(who),
  });
}

describe('PUT /v1/me/levels: the best of each level, kept at the max (D57)', () => {
  it('stores each level at the max ever sent, stars and plays apart; a lower resend keeps the best', async () => {
    const first = await put([lv(1, 2, 1), lv(2, 1, 3)]);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.body).toEqual<LevelsSyncResponse>({
      levels: [lv(1, 2, 1), lv(2, 1, 3)],
      maxLevel: 300,
      owedXp: 0,
      xp: 30,
      progress: { xp: 30, level: 1, xpIntoLevel: 30, xpForNext: 200, league: null, leagueRating: null },
      unknown: [],
    });
    // ★★ then ★: still ★★. More plays on this phone: the more.
    const lower = await put([lv(1, 1, 5)]);
    expect(lower.body).toMatchObject({ levels: [lv(1, 2, 5), lv(2, 1, 3)], xp: 0 });
    expect(await stored()).toEqual([
      ['ana', 'L001', 2, 5],
      ['ana', 'L002', 1, 3],
    ]);
  });

  it('an id twice in one request counts as its max; a level with nothing in it (0 stars, 0 plays) is no row', async () => {
    const answer = await put([lv(3, 1, 1), lv(3, 3, 1), lv(3, 0, 4), lv(4, 0, 0)]);
    expect(answer.body.levels).toEqual([lv(3, 3, 4)]);
    expect(await stored()).toEqual([['ana', 'L003', 3, 4]]);
    // A play with no star is kept: it opens the next level, and a boss played opens a gate.
    expect((await put([lv(5, 0, 1)])).body.levels).toEqual([lv(3, 3, 4), lv(5, 0, 1)]);
  });

  it("is the player's own: another account sees none of it", async () => {
    await put([lv(1, 3)]);
    expect((await get({ who: 'ben' })).body).toEqual<MyLevels>({ levels: [], maxLevel: 300, owedXp: 0 });
  });
});

describe('GET /v1/me/levels', () => {
  it('the bests in level order, with maxLevel (300: the engine’s LEVEL_RULES), never cached', async () => {
    await put([lv(10, 1), lv(2, 2, 4)]);
    await put([lv(1, 3, 2)], { who: 'ana' });
    const answer = await get();
    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.body).toEqual<MyLevels>({
      levels: [lv(1, 3, 2), lv(2, 2, 4), lv(10, 1)],
      maxLevel: 300,
      owedXp: 0,
    });
    expect([maxLevel(LEVEL_RULES), MAX_LEVELS_PER_REQUEST]).toEqual([300, 300]);
  });
});

describe('level XP: counted by the server from the stored bests, each star once (D55)', () => {
  it('10 per new star; the same request again pays 0; ★ to ★★★ pays 20; the answer agrees with GET /v1/me/progress', async () => {
    expect((await put([lv(1, 1)])).body).toMatchObject({ xp: 10, progress: { xp: 10 } });
    expect((await put([lv(1, 1)])).body).toMatchObject({ xp: 0, progress: { xp: 10 } });
    const better = await put([lv(1, 3)]);
    expect(better.body).toMatchObject({ xp: 20, owedXp: 0, progress: { xp: 30 } });
    expect(await myProgress()).toEqual(better.body.progress);
    expect(await xpOf('ana')).toBe(30);
    expect(await paidDays('ana')).toEqual([[utcDayOf(T0), 30]]);
  });

  it('two phones with different levels: the union of both, and each star is paid once', async () => {
    // Phone A, then phone B with one level in common (better there) and one of its own.
    expect((await put([lv(1, 3), lv(2, 2)])).body.xp).toBe(50);
    const b = await put([lv(2, 3, 2), lv(3, 1)]);
    expect(b.body).toMatchObject({ xp: 20, levels: [lv(1, 3), lv(2, 3, 2), lv(3, 1)] });
    // Phone A sends what it had again: nothing new.
    const a = await put([lv(1, 3), lv(2, 2)]);
    expect(a.body).toMatchObject({ xp: 0, levels: [lv(1, 3), lv(2, 3, 2), lv(3, 1)] });
    expect(await xpOf('ana')).toBe(70);
    expect((await myProgress()).xp).toBe(70);
  });

  it('a gate pays 50 exactly once: its boss (L010) played and 20 stars in chapter 1', async () => {
    // 19 stars, the boss played: no gate.
    const nineteen = [1, 2, 3, 4, 5, 6].map((n) => lv(n, 3));
    expect((await put([...nineteen, lv(10, 1)])).body.xp).toBe(190);
    // The 20th star opens it: 10 + 50.
    expect((await put([lv(7, 1)])).body.xp).toBe(60);
    // Later PUTs, a resend of all or a better star, never pay it again.
    expect((await put([...nineteen, lv(7, 1), lv(10, 1)])).body.xp).toBe(0);
    expect((await put([lv(7, 2)])).body.xp).toBe(10);
    expect(await xpOf('ana')).toBe(260);
  });

  it('20 stars with the boss unplayed: no gate, until the boss is played (even with no star)', async () => {
    const twenty = [...[1, 2, 3, 4, 5, 6].map((n) => lv(n, 3)), lv(7, 2)];
    expect((await put(twenty, { who: 'ben' })).body.xp).toBe(200);
    expect((await put([lv(10, 0, 1)], { who: 'ben' })).body.xp).toBe(50);
    expect(await xpOf('ben')).toBe(250);
  });

  it('a gate counts as open once the next chapter’s first level was played, whatever the stars here', async () => {
    // L011 can only be played behind an open gate (the phone keeps a gate open for good): 2 stars and the gate.
    expect((await put([lv(10, 1), lv(11, 1)])).body.xp).toBe(70);
  });

  it('every level at ★★★ and all 29 gates are worth 10,450 (300 levels in one request; the cap applies)', async () => {
    const all = Array.from({ length: MAX_LEVELS_PER_REQUEST }, (_, k) => lv(k + 1, 3, MAX_LEVEL_PLAYS));
    expect(Buffer.byteLength(JSON.stringify({ levels: all }))).toBeLessThan(LEVELS_BODY_BYTES);
    const answer = await put(all);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ xp: 1500, owedXp: 10_450 - 1500 });
    expect(answer.body.levels).toHaveLength(300);
    expect((await get()).body.owedXp).toBe(8950);
  });
});

describe('the daily cap: shared with practice, the rest paid on a later day (levelXpCarryOver)', () => {
  it('practice worth 80, then 5 new stars: 20 now, 30 owed; the next day an empty PUT pays the 30', async () => {
    expect((await sendPractice([practice('p1')], capped)).body.progress.xp).toBe(80);
    const today = await put([lv(1, 3), lv(2, 2)], { server: capped });
    expect(today.body).toMatchObject({ xp: 20, owedXp: 30, progress: { xp: 100 } });
    expect((await get({ server: capped })).body.owedXp).toBe(30);

    // Practice the same day sees the level XP in its cap: nothing more fits.
    const more = await sendPractice([practice('p2', T0 - H / 2)], capped);
    expect(more.body).toMatchObject({ accepted: 1, progress: { xp: 100 } });
    // Another PUT the same day: still no room.
    expect((await put([], { server: capped })).body).toMatchObject({ xp: 0, owedXp: 30 });

    clock.set(T0 + DAY);
    const tomorrow = await put([], { server: capped });
    expect(tomorrow.body).toMatchObject({
      xp: 30,
      owedXp: 0,
      progress: { xp: 130 },
      levels: [lv(1, 3), lv(2, 2)],
    });
    expect((await get({ server: capped })).body.owedXp).toBe(0);
    expect(await paidDays('ana')).toEqual([
      [utcDayOf(T0), 20],
      [utcDayOf(T0) + 1, 30],
    ]);
    // Nothing is paid twice: a PUT later that day has nothing to give.
    expect((await put([lv(1, 3), lv(2, 2)], { server: capped })).body).toMatchObject({ xp: 0, owedXp: 0 });
  });

  it('without the carry-over, a PUT pays only what it earned, as far as the day has room; the rest is lost', async () => {
    await sendPractice([practice('p1')], noCarry);
    expect((await put([lv(1, 3), lv(2, 2)], { server: noCarry })).body).toMatchObject({ xp: 20, owedXp: 0 });
    expect((await get({ server: noCarry })).body.owedXp).toBe(0);
    clock.set(T0 + DAY);
    expect((await put([], { server: noCarry })).body).toMatchObject({ xp: 0, owedXp: 0 });
    // A new star the next day is paid.
    expect((await put([lv(3, 1)], { server: noCarry })).body).toMatchObject({
      xp: 10,
      progress: { xp: 110 },
    });
  });

  it('LEVEL_XP_CARRY_OVER: on unless set to false', () => {
    const settingsOf = (env: Record<string, string>) =>
      progressSettings(loadConfig({ NODE_ENV: 'test', ...env }, { warn: () => {} }));
    expect(settingsOf({}).levelXpCarryOver).toBe(true);
    expect(settingsOf({ LEVEL_XP_CARRY_OVER: '' }).levelXpCarryOver).toBe(true);
    expect(settingsOf({ LEVEL_XP_CARRY_OVER: ' FALSE ' }).levelXpCarryOver).toBe(false);
    expect(settingsOf({ LEVEL_XP_CARRY_OVER: '0' }).levelXpCarryOver).toBe(false);
    expect(settingsOf({ LEVEL_XP_CARRY_OVER: 'true' }).levelXpCarryOver).toBe(true);
    expect(() => settingsOf({ LEVEL_XP_CARRY_OVER: 'maybe' })).toThrow(ConfigError);
  });
});

describe('a bad request', () => {
  it('refuses a malformed body whole (400 badRequest), and stores nothing of it', async () => {
    const good = lv(1, 3);
    const bad: [string, unknown][] = [
      ['too many', Array.from({ length: MAX_LEVELS_PER_REQUEST + 1 }, (_, k) => lv((k % 300) + 1, 1))],
      ['L000', [good, { id: 'L000', stars: 1, plays: 1 }]],
      ['lower case', [good, { id: 'l001', stars: 1, plays: 1 }]],
      ['too few digits', [good, { id: 'L1', stars: 1, plays: 1 }]],
      ['another spelling', [good, { id: 'L0001', stars: 1, plays: 1 }]],
      ['too many digits', [good, { id: 'L12345', stars: 1, plays: 1 }]],
      ['4 stars', [good, { ...lv(2, 1), stars: 4 }]],
      ['-1 stars', [good, { ...lv(2, 1), stars: -1 }]],
      ['1.5 stars', [good, { ...lv(2, 1), stars: 1.5 }]],
      ['stars as text', [good, { ...lv(2, 1), stars: '2' }]],
      ['negative plays', [good, lv(2, 0, -1)]],
      ['fractional plays', [good, lv(2, 1, 1.5)]],
      ['too many plays', [good, lv(2, 1, MAX_LEVEL_PLAYS + 1)]],
      ['stars without a play', [good, lv(2, 1, 0)]],
      ['an extra field', [good, { ...lv(2, 1), metric: 4100 }]],
      ['a missing field', [good, { id: 'L002', stars: 1 }]],
      ['not an entry', [good, 'L002']],
    ];
    for (const [what, levels] of bad) {
      const answer = await put<ProgressError>(levels);
      expect([what, answer.status, answer.body.error]).toEqual([what, 400, 'badRequest']);
    }
    for (const [what, body] of [
      ['no levels', {}],
      ['levels not a list', { levels: { L001: 3 } }],
      ['an extra field', { levels: [good], xp: 5000 }],
      ['not an object', [good]],
    ] as const) {
      const answer = await call<ProgressError>(http.url, 'PUT', PROGRESS_PATHS.myLevels, {
        body,
        token: await tokenOf('ana'),
      });
      expect([what, answer.status, answer.body.error]).toEqual([what, 400, 'badRequest']);
    }
    const notJson = await put<ProgressError>(undefined, { raw: '{"levels": [' });
    expect([notJson.status, notJson.body.error]).toEqual([400, 'badRequest']);
    const huge = await put<ProgressError>(undefined, {
      raw: JSON.stringify({ levels: [], pad: 'x'.repeat(LEVELS_BODY_BYTES) }),
    });
    expect([huge.status, huge.body.error]).toEqual([413, 'tooLarge']);
    expect(await stored()).toEqual([]);
    expect(await xpOf('ana')).toBe(0);
  });

  it('a level this server does not know yet (a newer app’s L301): skipped and listed in unknown, the rest stored', async () => {
    const answer = await put([
      lv(1, 2),
      { id: 'L301', stars: 3, plays: 1 },
      { id: 'L1000', stars: 1, plays: 2 },
      { id: 'L301', stars: 1, plays: 4 },
    ]);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ levels: [lv(1, 2)], unknown: ['L301', 'L1000'], xp: 20 });
    expect(await stored()).toEqual([['ana', 'L001', 2, 1]]);
  });
});

describe('who may', () => {
  it('needs a token (401) and a live account (404 notRegistered)', async () => {
    for (const method of ['GET', 'PUT']) {
      const none = await call<ProgressError>(http.url, method, PROGRESS_PATHS.myLevels, {
        body: method === 'PUT' ? { levels: [] } : undefined,
      });
      expect([method, none.status, none.body.error]).toEqual([method, 401, 'unauthorized']);
    }
    for (const who of ['nobody', 'gone']) {
      const read = await get<ProgressError>({ who });
      expect([who, read.status, read.body.error]).toEqual([who, 404, 'notRegistered']);
      const write = await put<ProgressError>([lv(1, 3)], { who });
      expect([who, write.status, write.body.error]).toEqual([who, 404, 'notRegistered']);
    }
    expect(await stored()).toEqual([]);
  });

  it('is rate limited per account: GET as a read, PUT as a write (shared with practice results), 429 with Retry-After', async () => {
    await addAccounts(t.db, [{ id: 'cid' }, { id: 'dan' }]);
    const writes = [
      (await sendPractice([], limited, 'cid')).status,
      (await put([lv(1, 1)], { who: 'cid', server: limited })).status,
      (await put([lv(1, 1)], { who: 'cid', server: limited })).status,
    ];
    expect(writes).toEqual([200, 200, 429]);
    const last = await put<ProgressError>([], { who: 'cid', server: limited });
    expect(last.body.error).toBe('tooManyRequests');
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    const reads: number[] = [];
    for (let k = 0; k < 3; k++) reads.push((await get({ who: 'dan', server: limited })).status);
    expect(reads).toEqual([200, 200, 429]);
  });

  it('two PUTs at once with the same new stars pay them once', async () => {
    const levels = [lv(1, 3), lv(2, 3), lv(3, 1)];
    const answers = await Promise.all([put(levels), put(levels), put(levels)]);
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200]);
    expect(answers.map((a) => a.body.xp).sort((a, b) => b - a)).toEqual([70, 0, 0]);
    expect(await xpOf('ana')).toBe(70);
    expect(await paidDays('ana')).toEqual([[utcDayOf(T0), 70]]);
  });
});
