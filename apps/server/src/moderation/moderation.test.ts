import {
  ACCOUNT_PATHS,
  type AccountError,
  ADMIN_API_PREFIX,
  ADMIN_REPORTS_PER_PLAYER,
  type AdminAuditEntry,
  type AdminModerationResult,
  type AdminPage,
  type AdminReport,
  type AdminReportedPlayer,
  type AdminUserRow,
  blockPath,
  type BlockedPlayer,
  type BlockList,
  DISMISSED_REPORT_COOLDOWN_DAYS,
  type Leaderboard,
  MAX_BLOCKS,
  type Me,
  MODERATION_PATHS,
  type ModerationError,
  type NameAvailability,
  PROGRESS_PATHS,
  RENAME_COOLDOWN_MS,
  REPORTS_PER_HOUR,
  type ReportReceipt,
  type TelemetryResponse,
  TELEMETRY_PATH,
} from '@sudoku-fight/protocol';
import { createRng, type GameEvent } from '@sudoku-fight/engine';
import { eq } from 'drizzle-orm';

import { BlockedWords, defaultBlockedWords } from '../accounts/blockedWords';
import { checkName } from '../accounts/names';
import { deleteUser } from '../accounts/store';
import type { Db } from '../db';
import {
  adminAudit,
  gameEvents,
  games,
  playerReports,
  retiredNames,
  suspendedSignIns,
  userBlocks,
  users,
} from '../db/schema';
import { appendGameEvents } from '../persistence';
import { call, type CallOptions, fighter } from '../testing/accounts';
import { signedInAdmin, type AdminClient } from '../testing/admin';
import { fakeClock } from '../testing/clock';
import {
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
  testConfig,
  testGoogleAdmin,
} from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { startHttp, type TestHttp } from '../testing/http';
import { addGamePuzzle, addStoredGame, setRating } from '../testing/progress';
import { addAccounts, T0 } from '../testing/ranked';
import { testTokens, type TestTokens } from '../testing/tokens';
import { createPersona } from '../stealth/personas';
import { adminName, resetName, TEMPORARY_NAME_PREFIX, temporaryName } from './admin';
import { DEFAULT_MODERATION_LIMITS } from './router';
import { lockActor, signInFingerprints } from './store';
import { type BlockChange, BlockWatch } from './watch';

/**
 * Spec §3.5 (UGC-PROPOSAL option A, approved 2026-10-12): reports, blocks, and the admin's moderation over
 * HTTP, on PGlite: the routes, the limits, the duplicates, a suspension's effects, a name reset (and the
 * 30-day rule it lifts), the audit log, and what an account deletion leaves.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let t: TestDb;
let tokens: TestTokens;
let http: TestHttp;
let admin: AdminClient;
const clock = fakeClock(T0 + HOUR);
const watch = new BlockWatch();
const heard: BlockChange[] = [];
watch.subscribe((c) => heard.push(c));
/** The temporary names' digits come from here: a queue, then 12345 for ever. */
const draws: number[] = [];
const random = (n: number) => Math.min(n - 1, draws.shift() ?? 2345);

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
  http = await startHttp({
    config: testConfig(),
    db: t.db,
    now: clock.now,
    tokens: tokens.verifier(clock.now),
    adminSiteDir: null,
    blockWatch: watch,
    moderationTools: { blockedWords: defaultBlockedWords(), random },
    // Small enough to reach, big enough for the tests that send many.
    moderationLimits: { ...DEFAULT_MODERATION_LIMITS, writes: { limit: 200, windowMs: 60_000 } },
  });
  admin = await signedInAdmin(http.url);
}, 30_000);
afterAll(async () => {
  await http.close();
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  clock.set(T0 + HOUR);
  heard.length = 0;
  draws.length = 0;
  await addAccounts(t.db, [
    { id: 'ana', name: 'Ana' },
    { id: 'ben', name: 'Ben' },
    { id: 'cyd', name: 'Cyd' },
    { id: 'gone', name: 'Gone', deleted: true },
  ]);
});

const tokenOf = (id: string) => tokens.sign({ uid: `uid-${id}`, email: `${id}@example.com` }, clock.now());
async function api<T>(who: string | null, method: string, path: string, options: CallOptions = {}) {
  return call<T>(http.url, method, path, {
    ...options,
    token: who === null ? undefined : await tokenOf(who),
  });
}
const report = (who: string, body: unknown) =>
  api<ReportReceipt & ModerationError>(who, 'POST', MODERATION_PATHS.reports, { body });
const block = (who: string, playerId: string) =>
  api<BlockedPlayer & ModerationError>(who, 'POST', MODERATION_PATHS.blocks, { body: { playerId } });
const blocks = (who: string) => api<BlockList>(who, 'GET', MODERATION_PATHS.blocks);
const me = (who: string) => api<Me & AccountError>(who, 'GET', ACCOUNT_PATHS.me);
const rename = (who: string, displayName: string) =>
  api<Me & AccountError>(who, 'PATCH', ACCOUNT_PATHS.me, { body: { displayName } });

/** A moderation POST of the admin API, with the session cookie. */
async function adminPost<T>(path: string, body: string | null = '{}', type = 'application/json') {
  const headers: Record<string, string> = { cookie: admin.cookie };
  if (body !== null) headers['content-type'] = type;
  const res = await fetch(`${http.url}${ADMIN_API_PREFIX}${path}`, {
    method: 'POST',
    headers,
    body: body ?? undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

// ---------------------------------------------------------------------------------------------------------

describe('POST /v1/reports', () => {
  it('stores an open report and answers its receipt: 48 hours, no gameId without a shared game', async () => {
    const res = await report('ana', { playerId: 'ben', reason: 'offensiveName' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toEqual({
      id: expect.stringMatching(UUID),
      playerId: 'ben',
      reason: 'offensiveName',
      status: 'open',
      gameId: null,
      createdAt: T0 + HOUR,
      respondWithinHours: 48,
    });
    const rows = await t.db.select().from(playerReports);
    expect(rows).toMatchObject([
      { reporterId: 'ana', reportedId: 'ben', reason: 'offensiveName', status: 'open', gameId: null },
    ]);
  });

  it('keeps the gameId of a ranked game both sat in, and drops any other', async () => {
    await addGamePuzzle(t.db);
    await addStoredGame(t.db, {
      id: 'g-ab',
      endedAt: T0,
      seats: [
        { userId: 'ana', place: 1 },
        { userId: 'ben', place: 2 },
      ],
    });
    await addStoredGame(t.db, {
      id: 'g-ac',
      endedAt: T0,
      seats: [
        { userId: 'ana', place: 1 },
        { userId: 'cyd', place: 2 },
      ],
    });
    expect((await report('ana', { playerId: 'ben', reason: 'cheating', gameId: 'g-ab' })).body.gameId).toBe(
      'g-ab',
    );
    // Cyd was not in g-ab, nor Ben in g-ac; nobody in "nope": the reports still count, without the game.
    expect((await report('ana', { playerId: 'cyd', reason: 'cheating', gameId: 'g-ab' })).body.gameId).toBe(
      null,
    );
    expect((await report('ana', { playerId: 'ben', reason: 'other', gameId: 'g-ac' })).body.gameId).toBe(
      null,
    );
    const nope = await report('cyd', { playerId: 'ben', reason: 'other', gameId: 'nope' });
    expect([nope.status, nope.body.gameId]).toEqual([201, null]);
  });

  it('refuses a body that is not one, an unknown reason, a missing or extra field (400 with the field)', async () => {
    const cases: [unknown, string][] = [
      [[1, 2], 'body'],
      [{ reason: 'cheating' }, 'playerId'],
      [{ playerId: 'ben', reason: 'spam' }, 'reason'],
      [{ playerId: 'ben' }, 'reason'],
      [{ playerId: '../ben', reason: 'other' }, 'playerId'],
      [{ playerId: 'ben', reason: 'other', gameId: 'a/b' }, 'gameId'],
      [{ playerId: 'ben', reason: 'other', text: 'free text is not taken' }, 'body'],
    ];
    for (const [body, field] of cases) {
      const res = await report('ana', body);
      expect({ body, status: res.status, error: res.body.error, field: res.body.field }).toEqual({
        body,
        status: 400,
        error: 'badRequest',
        field,
      });
    }
    expect(await t.db.select().from(playerReports)).toEqual([]);
  });

  it('needs a token (401) and an account (404 notRegistered)', async () => {
    const none = await api<ModerationError>(null, 'POST', MODERATION_PATHS.reports, {
      body: { playerId: 'ben', reason: 'other' },
    });
    expect([none.status, none.body.error]).toEqual([401, 'unauthorized']);
    const stranger = await report('stranger', { playerId: 'ben', reason: 'other' });
    expect([stranger.status, stranger.body.error]).toEqual([404, 'notRegistered']);
  });

  it('refuses yourself (400 self), and a player who is not there or deleted (404 notFound)', async () => {
    const self = await report('ana', { playerId: 'ana', reason: 'other' });
    expect([self.status, self.body.error]).toEqual([400, 'self']);
    for (const playerId of ['nobody', 'gone']) {
      const res = await report('ana', { playerId, reason: 'other' });
      expect([playerId, res.status, res.body.error]).toEqual([playerId, 404, 'notFound']);
    }
  });

  it('the same report while it is open: 409 duplicate with its id; another reason, or after resolving, is new', async () => {
    const first = await report('ana', { playerId: 'ben', reason: 'offensiveName' });
    const again = await report('ana', { playerId: 'ben', reason: 'offensiveName' });
    expect([again.status, again.body.error, again.body.reportId]).toEqual([409, 'duplicate', first.body.id]);
    // Someone else's report on the same player and reason is theirs.
    expect((await report('cyd', { playerId: 'ben', reason: 'offensiveName' })).status).toBe(201);
    expect((await report('ana', { playerId: 'ben', reason: 'cheating' })).status).toBe(201);
    const closed = await adminPost<AdminReport>(`/reports/${first.body.id}/resolve`);
    expect(closed.status).toBe(200);
    expect((await report('ana', { playerId: 'ben', reason: 'offensiveName' })).status).toBe(201);
    expect(await t.db.select().from(playerReports)).toHaveLength(4);
  });

  it(`a dismissed report: the same one again within ${DISMISSED_REPORT_COOLDOWN_DAYS} days is 409 duplicate with it`, async () => {
    const first = await report('ana', { playerId: 'ben', reason: 'cheating' });
    expect((await adminPost(`/reports/${first.body.id}/dismiss`)).status).toBe(200);
    clock.advance(DISMISSED_REPORT_COOLDOWN_DAYS * DAY - 1);
    const again = await report('ana', { playerId: 'ben', reason: 'cheating' });
    expect([again.status, again.body.error, again.body.reportId]).toEqual([409, 'duplicate', first.body.id]);
    // Another reason, or another reporter, is a report of its own.
    expect((await report('ana', { playerId: 'ben', reason: 'other' })).status).toBe(201);
    expect((await report('cyd', { playerId: 'ben', reason: 'cheating' })).status).toBe(201);
    // The cool-down over: a new report.
    clock.advance(1);
    expect((await report('ana', { playerId: 'ben', reason: 'cheating' })).status).toBe(201);
    expect(await t.db.select().from(playerReports)).toHaveLength(4);
  });

  it(`at most ${REPORTS_PER_HOUR} an hour: 429 rateLimited with retryAt and Retry-After; duplicates don't count`, async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    await addAccounts(
      t.db,
      ids.map((id) => ({ id })),
    );
    for (let i = 0; i < REPORTS_PER_HOUR; i++) {
      expect((await report('ana', { playerId: ids[i], reason: 'other' })).status).toBe(201);
      // A duplicate on the way: answered, not counted.
      if (i === 3) expect((await report('ana', { playerId: ids[i], reason: 'other' })).status).toBe(409);
      clock.advance(60_000);
    }
    const over = await report('ana', { playerId: ids[10], reason: 'other' });
    // The first went at T0 + 1 h: one more may go an hour after it.
    expect([over.status, over.body.error, over.body.retryAt]).toEqual([429, 'rateLimited', T0 + 2 * HOUR]);
    expect(Number(over.headers.get('retry-after'))).toBe((T0 + 2 * HOUR - clock.now()) / 1000);
    // Someone else is not limited by Ana's reports.
    expect((await report('ben', { playerId: ids[10], reason: 'other' })).status).toBe(201);
    clock.set(T0 + 2 * HOUR);
    expect((await report('ana', { playerId: ids[10], reason: 'other' })).status).toBe(201);
    expect((await report('ana', { playerId: ids[11], reason: 'other' })).status).toBe(429);
  });

  it('a suspended account cannot report (403 suspended)', async () => {
    await adminPost(`/users/ana/suspend`);
    const res = await report('ana', { playerId: 'ben', reason: 'other' });
    expect([res.status, res.body.error]).toEqual([403, 'suspended']);
  });
});

describe('blocks: GET, POST and DELETE /v1/me/blocks', () => {
  it('blocks with the public card, lists newest first, unblocks; the watch hears each change once', async () => {
    await setRating(t.db, 'ben', 'fast', 1320, 12);
    const first = await block('ana', 'ben');
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      id: 'ben',
      displayName: 'Ben',
      avatarId: 'av00',
      country: null,
      league: expect.any(String),
      level: 1,
      blockedAt: T0 + HOUR,
    });
    clock.advance(1000);
    // Again: the block that is there (200, its time), and nothing new to hear.
    const again = await block('ana', 'ben');
    expect([again.status, again.body.blockedAt]).toEqual([200, T0 + HOUR]);
    expect((await block('ana', 'cyd')).status).toBe(201);
    const list = await blocks('ana');
    expect(list.body.max).toBe(MAX_BLOCKS);
    expect(list.body.blocks.map((b) => [b.id, b.blockedAt])).toEqual([
      ['cyd', T0 + HOUR + 1000],
      ['ben', T0 + HOUR],
    ]);
    expect((await api(`ana`, 'DELETE', blockPath('ben'))).status).toBe(204);
    expect((await api(`ana`, 'DELETE', blockPath('ben'))).status).toBe(204); // not blocked: still 204
    expect((await blocks('ana')).body.blocks.map((b) => b.id)).toEqual(['cyd']);
    expect(heard).toEqual([
      { blockerId: 'ana', blockedId: 'ben', blocked: true },
      { blockerId: 'ana', blockedId: 'cyd', blocked: true },
      { blockerId: 'ana', blockedId: 'ben', blocked: false },
    ]);
    // Ben's own list is his: Ana's block of him is not in it.
    expect((await blocks('ben')).body.blocks).toEqual([]);
  });

  it('refuses yourself (400 self), a missing or deleted player (404), a bad id (400) and no account (404)', async () => {
    expect((await block('ana', 'ana')).body.error).toBe('self');
    expect((await block('ana', 'nobody')).status).toBe(404);
    expect((await block('ana', 'gone')).body.error).toBe('notFound');
    const bad = await api<ModerationError>('ana', 'DELETE', blockPath('a.b'));
    expect([bad.status, bad.body.error, bad.body.field]).toEqual([400, 'badRequest', 'playerId']);
    const noBody = await api<ModerationError>('ana', 'POST', MODERATION_PATHS.blocks, { body: {} });
    expect([noBody.status, noBody.body.field]).toEqual([400, 'playerId']);
    expect((await blocks('stranger')).status).toBe(404);
    expect((await api(null, 'GET', MODERATION_PATHS.blocks)).status).toBe(401);
  });

  it(`at most ${MAX_BLOCKS}: the next one is 409 limitReached`, async () => {
    const ids = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => `x${i}`);
    await addAccounts(
      t.db,
      ids.map((id) => ({ id })),
    );
    await t.db
      .insert(userBlocks)
      .values(ids.slice(0, MAX_BLOCKS).map((blockedId) => ({ blockerId: 'ana', blockedId })));
    const over = await block('ana', ids[MAX_BLOCKS]!);
    expect([over.status, over.body.error, over.body.max]).toEqual([409, 'limitReached', MAX_BLOCKS]);
    // One already blocked is still answered.
    expect((await block('ana', 'x0')).status).toBe(200);
  });

  it('a suspended account may still block and unblock', async () => {
    await adminPost(`/users/ana/suspend`);
    expect((await block('ana', 'ben')).status).toBe(201);
    expect((await api('ana', 'DELETE', blockPath('ben'))).status).toBe(204);
  });

  it('never hides anyone from the leaderboard', async () => {
    await setRating(t.db, 'ana', 'fast', 1300, 12);
    await setRating(t.db, 'ben', 'fast', 1250, 12);
    await block('ana', 'ben');
    await block('ben', 'ana');
    const board = await api<Leaderboard>('ana', 'GET', `${PROGRESS_PATHS.leaderboard}?tab=fast`);
    expect(board.body.entries.map((e) => e.id)).toEqual(['ana', 'ben']);
  });
});

describe('a persona (stealth-bot.md §12) [D90]: reports and blocks answer exactly as for a person', () => {
  /** The value types of a body, by key: what the app could tell apart. */
  const shapeOf = (body: object) =>
    Object.fromEntries(
      Object.entries(body)
        .map(([k, v]) => [k, v === null ? 'null' : typeof v] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

  it('report, a duplicate, block, the list and unblock: the same statuses and bodies; nothing says "bot"', async () => {
    const persona = (await createPersona(t.db, { rng: createRng(7), now: T0, ratingOption: 'B' }))!;
    const p = persona.userId;
    // Ben has a country too, as every persona does: their cards then compare field for field.
    await t.db.update(users).set({ country: 'IL' }).where(eq(users.id, 'ben'));
    // A stealth game Ana played against the persona, and a ranked one against Ben.
    await addGamePuzzle(t.db);
    for (const [id, other] of [
      ['g-ap', p],
      ['g-ab', 'ben'],
    ] as const)
      await addStoredGame(t.db, {
        id,
        endedAt: T0,
        seats: [
          { userId: 'ana', place: 1 },
          { userId: other, place: 2 },
        ],
      });
    await t.db.update(games).set({ stealth: true }).where(eq(games.id, 'g-ap'));

    const toPersona = await report('ana', { playerId: p, reason: 'cheating', gameId: 'g-ap' });
    const toPerson = await report('ana', { playerId: 'ben', reason: 'cheating', gameId: 'g-ab' });
    expect(toPersona.status).toBe(201);
    expect(toPersona.status).toBe(toPerson.status);
    expect(toPersona.body).toEqual({
      ...toPerson.body,
      id: expect.stringMatching(UUID),
      playerId: p,
      gameId: 'g-ap',
    });
    // The same report again: 409 duplicate, as for a person.
    const again = await report('ana', { playerId: p, reason: 'cheating' });
    const againPerson = await report('ana', { playerId: 'ben', reason: 'cheating' });
    expect([again.status, again.body.error]).toEqual([againPerson.status, againPerson.body.error]);
    expect(again.status).toBe(409);

    const blockedPersona = await block('ana', p);
    const blockedPerson = await block('ana', 'ben');
    expect(blockedPersona.status).toBe(201);
    expect(blockedPersona.status).toBe(blockedPerson.status);
    expect(shapeOf(blockedPersona.body)).toEqual(shapeOf(blockedPerson.body));
    expect(blockedPersona.body).toMatchObject({
      id: p,
      displayName: persona.displayName,
      country: persona.country,
      blockedAt: T0 + HOUR,
    });
    // Blocking it again: 200 with its time, as for a person.
    expect((await block('ana', p)).status).toBe((await block('ana', 'ben')).status);

    const list = await blocks('ana');
    expect(list.status).toBe(200);
    expect(list.body.blocks.map((b) => b.id).sort()).toEqual([p, 'ben'].sort());
    const [inList, personInList] = [p, 'ben'].map((id) => list.body.blocks.find((b) => b.id === id)!);
    expect(shapeOf(inList!)).toEqual(shapeOf(personInList!));
    expect(heard).toEqual([
      { blockerId: 'ana', blockedId: p, blocked: true },
      { blockerId: 'ana', blockedId: 'ben', blocked: true },
    ]);
    // Nothing on the wire tells a persona from a person.
    for (const body of [toPersona.body, blockedPersona.body, list.body])
      expect(JSON.stringify(body)).not.toMatch(/persona|stealth|isBot|"bot"/i);

    expect((await api('ana', 'DELETE', blockPath(p))).status).toBe(204);
    expect((await blocks('ana')).body.blocks.map((b) => b.id)).toEqual(['ben']);
  });
});

describe('the account: GET /v1/me, suspension and a name reset', () => {
  it('GET /v1/me says nameResetRequired and suspended', async () => {
    expect((await me('ana')).body).toMatchObject({ id: 'ana', nameResetRequired: false, suspended: false });
  });

  it('a suspension: no account changes (403 suspended), GET /v1/me and deletion work; lifting restores', async () => {
    const suspended = await adminPost<AdminModerationResult>('/users/ana/suspend');
    expect(suspended.body.user).toMatchObject({ id: 'ana', suspendedAt: T0 + HOUR });
    expect((await me('ana')).body).toMatchObject({ suspended: true });
    const refused = await api<AccountError>('ana', 'PATCH', ACCOUNT_PATHS.me, { body: { country: 'FR' } });
    expect([refused.status, refused.body.error]).toEqual([403, 'suspended']);
    await adminPost('/users/ana/unsuspend');
    expect((await me('ana')).body).toMatchObject({ suspended: false });
    expect((await api<Me>('ana', 'PATCH', ACCOUNT_PATHS.me, { body: { country: 'FR' } })).body.country).toBe(
      'FR',
    );
    await adminPost('/users/ben/suspend');
    // A suspended account may still be deleted (a fresh sign-in, as always).
    expect((await api('ben', 'DELETE', ACCOUNT_PATHS.me)).status).toBe(204);
    const [row] = await t.db.select().from(users).where(eq(users.id, 'ben'));
    expect(row).toMatchObject({ suspendedAt: null, nameResetRequired: false });
    expect(row?.deletedAt).not.toBeNull();
  });

  it('a reset name: a temporary one that passes the word filter; the next rename is free of the 30 days', async () => {
    // Ana renamed a day ago: her next rename would wait 29 days.
    await t.db
      .update(users)
      .set({ displayName: 'Ana2', displayNameChangedAt: new Date(clock.now() - DAY) })
      .where(eq(users.id, 'ana'));
    expect((await rename('ana', 'Ana3')).body.error).toBe('renameTooSoon');

    const res = await adminPost<AdminModerationResult>('/users/ana/reset-name');
    expect(res.status).toBe(200);
    const name = res.body.user.displayName;
    expect(name).toBe(`${TEMPORARY_NAME_PREFIX}12345`);
    expect(checkName(name, defaultBlockedWords()).ok).toBe(true);
    expect(res.body.user).toMatchObject({ nameResetRequired: true });
    expect(res.body.audit).toMatchObject({
      action: 'resetName',
      adminEmail: 'password',
      targetUserId: 'ana',
      details: { fromName: 'Ana2', toName: name },
    });
    expect((await me('ana')).body).toMatchObject({
      displayName: name,
      nameResetRequired: true,
      nextRenameAt: null,
    });

    const renamed = await rename('ana', 'Ana3');
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      displayName: 'Ana3',
      nameResetRequired: false,
      nextRenameAt: clock.now() + RENAME_COOLDOWN_MS,
    });
    // From here the 30 days count again.
    expect((await rename('ana', 'Ana4')).body.error).toBe('renameTooSoon');
  });

  it('a temporary name that is taken, or that reads as a blocked word, is drawn again', async () => {
    await t.db
      .update(users)
      .set({ displayName: `${TEMPORARY_NAME_PREFIX}10001` })
      .where(eq(users.id, 'cyd'));
    // Digits read as letters (leetspeak: 1 → i, 0 → o, 3 → e), so "10003" reads "ioooe": a list with "oooe"
    // blocks it, and not 10002 ("iooo").
    const words = new BlockedWords({
      en: { substring: ['oooe'], exact: [] },
      he: { substring: [], exact: [] },
      reserved: { substring: [], exact: [] },
      allow: [],
    });
    expect(checkName(`${TEMPORARY_NAME_PREFIX}10003`, words).ok).toBe(false);
    expect(checkName(`${TEMPORARY_NAME_PREFIX}10002`, words).ok).toBe(true);
    // 1 → 10001, Cyd's; 3 → 10003, blocked; 2 → 10002.
    draws.push(1, 3, 2);
    const result = await resetName(t.db, 'ben', 'admin@example.com', clock.now(), {
      blockedWords: words,
      random,
    });
    expect(result.ok && result.result.user.displayName).toBe(`${TEMPORARY_NAME_PREFIX}10002`);
  });

  it('the old name leaves the logs of the account’s games (its opponents’ replays)', async () => {
    await addGamePuzzle(t.db);
    await addStoredGame(t.db, {
      id: 'g1',
      endedAt: T0,
      seats: [
        { userId: 'ana', place: 1 },
        { userId: 'ben', place: 2 },
      ],
    });
    await t.db.insert(gameEvents).values({
      gameId: 'g1',
      seq: 1,
      tMs: T0,
      type: 'gameCreated',
      payload: {
        config: {
          players: [
            { id: 'ana', name: 'Ana' },
            { id: 'ben', name: 'Ben' },
          ],
        },
      },
    });
    await adminPost('/users/ana/reset-name');
    const [row] = await t.db.select({ payload: gameEvents.payload }).from(gameEvents);
    expect(row?.payload).toEqual({
      config: {
        players: [
          { id: 'ana', name: `${TEMPORARY_NAME_PREFIX}12345` },
          { id: 'ben', name: 'Ben' },
        ],
      },
    });
  });

  it('a gameCreated written after the reset (the room took the name before it) gets the new name too', async () => {
    await addGamePuzzle(t.db);
    await addStoredGame(t.db, {
      id: 'g2',
      endedAt: T0,
      seats: [
        { userId: 'ana', place: 1 },
        { userId: 'ben', place: 2 },
      ],
    });
    await adminPost('/users/ana/reset-name');
    // Ben renamed himself meanwhile: his name in the log stays as played.
    await t.db.update(users).set({ displayName: 'Benny' }).where(eq(users.id, 'ben'));
    const created = {
      seq: 1,
      t: T0,
      type: 'gameCreated',
      config: {
        players: [
          { id: 'ana', name: 'Ana' },
          { id: 'ben', name: 'Ben' },
        ],
      },
    } as unknown as GameEvent;
    await appendGameEvents(t.db, 'g2', [created]);
    const [row] = await t.db.select({ payload: gameEvents.payload }).from(gameEvents);
    expect(row?.payload).toEqual({
      config: {
        players: [
          { id: 'ana', name: `${TEMPORARY_NAME_PREFIX}12345` },
          { id: 'ben', name: 'Ben' },
        ],
      },
    });
  });

  it('a reset name is retired: nobody may take it again, that player included (any case)', async () => {
    await adminPost('/users/ana/reset-name');
    // The free rename can't bring the old name straight back…
    for (const name of ['Ana', 'ana', 'ANA']) {
      const again = await rename('ana', name);
      expect({ name, status: again.status, error: again.body.error }).toEqual({
        name,
        status: 422,
        error: 'blocked',
      });
    }
    // …nor can another player take it, or a new account; the live check says so.
    expect((await rename('cyd', 'Ana')).body.error).toBe('blocked');
    const register = await call<AccountError>(http.url, 'POST', ACCOUNT_PATHS.users, {
      token: await tokens.sign({ uid: 'uid-new', email: 'new@example.com' }, clock.now()),
      body: fighter({ displayName: 'ana' }),
    });
    expect([register.status, register.body.error]).toEqual([422, 'blocked']);
    const check = await call<NameAvailability>(http.url, 'GET', `${ACCOUNT_PATHS.namesAvailable}?name=aNa`);
    expect(check.body).toEqual({ available: false, reason: 'blocked' });
    expect(await t.db.select({ key: retiredNames.nameKey }).from(retiredNames)).toEqual([{ key: 'ana' }]);
    // Any other name is free, and the rename takes it.
    expect((await rename('ana', 'Ana7')).status).toBe(200);
  });
});

describe('a suspension outlives the account’s deletion (spec §3.5)', () => {
  /** A sign-in's token: Firebase gives a new sign-in after a deletion a new uid, the address stays. */
  const signIn = (uid: string, email: string | null, emailVerified = true) =>
    tokens.sign({ uid, email, emailVerified }, clock.now());
  const registerWith = async (token: string, displayName: string) =>
    call<Me & AccountError>(http.url, 'POST', ACCOUNT_PATHS.users, {
      token,
      body: fighter({ displayName }),
    });
  const deleteWith = async (token: string) => call(http.url, 'DELETE', ACCOUNT_PATHS.me, { token });

  it('a new account of the same Google sign-in (a new uid, the same address) starts suspended', async () => {
    const first = await registerWith(await signIn('g-1', 'eve@example.com'), 'Eve');
    expect(first.status).toBe(201);
    const eve = first.body.id;
    expect((await adminPost(`/users/${eve}/suspend`)).status).toBe(200);
    expect((await deleteWith(await signIn('g-1', 'eve@example.com'))).status).toBe(204);
    // Only one-way fingerprints are kept, never the uid or the address.
    const kept = await t.db.select().from(suspendedSignIns);
    expect(kept).toHaveLength(2);
    for (const row of kept) {
      expect(row).toMatchObject({ userId: eve, suspendedAt: new Date(clock.now()) });
      expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }

    clock.advance(HOUR);
    const again = await registerWith(await signIn('g-2', 'EVE@example.com'), 'Eve2');
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ displayName: 'Eve2', suspended: true });
    const newId = again.body.id;
    expect(newId).not.toBe(eve);
    const audit = await admin.get<AdminPage<AdminAuditEntry>>('/audit');
    expect(audit.body.items[0]).toMatchObject({
      adminEmail: 'system',
      action: 'suspend',
      targetUserId: newId,
      details: { previousUserId: eve },
      createdAt: clock.now(),
    });
    // The new account carries the suspension now: its fingerprints are gone, and it is refused as ever.
    expect(await t.db.select().from(suspendedSignIns)).toEqual([]);
    const refused = await call<AccountError>(http.url, 'PATCH', ACCOUNT_PATHS.me, {
      token: await signIn('g-2', 'EVE@example.com'),
      body: { country: 'FR' },
    });
    expect([refused.status, refused.body.error]).toEqual([403, 'suspended']);
    // Lifted by an admin, it is an ordinary account.
    expect((await adminPost(`/users/${newId}/unsuspend`)).status).toBe(200);
    const lifted = await call<Me>(http.url, 'GET', ACCOUNT_PATHS.me, {
      token: await signIn('g-2', 'EVE@example.com'),
    });
    expect(lifted.body.suspended).toBe(false);
  });

  it('the same uid matches too (a Firebase deletion that failed); an unverified address is not kept', async () => {
    const first = await registerWith(await signIn('p-1', 'fay@example.com', false), 'Fay');
    expect((await adminPost(`/users/${first.body.id}/suspend`)).status).toBe(200);
    expect((await deleteWith(await signIn('p-1', 'fay@example.com', false))).status).toBe(204);
    expect(await t.db.select().from(suspendedSignIns)).toHaveLength(1);
    // The address was never verified: it may be someone else's, and their new account is theirs.
    const other = await registerWith(await signIn('p-2', 'fay@example.com'), 'Fay2');
    expect(other.body.suspended).toBe(false);
    expect((await deleteWith(await signIn('p-2', 'fay@example.com'))).status).toBe(204);
    // The same uid back: suspended.
    expect((await registerWith(await signIn('p-1', 'fay@example.com', false), 'Fay3')).body.suspended).toBe(
      true,
    );
  });

  it('deleting an account that is not suspended keeps nothing; another sign-in is never matched', async () => {
    expect((await registerWith(await signIn('g-3', 'gil@example.com'), 'Gil')).status).toBe(201);
    expect((await deleteWith(await signIn('g-3', 'gil@example.com'))).status).toBe(204);
    expect(await t.db.select().from(suspendedSignIns)).toEqual([]);
    expect((await registerWith(await signIn('g-4', 'gil@example.com'), 'Gil2')).body.suspended).toBe(false);

    const hal = await registerWith(await signIn('g-5', 'hal@example.com'), 'Hal');
    await adminPost(`/users/${hal.body.id}/suspend`);
    expect((await deleteWith(await signIn('g-5', 'hal@example.com'))).status).toBe(204);
    expect((await registerWith(await signIn('g-6', 'hal2@example.com'), 'Hal2')).body.suspended).toBe(false);
  });

  it('fingerprints: the uid always, the address in lower case only when verified (or when matching)', () => {
    const token = {
      kind: 'firebase' as const,
      uid: 'u1',
      email: ' Ana@Example.com ',
      emailVerified: false,
      signedInAt: null,
      signInProvider: null,
    };
    expect(signInFingerprints(token, true)).toHaveLength(1);
    const [uid, email] = signInFingerprints(token, false);
    expect(signInFingerprints({ ...token, email: 'ana@example.com', emailVerified: true }, true)).toEqual([
      uid,
      email,
    ]);
    expect(signInFingerprints({ ...token, email: null }, false)).toEqual([uid]);
  });
});

describe('the admin API: reports, actions and the audit log', () => {
  it('needs the session for every moderation route', async () => {
    for (const [method, path] of [
      ['GET', '/reports'],
      ['GET', '/audit'],
      ['POST', '/reports/x/resolve'],
      ['POST', '/reports/x/dismiss'],
      ['POST', '/users/ana/reset-name'],
      ['POST', '/users/ana/suspend'],
      ['POST', '/users/ana/unsuspend'],
    ] as const) {
      const res = await fetch(`${http.url}${ADMIN_API_PREFIX}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      expect([path, res.status]).toEqual([path, 401]);
    }
    expect(await t.db.select().from(adminAudit)).toEqual([]);
  });

  it('lists reported players by status, the most reports first, with counts, reporters and open totals', async () => {
    await report('ana', { playerId: 'ben', reason: 'offensiveName' });
    clock.advance(1000);
    await report('cyd', { playerId: 'ben', reason: 'offensiveName' });
    clock.advance(1000);
    const cheat = await report('ana', { playerId: 'cyd', reason: 'cheating' });
    clock.advance(1000);
    await report('cyd', { playerId: 'ben', reason: 'cheating' });
    await adminPost(`/reports/${cheat.body.id}/resolve`);

    const open = await admin.get<AdminPage<AdminReportedPlayer>>('/reports');
    expect(open.status).toBe(200);
    expect(open.body.total).toBe(1);
    const [ben] = open.body.items;
    expect(ben).toEqual({
      player: {
        id: 'ben',
        displayName: 'Ben',
        avatarId: null,
        country: null,
        deletedAt: null,
        suspendedAt: null,
        nameResetRequired: false,
        persona: false,
      },
      counts: { offensiveName: 2, cheating: 1, other: 0, total: 3, reporters: 2 },
      open: 3,
      oldestOpenAt: T0 + HOUR,
      lastReportedAt: T0 + HOUR + 3000,
      reports: [
        expect.objectContaining({ reason: 'cheating', reporter: { id: 'cyd', displayName: 'Cyd' } }),
        expect.objectContaining({ reason: 'offensiveName', reporter: { id: 'cyd', displayName: 'Cyd' } }),
        expect.objectContaining({
          reason: 'offensiveName',
          status: 'open',
          gameId: null,
          playerId: 'ben',
          createdAt: T0 + HOUR,
          resolvedAt: null,
          resolvedBy: null,
          reporter: { id: 'ana', displayName: 'Ana' },
        }),
      ],
    });

    const resolved = await admin.get<AdminPage<AdminReportedPlayer>>('/reports', { status: 'resolved' });
    expect(resolved.body.items.map((i) => [i.player.id, i.counts.total, i.open])).toEqual([['cyd', 1, 0]]);
    expect(resolved.body.items[0]!.reports[0]).toMatchObject({
      status: 'resolved',
      resolvedAt: T0 + HOUR + 3000,
      resolvedBy: 'password',
    });
    const all = await admin.get<AdminPage<AdminReportedPlayer>>('/reports', { status: 'all', pageSize: 1 });
    expect([all.body.total, all.body.items.map((i) => i.player.id)]).toEqual([2, ['ben']]);
    const page2 = await admin.get<AdminPage<AdminReportedPlayer>>('/reports', {
      status: 'all',
      pageSize: 1,
      page: 2,
    });
    expect(page2.body.items.map((i) => i.player.id)).toEqual(['cyd']);
    expect((await admin.get('/reports', { status: 'closed' })).status).toBe(400);
  });

  it('the most different reporters first: one account’s three reasons count once', async () => {
    for (const reason of ['offensiveName', 'cheating', 'other'] as const)
      await report('ana', { playerId: 'ben', reason });
    clock.advance(1000);
    await report('ana', { playerId: 'cyd', reason: 'cheating' });
    await report('ben', { playerId: 'cyd', reason: 'cheating' });
    const list = await admin.get<AdminPage<AdminReportedPlayer>>('/reports');
    expect(list.body.items.map((i) => [i.player.id, i.counts.reporters, i.counts.total])).toEqual([
      ['cyd', 2, 2],
      ['ben', 1, 3],
    ]);
  });

  it(`the oldest open report comes with the player, beyond the ${ADMIN_REPORTS_PER_PLAYER} reports listed`, async () => {
    const reporters = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, name: `Reporter${i}` }));
    await addAccounts(t.db, reporters);
    // 60 open reports on Ben, one a minute, the first three days ago.
    const start = clock.now() - 3 * DAY;
    await t.db.insert(playerReports).values(
      reporters.flatMap((r, i) =>
        (['offensiveName', 'cheating', 'other'] as const).map((reason, j) => ({
          reporterId: r.id,
          reportedId: 'ben',
          reason,
          createdAt: new Date(start + (i * 3 + j) * 60_000),
        })),
      ),
    );
    const [ben] = (await admin.get<AdminPage<AdminReportedPlayer>>('/reports')).body.items;
    expect(ben?.reports).toHaveLength(ADMIN_REPORTS_PER_PLAYER);
    expect(Math.min(...ben!.reports.map((r) => r.createdAt))).toBeGreaterThan(start);
    expect([ben?.open, ben?.oldestOpenAt, ben?.counts.reporters]).toEqual([60, start, 20]);
    // Closed reports don't count: with none open, there is no oldest.
    await t.db.update(playerReports).set({ status: 'dismissed' });
    const [closed] = (await admin.get<AdminPage<AdminReportedPlayer>>('/reports', { status: 'all' })).body
      .items;
    expect([closed?.open, closed?.oldestOpenAt]).toEqual([0, null]);
  });

  it('resolve and dismiss: open reports only (409 notOpen), 404 for none; each writes the audit log', async () => {
    const a = await report('ana', { playerId: 'ben', reason: 'other' });
    const b = await report('cyd', { playerId: 'ben', reason: 'other' });
    const resolved = await adminPost<AdminReport>(`/reports/${a.body.id}/resolve`);
    expect(resolved.body).toMatchObject({ id: a.body.id, status: 'resolved', resolvedBy: 'password' });
    expect((await adminPost<{ error: string }>(`/reports/${a.body.id}/dismiss`)).body).toMatchObject({
      error: 'notOpen',
    });
    expect((await adminPost(`/reports/${b.body.id}/dismiss`)).status).toBe(200);
    expect((await adminPost('/reports/nope/resolve')).status).toBe(404);
    const audit = await admin.get<AdminPage<AdminAuditEntry>>('/audit');
    expect(audit.body.items.map((e) => [e.action, e.targetUserId, e.details])).toEqual([
      ['dismissReport', 'ben', { reportId: b.body.id, reason: 'other' }],
      ['resolveReport', 'ben', { reportId: a.body.id, reason: 'other' }],
    ]);
    expect(audit.body.items.every((e) => e.adminEmail === 'password')).toBe(true);
  });

  it('the actions want a JSON {} body: anything else is 400 and changes nothing', async () => {
    for (const [body, type] of [
      [null, 'application/json'],
      ['{"why":"spam"}', 'application/json'],
      ['[]', 'application/json'],
      ['reason=x', 'application/x-www-form-urlencoded'],
      ['{}', 'text/plain'],
    ] as const) {
      const res = await adminPost<{ error: string }>('/users/ana/suspend', body, type);
      expect({ body, type, status: res.status }).toEqual({ body, type, status: 400 });
    }
    const [row] = await t.db.select().from(users).where(eq(users.id, 'ana'));
    expect(row?.suspendedAt).toBeNull();
  });

  it('suspend and unsuspend: one audit entry per change, none for no change; 404 and 409 accountDeleted', async () => {
    const first = await adminPost<AdminModerationResult>('/users/ben/suspend');
    expect(first.body.audit).toMatchObject({ action: 'suspend', targetUserId: 'ben', details: {} });
    const again = await adminPost<AdminModerationResult>('/users/ben/suspend');
    expect([again.status, again.body.audit, again.body.user.suspendedAt]).toEqual([200, null, T0 + HOUR]);
    const lifted = await adminPost<AdminModerationResult>('/users/ben/unsuspend');
    expect([lifted.body.audit?.action, lifted.body.user.suspendedAt]).toEqual(['unsuspend', null]);
    expect((await adminPost<AdminModerationResult>('/users/ben/unsuspend')).body.audit).toBeNull();
    expect((await adminPost('/users/nobody/suspend')).status).toBe(404);
    expect((await adminPost<{ error: string }>('/users/gone/suspend')).body.error).toBe('accountDeleted');
    expect((await adminPost<{ error: string }>('/users/gone/reset-name')).body.error).toBe('accountDeleted');
    expect((await adminPost('/users/nobody/reset-name')).status).toBe(404);
    const audit = await admin.get<AdminPage<AdminAuditEntry>>('/audit');
    expect(audit.body.items.map((e) => e.action)).toEqual(['unsuspend', 'suspend']);
  });

  it('the users list shows the moderation state', async () => {
    await report('ana', { playerId: 'ben', reason: 'other' });
    await adminPost('/users/ben/suspend');
    const res = await admin.get<AdminPage<AdminUserRow>>('/users', { search: 'Ben' });
    expect(res.body.items[0]).toMatchObject({
      id: 'ben',
      suspendedAt: T0 + HOUR,
      nameResetRequired: false,
      openReports: 1,
    });
  });

  it('where Google sign-in is offered, a password session reads but may not act (403 googleRequired)', async () => {
    const both = await startHttp({
      config: testConfig({
        admin: {
          enabled: true,
          password: TEST_ADMIN_PASSWORD,
          devPassword: false,
          google: testGoogleAdmin(),
          sessionSecret: TEST_SESSION_SECRET,
        },
      }),
      db: t.db,
      now: clock.now,
      tokens: tokens.verifier(clock.now),
      adminSiteDir: null,
      blockWatch: watch,
      moderationTools: { blockedWords: defaultBlockedWords(), random },
    });
    try {
      const post = async (cookie: string, path: string) => {
        const res = await fetch(`${both.url}${ADMIN_API_PREFIX}${path}`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: '{}',
        });
        return { status: res.status, body: (await res.json()) as { error?: string } & AdminModerationResult };
      };
      const byPassword = await signedInAdmin(both.url);
      expect((await byPassword.get('/reports')).status).toBe(200);
      const refused = await post(byPassword.cookie, '/users/ben/suspend');
      expect([refused.status, refused.body.error]).toEqual([403, 'googleRequired']);
      expect((await me('ben')).body.suspended).toBe(false);

      const login = await fetch(`${both.url}${ADMIN_API_PREFIX}/login/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idToken: await tokens.sign(
            { uid: 'google-admin', email: TEST_ADMIN_EMAIL, provider: 'google.com' },
            clock.now(),
          ),
        }),
      });
      expect(login.status).toBe(204);
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const done = await post(cookie, '/users/ben/suspend');
      expect(done.status).toBe(200);
      expect(done.body.audit).toMatchObject({ adminEmail: TEST_ADMIN_EMAIL, action: 'suspend' });
    } finally {
      await both.close();
    }
  });

  it('names the admin by the session: the Google address, or `password`', () => {
    expect(adminName({ method: 'google', email: 'moshe@example.com' })).toBe('moshe@example.com');
    expect(adminName({ method: 'password' })).toBe('password');
  });

  it('temporary names: "שחקן" and five digits, a valid display name', () => {
    const none = { substring: [], exact: [] };
    const noWords = new BlockedWords({ en: none, he: none, reserved: none, allow: [] });
    for (const n of [0, 1, 45_678, 89_999]) {
      const name = temporaryName(() => n);
      expect(name).toMatch(/^שחקן\d{5}$/);
      expect(checkName(name, noWords).ok).toBe(true);
    }
  });
});

describe('an account deletion and moderation', () => {
  it('blocks go both ways, open reports about it are dismissed by system, its reports stay, audit names go', async () => {
    await block('ana', 'ben');
    await block('ben', 'cyd');
    await report('ana', { playerId: 'ben', reason: 'offensiveName' });
    const fromBen = await report('ben', { playerId: 'cyd', reason: 'cheating' });
    await adminPost('/users/ben/reset-name');
    await adminPost('/users/ben/suspend');

    const [row] = await t.db.select({ uid: users.firebaseUid }).from(users).where(eq(users.id, 'ben'));
    const deleted = await deleteUser(
      t.db,
      {
        kind: 'firebase',
        uid: row!.uid,
        email: null,
        emailVerified: true,
        signedInAt: clock.now(),
        signInProvider: 'password',
      },
      clock.now(),
    );
    expect(deleted).toBe(true);
    expect(await t.db.select().from(userBlocks)).toEqual([]);
    const reports = await t.db.select().from(playerReports);
    expect(reports.find((r) => r.reportedId === 'ben')).toMatchObject({
      status: 'dismissed',
      resolvedBy: 'system',
      resolvedAt: new Date(clock.now()),
    });
    expect(reports.find((r) => r.id === fromBen.body.id)).toMatchObject({
      reporterId: 'ben',
      status: 'open',
    });
    const audit = await t.db.select().from(adminAudit).orderBy(adminAudit.id);
    expect(audit.map((a) => [a.action, a.targetUserId, a.details])).toEqual([
      ['resetName', 'ben', {}],
      ['suspend', 'ben', {}],
    ]);
  });
});

describe('the actor lock', () => {
  it('is FOR NO KEY UPDATE: it lets the foreign key checks of two players acting on each other through', async () => {
    // FOR UPDATE would conflict with the FOR KEY SHARE an insert's foreign key check takes on the other
    // player's row: two players blocking or reporting each other at once would deadlock (Postgres; PGlite runs
    // one transaction at a time, so this checks the lock asked for).
    const asked: string[] = [];
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      for: (strength: string) => {
        asked.push(strength);
        return Promise.resolve([]);
      },
    };
    await lockActor(chain as unknown as Db, 'ana');
    expect(asked).toEqual(['no key update']);
    // And it runs on the real database.
    await t.db.transaction((tx) => lockActor(tx, 'ana'));
  });
});

describe('POST /v1/events: report_sent carries the reason only', () => {
  const batch = (props: Record<string, unknown>, id = '00000000-0000-4000-8000-000000000001') => ({
    installId: '00000000-0000-4000-8000-0000000000aa',
    platform: 'android',
    appVersion: '1.0.0',
    events: [{ id, name: 'report_sent', props, t: T0 }],
  });
  const send = (body: unknown) =>
    call<TelemetryResponse & { error?: string; message?: string }>(http.url, 'POST', TELEMETRY_PATH, {
      body,
    });

  it('takes { reason } and refuses ids, other props or another reason', async () => {
    expect((await send(batch({ reason: 'cheating' }))).status).toBe(202);
    for (const props of [
      { reason: 'cheating', playerId: 'ben' },
      { reason: 'cheating', gameId: 'g1' },
      { reason: 'spam' },
      {},
    ]) {
      const res = await send(batch(props, '00000000-0000-4000-8000-000000000002'));
      expect({ props, status: res.status }).toEqual({ props, status: 400 });
      expect(res.body.message).toMatch(/^events\.0\.props: /);
    }
  });
});
