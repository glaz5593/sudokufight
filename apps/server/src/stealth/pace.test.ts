import { type GameType, paceFromHistory, STEALTH_BOT_CONFIG } from '@sudoku-fight/engine';

import { FRIENDS_GAME_MODE, gamePlayers, games } from '../db/schema';
import { createTestDb, type TestDb } from '../testing/db';
import { addGamePuzzle } from '../testing/progress';
import { addAccounts, T0 } from '../testing/ranked';
import { paceHistoryOf } from './pace';

/**
 * A person's pace history for the stealth bot (stealth-bot.md §5.1, §5.2) [D96, D97a]: from the paces the end of
 * each ranked game stored, and his results against stealth bots (the guard), on PGlite.
 */

let t: TestDb;
let puzzleId: string;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
beforeEach(async () => {
  await t.reset();
  await addAccounts(t.db, [{ id: 'ana' }, { id: 'ben' }, { id: 'pia' }]);
  puzzleId = await addGamePuzzle(t.db);
});
afterAll(() => t.close());

interface Played {
  id: string;
  /** Minutes after T0 it ended (newer is later). */
  at: number;
  gameType?: GameType;
  mode?: string;
  stealth?: boolean;
  /** ana's seat. */
  pace?: { ms: number; moves: number; digits: number | null } | null;
  mistakes?: number | null;
  /** ana's place and the opponent's (null: no place, a game cut short). */
  place?: number | null;
  theirs?: number | null;
  ended?: boolean;
}

async function played(g: Played): Promise<void> {
  const endedAt = g.ended === false ? null : new Date(T0 + g.at * 60_000);
  await t.db.insert(games).values({
    id: g.id,
    mode: g.mode ?? 'ranked',
    gameType: g.gameType ?? 'fast',
    playerCount: 2,
    puzzleId,
    rules: {},
    startedAt: new Date(T0 + (g.at - 5) * 60_000),
    endedAt,
    endReason: endedAt === null ? null : 'boardComplete',
    stealth: g.stealth ?? false,
  });
  const pace = g.pace === undefined ? { ms: 9000, moves: 30, digits: 32 } : g.pace;
  await t.db.insert(gamePlayers).values([
    {
      gameId: g.id,
      userId: 'ana',
      seat: 0,
      status: 'active',
      place: g.place === undefined ? 1 : g.place,
      mistakes: g.mistakes === undefined ? 2 : g.mistakes,
      paceMs: pace?.ms ?? null,
      paceMoves: pace?.moves ?? null,
      paceDigits: pace?.digits ?? null,
    },
    {
      gameId: g.id,
      userId: g.stealth ? 'pia' : 'ben',
      seat: 1,
      status: 'active',
      place: g.theirs === undefined ? 2 : g.theirs,
      mistakes: 0,
    },
  ]);
}

describe('paceHistoryOf', () => {
  it('his newest ranked games with a pace, newest first, at most 10; each with its digits and mistakes', async () => {
    for (let k = 0; k < 13; k++)
      await played({ id: `g${k}`, at: k, pace: { ms: 8000 + k * 100, moves: 20 + k, digits: 25 + k } });
    const history = await paceHistoryOf(t.db, 'ana', 'fast');
    expect(history.gameType).toBe('fast');
    expect(history.games).toHaveLength(STEALTH_BOT_CONFIG.games);
    expect(history.games[0]).toEqual({
      gameType: 'fast',
      paceMs: 9200,
      paceMoves: 32,
      digits: 37,
      mistakes: 2,
    });
    expect(history.games.map((g) => g.paceMs)).toEqual(
      Array.from({ length: 10 }, (_, k) => 8000 + (12 - k) * 100),
    );
    expect(history.stealthWins).toEqual([]);
  });

  it('leaves out games without a pace, friends games, unfinished ones and other players’ seats; keeps every type', async () => {
    await played({ id: 'ranked-fast', at: 1 });
    await played({ id: 'ranked-hard', at: 2, gameType: 'hard', pace: { ms: 15000, moves: 18, digits: 20 } });
    await played({ id: 'no-pace', at: 3, pace: null });
    await played({ id: 'friends', at: 4, mode: FRIENDS_GAME_MODE });
    await played({ id: 'running', at: 5, ended: false });
    await played({ id: 'old-digits', at: 6, pace: { ms: 7000, moves: 12, digits: null } });
    const history = await paceHistoryOf(t.db, 'ana', 'normal');
    expect(history.games).toEqual([
      { gameType: 'fast', paceMs: 7000, paceMoves: 12 }, // no digits: counts for the base only
      { gameType: 'hard', paceMs: 15000, paceMoves: 18, digits: 20, mistakes: 2 },
      { gameType: 'fast', paceMs: 9000, paceMoves: 30, digits: 32, mistakes: 2 },
    ]);
    expect((await paceHistoryOf(t.db, 'ben', 'fast')).games).toEqual([]);
  });

  it('his results against stealth bots, newest first, at most 40: won = placed ahead of the persona', async () => {
    await played({ id: 's-won', at: 1, stealth: true, place: 1, theirs: 2 });
    await played({ id: 's-lost', at: 2, stealth: true, place: 2, theirs: 1 });
    await played({ id: 'person', at: 3, place: 1, theirs: 2 }); // not stealth
    await played({ id: 's-cut', at: 4, stealth: true, place: null, theirs: null }); // a restart: no place
    await played({ id: 's-friends', at: 5, stealth: true, mode: FRIENDS_GAME_MODE });
    await played({ id: 's-tie', at: 6, stealth: true, place: 1, theirs: 1 });
    expect((await paceHistoryOf(t.db, 'ana', 'fast')).stealthWins).toEqual([false, false, true]);

    for (let k = 0; k < 45; k++) await played({ id: `w${k}`, at: 100 + k, stealth: true });
    expect((await paceHistoryOf(t.db, 'ana', 'fast')).stealthWins).toEqual(
      Array.from({ length: STEALTH_BOT_CONFIG.guard.history }, () => true),
    );
  });

  it('feeds the engine’s paceFromHistory as it is: the guard steps down after a winning streak', async () => {
    for (let k = 0; k < 10; k++) await played({ id: `s${k}`, at: k, stealth: true, place: 1, theirs: 2 });
    const pace = paceFromHistory(await paceHistoryOf(t.db, 'ana', 'fast'));
    expect(pace).toMatchObject({ baseMs: 9000, games: 10, sameTypeOnly: true, scale: 0.95 });
    expect(pace.mistakeRate).toBeCloseTo(2 / 32, 6);
  });
});
