import { createRng, GAME_TYPES } from '@sudoku-fight/engine';
import { asc, eq } from 'drizzle-orm';

import { puzzleHistory, puzzles } from '../db/schema';
import { createTestDb, type TestDb } from '../testing';
import { addAccounts, addPuzzles, standInPuzzles, T0 } from '../testing/ranked';
import {
  type BankPuzzle,
  dbPuzzleSource,
  EmptyPoolError,
  rankedPoolSizes,
  readPuzzleBank,
  seedRankedPuzzles,
} from '.';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
beforeEach(() => t.reset());
afterAll(() => t.close());

const bankPuzzle = (id: string, gameType: BankPuzzle['gameType'], pool: BankPuzzle['pool']): BankPuzzle => ({
  id,
  givens: '0'.repeat(80) + '5',
  solution: '5'.repeat(81),
  gameType,
  techniques: ['nakedSingle'],
  givensCount: 17,
  source: 'test',
  pool,
});

describe('the puzzle bank file (spec §20)', () => {
  it('has a ranked pool of 2,000 puzzles per game type, next to the offline pool', () => {
    const bank = readPuzzleBank();
    for (const type of GAME_TYPES) {
      const ofType = bank.filter((p) => p.gameType === type);
      expect(ofType.filter((p) => p.pool === 'ranked').length).toBeGreaterThanOrEqual(2000);
      expect(ofType.filter((p) => p.pool === 'offline').length).toBeGreaterThan(0);
    }
    // A puzzle is in one pool only: no ranked puzzle is also an offline one (the app ships those).
    const ids = bank.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('npm run db:seed-puzzles: seedRankedPuzzles', () => {
  it('writes only the ranked pool, and again only brings rows up to date', async () => {
    const bank = [
      bankPuzzle('r1', 'fast', 'ranked'),
      bankPuzzle('r2', 'fast', 'ranked'),
      bankPuzzle('r3', 'normal', 'ranked'),
      bankPuzzle('o1', 'fast', 'offline'),
      bankPuzzle('o2', 'hard', 'offline'),
    ];
    expect(await seedRankedPuzzles(t.db, bank)).toEqual({
      ranked: 3,
      byType: { fast: 2, normal: 1, hard: 0 },
      skipped: 2,
    });
    const rows = await t.db.select().from(puzzles).orderBy(asc(puzzles.id));
    expect(rows.map((r) => [r.id, r.gameType, r.pool, r.givensCount])).toEqual([
      ['r1', 'fast', 'ranked', 17],
      ['r2', 'fast', 'ranked', 17],
      ['r3', 'normal', 'ranked', 17],
    ]);
    expect(rows[0]!.techniques).toEqual(['nakedSingle']);

    const changed = bank.map((p) => (p.id === 'r1' ? { ...p, techniques: ['hiddenSingle'] } : p));
    await seedRankedPuzzles(t.db, changed);
    expect(await t.db.select().from(puzzles)).toHaveLength(3);
    const [r1] = await t.db.select().from(puzzles).where(eq(puzzles.id, 'r1'));
    expect(r1!.techniques).toEqual(['hiddenSingle']);
    expect(await rankedPoolSizes(t.db)).toEqual({ fast: 2, normal: 1, hard: 0 });
  });

  it('loads the real bank: 2,000+ ranked puzzles per type, no offline one', async () => {
    const bank = readPuzzleBank();
    const result = await seedRankedPuzzles(t.db, bank);
    const sizes = await rankedPoolSizes(t.db);
    for (const type of GAME_TYPES) {
      expect(sizes[type]).toBe(result.byType[type]);
      expect(sizes[type]).toBeGreaterThanOrEqual(2000);
    }
    expect(await t.db.select().from(puzzles).where(eq(puzzles.pool, 'offline'))).toEqual([]);
  }, 60_000);
});

describe('the ranked puzzle source (spec §20: no repeats)', () => {
  const POOL = standInPuzzles(10, 'fast');

  /** Each of `userIds` played `puzzleId` at T0 + minutes. */
  const played = async (userIds: string[], puzzleId: string, minutes: number) => {
    await t.db
      .insert(puzzleHistory)
      .values(userIds.map((userId) => ({ userId, puzzleId, playedAt: new Date(T0 + minutes * 60_000) })));
  };

  beforeEach(async () => {
    await addAccounts(t.db, [{ id: 'ana' }, { id: 'ben' }, { id: 'dan' }]);
    await addPuzzles(t.db, POOL, { gameType: 'fast' });
    // Never to be picked: the offline pool of the same type, and ranked puzzles of another type.
    await addPuzzles(t.db, standInPuzzles(5, 'offline'), { gameType: 'fast', pool: 'offline' });
    await addPuzzles(t.db, standInPuzzles(5, 'normal'), { gameType: 'normal' });
  });

  it('only from the ranked pool of the game type', async () => {
    const source = dbPuzzleSource({ db: t.db, rng: createRng(1) });
    const ids = new Set<string>();
    for (let k = 0; k < 40; k++) ids.add((await source.pickFor('fast', ['ana', 'ben'])).id);
    expect([...ids].every((id) => id.startsWith('fast-'))).toBe(true);
    expect(ids.size).toBeGreaterThan(5);
    const picked = await source.pickFor('fast', ['ana']);
    expect(picked).toEqual(POOL.find((p) => p.id === picked.id));
  });

  it('a puzzle none of the participants has played', async () => {
    for (let k = 1; k <= 5; k++) await played(['ana'], `fast-00${k}`, k);
    for (let k = 6; k <= 8; k++) await played(['ben'], `fast-00${k}`, k);
    await played(['dan'], 'fast-009', 9); // not in this game: doesn't count
    for (let seed = 1; seed <= 20; seed++) {
      const source = dbPuzzleSource({ db: t.db, rng: createRng(seed) });
      expect(['fast-009', 'fast-010']).toContain((await source.pickFor('fast', ['ana', 'ben'])).id);
    }
  });

  it('game after game, never a puzzle either player has seen, until the history starts over', async () => {
    const source = dbPuzzleSource({ db: t.db, rng: createRng(7) });
    const seen: string[] = [];
    // 80% of 10: the 9th distinct puzzle starts a new cycle; the first 9 are all different.
    for (let game = 1; game <= 9; game++) {
      const { id } = await source.pickFor('fast', ['ana', 'ben']);
      expect(seen).not.toContain(id);
      seen.push(id);
      await played(['ana', 'ben'], id, game);
    }
    // A new cycle for both: any puzzle again.
    const ten = await source.pickFor('fast', ['ana', 'ben']);
    expect(POOL.map((p) => p.id)).toContain(ten.id);
  });

  it('every puzzle played by someone: the one whose latest play is the oldest', async () => {
    // ana has 7 (not past 80%), ben the other 3 and one of ana's. fast-001 was the oldest, but ana played it
    // again; fast-004's latest play is ana's (minute 14), not ben's older one. Oldest latest play: fast-002.
    for (let k = 1; k <= 7; k++) await played(['ana'], `fast-00${k}`, 10 + k);
    await played(['ben'], 'fast-008', 30);
    await played(['ben'], 'fast-009', 31);
    await played(['ben'], 'fast-010', 32);
    await played(['ben'], 'fast-004', 2); // older than ana's play of it
    await played(['ana'], 'fast-001', 40); // a replay: the latest play counts
    const source = dbPuzzleSource({ db: t.db, rng: createRng(3) });
    expect((await source.pickFor('fast', ['ana', 'ben'])).id).toBe('fast-002');
  });

  it('past 80% of the pool a player starts over (spec §20): what they played is fresh again', async () => {
    for (let k = 1; k <= 8; k++) await played(['ana'], `fast-00${k}`, k);
    const source = dbPuzzleSource({ db: t.db, rng: createRng(5) });
    // 8 of 10 is not past 80%: only the two left.
    for (let k = 0; k < 10; k++)
      expect(['fast-009', 'fast-010']).toContain((await source.pickFor('fast', ['ana'])).id);
    await played(['ana'], 'fast-009', 9); // 9 of 10: the cycle starts over
    const after = new Set<string>();
    for (let k = 0; k < 40; k++) after.add((await source.pickFor('fast', ['ana'])).id);
    expect(after.size).toBeGreaterThan(2);
    expect([...after].some((id) => id <= 'fast-008')).toBe(true);
  });

  it('an empty ranked pool is an error that says what to run', async () => {
    const source = dbPuzzleSource({ db: t.db, rng: createRng(1) });
    await expect(source.pickFor('hard', ['ana'])).rejects.toThrow(EmptyPoolError);
    await expect(source.pickFor('hard', ['ana'])).rejects.toThrow(/db:seed-puzzles/);
  });
});
