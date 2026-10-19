import { openDatabaseAsync } from 'expo-sqlite';

import { type LevelsRepo, openLevelsRepo } from './levelsRepo';

/**
 * Staged practice's database on the phone (1.0.2; dev-plan §1.4): levels.db, its own file, opened once per app
 * run, with its own queue (levelsRepo.ts), apart from the practices' practice.db. Nothing here runs at the
 * app's start: the first level's end, the levels' screens or a sync that has something to merge open it.
 */
export const LEVELS_DB_NAME = 'levels.db';

let opening: Promise<LevelsRepo> | null = null;

export function openLevelsStorage(): Promise<LevelsRepo> {
  if (opening) return opening;
  const attempt = (async () => {
    const db = await openDatabaseAsync(LEVELS_DB_NAME);
    await db.execAsync('PRAGMA journal_mode = WAL');
    return openLevelsRepo(db);
  })();
  opening = attempt;
  // A failure is not kept: the next call tries again.
  attempt.catch(() => {
    if (opening === attempt) opening = null;
  });
  return attempt;
}

/** For what can go on without it (a level's result, the map): the repository, or null (logged). */
export async function levelsStorageOrNull(): Promise<LevelsRepo | null> {
  try {
    return await openLevelsStorage();
  } catch (error) {
    console.warn('[levels] the local database is unavailable; progress is not saved', error);
    return null;
  }
}
