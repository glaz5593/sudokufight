import type { TelemetryEvent } from '@sudoku-fight/protocol';

import { memoryDb, type SqlJsDb } from '../../../game/testing/sqlJsDb';
import { TelemetryQueue } from '../queue';
import { openDeviceTelemetryStore, openTelemetryStore, TELEMETRY_DB_NAME } from '../storage';
import { uuidV4 } from '../uuid';

/**
 * The queue on disk (spec §27.1): what a run saved, the next run loads. SQLite runs for real (sql.js in place
 * of expo-sqlite); "a reload" is a new store, and a new queue, over the same database.
 */

const mockOpen = jest.fn<Promise<SqlJsDb>, [string]>();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: (name: string) => mockOpen(name) }));

const T = Date.UTC(2026, 9, 9, 12);
let n = 0;
function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  n++;
  return { id: uuidV4(), name: 'screen_view', props: { screen: `/s${n}` }, t: T + n, ...overrides };
}

let db: SqlJsDb;
beforeEach(async () => {
  db = await memoryDb();
  mockOpen.mockReset();
});
afterEach(() => db.close());

describe('the queue on disk', () => {
  it('what one run saves, the next loads, oldest first', async () => {
    const events = Array.from({ length: 5 }, () => event());
    const run1 = new TelemetryQueue();
    events.forEach((e) => run1.append(e));
    await (await openTelemetryStore(db)).save(run1.takeChanges()!);

    const run2 = new TelemetryQueue();
    run2.restore(await (await openTelemetryStore(db)).load());
    expect(run2.peek(100)).toEqual(events);
    expect(run2.takeChanges()).toBeNull();
  });

  it('sent events are deleted; a later save appends after what is there', async () => {
    const store = await openTelemetryStore(db);
    const q = new TelemetryQueue();
    const [a, b, c] = [event(), event(), event()];
    q.append(a);
    q.append(b);
    await store.save(q.takeChanges()!);
    q.ack([a.id]);
    q.append(c);
    await store.save(q.takeChanges()!);
    expect(await store.load()).toEqual([b, c]);
  });

  it('a whole batch of changes is a few statements in one transaction, not one write per event', async () => {
    const store = await openTelemetryStore(db);
    const q = new TelemetryQueue();
    for (let i = 0; i < 450; i++) q.append(event());
    const before = db.statements;
    await store.save(q.takeChanges()!);
    expect(db.statements - before).toBe(3); // 200 + 200 + 50 rows
    q.ack(q.peek(450).map((e) => e.id));
    const again = db.statements;
    await store.save(q.takeChanges()!);
    expect(db.statements - again).toBe(1);
    expect(await store.load()).toEqual([]);
  });

  it('a failed write leaves nothing half written', async () => {
    const store = await openTelemetryStore(db);
    const q = new TelemetryQueue();
    for (let i = 0; i < 250; i++) q.append(event());
    db.failOnce('INSERT', 1); // the second chunk of rows
    await expect(store.save(q.takeChanges()!)).rejects.toThrow('failing on purpose');
    expect(await store.load()).toEqual([]);
  });

  it('rows that are no longer valid events (another version, a broken row) are deleted on load', async () => {
    const store = await openTelemetryStore(db);
    const good = event();
    const old = { ...event(), name: 'an_old_event' };
    await db.runAsync('INSERT INTO telemetry_queue (id, event_json) VALUES (?, ?), (?, ?), (?, ?)', [
      good.id,
      JSON.stringify(good),
      old.id,
      JSON.stringify(old),
      'broken',
      '{not json',
    ]);
    expect(await store.load()).toEqual([good]);
    const left = await db.getAllAsync<{ id: string }>('SELECT id FROM telemetry_queue', []);
    expect(left).toEqual([{ id: good.id }]);
  });

  it('opening twice is harmless (CREATE TABLE IF NOT EXISTS), and leaves PRAGMA user_version alone', async () => {
    await db.execAsync('PRAGMA user_version = 7');
    const e = event();
    await (await openTelemetryStore(db)).save({ added: [e], removed: [] });
    expect(await (await openTelemetryStore(db)).load()).toEqual([e]);
    expect(await db.getFirstAsync('PRAGMA user_version', [])).toEqual({ user_version: 7 });
  });

  it('on the phone: its own database file, telemetry.db', async () => {
    mockOpen.mockResolvedValue(db);
    const store = await openDeviceTelemetryStore();
    expect(mockOpen).toHaveBeenCalledWith(TELEMETRY_DB_NAME);
    expect(TELEMETRY_DB_NAME).toBe('telemetry.db');
    expect(await store.load()).toEqual([]);
  });
});
