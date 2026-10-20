import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  ADMIN_API_PREFIX,
  ADMIN_STEALTH_PATH,
  ADMIN_STEALTH_SWITCH_PATH,
  type AdminAuditEntry,
  type AdminGameRow,
  type AdminModerationResult,
  type AdminOverview,
  type AdminPage,
  type AdminReportedPlayer,
  type AdminStealthSwitch,
  type AdminStealthSwitchResult,
  type AdminUserDetail,
  type AdminUserRow,
  type TelemetryProps,
} from '@sudoku-fight/protocol';
import express from 'express';

import { defaultBlockedWords } from '../accounts/blockedWords';
import { checkName } from '../accounts/names';
import {
  adminAudit,
  appEvents,
  gamePlayers,
  games,
  installs,
  playerReports,
  puzzles,
  retiredNames,
  serverSettings,
  userBlocks,
  users,
} from '../db/schema';
import { jsonErrorHandler } from '../http/errors';
import type { ModerationTools } from '../moderation/admin';
import { retireName } from '../moderation/store';
import { type AdminClient, signedInAdmin } from '../testing/admin';
import { fakeClock } from '../testing/clock';
import { TEST_SESSION_SECRET, TEST_ADMIN_PASSWORD, testConfig, testGoogleAdmin } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { testTokens, type TestTokens } from '../testing/tokens';
import { dbStealthSwitchStore, STEALTH_BOT_SETTING, StealthSwitch } from '../stealth/switch';
import { createAdminRouter } from './router';

/**
 * The stealth bot on the admin site (stealth-bot.md §8) [D90]: the overview's numbers on a dataset worked out
 * by hand below, the persona and stealth marks of the users, games and reports, the users' `kind` filter and
 * the games' `stealth` filter, the switch (the server's own, src/stealth/switch.ts, on server_settings) with
 * its audit entries, and a persona's name reset (with a stand-in for the names, and with the server's own).
 * Now: 2026-10-09 12:00 UTC = 15:00 in Jerusalem; a 3-day window starts at 00:00 on the 7th in Jerusalem
 * (21:00 UTC on the 6th).
 */

const NOW = Date.UTC(2026, 9, 9, 12);
const at = (iso: string) => new Date(iso);

let t: TestDb;
let tokens: TestTokens;
const servers: Server[] = [];

/** The server's switch on this database (STEALTH_BOT_ENABLED = `available`), counting its writes. */
function serverSwitch(available: boolean): { control: StealthSwitch; writes: () => number } {
  const store = dbStealthSwitchStore(() => t.db);
  let writes = 0;
  const control = new StealthSwitch({
    available,
    store: {
      read: () => store.read(),
      write: (record) => {
        writes++;
        return store.write(record);
      },
    },
    now: () => NOW,
    log: { error: () => {} },
  });
  return { control, writes: () => writes };
}

/** The persona names a name reset draws, in order. */
const inventions: string[] = [];
/** 'stub': the names above; 'server': the server's own (the router's default tools); 'none': no persona names. */
type Names = 'stub' | 'server' | 'none';
const tools = (names: Names): ModerationTools | undefined =>
  names === 'server'
    ? undefined
    : {
        blockedWords: defaultBlockedWords(),
        random: (n) => Math.min(n - 1, 2345),
        ...(names === 'stub'
          ? { personaName: () => Promise.resolve(inventions.shift() ?? 'Shira_B') }
          : null),
      };

async function serve({
  control,
  google = false,
  names = 'stub',
}: { control?: StealthSwitch; google?: boolean; names?: Names } = {}): Promise<string> {
  const clock = fakeClock(NOW);
  const app = express();
  app.use(
    createAdminRouter({
      config: testConfig(
        google
          ? {
              admin: {
                enabled: true,
                password: TEST_ADMIN_PASSWORD,
                devPassword: false,
                google: testGoogleAdmin(),
                sessionSecret: TEST_SESSION_SECRET,
              },
            }
          : {},
      ),
      db: t.db,
      now: clock.now,
      tokens: tokens.verifier(clock.now),
      log: () => {},
      moderationTools: tools(names),
      ...(control === undefined ? null : { stealthSwitch: control }),
    }),
  );
  app.use(jsonErrorHandler);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let url: string;
let admin: AdminClient;

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  url = await serve();
  admin = await signedInAdmin(url);
}, 30_000);
afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  await t.close();
});

async function post<T>(base: string, cookie: string, path: string, body: string, type = 'application/json') {
  const res = await fetch(`${base}${ADMIN_API_PREFIX}${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': type },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: (text === '' ? null : JSON.parse(text)) as T & { error?: string } };
}

// ---- the dataset ------------------------------------------------------------------------------------------------

const person = (id: string, displayName: string, deleted = false) => ({
  id,
  firebaseUid: `uid-${id}`,
  displayName,
  createdAt: at('2026-10-01T09:00:00Z'),
  deletedAt: deleted ? at('2026-10-02T09:00:00Z') : null,
});
const persona = (id: string, displayName: string, deleted = false) => ({
  ...person(id, displayName, deleted),
  firebaseUid: `persona:${id}`,
  kind: 'persona' as const,
  country: 'IL',
  avatarId: 'lava-lamp',
});

interface G {
  id: string;
  mode?: string;
  stealth?: boolean;
  start: string;
  end: string | null;
  endReason?: string;
  /** [userId, place] in seat order. */
  seats: [string, number | null][];
}

/**
 * Ranked games in the window: s5, s1, h1, s2, h3, h2, s3 (7); against the stealth bot: s5, s1, s2, s3 (4) on
 * the 7th, 8th, 8th and 9th in Jerusalem. s4 is before the window, f1 a friends game.
 */
const GAMES: G[] = [
  {
    id: 's4',
    stealth: true,
    start: '2026-10-05T10:00:00Z',
    end: '2026-10-05T10:05:00Z',
    seats: [
      ['ana', 1],
      ['p2', 2],
    ],
  },
  {
    id: 's5',
    stealth: true,
    start: '2026-10-07T09:00:00Z',
    end: '2026-10-07T09:05:00Z',
    seats: [
      ['cyd', 1],
      ['p2', 2],
    ],
  },
  {
    id: 's1',
    stealth: true,
    start: '2026-10-08T10:00:00Z',
    end: '2026-10-08T10:05:00Z',
    seats: [
      ['ana', 1],
      ['p1', 2],
    ],
  },
  // Ana is back 3 minutes after s1.
  {
    id: 'h1',
    start: '2026-10-08T10:08:00Z',
    end: '2026-10-08T10:13:00Z',
    seats: [
      ['ana', 1],
      ['ben', 2],
    ],
  },
  {
    id: 's2',
    stealth: true,
    start: '2026-10-08T11:00:00Z',
    end: '2026-10-08T11:06:00Z',
    seats: [
      ['p2', 1],
      ['ben', 2],
    ],
  },
  // Ben is back 4 minutes after s2, with friends: that counts as playing again.
  {
    id: 'f1',
    mode: 'friends',
    start: '2026-10-08T11:10:00Z',
    end: '2026-10-08T11:15:00Z',
    seats: [
      ['ben', 1],
      ['cyd', 2],
    ],
  },
  // Cut short by a restart: not a game anyone chose to leave.
  {
    id: 'h3',
    start: '2026-10-08T12:00:00Z',
    end: '2026-10-08T12:01:00Z',
    endReason: 'serverRestart',
    seats: [
      ['ana', null],
      ['cyd', null],
    ],
  },
  // Ended 8 minutes ago: too soon to say whether they come back.
  {
    id: 'h2',
    start: '2026-10-09T11:45:00Z',
    end: '2026-10-09T11:52:00Z',
    seats: [
      ['cyd', 1],
      ['ana', 2],
    ],
  },
  // Still running.
  {
    id: 's3',
    stealth: true,
    start: '2026-10-09T11:55:00Z',
    end: null,
    seats: [
      ['cyd', null],
      ['p1', null],
    ],
  },
];

let eventNo = 0;
function wait(installId: string, iso: string, props: TelemetryProps, userId: string | null = null) {
  eventNo++;
  return {
    id: `e${eventNo}`,
    installId,
    userId,
    name: 'matchmaking_wait' as const,
    props,
    tClient: at(iso),
    tServer: at('2026-10-09T11:59:00Z'), // a batch sent later
  };
}

beforeEach(async () => {
  await t.reset();
  inventions.length = 0;
  await t.db
    .insert(users)
    .values([
      person('ana', 'Ana'),
      person('ben', 'Ben'),
      person('cyd', 'Cyd'),
      person('gone', 'Gone', true),
      persona('p1', 'Noa_K'),
      persona('p2', 'Tal88'),
      persona('p3', 'Old_P', true),
    ]);
  await t.db.insert(puzzles).values({
    id: 'p1',
    givens: '0'.repeat(81),
    solution: '1'.repeat(81),
    gameType: 'fast',
    givensCount: 0,
    source: 'test',
    pool: 'ranked',
  });
  for (const g of GAMES) {
    await t.db.insert(games).values({
      id: g.id,
      mode: g.mode ?? 'ranked',
      gameType: 'fast',
      playerCount: g.seats.length,
      puzzleId: 'p1',
      rules: {},
      startedAt: at(g.start),
      endedAt: g.end === null ? null : at(g.end),
      endReason: g.end === null ? null : (g.endReason ?? 'boardComplete'),
      stealth: g.stealth ?? false,
    });
    await t.db
      .insert(gamePlayers)
      .values(
        g.seats.map(([userId, place], seat) => ({ gameId: g.id, userId, seat, place, status: 'active' })),
      );
  }
  const install = (id: string, userId: string | null) => ({
    id,
    platform: 'android' as const,
    appVersion: '1.0.4',
    firstSeen: at('2026-10-01T09:00:00Z'),
    lastSeen: at('2026-10-09T11:59:00Z'),
    userId,
  });
  await t.db
    .insert(installs)
    .values([install('ia', 'ana'), install('ib', 'ben'), install('ic', 'cyd'), install('ix', null)]);
  await t.db.insert(appEvents).values([
    // s1, Ana: found 10 seconds before the start.
    wait('ia', '2026-10-08T09:59:50Z', { sec: 14, result: 'found' }),
    // h1: Ana 3 s, Ben 5 s.
    wait('ia', '2026-10-08T10:07:55Z', { sec: 3, result: 'found' }),
    wait('ib', '2026-10-08T10:07:58Z', { sec: 5, result: 'found' }),
    // s2, Ben: an earlier "found" (a ready check that failed), the later one counts; a timeout never does.
    wait('ib', '2026-10-08T10:59:00Z', { sec: 99, result: 'found' }),
    wait('ib', '2026-10-08T10:59:30Z', { sec: 20, result: 'found' }),
    wait('ib', '2026-10-08T10:59:40Z', { sec: 60, result: 'timeout' }),
    // s5, Cyd: from an install not linked to him, sent signed in as him.
    wait('ix', '2026-10-07T08:59:00Z', { sec: 8, result: 'found' }, 'cyd'),
    // h3, Cyd: not a number.
    wait('ic', '2026-10-08T11:59:30Z', { sec: '12', result: 'found' }),
    // 5 minutes before h2 and 15 before s3: too early to be the wait of either.
    wait('ic', '2026-10-09T11:40:00Z', { sec: 30, result: 'found' }),
  ]);
  await t.db.insert(playerReports).values([
    {
      reporterId: 'ana',
      reportedId: 'p1',
      reason: 'cheating',
      gameId: 's1',
      createdAt: at('2026-10-08T10:06:00Z'),
    },
    { reporterId: 'ben', reportedId: 'ana', reason: 'other', createdAt: at('2026-10-08T10:14:00Z') },
    // Before the window.
    { reporterId: 'cyd', reportedId: 'p2', reason: 'other', createdAt: at('2026-10-05T10:06:00Z') },
  ]);
  await t.db.insert(userBlocks).values([
    { blockerId: 'ben', blockedId: 'p2', createdAt: at('2026-10-08T11:07:00Z') },
    { blockerId: 'cyd', blockedId: 'ana', createdAt: at('2026-10-08T11:07:00Z') },
    { blockerId: 'cyd', blockedId: 'p1', createdAt: at('2026-10-01T11:07:00Z') },
  ]);
});

const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id);

// ---- the overview -------------------------------------------------------------------------------------------------

describe('GET /admin/api/overview: the stealth bot', () => {
  it('counts people, not personas, among the users', async () => {
    const res = await admin.get<AdminOverview>('/overview', { days: 3 });
    // Ana, Ben, Cyd: not Gone (deleted), not the personas.
    expect(res.body.totals.users).toBe(3);
  });

  it("the share of games, the people's results, the waits, reports, blocks and who came back", async () => {
    const res = await admin.get<AdminOverview>('/overview', { days: 3 });
    expect(res.status).toBe(200);
    expect(res.body.stealth).toEqual({
      // p1, p2 (p3 is deleted).
      personas: 2,
      rankedGames: 7,
      stealthGames: 4,
      stealthPerDay: [
        { day: '2026-10-07', count: 1 },
        { day: '2026-10-08', count: 2 },
        { day: '2026-10-09', count: 1 },
      ],
      // Cyd won s5, Ana won s1, Ben lost s2 (the personas' places don't count; s3 has none yet).
      wins: 2,
      losses: 1,
      winRate: 2 / 3,
      wait: {
        // Ana 14 (s1), Ben 20 (s2), Cyd 8 (s5).
        stealth: { games: 3, avgSec: 14 },
        // Ana 3, Ben 5 (h1).
        people: { games: 2, avgSec: 4 },
      },
      // Ana's report of p1 and Ben's block of p2; the others are before the window, or of a person.
      reports: 1,
      blocks: 1,
      returned: {
        // s5 (Cyd: no), s1 (Ana: h1 after 3 minutes), s2 (Ben: f1 after 4 minutes).
        stealth: { games: 3, returned: 2 },
        // h1 (Ana and Ben: no); h3 was cut short, h2 ended 8 minutes ago.
        people: { games: 2, returned: 0 },
      },
      // No two stealth games within a minute of each other.
      closeCalls: 0,
    });
  });

  it('close calls: a stealth game within a minute after another person’s, of the same type (§3.5)', async () => {
    const stealthGame = async (id: string, iso: string, userId: string, gameType = 'fast') => {
      await t.db.insert(games).values({
        id,
        mode: 'ranked',
        gameType,
        playerCount: 2,
        puzzleId: 'p1',
        rules: {},
        startedAt: at(iso),
        endedAt: null,
        stealth: true,
      });
      await t.db.insert(gamePlayers).values([
        { gameId: id, userId, seat: 0, place: null, status: 'active' },
        { gameId: id, userId: 'p2', seat: 1, place: null, status: 'active' },
      ]);
    };
    // 40 s after Ana's s1 (10:00:00), Ben got one too: they might have played each other.
    await stealthGame('c1', '2026-10-08T10:00:40Z', 'ben');
    // 30 s after Ben's s2 (11:00:00), but a normal game: another queue.
    await stealthGame('c2', '2026-10-08T11:00:30Z', 'cyd', 'normal');
    // 2 minutes after s2: too long.
    await stealthGame('c3', '2026-10-08T11:02:00Z', 'ana');
    // 50 s after Cyd's s3 (11:55:00), Cyd again: the same person.
    await stealthGame('c4', '2026-10-09T11:55:50Z', 'cyd');
    // Inside the window, 30 s after a stealth game that started just before it (Jerusalem midnight of the 7th).
    await stealthGame('c5', '2026-10-06T20:59:50Z', 'ana');
    await stealthGame('c6', '2026-10-06T21:00:20Z', 'ben');
    const res = await admin.get<AdminOverview>('/overview', { days: 3 });
    expect(res.body.stealth?.closeCalls).toBe(2);
  });

  it('a window before the stealth bot: zeros and no rates', async () => {
    await t.db.delete(games);
    await t.db.delete(playerReports);
    await t.db.delete(userBlocks);
    const res = await admin.get<AdminOverview>('/overview', { days: 1 });
    expect(res.body.stealth).toEqual({
      personas: 2,
      rankedGames: 0,
      stealthGames: 0,
      stealthPerDay: [{ day: '2026-10-09', count: 0 }],
      wins: 0,
      losses: 0,
      winRate: null,
      wait: { stealth: { games: 0, avgSec: null }, people: { games: 0, avgSec: null } },
      reports: 0,
      blocks: 0,
      returned: { stealth: { games: 0, returned: 0 }, people: { games: 0, returned: 0 } },
      closeCalls: 0,
    });
  });
});

// ---- users, games, reports ---------------------------------------------------------------------------------------

describe('the personas on the users list and detail', () => {
  it('lists people by default, personas with kind=persona, both with kind=all', async () => {
    const people = await admin.get<AdminPage<AdminUserRow>>('/users');
    expect(ids(people.body).sort()).toEqual(['ana', 'ben', 'cyd', 'gone']);
    expect(people.body.total).toBe(4);
    expect(people.body.items.every((u) => u.persona === false)).toBe(true);

    const personas = await admin.get<AdminPage<AdminUserRow>>('/users', { kind: 'persona' });
    expect(ids(personas.body).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(personas.body.items.every((u) => u.persona === true)).toBe(true);
    expect(personas.body.items.find((u) => u.id === 'p1')).toMatchObject({
      displayName: 'Noa_K',
      email: null,
      country: 'IL',
      games: 2,
      persona: true,
    });

    const all = await admin.get<AdminPage<AdminUserRow>>('/users', { kind: 'all' });
    expect(all.body.total).toBe(7);
  });

  it('searches within the kind', async () => {
    expect(ids((await admin.get<AdminPage<AdminUserRow>>('/users', { search: 'Noa' })).body)).toEqual([]);
    const found = await admin.get<AdminPage<AdminUserRow>>('/users', { search: 'Noa', kind: 'persona' });
    expect(ids(found.body)).toEqual(['p1']);
  });

  it('refuses another kind', async () => {
    const res = await admin.get('/users', { kind: 'robot' });
    expect(res).toMatchObject({ status: 400, body: { error: 'badRequest' } });
  });

  it("a persona's detail says so, and a person's games say which were against the stealth bot", async () => {
    expect((await admin.get<AdminUserDetail>('/users/p1')).body).toMatchObject({ id: 'p1', persona: true });
    const ana = await admin.get<AdminUserDetail>('/users/ana');
    expect(ana.body.persona).toBe(false);
    expect(ana.body.recentGames.map((g) => [g.gameId, g.stealth])).toEqual([
      ['h2', false],
      ['h3', false],
      ['h1', false],
      ['s1', true],
      ['s4', true],
    ]);
  });
});

describe('the stealth games on the games list', () => {
  it("marks a stealth game and its persona's seat", async () => {
    const res = await admin.get<AdminGameRow>('/games/s1');
    expect(res.body).toMatchObject({
      id: 's1',
      stealth: true,
      players: [
        { userId: 'ana', displayName: 'Ana', persona: false },
        { userId: 'p1', displayName: 'Noa_K', persona: true },
      ],
    });
    expect((await admin.get<AdminGameRow>('/games/h1')).body.stealth).toBe(false);
  });

  it('filters: stealth=1 only those games, stealth=0 the others, with the mode too', async () => {
    const get = async (query: Record<string, string>) =>
      ids((await admin.get<AdminPage<AdminGameRow>>('/games', query)).body);
    expect(await get({ stealth: '1' })).toEqual(['s3', 's2', 's1', 's5', 's4']);
    expect(await get({ stealth: '0' })).toEqual(['h2', 'h3', 'f1', 'h1']);
    expect(await get({ stealth: '0', mode: 'ranked' })).toEqual(['h2', 'h3', 'h1']);
    expect(await get({ stealth: '' })).toHaveLength(GAMES.length);
    expect(await get({ stealth: '1', search: 'Noa' })).toEqual(['s3', 's1']);
  });

  it('refuses another value', async () => {
    expect(await admin.get('/games', { stealth: 'yes' })).toMatchObject({
      status: 400,
      body: { error: 'badRequest' },
    });
  });
});

describe('the reports about a persona', () => {
  it('are tagged', async () => {
    const res = await admin.get<AdminPage<AdminReportedPlayer>>('/reports', { status: 'all' });
    const byId = new Map(res.body.items.map((i) => [i.player.id, i.player]));
    expect(byId.get('p1')).toMatchObject({ displayName: 'Noa_K', persona: true });
    expect(byId.get('p2')).toMatchObject({ persona: true });
    expect(byId.get('ana')).toMatchObject({ persona: false });
  });
});

// ---- a persona's name reset ----------------------------------------------------------------------------------------

describe("a persona's name reset", () => {
  const reset = (base: string, cookie: string, id: string) =>
    post<AdminModerationResult>(base, cookie, `/users/${id}/reset-name`, '{}');

  it('gives it a new invented name at once: no temporary name, nothing to wait for', async () => {
    inventions.push('Lior_M');
    const res = await reset(url, admin.cookie, 'p1');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: 'p1',
      displayName: 'Lior_M',
      nameResetRequired: false,
      persona: true,
    });
    expect(res.body.audit).toMatchObject({
      action: 'resetName',
      targetUserId: 'p1',
      details: { fromName: 'Noa_K', toName: 'Lior_M', persona: true },
    });
    // The old name is retired, as a person's.
    expect(await t.db.select().from(retiredNames)).toHaveLength(1);
  });

  it('never a retired name, a taken one, or one the word filter blocks', async () => {
    await retireName(t.db, 'Gil22', NOW);
    inventions.push('Gil22', 'Ana', 'fuck_you', 'Omer7');
    const res = await reset(url, admin.cookie, 'p2');
    expect(res.body.user).toMatchObject({ displayName: 'Omer7', nameResetRequired: false });
    expect(inventions).toEqual([]);
  });

  it("a person's reset is unchanged: a temporary name and a new one to choose", async () => {
    const res = await reset(url, admin.cookie, 'ben');
    expect(res.body.user).toMatchObject({
      displayName: 'שחקן12345',
      nameResetRequired: true,
      persona: false,
    });
    expect(res.body.audit?.details).toEqual({ fromName: 'Ben', toName: 'שחקן12345' });
  });

  it("the server's own names: invented in a player's style, never a temporary one", async () => {
    const base = await serve({ names: 'server' });
    const res = await reset(base, (await signedInAdmin(base)).cookie, 'p1');
    expect(res.status).toBe(200);
    const name = res.body.user.displayName;
    expect(name).not.toBe('Noa_K');
    expect(name.startsWith('שחקן')).toBe(false);
    expect(checkName(name, defaultBlockedWords()).ok).toBe(true);
    expect(res.body.user).toMatchObject({ nameResetRequired: false, persona: true });
  });

  it('without the persona names (a server not wired to them): a temporary name, like a person', async () => {
    const base = await serve({ names: 'none' });
    const res = await reset(base, (await signedInAdmin(base)).cookie, 'p1');
    expect(res.body.user).toMatchObject({ displayName: 'שחקן12345', nameResetRequired: true, persona: true });
  });
});

// ---- the switch -----------------------------------------------------------------------------------------------------

describe('the switch: GET /stealth, POST /stealth/switch', () => {
  const OFF: AdminStealthSwitch = { enabled: false, on: false, changedAt: null, changedBy: null };
  const turn = (base: string, cookie: string, body: string, type?: string) =>
    post<AdminStealthSwitchResult>(base, cookie, ADMIN_STEALTH_SWITCH_PATH, body, type);

  it('a server without it, or with STEALTH_BOT_ENABLED off: no switch, and nothing to turn', async () => {
    expect((await admin.get(ADMIN_STEALTH_PATH)).body).toEqual(OFF);
    expect(await turn(url, admin.cookie, '{"on":true}')).toMatchObject({
      status: 409,
      body: { error: 'stealthDisabled' },
    });

    const { control, writes } = serverSwitch(false);
    const base = await serve({ control });
    const off = await signedInAdmin(base);
    expect((await off.get(ADMIN_STEALTH_PATH)).body).toEqual(OFF);
    expect((await turn(base, off.cookie, '{"on":true}')).status).toBe(409);
    expect(writes()).toBe(0);
    expect(await t.db.select().from(adminAudit)).toEqual([]);
  });

  it('turns it on and off, each change in the audit log; the same state again changes nothing', async () => {
    const { control } = serverSwitch(true);
    const base = await serve({ control });
    const signed = await signedInAdmin(base);
    expect((await signed.get(ADMIN_STEALTH_PATH)).body).toEqual({
      enabled: true,
      on: false,
      changedAt: null,
      changedBy: null,
    });

    const on = await turn(base, signed.cookie, '{"on":true}');
    expect(on.status).toBe(200);
    expect(on.body.switch).toEqual({ enabled: true, on: true, changedAt: NOW, changedBy: 'password' });
    expect(on.body.audit).toMatchObject({
      adminEmail: 'password',
      action: 'stealthSwitch',
      targetUserId: null,
      details: { on: true },
    });
    expect((await signed.get(ADMIN_STEALTH_PATH)).body).toMatchObject({ on: true });

    const again = await turn(base, signed.cookie, '{"on":true}');
    expect([again.status, again.body.audit]).toEqual([200, null]);

    // Kept where matchmaking reads it (server_settings), at once.
    expect(control.isOn()).toBe(true);
    expect(await t.db.select().from(serverSettings)).toEqual([
      expect.objectContaining({ key: STEALTH_BOT_SETTING, value: { enabled: true }, updatedBy: 'password' }),
    ]);

    const off = await turn(base, signed.cookie, '{"on":false}');
    expect(off.body.switch.on).toBe(false);
    expect(control.isOn()).toBe(false);
    const log = await signed.get<AdminPage<AdminAuditEntry>>('/audit');
    expect(log.body.items.map((e) => [e.action, e.details])).toEqual([
      ['stealthSwitch', { on: false }],
      ['stealthSwitch', { on: true }],
    ]);
  });

  it.each([
    ['no field', '{}', 'application/json'],
    ['not a boolean', '{"on":"yes"}', 'application/json'],
    ['another field', '{"on":true,"x":1}', 'application/json'],
    ['not JSON', 'on=true', 'application/x-www-form-urlencoded'],
  ])('refuses a body with %s (400), and turns nothing', async (_what, body, type) => {
    const { control, writes } = serverSwitch(true);
    const base = await serve({ control });
    const res = await turn(base, (await signedInAdmin(base)).cookie, body, type);
    expect([res.status, res.body.error]).toEqual([400, 'badRequest']);
    expect(writes()).toBe(0);
  });

  it('needs a session (401), and a Google one where Google sign-in is offered (403)', async () => {
    const { control, writes } = serverSwitch(true);
    const base = await serve({ control, google: true });
    expect((await turn(base, '', '{"on":true}')).status).toBe(401);
    const byPassword = await signedInAdmin(base);
    expect((await byPassword.get(ADMIN_STEALTH_PATH)).status).toBe(200);
    const refused = await turn(base, byPassword.cookie, '{"on":true}');
    expect([refused.status, refused.body.error]).toEqual([403, 'googleRequired']);
    expect([writes(), control.isOn()]).toEqual([0, false]);
  });

  it('GET /stealth answers no-store, like the rest of the admin API', async () => {
    const res = await fetch(`${url}${ADMIN_API_PREFIX}${ADMIN_STEALTH_PATH}`, {
      headers: { cookie: admin.cookie },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
