import { openPracticeRepo } from '../practiceRepo';
import { memoryDb, type SqlJsDb } from '../testing/sqlJsDb';

/**
 * The app's database: opened once per run; opening migrates and marks the last run's games interrupted.
 * expo-sqlite is replaced by sql.js; each test loads the module afresh (it keeps the open database).
 */

const mockOpen = jest.fn<Promise<SqlJsDb>, [string]>();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: (name: string) => mockOpen(name) }));

type Storage = typeof import('../storage');
const load = (): Storage => {
  let mod!: Storage;
  jest.isolateModules(() => {
    mod = jest.requireActual<Storage>('../storage');
  });
  return mod;
};

beforeEach(() => mockOpen.mockReset());

describe('the practice database on the phone', () => {
  it('opens once, migrates, and marks games the last run left playing as interrupted', async () => {
    const db = await memoryDb();
    const lastRun = await openPracticeRepo(db);
    await lastRun.createGame({
      id: 'left',
      mode: 'solo',
      gameType: 'fast',
      puzzleId: 'p',
      playerId: 'me',
      seed: 1,
      startedAt: 5,
    });
    mockOpen.mockResolvedValue(db);

    const { openPracticeStorage, PRACTICE_DB_NAME } = load();
    const [a, b] = await Promise.all([openPracticeStorage(), openPracticeStorage()]);
    expect(a).toBe(b);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith(PRACTICE_DB_NAME);
    expect((await a.getGame('left'))?.status).toBe('interrupted');
  });

  it('a failure is not kept: the next call tries again; the "or null" form logs it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockOpen.mockRejectedValueOnce(new Error('disk full'));
    const { openPracticeStorage, practiceStorageOrNull } = load();
    expect(await practiceStorageOrNull()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[practice]'), expect.any(Error));

    mockOpen.mockResolvedValueOnce(await memoryDb());
    const repo = await openPracticeStorage();
    expect(await repo.listRecent()).toEqual([]);
    expect(await practiceStorageOrNull()).toBe(repo);
    warn.mockRestore();
  });
});
