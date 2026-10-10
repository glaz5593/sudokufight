import { eloChanges } from '@sudoku-fight/engine';
import { and, eq } from 'drizzle-orm';

import { ratings } from '../db/schema';
import { createTestDb, type TestDb } from '../testing';
import { addAccounts, T0 } from '../testing/ranked';
import { applyRatingChanges, NotRatedError, ratingKeyFor, ratingsAtStart } from '.';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
beforeEach(() => t.reset());
afterAll(() => t.close());

const rowOf = async (userId: string, key: string) =>
  (
    await t.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.ratingKey, key)))
  )[0];

describe('ratingKeyFor (spec §11.1, D7)', () => {
  it("option B: one key per game type, whatever the player count ('fast')", () => {
    expect(ratingKeyFor('fast', 2, 'B')).toBe('fast');
    expect(ratingKeyFor('normal', 3, 'B')).toBe('normal');
    expect(ratingKeyFor('hard', 4, 'B')).toBe('hard');
  });

  it("option A: one key per game type and player count ('normal-2p', not 'normal')", () => {
    expect(ratingKeyFor('normal', 2, 'A')).toBe('normal-2p');
    expect(ratingKeyFor('fast', 3, 'A')).toBe('fast-3p');
    expect(ratingKeyFor('hard', 4, 'A')).toBe('hard-4p');
  });

  it('refuses a player count no ranked game has', () => {
    expect(() => ratingKeyFor('fast', 1, 'B')).toThrow(RangeError);
    expect(() => ratingKeyFor('fast', 5, 'A')).toThrow(RangeError);
  });
});

describe('ratingsAtStart', () => {
  it("reads each player's rating and games in the key", async () => {
    await addAccounts(t.db, [
      { id: 'ana', rating: 1287, games: 12 },
      { id: 'ben', rating: 1305, games: 3 },
    ]);
    const map = await ratingsAtStart(t.db, ['ana', 'ben'], 'fast', 1200);
    expect([...map]).toEqual([
      ['ana', { rating: 1287, games: 12 }],
      ['ben', { rating: 1305, games: 3 }],
    ]);
  });

  it('a key without a row yet (RATING_OPTION changed after registration) starts at 1200 with no games [D23]', async () => {
    await addAccounts(t.db, [{ id: 'ana', rating: 1400, games: 30, option: 'B' }]);
    expect(await ratingsAtStart(t.db, ['ana'], 'fast-2p', 1200)).toEqual(
      new Map([['ana', { rating: 1200, games: 0 }]]),
    );
  });

  it('refuses a player without a live account (unknown or deleted)', async () => {
    await addAccounts(t.db, [{ id: 'ana' }, { id: 'gone', deleted: true }]);
    const err = await ratingsAtStart(t.db, ['ana', 'gone', 'nobody'], 'fast', 1200).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotRatedError);
    expect((err as NotRatedError).userIds).toEqual(['gone', 'nobody']);
  });
});

describe('applyRatingChanges', () => {
  const at = new Date(T0 + 60_000);

  it('moves the rating by the engine delta, counts the game, keeps the peak and updated_at', async () => {
    await addAccounts(t.db, [
      { id: 'ana', rating: 1287, games: 12 },
      { id: 'ben', rating: 1305, games: 12 },
    ]);
    const pair = (anaPlace: number) =>
      eloChanges([
        { id: 'ana', rating: 1287, games: 12, place: anaPlace },
        { id: 'ben', rating: 1305, games: 12, place: 3 - anaPlace },
      ]);
    // The spec's example (§11.2): 1287 against 1305, E = 0.474; a win is +17, a loss −15 (K = 32).
    expect(pair(2).map((c) => c.delta)).toEqual([-15, 15]);
    const [win, loss] = pair(1);
    expect([win!.delta, loss!.delta]).toEqual([17, -17]);
    await applyRatingChanges(
      t.db,
      'fast',
      [
        { userId: 'ana', change: win! },
        { userId: 'ben', change: loss! },
      ],
      { provisionalGames: 10, at },
    );
    expect(await rowOf('ana', 'fast')).toMatchObject({
      rating: 1304,
      games: 13,
      provisional: false,
      peak: 1304,
      updatedAt: at,
    });
    expect(await rowOf('ben', 'fast')).toMatchObject({ rating: 1288, games: 13, peak: 1305 });
    // Other keys are untouched.
    expect(await rowOf('ana', 'normal')).toMatchObject({ rating: 1287, games: 12 });
  });

  it('provisional while games < 10 [D23]: the 10th game ends it', async () => {
    await addAccounts(t.db, [{ id: 'ana', rating: 1200, games: 8 }]);
    const change = { playerId: 'ana', before: 1200, after: 1232, delta: 32, provisional: true };
    await applyRatingChanges(t.db, 'fast', [{ userId: 'ana', change }], { provisionalGames: 10, at });
    expect(await rowOf('ana', 'fast')).toMatchObject({ games: 9, provisional: true });
    await applyRatingChanges(t.db, 'fast', [{ userId: 'ana', change }], { provisionalGames: 10, at });
    expect(await rowOf('ana', 'fast')).toMatchObject({ games: 10, provisional: false, rating: 1264 });
  });

  it('makes a missing row (a key the account has no row in yet)', async () => {
    await addAccounts(t.db, [{ id: 'ana', option: 'B' }]);
    const change = { playerId: 'ana', before: 1200, after: 1168, delta: -32, provisional: true };
    await applyRatingChanges(t.db, 'fast-2p', [{ userId: 'ana', change }], { provisionalGames: 10, at });
    expect(await rowOf('ana', 'fast-2p')).toMatchObject({
      rating: 1168,
      games: 1,
      provisional: true,
      peak: 1200,
    });
  });
});
