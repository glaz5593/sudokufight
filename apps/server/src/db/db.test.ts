import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LEGACY_AVATAR_IDS, LEGACY_AVATAR_MAP } from '@sudoku-fight/protocol';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { is, sql } from 'drizzle-orm';

import { createTestDb, type TestDb } from '../testing/db';
import { createDb, findMigrationsFolder, queryRows, schema } from '.';
import { DataDirLockedError, lockDataDir, lockFileOf } from './lock';
import { installs, puzzles, users } from './schema';

const SCHEMA_TABLES = Object.values(schema as Record<string, unknown>)
  .filter((v): v is PgTable => is(v, PgTable))
  .map((t) => getTableConfig(t).name)
  .sort();

describe('database', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 30_000); // a cold PGlite takes seconds when many suites start at once
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('has every table of spec §19 and §27.2', () => {
    expect(SCHEMA_TABLES).toEqual([
      'achievements',
      'admin_audit',
      'app_events',
      'cheat_flags',
      'game_events',
      'game_players',
      'games',
      'installs',
      'opponent_history',
      'player_reports',
      'practice_results',
      'puzzle_history',
      'puzzles',
      'ratings',
      'retired_names',
      'suspended_sign_ins',
      'user_achievements',
      'user_blocks',
      'users',
      'xp',
    ]);
  });

  it('the migrations create exactly the tables of the schema', async () => {
    const rows = await queryRows<{ name: string }>(
      t.db,
      sql`select table_name as name from information_schema.tables
          where table_schema = 'public' order by table_name`,
    );
    expect(rows.map((r) => r.name)).toEqual(SCHEMA_TABLES);
    const applied = await queryRows<{ n: number }>(
      t.db,
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(applied[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('runs sessions in UTC', async () => {
    const [row] = await queryRows<{ tz: string }>(t.db, sql`select current_setting('TimeZone') as tz`);
    expect(row?.tz).toBe('UTC');
  });

  it('display names are unique regardless of case', async () => {
    await t.db.insert(users).values({ firebaseUid: 'f1', displayName: 'Moshe' });
    await expect(t.db.insert(users).values({ firebaseUid: 'f2', displayName: 'moshe' })).rejects.toThrow();
    await t.db.insert(users).values({ firebaseUid: 'f3', displayName: 'Moshe2' });
  });

  it('a puzzle pool is offline or ranked', async () => {
    const p = { givens: '0'.repeat(81), solution: '1'.repeat(81), gameType: 'fast', givensCount: 30 };
    await t.db.insert(puzzles).values({ ...p, id: 'p1', source: 'test', pool: 'ranked' });
    const bad = sql`insert into puzzles (id, givens, solution, game_type, givens_count, source, pool)
                    values ('p2', ${p.givens}, ${p.solution}, 'fast', 30, 'test', 'secret')`;
    await expect(t.db.execute(bad)).rejects.toThrow();
    const [row] = await t.db.select().from(puzzles);
    expect(row).toMatchObject({ id: 'p1', pool: 'ranked', techniques: [] });
  });

  it('round-trips times as Dates, and reset() empties every table', async () => {
    const seen = new Date(Date.UTC(2026, 9, 9, 10, 30, 0, 123));
    await t.db
      .insert(installs)
      .values({ id: 'i1', platform: 'android', appVersion: '0.1.0', firstSeen: seen, lastSeen: seen });
    const [row] = await t.db.select().from(installs);
    expect(row).toEqual({
      id: 'i1',
      platform: 'android',
      appVersion: '0.1.0',
      firstSeen: seen,
      lastSeen: seen,
      userId: null,
    });
    await t.reset();
    expect(await t.db.select().from(installs)).toEqual([]);
  });

  it('queryRows reads raw SQL the same way on every driver', async () => {
    const rows = await queryRows<{ n: number; s: string }>(t.db, sql`select 1::int as n, 'x' as s`);
    expect(rows).toEqual([{ n: 1, s: 'x' }]);
  });
});

describe('createDb', () => {
  it('finds apps/server/drizzle', () => {
    expect(findMigrationsFolder()).toBe(path.resolve(__dirname, '..', '..', 'drizzle'));
  });

  it('keeps PGlite data in a folder, and migrating again on the next start changes nothing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const first = await createDb({ database: { kind: 'pglite', dataDir: dir } });
      const seen = new Date(Date.UTC(2026, 0, 1));
      await first.db
        .insert(installs)
        .values({ id: 'kept', platform: 'ios', appVersion: '1', firstSeen: seen, lastSeen: seen });
      await first.close();

      const second = await createDb({ database: { kind: 'pglite', dataDir: dir } });
      const rows = await second.db.select({ id: installs.id }).from(installs);
      await second.close();
      expect(rows).toEqual([{ id: 'kept' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails clearly without migrations', async () => {
    await expect(
      createDb({ database: { kind: 'pglite', dataDir: null } }, { migrationsFolder: os.tmpdir() }),
    ).rejects.toThrow(/_journal\.json/);
  });
});

/** A copy of drizzle/ that stops before migration `idx`: a database as it was then. */
function foldersBefore(idx: number): string {
  const full = findMigrationsFolder();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-migrations-'));
  const journal = JSON.parse(readFileSync(path.join(full, 'meta', '_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  journal.entries = journal.entries.filter((e) => e.idx < idx);
  mkdirSync(path.join(dir, 'meta'));
  writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    copyFileSync(path.join(full, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

/**
 * Users rows in a database of an older schema: raw SQL with the columns every migration has (the schema's
 * insert would name columns a later migration adds).
 */
async function insertOldUsers(
  db: Parameters<typeof queryRows>[0],
  rows: { id: string; avatarId: string | null }[],
): Promise<void> {
  for (const r of rows)
    await db.execute(sql`insert into users (id, firebase_uid, display_name, avatar_id)
                         values (${r.id}, ${`f-${r.id}`}, ${`u_${r.id}`}, ${r.avatarId})`);
}

describe('migration 0004: the first avatar pack is retired (spec §3.4)', () => {
  const MIGRATION = path.join(findMigrationsFolder(), '0004_legacy_avatars.sql');
  const foldersBefore0004 = () => foldersBefore(4);

  it('maps exactly the pairs of LEGACY_AVATAR_MAP', () => {
    const pairs = [...readFileSync(MIGRATION, 'utf8').matchAll(/WHEN '(av\d\d)' THEN '([a-z0-9-]+)'/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(pairs).toEqual(LEGACY_AVATAR_IDS.map((id) => [id, LEGACY_AVATAR_MAP[id]]));
  });

  it('rewrites an old avatar id in users to its replacement and leaves every other value alone', async () => {
    const migrations = foldersBefore0004();
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      const others: Record<string, string | null> = {
        new: 'noam',
        none: null,
        unknown: 'av36',
        blank: 'av00',
      };
      await insertOldUsers(before.db, [
        ...LEGACY_AVATAR_IDS.map((id) => ({ id, avatarId: id })),
        ...Object.entries(others).map(([id, avatarId]) => ({ id, avatarId })),
      ]);
      await before.close();

      const after = await createDb({ database: { kind: 'pglite', dataDir } });
      const rows = await after.db.select({ id: users.id, avatarId: users.avatarId }).from(users);
      await after.close();
      const byId = new Map(rows.map((r) => [r.id, r.avatarId]));
      for (const id of LEGACY_AVATAR_IDS) expect([id, byId.get(id)]).toEqual([id, LEGACY_AVATAR_MAP[id]]);
      for (const [id, avatarId] of Object.entries(others)) expect([id, byId.get(id)]).toEqual([id, avatarId]);
    } finally {
      rmSync(migrations, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('migration 0005: moderation (spec §3.5)', () => {
  it('adds the reports, blocks and audit tables, and existing accounts are neither suspended nor reset', async () => {
    const migrations = foldersBefore(5);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      await insertOldUsers(before.db, [
        { id: 'ana', avatarId: 'noam' },
        { id: 'ben', avatarId: null },
      ]);
      await before.close();

      const after = await createDb({ database: { kind: 'pglite', dataDir } });
      try {
        const rows = await after.db
          .select({ id: users.id, suspendedAt: users.suspendedAt, reset: users.nameResetRequired })
          .from(users)
          .orderBy(users.id);
        expect(rows).toEqual([
          { id: 'ana', suspendedAt: null, reset: false },
          { id: 'ben', suspendedAt: null, reset: false },
        ]);
        // One open report per reporter, player and reason; a closed one doesn't count.
        const report = (status: string) =>
          after.db.execute(sql`insert into player_reports (id, reporter_id, reported_id, reason, status)
                               values (gen_random_uuid()::text, 'ana', 'ben', 'cheating', ${status})`);
        await report('open');
        await expect(report('open')).rejects.toThrow();
        await report('resolved');
        await report('dismissed');
        // The checks: a known reason and status, never about oneself; a block is one row a pair, not of oneself.
        await expect(
          after.db.execute(sql`insert into player_reports (id, reporter_id, reported_id, reason)
                               values ('r1', 'ana', 'ben', 'spam')`),
        ).rejects.toThrow();
        await expect(
          after.db.execute(sql`insert into player_reports (id, reporter_id, reported_id, reason)
                               values ('r2', 'ana', 'ana', 'other')`),
        ).rejects.toThrow();
        await after.db.execute(sql`insert into user_blocks (blocker_id, blocked_id) values ('ana', 'ben')`);
        await expect(
          after.db.execute(sql`insert into user_blocks (blocker_id, blocked_id) values ('ana', 'ben')`),
        ).rejects.toThrow();
        await expect(
          after.db.execute(sql`insert into user_blocks (blocker_id, blocked_id) values ('ana', 'ana')`),
        ).rejects.toThrow();
        await after.db.execute(sql`insert into admin_audit (admin_email, action, target_user_id)
                                   values ('admin@example.com', 'suspend', 'ben')`);
        const [audit] = await queryRows<{ id: number; details: unknown }>(
          after.db,
          sql`select id::int as id, details from admin_audit`,
        );
        expect(audit).toEqual({ id: 1, details: {} });
      } finally {
        await after.close();
      }
    } finally {
      rmSync(migrations, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('migration 0006: retired names and suspended sign-ins (spec §3.5)', () => {
  it('adds both tables, empty, on a database that has 0005 already', async () => {
    const migrations = foldersBefore(6);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      await insertOldUsers(before.db, [{ id: 'ana', avatarId: null }]);
      await before.close();

      const after = await createDb({ database: { kind: 'pglite', dataDir } });
      try {
        const count = async (table: string) =>
          (
            await queryRows<{ n: number }>(
              after.db,
              sql`select count(*)::int as n from ${sql.identifier(table)}`,
            )
          )[0]?.n;
        expect([await count('retired_names'), await count('suspended_sign_ins')]).toEqual([0, 0]);
        await after.db.execute(sql`insert into retired_names (name_key) values ('ana')`);
        await expect(
          after.db.execute(sql`insert into retired_names (name_key) values ('ana')`),
        ).rejects.toThrow();
        await after.db.execute(sql`insert into suspended_sign_ins (fingerprint, user_id, suspended_at)
                                   values ('f1', 'ana', now())`);
        // The fingerprint names a deleted account's row, which stays: one that isn't there is refused.
        await expect(
          after.db.execute(sql`insert into suspended_sign_ins (fingerprint, user_id, suspended_at)
                               values ('f2', 'nobody', now())`),
        ).rejects.toThrow();
      } finally {
        await after.close();
      }
    } finally {
      rmSync(migrations, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('migration 0007: retired puzzles (spec §20) [D43]', () => {
  it('keeps every puzzle of a database that has 0006 already, all of them still in the pool', async () => {
    const migrations = foldersBefore(7);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      for (const id of ['p1', 'p2'])
        await before.db
          .execute(sql`insert into puzzles (id, givens, solution, game_type, givens_count, source, pool)
                                    values (${id}, ${'0'.repeat(81)}, ${'1'.repeat(81)}, 'fast', 17, 'old', 'ranked')`);
      await before.close();

      const after = await createDb({ database: { kind: 'pglite', dataDir } });
      try {
        const rows = await after.db
          .select({ id: puzzles.id, retiredAt: puzzles.retiredAt })
          .from(puzzles)
          .orderBy(puzzles.id);
        expect(rows).toEqual([
          { id: 'p1', retiredAt: null },
          { id: 'p2', retiredAt: null },
        ]);
      } finally {
        await after.close();
      }
    } finally {
      rmSync(migrations, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('one process per PGlite folder', () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'sudoku-lock-')), 'pglite');
  });
  afterEach(() => rmSync(path.dirname(dir), { recursive: true, force: true }));

  /** A pid that surely belongs to no running process: a child that has already exited. */
  const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

  it('a second open is refused while the first holds the folder, and allowed after it lets go', () => {
    const release = lockDataDir(dir);
    expect(readFileSync(lockFileOf(dir), 'utf8')).toBe(String(process.pid));
    expect(() => lockDataDir(dir)).toThrow(DataDirLockedError);
    release();
    release(); // twice is harmless
    expect(existsSync(lockFileOf(dir))).toBe(false);
    lockDataDir(dir)();
  });

  it('another live process holding it: createDb refuses before opening anything, and says what to do', async () => {
    writeFileSync(lockFileOf(dir), String(process.ppid)); // Jest's parent process: alive
    const opening = createDb({ database: { kind: 'pglite', dataDir: dir } });
    await expect(opening).rejects.toThrow(DataDirLockedError);
    await expect(opening).rejects.toThrow(`(pid ${process.ppid})`);
    await expect(opening).rejects.toThrow('stop the other one first');
    expect(readFileSync(lockFileOf(dir), 'utf8')).toBe(String(process.ppid)); // not ours to remove
  });

  it('a lock left by a process that died is taken over', () => {
    writeFileSync(lockFileOf(dir), String(deadPid()));
    const release = lockDataDir(dir);
    expect(readFileSync(lockFileOf(dir), 'utf8')).toBe(String(process.pid));
    release();
    writeFileSync(lockFileOf(dir), 'garbage');
    lockDataDir(dir)();
  });

  it('createDb holds the lock while open and lets go on close', async () => {
    const database = await createDb({ database: { kind: 'pglite', dataDir: dir } });
    expect(readFileSync(lockFileOf(dir), 'utf8')).toBe(String(process.pid));
    await expect(createDb({ database: { kind: 'pglite', dataDir: dir } })).rejects.toThrow(
      DataDirLockedError,
    );
    await database.close();
    expect(existsSync(lockFileOf(dir))).toBe(false);
  }, 30_000);
});
