import { createDb, type Database, truncateAll } from '../db';

/**
 * A fresh, migrated, in-memory PGlite for a test file (about 1.5 s to make, so make one per file):
 *
 *   let t: TestDb;
 *   beforeAll(async () => { t = await createTestDb(); });
 *   beforeEach(() => t.reset());
 *   afterAll(() => t.close());
 */
export interface TestDb extends Database {
  /** Empties every table in one TRUNCATE (identities restart). */
  reset(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const database = await createDb({ database: { kind: 'pglite', dataDir: null } });
  return { ...database, reset: () => truncateAll(database.db) };
}
