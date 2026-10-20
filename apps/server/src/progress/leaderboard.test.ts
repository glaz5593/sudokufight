import {
  type Leaderboard,
  LEADERBOARD_PAGE_SIZE,
  type LeaderboardEntry,
  PROGRESS_PATHS,
  type ProgressError,
} from '@sudoku-fight/protocol';
import { eq, inArray } from 'drizzle-orm';

import { personas, ratings, users, xp } from '../db/schema';
import { call } from '../testing/accounts';
import { fakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { startHttp, type TestHttp } from '../testing/http';
import { addOpponent, setRating } from '../testing/progress';
import { addAccounts, T0 } from '../testing/ranked';
import { testTokens, type TestTokens } from '../testing/tokens';
import { decodeLeaderboardCursor, encodeLeaderboardCursor } from './cursor';

/**
 * Stage 12: the leaderboards (spec §14.2, §11.1, §11.3 [D9, D27]) over HTTP, on PGlite with known ratings.
 */

let t: TestDb;
let tokens: TestTokens;
let http: TestHttp;
let httpA: TestHttp;
let httpInvite: TestHttp;
const clock = fakeClock(T0 + 3_600_000);
const INVITE = 'https://sudokufight.example/invite';

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  const base = { db: t.db, now: clock.now, tokens: tokens.verifier(clock.now), adminSiteDir: null };
  [http, httpA, httpInvite] = await Promise.all([
    startHttp({ ...base, config: testConfig() }),
    startHttp({ ...base, config: testConfig({ ratingOption: 'A' }) }),
    startHttp({
      ...base,
      config: testConfig({ progress: { practiceXpDailyCap: 1500, inviteUrl: INVITE } }),
    }),
  ]);
}, 30_000);
afterAll(async () => {
  await Promise.all([http.close(), httpA.close(), httpInvite.close()]);
  await t.close();
});
beforeEach(() => t.reset());

const tokenOf = (id: string) => tokens.sign({ uid: `uid-${id}` }, clock.now());

async function board(who: string, query = '', server: TestHttp = http) {
  const answer = await call<Leaderboard>(server.url, 'GET', `${PROGRESS_PATHS.leaderboard}${query}`, {
    token: await tokenOf(who),
  });
  if (answer.status !== 200) throw new Error(`${answer.status}: ${JSON.stringify(answer.body)}`);
  return answer.body;
}

const rows = (entries: readonly LeaderboardEntry[]) => entries.map((e) => [e.id, e.rating, e.rank]);

/**
 * ana: fast 1300 (12 games), normal 1350 (3 games) → general 1350, league gold (from fast: settled).
 * ben: normal 1400 (20) → general 1400, diamond; XP 650 → level 3.
 * cid: fast 1350 (15) → general 1350 (tied with ana), gold.
 * dan: hard 1250 (5) → provisional everywhere: no league.
 * eve: deleted, normal 1500 (30): on no board.
 * fay: no rated game: on no board.
 * gus: hard 1350 with 0 games (not a rating yet), fast 1100 (2) → general 1100.
 */
async function cast() {
  await addAccounts(
    t.db,
    ['ana', 'ben', 'cid', 'dan', 'eve', 'fay', 'gus'].map((id) => ({
      id,
      name: id[0]!.toUpperCase() + id.slice(1),
      deleted: id === 'eve',
    })),
  );
  await setRating(t.db, 'ana', 'fast', 1300, 12);
  await setRating(t.db, 'ana', 'normal', 1350, 3);
  await setRating(t.db, 'ben', 'normal', 1400, 20, 1420);
  await setRating(t.db, 'cid', 'fast', 1350, 15);
  await setRating(t.db, 'dan', 'hard', 1250, 5);
  await setRating(t.db, 'eve', 'normal', 1500, 30);
  await setRating(t.db, 'gus', 'hard', 1350, 0);
  await setRating(t.db, 'gus', 'fast', 1100, 2);
  await t.db
    .update(users)
    .set({ avatarId: 'maya', country: 'DE', email: 'ben@example.com' })
    .where(eq(users.id, 'ben'));
  await t.db.insert(xp).values({ userId: 'ben', xp: 650, level: 3 });
}

describe('the general tab (spec §14.2: each player at their highest rating [D9])', () => {
  it('ranks live players with a rated game by their best key; equal ratings share a rank (1, 2, 2, 4)', async () => {
    await cast();
    const answer = await board('ana');
    expect(answer).toMatchObject({ tab: 'general', ratingKey: null, players: null, nextCursor: null });
    expect(answer.friends).toBeNull();
    expect(rows(answer.entries)).toEqual([
      ['ben', 1400, 1],
      ['ana', 1350, 2],
      ['cid', 1350, 2],
      ['dan', 1250, 4],
      ['gus', 1100, 5],
    ]);
    expect(answer.entries[0]).toEqual<LeaderboardEntry>({
      id: 'ben',
      displayName: 'Ben',
      avatarId: 'maya',
      country: 'DE',
      league: 'diamond',
      level: 3,
      rank: 1,
      rating: 1400,
      provisional: false,
      games: 20,
    });
    // ana's general row is her normal 1350 (3 games, provisional); her league comes from fast (settled).
    expect(answer.entries[1]).toMatchObject({
      league: 'gold',
      provisional: true,
      games: 3,
      avatarId: 'av00',
    });
    // Provisional in every key: no league yet (§11.3).
    expect(answer.entries.find((e) => e.id === 'dan')!.league).toBeNull();
    // Public data only.
    const text = JSON.stringify(answer);
    for (const secret of ['ben@example.com', 'uid-ben', 'uid-ana']) expect(text).not.toContain(secret);
  });

  it('shows an old avatar id still in a row as its replacement (normalizeAvatarId)', async () => {
    await cast();
    await t.db.update(users).set({ avatarId: 'av50' }).where(eq(users.id, 'ana'));
    const answer = await board('ben');
    expect(answer.entries.find((e) => e.id === 'ana')!.avatarId).toBe('fox');
  });

  it('pins my row, with my exact rank; none before my first rated game', async () => {
    await cast();
    expect((await board('cid')).me).toMatchObject({ id: 'cid', rank: 2, rating: 1350 });
    expect((await board('gus')).me).toMatchObject({ id: 'gus', rank: 5, rating: 1100, games: 2 });
    expect((await board('fay')).me).toBeNull();
  });

  it('leaves out deleted accounts, also from the ranks of the others', async () => {
    await cast();
    await t.db
      .update(users)
      .set({ deletedAt: new Date(T0) })
      .where(eq(users.id, 'ben'));
    const answer = await board('cid');
    expect(rows(answer.entries)).toEqual([
      ['ana', 1350, 1],
      ['cid', 1350, 1],
      ['dan', 1250, 3],
      ['gus', 1100, 4],
    ]);
    expect(answer.me).toMatchObject({ rank: 1 });
  });
});

describe('a game-type tab', () => {
  it('option B: one key per type; ?players is not read', async () => {
    await cast();
    const normal = await board('ana', '?tab=normal&players=3');
    expect(normal).toMatchObject({ tab: 'normal', ratingKey: 'normal', players: null, friends: null });
    expect(rows(normal.entries)).toEqual([
      ['ben', 1400, 1],
      ['ana', 1350, 2],
    ]);
    expect(normal.me).toMatchObject({ id: 'ana', rank: 2, rating: 1350, games: 3, provisional: true });

    // A key with 0 games is not a rating yet: gus is not on the hard board.
    const hard = await board('gus', '?tab=hard');
    expect(rows(hard.entries)).toEqual([['dan', 1250, 1]]);
    expect(hard.me).toBeNull();
  });

  it('option A (§11.1): a 2 / 3 / 4 picker, 2 by default; general is the best of all nine keys', async () => {
    await addAccounts(t.db, [
      { id: 'ana', option: 'A' },
      { id: 'ben', option: 'A' },
      { id: 'cid', option: 'A' },
    ]);
    await setRating(t.db, 'ana', 'fast-2p', 1260, 4);
    await setRating(t.db, 'ana', 'fast-3p', 1330, 11);
    await setRating(t.db, 'ben', 'fast-3p', 1290, 2);
    await setRating(t.db, 'ben', 'hard-4p', 1410, 12);
    await setRating(t.db, 'cid', 'fast-2p', 1240, 9);

    const two = await board('ana', '?tab=fast', httpA);
    expect(two).toMatchObject({ ratingKey: 'fast-2p', players: 2 });
    expect(rows(two.entries)).toEqual([
      ['ana', 1260, 1],
      ['cid', 1240, 2],
    ]);
    const three = await board('ana', '?tab=fast&players=3', httpA);
    expect(three).toMatchObject({ ratingKey: 'fast-3p', players: 3 });
    expect(rows(three.entries)).toEqual([
      ['ana', 1330, 1],
      ['ben', 1290, 2],
    ]);
    expect(three.me).toMatchObject({ id: 'ana', rank: 1 });
    const four = await board('cid', '?tab=hard&players=4', httpA);
    expect(rows(four.entries)).toEqual([['ben', 1410, 1]]);
    expect(four.me).toBeNull();

    const general = await board('ana', '', httpA);
    expect(general).toMatchObject({ ratingKey: null, players: null });
    expect(rows(general.entries)).toEqual([
      ['ben', 1410, 1],
      ['ana', 1330, 2],
      ['cid', 1240, 3],
    ]);
    // Leagues from the settled keys of the nine: ben hard-4p 1410 (diamond), ana fast-3p 1330 (gold).
    expect(general.entries.map((e) => e.league)).toEqual(['diamond', 'gold', null]);
  });
});

/** `n` live accounts p000…, rated in 'fast' in groups of three equal ratings: 1500, 1500, 1500, 1495, … */
async function crowd(n: number) {
  const ids = Array.from({ length: n }, (_, k) => `p${String(k).padStart(3, '0')}`);
  await t.db
    .insert(users)
    .values(ids.map((id) => ({ id, firebaseUid: `uid-${id}`, displayName: id, createdAt: new Date(T0) })));
  await t.db.insert(ratings).values(
    ids.map((id, k) => ({
      userId: id,
      ratingKey: 'fast',
      rating: 1500 - Math.floor(k / 3) * 5,
      games: 12,
      provisional: false,
      peak: 1500,
      updatedAt: new Date(T0),
    })),
  );
  return ids;
}

const pageQuery = (cursor: string | null) =>
  cursor === null ? '?tab=fast' : `?tab=fast&cursor=${encodeURIComponent(cursor)}`;

describe('pages (keyset on rating, then user id)', () => {
  it('walks every player once, in order, with tied ranks across a page boundary', async () => {
    const ids = await crowd(120);
    const seen: LeaderboardEntry[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const page: Leaderboard = await board('p100', pageQuery(cursor));
      sizes.push(page.entries.length);
      seen.push(...page.entries);
      // My row stays pinned on every page.
      expect(page.me).toMatchObject({ id: 'p100', rank: 100 });
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(LEADERBOARD_PAGE_SIZE).toBe(50);
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen.map((e) => e.id)).toEqual(ids);
    // Ranks: 1 + three for each rating above; rows 48–50 share 49, across the first page's end.
    expect(seen.map((e) => e.rank)).toEqual(ids.map((_, k) => 1 + 3 * Math.floor(k / 3)));
    expect(seen.slice(48, 51).map((e) => e.rank)).toEqual([49, 49, 49]);
  });

  it('a page starts right after the cursor, whatever moved meanwhile; ranks are as of now', async () => {
    await crowd(120);
    const first = await board('p000', pageQuery(null));
    expect(first.entries.at(-1)!.id).toBe('p049');
    const onFirst = new Set(first.entries.map((e) => e.id));

    // Meanwhile: a newcomer above everyone; p010 climbs to the top; p060 (not seen yet) falls to the bottom.
    await addAccounts(t.db, [{ id: 'new', option: 'B' }]);
    await setRating(t.db, 'new', 'fast', 1600, 1);
    await setRating(t.db, 'p010', 'fast', 1700, 13);
    await setRating(t.db, 'p060', 'fast', 900, 13);

    const second = await board('p000', pageQuery(first.nextCursor));
    // Right after p049: p050 (p049's tie partner), whose rank now counts the newcomer above.
    expect(second.entries[0]).toMatchObject({ id: 'p050', rank: 50 });
    expect(second.entries.some((e) => onFirst.has(e.id) || e.id === 'new')).toBe(false);
    expect(second.entries.some((e) => e.id === 'p060')).toBe(false);
    const third = await board('p000', pageQuery(second.nextCursor));
    expect(third.entries.at(-1)).toMatchObject({ id: 'p060', rating: 900, rank: 121 });
    expect(third.nextCursor).toBeNull();
  });

  it('refuses a cursor it did not make', async () => {
    await cast();
    for (const bad of ['yesterday', '_ana', '1300_', '13x0_ana', '1300_a b']) {
      const answer = await call<ProgressError>(
        http.url,
        'GET',
        `${PROGRESS_PATHS.leaderboard}?cursor=${encodeURIComponent(bad)}`,
        { token: await tokenOf('ana') },
      );
      expect([bad, answer.status, answer.body.error]).toEqual([bad, 400, 'badRequest']);
    }
    expect(decodeLeaderboardCursor(encodeLeaderboardCursor({ rating: 1287.5, userId: 'a-b_c' }))).toEqual({
      rating: 1287.5,
      userId: 'a-b_c',
    });
  });
});

describe('the friends tab (D27, V1: recent opponents and the invite button)', () => {
  it('lists my recent opponents, newest meeting first, live ones only, each with their general row', async () => {
    await cast();
    await addOpponent(t.db, 'ana', 'ben', T0 + 1000, 'normal');
    await addOpponent(t.db, 'ana', 'cid', T0 + 3000, 'fast');
    await addOpponent(t.db, 'ana', 'ben', T0 + 5000, 'hard'); // ben again, in another type: newest
    await addOpponent(t.db, 'ana', 'eve', T0 + 6000); // deleted since
    await addOpponent(t.db, 'ana', 'fay', T0 + 2000); // never rated: shown at her start rating
    await addOpponent(t.db, 'cid', 'dan', T0 + 9000); // someone else's

    const answer = await board('ana', '?tab=friends');
    expect(answer).toMatchObject({
      tab: 'friends',
      ratingKey: null,
      players: null,
      entries: [],
      nextCursor: null,
    });
    expect(answer.me).toMatchObject({ id: 'ana', rank: 2, rating: 1350 });
    expect(answer.friends!.inviteUrl).toBeNull();
    expect(
      answer.friends!.recentOpponents.map((e) => [e.id, e.rating, e.rank, e.games, e.provisional]),
    ).toEqual([
      ['ben', 1400, 1, 20, false],
      ['cid', 1350, 2, 15, false],
      ['fay', 1200, 5, 0, true],
    ]);
    expect(answer.friends!.recentOpponents[0]).toMatchObject({ displayName: 'Ben', league: 'diamond' });
  });

  it('the empty state: no opponents yet, and the invite link from INVITE_URL', async () => {
    await cast();
    expect((await board('gus', '?tab=friends')).friends).toEqual({ recentOpponents: [], inviteUrl: null });
    expect((await board('gus', '?tab=friends', httpInvite)).friends).toEqual({
      recentOpponents: [],
      inviteUrl: INVITE,
    });
    // Before any rated game I have no row to pin.
    expect((await board('fay', '?tab=friends')).me).toBeNull();
  });
});

describe('a stealth bot’s personas (stealth-bot.md §6) [D99]', () => {
  /**
   * The cast, and two personas: pia (normal 1450, fast 1320: above everyone on the general board) and rex
   * (hard 1250, tied with dan). Both have played rated games, as personas do.
   */
  async function castWithPersonas() {
    await cast();
    await addAccounts(t.db, [
      { id: 'pia', name: 'Pia' },
      { id: 'rex', name: 'Rex' },
    ]);
    await t.db
      .update(users)
      .set({ kind: 'persona' })
      .where(inArray(users.id, ['pia', 'rex']));
    await t.db.insert(personas).values([
      { userId: 'pia', temperament: 'quiet', createdAt: new Date(T0) },
      { userId: 'rex', temperament: 'lively', createdAt: new Date(T0) },
    ]);
    await setRating(t.db, 'pia', 'normal', 1450, 14);
    await setRating(t.db, 'pia', 'fast', 1320, 6);
    await setRating(t.db, 'rex', 'hard', 1250, 9);
  }

  it('are on no board, and count in no rank: the boards are as without them', async () => {
    await castWithPersonas();
    const general = await board('ana');
    expect(rows(general.entries)).toEqual([
      ['ben', 1400, 1],
      ['ana', 1350, 2],
      ['cid', 1350, 2],
      ['dan', 1250, 4],
      ['gus', 1100, 5],
    ]);
    expect(general.me).toMatchObject({ id: 'ana', rank: 2 });
    expect(rows((await board('cid', '?tab=fast')).entries)).toEqual([
      ['cid', 1350, 1],
      ['ana', 1300, 2],
      ['gus', 1100, 3],
    ]);
    expect(rows((await board('dan', '?tab=hard')).entries)).toEqual([['dan', 1250, 1]]);
    expect((await board('dan', '?tab=hard')).me).toMatchObject({ id: 'dan', rank: 1 });
  });

  it('pages walk the people only, ranked among the people', async () => {
    const ids = await crowd(120);
    // One in four is a persona: 30 of them, spread through every rating.
    const personaIds = ids.filter((_, k) => k % 4 === 1);
    await t.db.update(users).set({ kind: 'persona' }).where(inArray(users.id, personaIds));
    await t.db
      .insert(personas)
      .values(
        personaIds.map((userId) => ({ userId, temperament: 'normal' as const, createdAt: new Date(T0) })),
      );
    const people = ids.filter((id) => !personaIds.includes(id));
    const ratingOf = (id: string) => 1500 - Math.floor(ids.indexOf(id) / 3) * 5;

    const seen: LeaderboardEntry[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const page: Leaderboard = await board('p100', pageQuery(cursor));
      sizes.push(page.entries.length);
      seen.push(...page.entries);
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(sizes).toEqual([50, 40]);
    expect(seen.map((e) => e.id)).toEqual(people);
    expect(seen.map((e) => e.rank)).toEqual(
      people.map((id) => 1 + people.filter((other) => ratingOf(other) > ratingOf(id)).length),
    );
  });

  it('on the friends tab, a persona I met is listed like any opponent, ranked where its rating stands among the people', async () => {
    await castWithPersonas();
    await addOpponent(t.db, 'ana', 'pia', T0 + 4000, 'fast');
    await addOpponent(t.db, 'ana', 'ben', T0 + 1000);
    await addOpponent(t.db, 'ana', 'rex', T0 + 2000, 'hard');
    const answer = await board('ana', '?tab=friends');
    expect(answer.friends!.recentOpponents.map((e) => [e.id, e.rating, e.rank, e.games])).toEqual([
      ['pia', 1450, 1, 14], // above ben: 1 + the people rated higher (none)
      ['rex', 1250, 4, 9], // tied with dan: dan's rank
      ['ben', 1400, 1, 20], // ben's rank is not pushed down by pia
    ]);
    expect(answer.friends!.recentOpponents[0]).toMatchObject({ displayName: 'Pia' });
    expect(answer.me).toMatchObject({ id: 'ana', rank: 2 });
  });
});

describe('requests', () => {
  it('refuses a bad tab or player count; needs a sign-in with an account; never cached', async () => {
    await cast();
    const token = await tokenOf('ana');
    for (const query of ['?tab=weekly', '?tab=fast&players=5', '?tab=fast&players=2&players=3', '?tab=']) {
      const answer = await call<ProgressError>(http.url, 'GET', PROGRESS_PATHS.leaderboard + query, {
        token,
      });
      expect([query, answer.status, answer.body.error]).toEqual([query, 400, 'badRequest']);
    }
    const ok = await call<Leaderboard>(http.url, 'GET', PROGRESS_PATHS.leaderboard, { token });
    expect(ok.headers.get('cache-control')).toBe('no-store');

    const none = await call<ProgressError>(http.url, 'GET', PROGRESS_PATHS.leaderboard);
    expect([none.status, none.body.error]).toEqual([401, 'unauthorized']);
    const stranger = await call<ProgressError>(http.url, 'GET', PROGRESS_PATHS.leaderboard, {
      token: await tokens.sign({ uid: 'uid-nobody' }, clock.now()),
    });
    expect([stranger.status, stranger.body.error]).toEqual([404, 'notRegistered']);
    const deleted = await call<ProgressError>(http.url, 'GET', PROGRESS_PATHS.leaderboard, {
      token: await tokenOf('eve'),
    });
    expect([deleted.status, deleted.body.error]).toEqual([404, 'notRegistered']);
  });
});
