import { normalizeForCompare, RENAME_COOLDOWN_MS } from '@sudoku-fight/protocol';
import { sql } from 'drizzle-orm';

import { queryRows } from '../db';
import { displayNameKey, users } from '../db/schema';
import { createTestDb, type TestDb } from '../testing/db';
import { isNameTaken, NAME_INDEX, nextRenameAt, UID_INDEX, uniqueViolation } from './store';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
beforeEach(() => t.reset());
afterAll(() => t.close());

const NOW = Date.UTC(2026, 9, 9, 12);

const user = (id: string, displayName: string, extra: Partial<typeof users.$inferInsert> = {}) => ({
  id,
  firebaseUid: `uid-${id}`,
  displayName,
  ...extra,
});

/** The error an insert threw, or null. */
async function insertError(row: typeof users.$inferInsert): Promise<unknown> {
  try {
    await t.db.insert(users).values(row);
    return null;
  } catch (err) {
    return err;
  }
}

describe('the name key: the same rule in SQL and in the protocol', () => {
  it('normalizeForCompare() equals the SQL of the unique index, name by name', async () => {
    const names = [
      'Dana',
      'DANA',
      'dAnA_1.x',
      'Player.007',
      'דן',
      'שירן',
      'ךםןףץ',
      'כמנפצ',
      'Mix.שם_X',
      'ABCDEFGHIJKLMNOP',
      'abcdefghijklmnopqrstuvwxyz',
      'אבגדהוזחטיךכלםמןנסעףפץצקרשת',
      '0123456789_.',
    ];
    const rows = await queryRows<{ name: string; key: string }>(
      t.db,
      sql`select n as name, ${displayNameKey(sql`n`)} as key from unnest(${sql.param(names)}::text[]) as n`,
    );
    expect(rows.map((r) => [r.name, r.key])).toEqual(names.map((n) => [n, normalizeForCompare(n)]));
  });

  it('the index refuses a second live name with the same key', async () => {
    await t.db.insert(users).values(user('a', 'Dana'));
    expect(uniqueViolation(await insertError(user('b', 'dana')))).toBe(NAME_INDEX);
    await t.db.insert(users).values(user('c', 'דן'));
    expect(uniqueViolation(await insertError(user('d', 'דנ')))).toBe(NAME_INDEX);
  });

  it('…among accounts not deleted only', async () => {
    await t.db.insert(users).values(user('a', 'Dana', { deletedAt: new Date(NOW) }));
    expect(await insertError(user('b', 'Dana'))).toBeNull();
    expect(await insertError(user('c', 'DANA', { deletedAt: new Date(NOW) }))).toBeNull();
  });

  it('the uid is unique too', async () => {
    await t.db.insert(users).values(user('a', 'Dana'));
    expect(uniqueViolation(await insertError({ id: 'b', firebaseUid: 'uid-a', displayName: 'Other' }))).toBe(
      UID_INDEX,
    );
  });

  it('isNameTaken compares the same way, leaving out deleted accounts and the caller', async () => {
    await t.db
      .insert(users)
      .values([user('a', 'Dana'), user('b', 'שירן'), user('c', 'Gone', { deletedAt: new Date(NOW) })]);
    expect(await isNameTaken(t.db, 'DANA')).toBe(true);
    expect(await isNameTaken(t.db, 'שירנ')).toBe(true);
    expect(await isNameTaken(t.db, 'Gone')).toBe(false);
    expect(await isNameTaken(t.db, 'Dana', 'a')).toBe(false);
    expect(await isNameTaken(t.db, 'Dana', 'b')).toBe(true);
    expect(await isNameTaken(t.db, 'Dan')).toBe(false);
  });
});

describe('uniqueViolation', () => {
  it('reads the constraint from the error or what caused it', () => {
    expect(uniqueViolation({ code: '23505', constraint: 'x' })).toBe('x');
    expect(uniqueViolation({ code: '23505', constraint_name: 'y' })).toBe('y');
    expect(uniqueViolation({ message: 'wrapped', cause: { code: '23505', constraint: 'z' } })).toBe('z');
    expect(uniqueViolation({ code: '23505' })).toBe('');
    expect(uniqueViolation({ code: '23503', constraint: 'fk' })).toBeNull();
    expect(uniqueViolation(new Error('no'))).toBeNull();
    expect(uniqueViolation(null)).toBeNull();
  });
});

describe('nextRenameAt [D20]', () => {
  it('null until the first rename, then 30 days after the last one', () => {
    expect(nextRenameAt(null, NOW)).toBeNull();
    expect(nextRenameAt(new Date(NOW), NOW)).toBe(NOW + RENAME_COOLDOWN_MS);
    expect(nextRenameAt(new Date(NOW), NOW + RENAME_COOLDOWN_MS - 1)).toBe(NOW + RENAME_COOLDOWN_MS);
    expect(nextRenameAt(new Date(NOW), NOW + RENAME_COOLDOWN_MS)).toBeNull();
  });
});
