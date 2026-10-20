import { eq } from 'drizzle-orm';

import { serverSettings } from '../db/schema';
import { createTestDb, quietLog, type TestDb } from '../testing';
import {
  dbStealthSwitchStore,
  STEALTH_BOT_SETTING,
  StealthSwitch,
  type StealthSwitchRecord,
  type StealthSwitchStore,
  StealthSwitchUnavailableError,
} from './switch';

/**
 * The stealth bot's switch (stealth-bot.md §8) [D90]: off by default, under the STEALTH_BOT_ENABLED master switch,
 * turned from the admin site with no restart; matchmaking reads it every round, from memory.
 */

const T0 = Date.UTC(2026, 9, 20, 12);

class MemoryStore implements StealthSwitchStore {
  record: StealthSwitchRecord | null = null;
  reads = 0;
  failing = false;
  read() {
    this.reads++;
    return this.failing ? Promise.reject(new Error('db down')) : Promise.resolve(this.record);
  }
  write(record: StealthSwitchRecord) {
    this.record = record;
    return Promise.resolve();
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

function setup(available = true) {
  let now = T0;
  const store = new MemoryStore();
  const log = quietLog();
  const sw = new StealthSwitch({ available, store, now: () => now, log, ttlMs: 2000 });
  return { sw, store, log, advance: (ms: number) => (now += ms) };
}

describe('StealthSwitch', () => {
  it('is off until an admin turns it on (no stored row: off)', async () => {
    const { sw } = setup();
    expect(sw.isOn()).toBe(false);
    expect(await sw.state()).toEqual({
      available: true,
      enabled: false,
      on: false,
      updatedAt: null,
      updatedBy: null,
    });
    expect(sw.isOn()).toBe(false);
  });

  it('STEALTH_BOT_ENABLED=false: off whatever is stored, never read, and it can’t be turned', async () => {
    const { sw, store } = setup(false);
    store.record = { enabled: true, updatedAt: T0, updatedBy: 'x@y.z' };
    expect(sw.isOn()).toBe(false);
    expect(await sw.state()).toMatchObject({ available: false, enabled: false, on: false });
    expect(store.reads).toBe(0);
    await expect(sw.set(true, 'admin@example.com')).rejects.toBeInstanceOf(StealthSwitchUnavailableError);
  });

  it('set() takes effect at once in this process, and says who and when', async () => {
    const { sw, store, advance } = setup();
    advance(500);
    expect(await sw.set(true, 'admin@example.com')).toEqual({
      available: true,
      enabled: true,
      on: true,
      updatedAt: T0 + 500,
      updatedBy: 'admin@example.com',
    });
    expect(sw.isOn()).toBe(true);
    expect(store.record).toEqual({ enabled: true, updatedAt: T0 + 500, updatedBy: 'admin@example.com' });
    await sw.set(false, 'admin@example.com');
    // Off at once: the next matchmaking round seats no new bot.
    expect(sw.isOn()).toBe(false);
  });

  it('a change made elsewhere shows within ttlMs, read in the background, one read at a time', async () => {
    const { sw, store, advance } = setup();
    await sw.state();
    const reads = store.reads;
    store.record = { enabled: true, updatedAt: T0, updatedBy: null };
    expect(sw.isOn()).toBe(false); // still fresh
    advance(1999);
    expect(sw.isOn()).toBe(false);
    expect(store.reads).toBe(reads);
    advance(1);
    expect(sw.isOn()).toBe(false); // the read starts now
    expect(sw.isOn()).toBe(false);
    expect(store.reads).toBe(reads + 1);
    await settle();
    expect(sw.isOn()).toBe(true);
  });

  it('a read that fails keeps the last value, is logged, and is tried again later', async () => {
    const { sw, store, log, advance } = setup();
    await sw.set(true, null);
    store.failing = true;
    advance(2000);
    expect(sw.isOn()).toBe(true);
    await settle();
    expect(sw.isOn()).toBe(true);
    expect(log.errors).toHaveLength(1);
    store.failing = false;
    store.record = { enabled: false, updatedAt: T0, updatedBy: null };
    advance(2000);
    sw.isOn();
    await settle();
    expect(sw.isOn()).toBe(false);
  });

  it('a read that started before a set() does not undo it', async () => {
    const { sw, store } = setup();
    let release: (r: StealthSwitchRecord | null) => void = () => undefined;
    store.read = () => new Promise((resolve) => (release = resolve));
    sw.isOn(); // a read starts (stale: never read)
    await sw.set(true, null);
    release(null); // the old answer: no row
    await settle();
    expect(sw.isOn()).toBe(true);
  });
});

describe('dbStealthSwitchStore (server_settings)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it('no row: null (off); then one row, written over', async () => {
    const store = dbStealthSwitchStore(t.db);
    expect(await store.read()).toBeNull();
    await store.write({ enabled: true, updatedAt: T0, updatedBy: 'admin@example.com' });
    expect(await store.read()).toEqual({ enabled: true, updatedAt: T0, updatedBy: 'admin@example.com' });
    await store.write({ enabled: false, updatedAt: T0 + 1000, updatedBy: null });
    expect(await store.read()).toEqual({ enabled: false, updatedAt: T0 + 1000, updatedBy: null });
    const rows = await t.db.select().from(serverSettings).where(eq(serverSettings.key, STEALTH_BOT_SETTING));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toEqual({ enabled: false });
  });

  it('anything but an explicit true is off', async () => {
    const store = dbStealthSwitchStore(() => t.db);
    await t.db
      .update(serverSettings)
      .set({ value: 'yes' })
      .where(eq(serverSettings.key, STEALTH_BOT_SETTING));
    expect((await store.read())?.enabled).toBe(false);
  });

  it('the switch over the database: off, on, and read back by another switch', async () => {
    const log = quietLog();
    const a = new StealthSwitch({ available: true, store: dbStealthSwitchStore(t.db), now: Date.now, log });
    const b = new StealthSwitch({ available: true, store: dbStealthSwitchStore(t.db), now: Date.now, log });
    await a.set(true, 'admin@example.com');
    expect(await b.state()).toMatchObject({ on: true, updatedBy: 'admin@example.com' });
    await a.set(false, 'admin@example.com');
    expect((await b.state()).on).toBe(false);
  });
});
