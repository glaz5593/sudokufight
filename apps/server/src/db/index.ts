import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { is, type SQL, sql } from 'drizzle-orm';
import { getTableConfig, type PgDatabase, type PgQueryResultHKT, PgTable } from 'drizzle-orm/pg-core';

import type { DatabaseConfig } from '../config';
import { lockDataDir } from './lock';
import * as schema from './schema';

/**
 * Opens the database: Postgres (postgres-js) when the settings have a URL, else PGlite, the in-process
 * Postgres (a folder, or memory). Either way it applies pending migrations from drizzle/ before returning.
 * A PGlite folder is held by one process at a time (./lock): a second one gets DataDirLockedError.
 *
 * Both drivers give the same query builder (`Db`). Raw SQL results differ in shape between them, so read
 * those with queryRows(). Sessions run in UTC; count days in the admin time zone with `at time zone`.
 */

export { schema };
export { DataDirLockedError } from './lock';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface Database {
  db: Db;
  driver: DatabaseConfig['kind'];
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Default: apps/server/drizzle. */
  migrationsFolder?: string;
}

/** apps/server/drizzle, from the sources (src/db) or from the bundle (dist). */
export function findMigrationsFolder(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'drizzle'),
    path.resolve(__dirname, '..', 'drizzle'),
  ];
  const found = candidates.find((dir) => existsSync(path.join(dir, 'meta', '_journal.json')));
  if (found === undefined) throw new Error(`No drizzle migrations folder in ${candidates.join(' or ')}`);
  return found;
}

export async function createDb(
  config: { database: DatabaseConfig },
  { migrationsFolder = findMigrationsFolder() }: CreateDbOptions = {},
): Promise<Database> {
  const { database } = config;
  // Imported on demand: production never loads PGlite's WASM, and tests never load the network driver.
  if (database.kind === 'pglite') {
    const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
      import('@electric-sql/pglite'),
      import('drizzle-orm/pglite'),
      import('drizzle-orm/pglite/migrator'),
    ]);
    let release = () => {};
    if (database.dataDir !== null) {
      mkdirSync(database.dataDir, { recursive: true });
      release = lockDataDir(database.dataDir); // one process per folder (./lock)
    }
    try {
      const client = await PGlite.create(database.dataDir ?? 'memory://');
      try {
        await client.exec(`SET TIME ZONE 'UTC'`);
        const db = drizzle({ client, schema });
        await migrate(db, { migrationsFolder });
        const close = async () => {
          try {
            await client.close();
          } finally {
            release();
          }
        };
        return { db, driver: 'pglite', close };
      } catch (err) {
        await client.close();
        throw err;
      }
    } catch (err) {
      release();
      throw err;
    }
  }

  const [{ default: postgres }, { drizzle }, { migrate }] = await Promise.all([
    import('postgres'),
    import('drizzle-orm/postgres-js'),
    import('drizzle-orm/postgres-js/migrator'),
  ]);
  const client = postgres(database.url, {
    max: 10,
    connection: { TimeZone: 'UTC' },
    onnotice: () => {}, // "relation already exists, skipping" from the migrator
  });
  try {
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder });
    return { db, driver: 'postgres', close: () => client.end({ timeout: 5 }) };
  } catch (err) {
    await client.end({ timeout: 1 });
    throw err;
  }
}

/**
 * The rows of a raw query, the same on both drivers (postgres-js answers an array, PGlite `{ rows }`).
 * Timestamps come back as strings here; select `(extract(epoch from t) * 1000)::float8` for epoch ms, and
 * cast counts (`count(*)::int`), which are bigint strings otherwise.
 */
export async function queryRows<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  if (Array.isArray(result)) return result as T[];
  return (result as { rows: T[] }).rows;
}

/** Empties every table of the schema in one TRUNCATE (identities restart). Tests and `npm run seed -- --reset`. */
export async function truncateAll(db: Db): Promise<void> {
  const tables = Object.values(schema as Record<string, unknown>)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((table) => `"${getTableConfig(table).name}"`)
    .join(', ');
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
}
