import { openDatabaseAsync } from 'expo-sqlite';

import { openPracticeRepo, type PracticeRepo } from './practiceRepo';

/**
 * The practice database on the phone [D25], opened once per app run. Opening also migrates the schema and
 * marks games left 'playing' by the previous run as 'interrupted' (their events are kept), so a game started
 * in this run is never caught by it: everyone waits for the same promise.
 */
export const PRACTICE_DB_NAME = 'practice.db';

let opening: Promise<PracticeRepo> | null = null;

export function openPracticeStorage(): Promise<PracticeRepo> {
  if (opening) return opening;
  const attempt = (async () => {
    const db = await openDatabaseAsync(PRACTICE_DB_NAME);
    await db.execAsync('PRAGMA journal_mode = WAL');
    const repo = await openPracticeRepo(db);
    await repo.markInterrupted();
    return repo;
  })();
  opening = attempt;
  // A failure is not kept: the next call tries again.
  attempt.catch(() => {
    if (opening === attempt) opening = null;
  });
  return attempt;
}

/** For screens that can play without saving: the repository, or null (logged) when it can't open. */
export async function practiceStorageOrNull(): Promise<PracticeRepo | null> {
  try {
    return await openPracticeStorage();
  } catch (error) {
    console.warn('[practice] the local database is unavailable; this game will not be saved', error);
    return null;
  }
}
