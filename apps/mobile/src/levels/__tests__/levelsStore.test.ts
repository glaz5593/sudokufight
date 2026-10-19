import { type FindLevelOver, levelIdOf } from '@sudoku-fight/engine';
import { act, renderHook } from '@testing-library/react-native';

import { useAuth } from '../../auth/authStore';
import type { AuthUser } from '../../auth/types';
import { memoryDb, type SqlJsDb } from '../../game/testing/sqlJsDb';
import { type LevelsRepo, openLevelsRepo } from '../levelsRepo';
import { forgetLevels, refreshLevels, useLevels, useLevelsProgress, useLevelsSummary } from '../levelsStore';

/**
 * The levels' numbers for the screens (dev-plan §2ו): the "משחק חדש" row and my card read levels.db only,
 * never the levels' data file; one owner's numbers, never another's; an answer older than the last is dropped.
 */

// The progress must never need the levels themselves (Home must not load them, startupGraph.test.ts).
const mockRead = jest.fn();
jest.mock('../data/levels.json', () => {
  mockRead();
  return [];
});

const user = (uid: string): AuthUser => ({ uid, email: null, emailVerified: true, methods: ['password'] });
const signIn = (uid: string | null) =>
  useAuth.setState(uid ? { status: 'ready', user: user(uid) } : { status: 'signedOut', user: null });

const found: FindLevelOver = {
  reason: 'targetReached',
  elapsedMs: 4000,
  penaltyMs: 0,
  spots: 1,
  found: 0,
  stars: 0,
};

let db: SqlJsDb;
let repo: LevelsRepo;

async function play(owner: string, n: number) {
  await repo.recordAttempt({
    owner,
    level: {
      id: levelIdOf(n),
      rev: 1,
      kind: 'find',
      chapter: 1,
      stars: { by: 'timeMs', three: 5000, two: 10000, one: 20000 },
    },
    end: found,
    startedAt: 1,
    endedAt: 2,
  });
}

beforeEach(async () => {
  db = await memoryDb();
  repo = await openLevelsRepo(db);
  forgetLevels();
  signIn(null);
});
afterEach(() => db.close());

describe('the levels store', () => {
  it('reads the summary, the bests and the opened gates from levels.db, never the levels file', async () => {
    await play('uid-1', 1);
    await play('uid-1', 2);
    await repo.openGate('uid-1', 2, 5);
    await refreshLevels({ owner: 'uid-1', repo: async () => repo });
    expect(useLevels.getState()).toMatchObject({
      owner: 'uid-1',
      status: 'ready',
      summary: { played: 2, stars: 6, current: 3 },
      openedChapters: [2],
    });
    expect(useLevels.getState().progress.L002).toMatchObject({ stars: 3, plays: 1 });
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('another owner starts from nothing; an answer for the last one is dropped', async () => {
    await play('uid-1', 1);
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const first = refreshLevels({
      owner: 'uid-1',
      repo: async () => {
        await slow;
        return repo;
      },
    });
    await refreshLevels({ owner: 'uid-2', repo: async () => repo });
    expect(useLevels.getState()).toMatchObject({ owner: 'uid-2', summary: { played: 0, stars: 0 } });
    release();
    await first;
    expect(useLevels.getState()).toMatchObject({ owner: 'uid-2', summary: { played: 0 } });

    // Signed out: nothing stays.
    await refreshLevels({ owner: null });
    expect(useLevels.getState()).toMatchObject({ owner: null, summary: null, progress: {} });
  });

  it('levels.db unavailable: says so, and keeps no numbers', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await refreshLevels({
      owner: 'uid-1',
      repo: () => Promise.reject(new Error('disk full')),
    });
    expect(useLevels.getState()).toMatchObject({ owner: 'uid-1', status: 'unavailable', summary: null });
    log.mockRestore();
  });

  it("the hooks give the signed-in player's numbers only", async () => {
    await play('uid-1', 1);
    signIn('uid-1');
    const summary = await renderHook(() => useLevelsSummary());
    const progress = await renderHook(() => useLevelsProgress());
    expect(summary.result.current).toBeNull();
    expect(progress.result.current).toBeNull();
    await act(() => refreshLevels({ repo: async () => repo }));
    expect(summary.result.current).toEqual({ played: 1, stars: 3, current: 2 });
    expect(progress.result.current?.L001).toMatchObject({ stars: 3 });
    // Another account signed in: not theirs.
    await act(async () => signIn('uid-2'));
    expect(summary.result.current).toBeNull();
    expect(progress.result.current).toBeNull();
  });
});
