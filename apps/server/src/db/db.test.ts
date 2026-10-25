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
      'level_xp_days',
      'opponent_history',
      'personas',
      'player_reports',
      'practice_results',
      'puzzle_history',
      'puzzles',
      'qa_items',
      'qa_runs',
      'ratings',
      'retired_names',
      'server_settings',
      'suspended_sign_ins',
      'user_achievements',
      'user_blocks',
      'user_levels',
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

  it("a level's best is a level id and 0–3 stars (staged practice, 1.0.2)", async () => {
    await t.db.insert(users).values({ id: 'ana', firebaseUid: 'f-ana', displayName: 'ana' });
    const level = (id: string, stars: number, plays = 1) =>
      t.db.execute(sql`insert into user_levels (user_id, level_id, best_stars, plays)
                       values ('ana', ${id}, ${stars}, ${plays})`);
    await level('L001', 3);
    await level('L1000', 0);
    for (const [id, stars, plays] of [
      ['X1', 1, 1],
      ['L01', 1, 1],
      ['l002', 1, 1],
      ['L002', 4, 1],
      ['L003', -1, 1],
      ['L004', 1, -1],
    ] as const)
      await expect(level(id, stars, plays)).rejects.toThrow();
    await expect(level('L001', 2)).rejects.toThrow(); // one row a level
    await t.db.execute(sql`insert into level_xp_days (user_id, day, xp) values ('ana', 20370, 50)`);
    await expect(
      t.db.execute(sql`insert into level_xp_days (user_id, day, xp) values ('ana', 20370, 10)`),
    ).rejects.toThrow();
    await expect(
      t.db.execute(sql`insert into level_xp_days (user_id, day, xp) values ('nobody', 20370, 10)`),
    ).rejects.toThrow();
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

describe('migration 0008: staged practice (spec §5.3.7, §15; 1.0.2)', () => {
  it('adds user_levels and level_xp_days, empty, on a database that has 0007 already', async () => {
    const migrations = foldersBefore(8);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      await insertOldUsers(before.db, [{ id: 'ana', avatarId: null }]);
      await before.db.execute(sql`insert into xp (user_id, level, xp) values ('ana', 2, 250)`);
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
        expect([await count('user_levels'), await count('level_xp_days')]).toEqual([0, 0]);
        // The rest is as it was.
        expect(await queryRows(after.db, sql`select user_id, level, xp from xp`)).toEqual([
          { user_id: 'ana', level: 2, xp: 250 },
        ]);
        await after.db.execute(sql`insert into user_levels (user_id, level_id, best_stars, plays)
                                   values ('ana', 'L010', 2, 3)`);
        await after.db.execute(sql`insert into level_xp_days (user_id, day, xp) values ('ana', 20370, 20)`);
        await expect(
          after.db.execute(sql`insert into user_levels (user_id, level_id, best_stars, plays)
                               values ('ana', 'L011', 4, 1)`),
        ).rejects.toThrow();
        const [row] = await queryRows<{ updated: boolean }>(
          after.db,
          sql`select updated_at is not null as updated from user_levels`,
        );
        expect(row).toEqual({ updated: true });
      } finally {
        await after.close();
      }
    } finally {
      rmSync(migrations, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('migration 0009: friends rooms (1.0.4) [D81a]', () => {
  it('adds game_players.xp, null on the seats a database with 0008 already has', async () => {
    const migrations = foldersBefore(9);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      await insertOldUsers(before.db, [{ id: 'ana', avatarId: null }]);
      await before.db
        .execute(sql`insert into puzzles (id, givens, solution, game_type, givens_count, source, pool)
                                  values ('p1', ${'0'.repeat(81)}, ${'1'.repeat(81)}, 'fast', 0, 'test', 'ranked')`);
      await before.db
        .execute(sql`insert into games (id, mode, game_type, player_count, puzzle_id, rules, started_at)
                                  values ('g1', 'ranked', 'fast', 2, 'p1', '{}', now())`);
      await before.db.execute(sql`insert into game_players (game_id, user_id, seat, status, place)
                                  values ('g1', 'ana', 0, 'active', 1)`);
      await before.close();

      const after = await createDb({ database: { kind: 'pglite', dataDir } });
      try {
        expect(await queryRows(after.db, sql`select game_id, seat, place, xp from game_players`)).toEqual([
          { game_id: 'g1', seat: 0, place: 1, xp: null },
        ]);
        await after.db.execute(sql`update game_players set xp = 53 where game_id = 'g1'`);
        expect(await queryRows(after.db, sql`select xp from game_players`)).toEqual([{ xp: 53 }]);
      } finally {
        await after.close();
      }
    } finally {
      rmSync(migrations, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('migration 0010: the stealth bot (stealth-bot.md §6, §7, §8) [D90, D96]', () => {
  it('every account is a person, every game not stealth and without a pace; personas and server_settings start empty', async () => {
    const migrations = foldersBefore(10);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      await insertOldUsers(before.db, [{ id: 'ana', avatarId: 'moon' }]);
      await before.db
        .execute(sql`insert into puzzles (id, givens, solution, game_type, givens_count, source, pool)
                                  values ('p1', ${'0'.repeat(81)}, ${'1'.repeat(81)}, 'fast', 0, 'test', 'ranked')`);
      await before.db
        .execute(sql`insert into games (id, mode, game_type, player_count, puzzle_id, rules, started_at)
                                  values ('g1', 'ranked', 'fast', 2, 'p1', '{}', now())`);
      await before.db.execute(sql`insert into game_players (game_id, user_id, seat, status, place, mistakes)
                                  values ('g1', 'ana', 0, 'active', 1, 2)`);
      await before.close();

      const after = await createDb({ database: { kind: 'pglite', dataDir } });
      try {
        expect(await queryRows(after.db, sql`select id, kind from users`)).toEqual([
          { id: 'ana', kind: 'person' },
        ]);
        expect(await queryRows(after.db, sql`select id, stealth from games`)).toEqual([
          { id: 'g1', stealth: false },
        ]);
        expect(
          await queryRows(after.db, sql`select mistakes, pace_ms, pace_moves, pace_digits from game_players`),
        ).toEqual([{ mistakes: 2, pace_ms: null, pace_moves: null, pace_digits: null }]);
        const count = async (table: string) =>
          (
            await queryRows<{ n: number }>(
              after.db,
              sql`select count(*)::int as n from ${sql.identifier(table)}`,
            )
          )[0]?.n;
        expect([await count('personas'), await count('server_settings')]).toEqual([0, 0]);

        // A persona: its users row and its personas row; a kind or a temperament out of the list is refused.
        await after.db.execute(sql`insert into users (id, firebase_uid, display_name, kind)
                                   values ('p-1', 'persona:p-1', 'Tal88', 'persona')`);
        await after.db.execute(sql`insert into personas (user_id, temperament) values ('p-1', 'quiet')`);
        await expect(
          after.db.execute(sql`insert into users (id, firebase_uid, display_name, kind)
                               values ('x', 'x', 'Xyz', 'robot')`),
        ).rejects.toThrow();
        await expect(
          after.db.execute(sql`insert into personas (user_id, temperament) values ('ana', 'grumpy')`),
        ).rejects.toThrow();
        // A persona's name is taken like anyone's.
        await expect(
          after.db.execute(
            sql`insert into users (id, firebase_uid, display_name) values ('y', 'y', 'TAL88')`,
          ),
        ).rejects.toThrow();
        await after.db.execute(
          sql`update game_players set pace_ms = 9200, pace_moves = 31, pace_digits = 33`,
        );
        await after.db.execute(sql`insert into server_settings (key, value) values ('stealthBot', 'true')`);
        expect(await queryRows(after.db, sql`select key, value from server_settings`)).toEqual([
          { key: 'stealthBot', value: true },
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

describe('migration 0011: the QA module (docs/handoff/2026-10-23/qa-module/plan.md)', () => {
  it('adds qa_runs and qa_items, empty, and leaves the rest as it was; an item goes with its run', async () => {
    const migrations = foldersBefore(11);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      await insertOldUsers(before.db, [{ id: 'ana', avatarId: 'moon' }]);
      await before.close();

      const after = await createDb({ database: { kind: 'pglite', dataDir } });
      try {
        expect(await queryRows(after.db, sql`select id, kind from users`)).toEqual([
          { id: 'ana', kind: 'person' },
        ]);
        const count = async (table: string) =>
          (
            await queryRows<{ n: number }>(
              after.db,
              sql`select count(*)::int as n from ${sql.identifier(table)}`,
            )
          )[0]?.n;
        expect([await count('qa_runs'), await count('qa_items')]).toEqual([0, 0]);

        // A run: integer ids from 1, open by default; a platform or status out of the list is refused.
        const [run] = await queryRows<{ id: number; status: string }>(
          after.db,
          sql`insert into qa_runs (title, app_version, platform, engine_version, catalog_version, filter, created_by)
              values ('בדיקת 1.0.5', '1.0.5', 'android', '0.4.0', 1, '{"who":"all","categories":null}', 'claude')
              returning id, status`,
        );
        expect(run).toEqual({ id: 1, status: 'open' });
        await expect(
          after.db
            .execute(sql`insert into qa_runs (title, app_version, platform, engine_version, catalog_version,
                                 filter, created_by) values ('x', '1', 'web', '0', 1, '{}', 'claude')`),
        ).rejects.toThrow();
        await expect(after.db.execute(sql`update qa_runs set status = 'paused'`)).rejects.toThrow();

        // Its items: untested by default, one per task; a result, who or bug state out of the list is refused.
        const item = (taskId: string, who = 'both') =>
          after.db
            .execute(sql`insert into qa_items (run_id, position, category_id, category_title, subcategory_id,
                                 subcategory_title, task_id, title, steps, expected, who)
                               values (1, 0, 'friends', 'חברים', 'friends-room', 'חדר', ${taskId}, 'פתיחת חדר',
                                 '["פותחים"]', '["נפתח"]', ${who})`);
        await item('friends-room-create');
        expect(await queryRows(after.db, sql`select task_id, result, bug_status from qa_items`)).toEqual([
          { task_id: 'friends-room-create', result: 'untested', bug_status: null },
        ]);
        await expect(item('friends-room-create')).rejects.toThrow(); // one row per task of a run
        await expect(item('friends-room-join', 'everyone')).rejects.toThrow();
        await expect(after.db.execute(sql`update qa_items set result = 'skipped'`)).rejects.toThrow();
        await expect(after.db.execute(sql`update qa_items set bug_status = 'fixed'`)).rejects.toThrow();
        await after.db.execute(
          sql`update qa_items set result = 'fail', actual = 'לא נפתח', bug_status = 'open'`,
        );

        await after.db.execute(sql`delete from qa_runs where id = 1`);
        expect(await count('qa_items')).toBe(0);
      } finally {
        await after.close();
      }
    } finally {
      rmSync(migrations, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('migration 0012: a QA task subtitle (docs/handoff/2026-10-23/qa-module/plan.md)', () => {
  it('adds qa_items.subtitle, null on the items of a run opened before it; a new item may carry one', async () => {
    const migrations = foldersBefore(12);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-pglite-'));
    try {
      const before = await createDb(
        { database: { kind: 'pglite', dataDir } },
        { migrationsFolder: migrations },
      );
      await before.db
        .execute(sql`insert into qa_runs (title, app_version, engine_version, catalog_version, filter, created_by)
                     values ('בדיקת 1.0.5', '1.0.5', '0.4.0', 1, '{"who":"all","categories":null}', 'claude')`);
      await before.db
        .execute(sql`insert into qa_items (run_id, position, category_id, category_title, subcategory_id,
                             subcategory_title, task_id, title, steps, expected, who, result)
                           values (1, 0, 'friends', 'חברים', 'friends-room', 'חדר', 'friends-room-create',
                             'פתיחת חדר', '["פותחים"]', '["נפתח"]', 'both', 'pass')`);
      await before.close();

      const after = await createDb({ database: { kind: 'pglite', dataDir } });
      try {
        expect(await queryRows(after.db, sql`select task_id, title, subtitle, result from qa_items`)).toEqual(
          [{ task_id: 'friends-room-create', title: 'פתיחת חדר', subtitle: null, result: 'pass' }],
        );
        await after.db
          .execute(sql`insert into qa_items (run_id, position, category_id, category_title, subcategory_id,
                               subcategory_title, task_id, title, subtitle, steps, expected, who)
                             values (1, 1, 'friends', 'חברים', 'friends-room', 'חדר', 'friends-room-join',
                               'הצטרפות לחדר', 'בדוק הצטרפות לחדר עם קוד', '["מצטרפים"]', '["נכנס"]', 'both')`);
        expect(
          await queryRows(after.db, sql`select task_id, subtitle from qa_items order by position`),
        ).toEqual([
          { task_id: 'friends-room-create', subtitle: null },
          { task_id: 'friends-room-join', subtitle: 'בדוק הצטרפות לחדר עם קוד' },
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
