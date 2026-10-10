/* Test-only: an in-memory SQLite (sql.js) behind the SqlDb interface, so the repository's SQL runs for real. */
import initSqlJs from 'sql.js';

import type { SqlDb, SqlRunResult, SqlValue } from '../sqlDb';

type SqlJsDatabase = InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;

let engine: ReturnType<typeof initSqlJs> | null = null;

/** The adapter: the async API of expo-sqlite over sql.js's synchronous one. */
export class SqlJsDb implements SqlDb {
  /** Statements run so far (for tests that check batching). */
  statements = 0;
  /** Fails a statement when this says so (for error-path tests); see failOnce. */
  failWhen: ((source: string, params: readonly SqlValue[]) => boolean) | null = null;

  constructor(readonly db: SqlJsDatabase) {}

  /** Fails the next statement whose SQL contains `text`, after letting `skip` of them through. */
  failOnce(text: string, skip = 0): void {
    let left = skip;
    this.failWhen = (source) => {
      if (!source.includes(text)) return false;
      if (left-- > 0) return false;
      this.failWhen = null;
      return true;
    };
  }

  private check(source: string, params: readonly SqlValue[] = []): void {
    this.statements++;
    if (this.failWhen?.(source, params))
      throw new Error(`SqlJsDb: failing on purpose: ${source.slice(0, 60)}`);
  }

  async execAsync(source: string): Promise<void> {
    this.check(source);
    this.db.exec(source);
  }

  async runAsync(source: string, params: SqlValue[]): Promise<SqlRunResult> {
    this.check(source, params);
    this.db.run(source, params);
    const id = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];
    return { changes: this.db.getRowsModified(), lastInsertRowId: Number(id ?? 0) };
  }

  async getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]> {
    this.check(source, params);
    const stmt = this.db.prepare(source);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  async getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null> {
    return (await this.getAllAsync<T>(source, params))[0] ?? null;
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec('BEGIN');
    try {
      await task();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

/** A fresh in-memory database. */
export async function memoryDb(): Promise<SqlJsDb> {
  engine ??= initSqlJs();
  const SQL = await engine;
  return new SqlJsDb(new SQL.Database());
}
