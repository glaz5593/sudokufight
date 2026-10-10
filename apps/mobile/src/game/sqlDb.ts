/**
 * The part of expo-sqlite's async API that the practice store uses. Written against this, the repository
 * runs on the phone (expo-sqlite's SQLiteDatabase fits it as is) and in tests on sql.js (testing/sqlJsDb.ts).
 */
export type SqlValue = string | number | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlDb {
  /** Runs one or more statements, without parameters. */
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<SqlRunResult>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  /** Commits when the task resolves, rolls back when it throws. Not exclusive: callers serialise. */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
