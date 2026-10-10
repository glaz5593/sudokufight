import type { TelemetryEvent } from '@sudoku-fight/protocol';
import { openDatabaseAsync } from 'expo-sqlite';

import type { SqlDb, SqlValue } from '../../game/sqlDb';
import { sanitizeEvent } from './batching';
import type { TelemetryStore } from './queue';

export type { TelemetryStore } from './queue';

/**
 * The event queue on disk (spec §27.1: events wait on the phone until there is a connection), so events
 * survive the app being killed. A table in its own small SQLite database, not the key-value store:
 * - Sending removes events from the front while taps add at the end. In a table both are cheap (an INSERT, a
 *   DELETE by id); the key-value store would rewrite whole chunks of JSON for each.
 * - Its own file: telemetry never touches the practice games (practice.db), and its schema needs no
 *   migration shared with them. `CREATE TABLE IF NOT EXISTS`, no PRAGMA user_version (so it is harmless even
 *   on a database that has its own versions).
 *
 * Writes are batched by the caller (client.ts): one transaction for all the changes of the last seconds, not
 * one write per tap. Written against SqlDb: expo-sqlite on the phone, sql.js in tests.
 */

export const TELEMETRY_DB_NAME = 'telemetry.db';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS telemetry_queue (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    event_json TEXT NOT NULL
  );
`;

/** Rows per statement (two parameters each), well under SQLite's oldest limit of 999 parameters. */
const INSERT_CHUNK = 200;
const DELETE_CHUNK = 500;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (n: number, one: string): string => Array.from({ length: n }, () => one).join(', ');

async function deleteIds(db: SqlDb, ids: readonly string[]): Promise<void> {
  for (const part of chunks(ids, DELETE_CHUNK))
    await db.runAsync(`DELETE FROM telemetry_queue WHERE id IN (${placeholders(part.length, '?')})`, part);
}

/** The queue's table in `db`, created when missing. */
export async function openTelemetryStore(db: SqlDb): Promise<TelemetryStore> {
  await db.execAsync(SCHEMA);
  return {
    async load() {
      const rows = await db.getAllAsync<{ id: string; event_json: string }>(
        'SELECT id, event_json FROM telemetry_queue ORDER BY seq',
        [],
      );
      const events: TelemetryEvent[] = [];
      const bad: string[] = [];
      for (const row of rows) {
        let event: TelemetryEvent | null = null;
        try {
          event = sanitizeEvent(JSON.parse(row.event_json));
        } catch {
          event = null;
        }
        if (event && event.id === row.id) events.push(event);
        else bad.push(row.id);
      }
      if (bad.length > 0) await deleteIds(db, bad);
      return events;
    },

    async save({ added, removed }) {
      if (added.length === 0 && removed.length === 0) return;
      await db.withTransactionAsync(async () => {
        await deleteIds(db, removed);
        for (const part of chunks(added, INSERT_CHUNK)) {
          const params: SqlValue[] = part.flatMap((e) => [e.id, JSON.stringify(e)]);
          await db.runAsync(
            `INSERT OR IGNORE INTO telemetry_queue (id, event_json) VALUES ${placeholders(part.length, '(?, ?)')}`,
            params,
          );
        }
      });
    },
  };
}

/** The queue on this phone: its own database file, opened once per run by the caller. */
export async function openDeviceTelemetryStore(): Promise<TelemetryStore> {
  const db = await openDatabaseAsync(TELEMETRY_DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL');
  return openTelemetryStore(db);
}
