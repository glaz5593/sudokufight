import {
  ACCOUNT_PATHS,
  type AccountError,
  AVATAR_IDS,
  type AvatarId,
  LEGACY_AVATAR_MAP,
  type LevelsSyncResponse,
  type Me,
  type MyLevels,
  type NameAvailability,
  NO_AVATAR_ID,
  PROGRESS_PATHS,
  RECENT_SIGN_IN_MS,
  RENAME_COOLDOWN_MS,
} from '@sudoku-fight/protocol';
import { asc, eq } from 'drizzle-orm';

import { createTokenVerifier } from '../auth/firebaseToken';
import { KeysUnavailableError } from '../auth/googleKeys';
import type { ServerConfig } from '../config';
import { installs, levelXpDays, ratings, userLevels, users, xp } from '../db/schema';
import { call, type CallOptions, fighter } from '../testing/accounts';
import { fakeClock, type FakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { startHttp, type TestHttp } from '../testing/http';
import { testTokens, type TestTokens } from '../testing/tokens';
import { type AccountLimits, DEFAULT_ACCOUNT_LIMITS } from './router';

const NOW = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let t: TestDb;
let tokens: TestTokens;
let clock: FakeClock;
let http: TestHttp;

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
}, 30_000);
afterAll(() => t.close());
let running = false;
async function stop() {
  if (running) await http.close();
  running = false;
}
afterEach(stop);

async function start(
  config: Partial<ServerConfig> = {},
  accountLimits: AccountLimits = DEFAULT_ACCOUNT_LIMITS,
  devTokens?: boolean,
) {
  // A test may start again with other settings, after its describe's beforeEach started one: close that one
  // first, or its listening socket outlives the run and keeps Jest from exiting.
  await stop();
  await t.reset();
  clock = fakeClock(NOW);
  const cfg = testConfig(config);
  http = await startHttp({
    config: cfg,
    db: t.db,
    now: clock.now,
    tokens: tokens.verifier(clock.now, {
      projectId: cfg.firebaseProjectId,
      devTokens: devTokens ?? cfg.nodeEnv !== 'production',
    }),
    accountLimits,
    adminSiteDir: null,
  });
  running = true;
}

/** A Firebase ID token for `uid`, issued now (by the test clock). */
const idToken = (uid: string, email: string | null = `${uid}@example.com`, emailVerified = true) =>
  tokens.sign({ uid, email, emailVerified }, clock.now());

const api = <T = unknown>(method: string, p: string, options?: CallOptions) =>
  call<T>(http.url, method, p, options);
const names = (name: string, token?: string) =>
  api<NameAvailability>('GET', `${ACCOUNT_PATHS.namesAvailable}?name=${encodeURIComponent(name)}`, { token });
const register = async (uid: string, overrides: Parameters<typeof fighter>[0] = {}) =>
  api<Me & AccountError>('POST', ACCOUNT_PATHS.users, {
    token: await idToken(uid),
    body: fighter(overrides),
  });
const me = async (uid: string) =>
  api<Me & AccountError>('GET', ACCOUNT_PATHS.me, { token: await idToken(uid) });
const patch = async (uid: string, body: unknown) =>
  api<Me & AccountError>('PATCH', ACCOUNT_PATHS.me, { token: await idToken(uid), body });
const remove = async (uid: string) =>
  api<AccountError | null>('DELETE', ACCOUNT_PATHS.me, { token: await idToken(uid) });

const userRow = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0];

describe('the "done" story of stage 8, on the server', () => {
  beforeEach(() => start());

  it('register → me → change the avatar → delete → register again with the same name', async () => {
    const created = await register('uid-1', { displayName: 'Dana', avatarId: 'lava-lamp' });
    expect(created.status).toBe(201);

    const card = await me('uid-1');
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ displayName: 'Dana', avatarId: 'lava-lamp', country: 'IL' });

    const changed = await patch('uid-1', { avatarId: 'maya' });
    expect(changed.status).toBe(200);
    expect(changed.body.avatarId).toBe('maya');

    expect((await remove('uid-1')).status).toBe(204);
    const row = await userRow(created.body.id);
    expect(row?.deletedAt).toEqual(new Date(NOW));
    expect((await me('uid-1')).status).toBe(404);

    // A new Firebase account (Firebase deleted the old one) takes the same name.
    const again = await register('uid-2', { displayName: 'Dana' });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(created.body.id);
    expect(again.body.displayName).toBe('Dana');
  });

  it('"המשך עם Google" in the app (Moshe, 14.10.2026): a Google sign-in is an account like any other', async () => {
    // Firebase's token of a Google sign-in: sign_in_provider google.com, the address verified by Google.
    const google = (uid: string) =>
      tokens.sign(
        { uid, email: 'gamer@gmail.com', emailVerified: true, provider: 'google.com' },
        clock.now(),
      );
    for (const env of ['test', 'production'] as const) {
      await start({ nodeEnv: env });
      const created = await api<Me>('POST', ACCOUNT_PATHS.users, {
        token: await google('google-uid-1'),
        body: fighter({ displayName: 'Gamer' }),
      });
      expect({ env, status: created.status }).toEqual({ env, status: 201 });
      const card = await api<Me>('GET', ACCOUNT_PATHS.me, { token: await google('google-uid-1') });
      expect(card.body).toMatchObject({
        displayName: 'Gamer',
        email: 'gamer@gmail.com',
        emailVerified: true,
      });
      const changed = await api<Me>('PATCH', ACCOUNT_PATHS.me, {
        token: await google('google-uid-1'),
        body: { country: 'US' },
      });
      expect(changed.body.country).toBe('US');
      // Deleting it needs a fresh sign-in, as with a password: re-authenticating with Google gives one.
      const removed = await api('DELETE', ACCOUNT_PATHS.me, { token: await google('google-uid-1') });
      expect(removed.status).toBe(204);
    }
  });
});

describe('POST /v1/users', () => {
  beforeEach(() => start());

  it('creates the account: the name, avatar and country from the body, the email from the token', async () => {
    const res = await api<Me>('POST', ACCOUNT_PATHS.users, {
      token: await idToken('uid-1', 'dana@example.com', false),
      body: fighter({ displayName: 'דנה_כהן', avatarId: 'moon', country: 'US' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toEqual({
      id: expect.stringMatching(UUID),
      displayName: 'דנה_כהן',
      avatarId: 'moon',
      country: 'US',
      email: 'dana@example.com',
      emailVerified: false,
      createdAt: NOW,
      displayNameChangedAt: null,
      nextRenameAt: null,
      ratings: [
        { key: 'fast', rating: 1200, games: 0, provisional: true, peak: 1200 },
        { key: 'normal', rating: 1200, games: 0, provisional: true, peak: 1200 },
        { key: 'hard', rating: 1200, games: 0, provisional: true, peak: 1200 },
      ],
      // Moderation (spec §3.5): neither.
      nameResetRequired: false,
      suspended: false,
    });
    expect(await userRow(res.body.id)).toEqual({
      id: res.body.id,
      firebaseUid: 'uid-1',
      displayName: 'דנה_כהן',
      displayNameChangedAt: null,
      country: 'US',
      avatarId: 'moon',
      email: 'dana@example.com',
      createdAt: new Date(NOW),
      deletedAt: null,
      suspendedAt: null,
      nameResetRequired: false,
      kind: 'person', // stealth bot (0010): a person, not a persona
    });
  });

  it('makes the ratings at 1200, provisional, for the three keys of option B [D7, D23]', async () => {
    const { body } = await register('uid-1');
    const rows = await t.db
      .select()
      .from(ratings)
      .where(eq(ratings.userId, body.id))
      .orderBy(asc(ratings.ratingKey));
    expect(rows.map((r) => [r.ratingKey, r.rating, r.games, r.provisional, r.peak])).toEqual([
      ['fast', 1200, 0, true, 1200],
      ['hard', 1200, 0, true, 1200],
      ['normal', 1200, 0, true, 1200],
    ]);
  });

  it('…and for the nine keys of option A', async () => {
    await http.close();
    await start({ ratingOption: 'A' });
    const { status, body } = await register('uid-1');
    expect(status).toBe(201);
    expect(body.ratings.map((r) => r.key)).toEqual([
      'fast-2p',
      'fast-3p',
      'fast-4p',
      'normal-2p',
      'normal-3p',
      'normal-4p',
      'hard-2p',
      'hard-3p',
      'hard-4p',
    ]);
    expect(await t.db.$count(ratings, eq(ratings.userId, body.id))).toBe(9);
  });

  it('refuses a second account for the same sign-in: 409 alreadyRegistered', async () => {
    expect((await register('uid-1')).status).toBe(201);
    const second = await register('uid-1', { displayName: 'Other' });
    expect(second).toMatchObject({ status: 409, body: { error: 'alreadyRegistered' } });
    expect(await t.db.$count(users)).toBe(1);
  });

  it('refuses a name someone has, without regard to case or Hebrew final letters: 409 taken', async () => {
    expect((await register('uid-1', { displayName: 'Dana' })).status).toBe(201);
    expect(await register('uid-2', { displayName: 'dana' })).toMatchObject({
      status: 409,
      body: { error: 'taken' },
    });
    expect(await register('uid-3', { displayName: 'DANA' })).toMatchObject({
      status: 409,
      body: { error: 'taken' },
    });

    expect((await register('uid-4', { displayName: 'דן_לוי' })).status).toBe(201);
    expect(await register('uid-5', { displayName: 'דנ_לוי' })).toMatchObject({
      status: 409,
      body: { error: 'taken' },
    });
    // Nothing half-made: no user, no ratings.
    expect(await t.db.$count(users)).toBe(2);
    expect(await t.db.$count(ratings)).toBe(6);
  });

  it('two registrations of one name at once: one gets it, the other 409 taken', async () => {
    const [a, b] = await Promise.all([
      register('uid-1', { displayName: 'Racer' }),
      register('uid-2', { displayName: 'RACER' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)?.body.error).toBe('taken');
    expect(await t.db.$count(users)).toBe(1);
  });

  it('two registrations of one sign-in at once: one account', async () => {
    const [a, b] = await Promise.all([
      register('uid-1', { displayName: 'First' }),
      register('uid-1', { displayName: 'Second' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await t.db.$count(users)).toBe(1);
  });

  it.each([
    ['ab', 'tooShort'],
    ['a'.repeat(17), 'tooLong'],
    ['Dana Cohen', 'invalidChars'],
    [' Dana', 'invalidChars'],
    ['שָׁלוֹם', 'invalidChars'],
  ])('refuses the name %j: 400 invalidName (%s)', async (displayName, problem) => {
    expect(await register('uid-1', { displayName })).toMatchObject({
      status: 400,
      body: { error: 'invalidName', problem },
    });
  });

  it.each(['fuck_you', 'Sh1t', 'זונה', 'Admin', 'BigDick'])(
    'refuses %j: 422 blocked',
    async (displayName) => {
      expect(await register('uid-1', { displayName })).toMatchObject({
        status: 422,
        body: { error: 'blocked' },
      });
      expect(await t.db.$count(users)).toBe(0);
    },
  );

  it.each([
    ['avatar av00 ("no avatar")', { avatarId: 'av00' }, 'avatarId'],
    ['avatar av36 (not in the set)', { avatarId: 'av36' }, 'avatarId'],
    ['avatar av07 (the old pack)', { avatarId: 'av07' }, 'avatarId'],
    ['avatar av52', { avatarId: 'av52' }, 'avatarId'],
    ['avatar Noam (case matters)', { avatarId: 'Noam' }, 'avatarId'],
    ['a lower-case country', { country: 'il' }, 'country'],
    ['an unknown country', { country: 'ZZ' }, 'country'],
    ['a number for a name', { displayName: 42 }, 'displayName'],
    ['no country', { country: undefined }, 'country'],
  ])('refuses %s: 400 badRequest', async (_why, overrides, field) => {
    const res = await api<AccountError>('POST', ACCOUNT_PATHS.users, {
      token: await idToken('uid-1'),
      body: { ...fighter(), ...overrides },
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'badRequest', field } });
  });

  it('takes the email from the token only: an email (or anything else) in the body is refused', async () => {
    const res = await api<AccountError>('POST', ACCOUNT_PATHS.users, {
      token: await idToken('uid-1'),
      body: { ...fighter(), email: 'someone@else.com' },
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'badRequest', field: 'body' } });
  });

  it('refuses a body that is not a JSON object', async () => {
    const token = await idToken('uid-1');
    const cases: CallOptions[] = [
      { token, raw: '[1,2]' },
      { token, raw: '"Dana"' },
      { token, raw: 'displayName=Dana', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      { token },
    ];
    for (const options of cases) {
      expect(await api('POST', ACCOUNT_PATHS.users, options)).toMatchObject({
        status: 400,
        body: { error: 'badRequest' },
      });
    }
    expect(await api('POST', ACCOUNT_PATHS.users, { token, raw: '{"displayName":' })).toMatchObject({
      status: 400,
      body: { error: 'badRequest', message: 'invalid JSON' },
    });
    const big = { ...fighter(), padding: 'x'.repeat(3000) };
    expect(await api('POST', ACCOUNT_PATHS.users, { token, body: big })).toMatchObject({
      status: 413,
      body: { error: 'tooLarge' },
    });
  });

  it('takes a development token outside production', async () => {
    const res = await api<Me>('POST', ACCOUNT_PATHS.users, {
      token: 'dev:ana:ana@example.com',
      body: fighter({ displayName: 'Ana' }),
    });
    expect(res).toMatchObject({ status: 201, body: { displayName: 'Ana', email: 'ana@example.com' } });
    expect((await userRow(res.body.id))?.firebaseUid).toBe('dev:ana');
    expect(await api('GET', ACCOUNT_PATHS.me, { token: 'dev:ana' })).toMatchObject({
      status: 200,
      body: { id: res.body.id, email: 'ana@example.com' },
    });
  });
});

describe('who is calling', () => {
  beforeEach(() => start());

  it('401 without a token, with WWW-Authenticate', async () => {
    for (const [method, p] of [
      ['POST', ACCOUNT_PATHS.users],
      ['GET', ACCOUNT_PATHS.me],
      ['PATCH', ACCOUNT_PATHS.me],
      ['DELETE', ACCOUNT_PATHS.me],
    ] as const) {
      const res = await api<AccountError>(method, p, {
        body: method === 'GET' || method === 'DELETE' ? undefined : {},
      });
      expect({ method, status: res.status, error: res.body.error }).toEqual({
        method,
        status: 401,
        error: 'unauthorized',
      });
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
    }
  });

  it('401 with a forged, foreign or expired token', async () => {
    await register('uid-1');
    const foreign = await tokens.sign({ uid: 'uid-1', extra: { aud: 'other-project' } }, clock.now());
    const forged = (await idToken('uid-1')).slice(0, -4) + 'AAAA';
    for (const token of [foreign, forged, 'garbage']) {
      const res = await api<AccountError>('GET', ACCOUNT_PATHS.me, { token });
      expect(res).toMatchObject({
        status: 401,
        body: { error: 'unauthorized', message: expect.stringMatching(/^Invalid token/) },
      });
      expect(res.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    }
    const old = await idToken('uid-1');
    clock.advance(2 * 3600_000);
    expect(await api('GET', ACCOUNT_PATHS.me, { token: old })).toMatchObject({
      status: 401,
      body: { error: 'unauthorized', message: expect.stringMatching(/^Expired token/) },
    });
  });

  it('another scheme than Bearer is no token', async () => {
    const res = await api('GET', ACCOUNT_PATHS.me, {
      headers: { authorization: `Basic ${await idToken('u')}` },
    });
    expect(res.status).toBe(401);
  });

  it("503 unavailable (not 401) when Google's keys can't be had; the name check goes on anonymous", async () => {
    await http.close();
    http = await startHttp({
      config: testConfig(),
      db: t.db,
      now: clock.now,
      tokens: createTokenVerifier({
        projectId: testConfig().firebaseProjectId,
        devTokens: false,
        now: clock.now,
        keys: () => Promise.reject(new KeysUnavailableError("Google's token keys: HTTP 503")),
      }),
      adminSiteDir: null,
    });
    expect(await me('uid-1')).toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(await names('Dana', await idToken('uid-1'))).toMatchObject({
      status: 200,
      body: { available: true },
    });
  });
});

describe('GET /v1/me', () => {
  beforeEach(() => start());

  it('404 notRegistered before registration (the app then goes to registration)', async () => {
    expect(await me('uid-1')).toMatchObject({ status: 404, body: { error: 'notRegistered' } });
  });

  it('answers the account; emailVerified follows the token of each request [D22]', async () => {
    const { body: created } = await register('uid-1');
    expect(
      (await api<Me>('GET', ACCOUNT_PATHS.me, { token: await idToken('uid-1', 'u@x.com', false) })).body,
    ).toMatchObject({
      id: created.id,
      emailVerified: false,
    });
    expect(
      (await api<Me>('GET', ACCOUNT_PATHS.me, { token: await idToken('uid-1', 'u@x.com', true) })).body
        .emailVerified,
    ).toBe(true);
  });

  it('follows an email changed in Firebase', async () => {
    const { body: created } = await register('uid-1');
    const res = await api<Me>('GET', ACCOUNT_PATHS.me, { token: await idToken('uid-1', 'new@example.com') });
    expect(res.body.email).toBe('new@example.com');
    expect((await userRow(created.id))?.email).toBe('new@example.com');
  });

  it('shows the ratings as they are', async () => {
    const { body: created } = await register('uid-1');
    await t.db
      .update(ratings)
      .set({ rating: 1287.5, games: 12, provisional: false, peak: 1300 })
      .where(eq(ratings.ratingKey, 'normal'));
    expect((await me('uid-1')).body.ratings[1]).toEqual({
      key: 'normal',
      rating: 1287.5,
      games: 12,
      provisional: false,
      peak: 1300,
    });
    expect(created.ratings).toHaveLength(3);
  });

  it("shows the keys of the server's option: after a switch to A, the new keys start at 1200", async () => {
    await register('uid-1');
    await http.close();
    clock = fakeClock(NOW);
    http = await startHttp({
      config: testConfig({ ratingOption: 'A' }),
      db: t.db,
      now: clock.now,
      tokens: tokens.verifier(clock.now),
      adminSiteDir: null,
    });
    const { body } = await me('uid-1');
    expect(body.ratings).toHaveLength(9);
    expect(body.ratings[0]).toEqual({
      key: 'fast-2p',
      rating: 1200,
      games: 0,
      provisional: true,
      peak: 1200,
    });
  });
});

describe('PATCH /v1/me', () => {
  beforeEach(async () => {
    await start();
    await register('uid-1', { displayName: 'Dana', avatarId: 'lava-lamp', country: 'IL' });
  });

  it('changes the avatar and the country any time [D21]', async () => {
    expect(await patch('uid-1', { avatarId: 'maya' })).toMatchObject({
      status: 200,
      body: { avatarId: 'maya' },
    });
    expect(await patch('uid-1', { country: 'FR' })).toMatchObject({ status: 200, body: { country: 'FR' } });
    expect(await patch('uid-1', { avatarId: 'microphone', country: 'IL' })).toMatchObject({
      status: 200,
      body: {
        avatarId: 'microphone',
        country: 'IL',
        displayName: 'Dana',
        displayNameChangedAt: null,
        nextRenameAt: null,
      },
    });
  });

  it('renames once in 30 days [D20]', async () => {
    const first = await patch('uid-1', { displayName: 'Dana2' });
    expect(first).toMatchObject({
      status: 200,
      body: { displayName: 'Dana2', displayNameChangedAt: NOW, nextRenameAt: NOW + RENAME_COOLDOWN_MS },
    });

    clock.advance(10 * DAY);
    expect(await patch('uid-1', { displayName: 'Dana3' })).toMatchObject({
      status: 409,
      body: { error: 'renameTooSoon', nextRenameAt: NOW + 30 * DAY },
    });
    // A case change is a rename too.
    expect((await patch('uid-1', { displayName: 'DANA2' })).status).toBe(409);
    // The avatar and the country still change.
    expect((await patch('uid-1', { avatarId: 'balloon' })).status).toBe(200);
    // The same name again is no change at all.
    expect(await patch('uid-1', { displayName: 'Dana2', country: 'GB' })).toMatchObject({
      status: 200,
      body: { displayName: 'Dana2', country: 'GB', displayNameChangedAt: NOW },
    });

    clock.set(NOW + 30 * DAY - 1);
    expect((await patch('uid-1', { displayName: 'Dana3' })).status).toBe(409);
    clock.set(NOW + 30 * DAY);
    expect(await patch('uid-1', { displayName: 'Dana3' })).toMatchObject({
      status: 200,
      body: { displayName: 'Dana3', displayNameChangedAt: NOW + 30 * DAY, nextRenameAt: NOW + 60 * DAY },
    });
  });

  it('frees the old name on a rename, and refuses a name someone has', async () => {
    await register('uid-2', { displayName: 'Noa' });
    expect(await patch('uid-1', { displayName: 'NOA' })).toMatchObject({
      status: 409,
      body: { error: 'taken' },
    });
    expect((await me('uid-1')).body.displayNameChangedAt).toBeNull(); // a refused rename uses nothing up

    expect((await patch('uid-1', { displayName: 'Dana_K' })).status).toBe(200);
    expect((await register('uid-3', { displayName: 'dana' })).status).toBe(201);
  });

  it('a case change of the own name is not "taken"', async () => {
    expect(await patch('uid-1', { displayName: 'DANA' })).toMatchObject({
      status: 200,
      body: { displayName: 'DANA' },
    });
  });

  it('checks the new name like a registration', async () => {
    expect(await patch('uid-1', { displayName: 'x' })).toMatchObject({
      status: 400,
      body: { error: 'invalidName', problem: 'tooShort' },
    });
    expect(await patch('uid-1', { displayName: 'b1tch' })).toMatchObject({
      status: 422,
      body: { error: 'blocked' },
    });
  });

  it('keeps a name that was fine when chosen, though a word in it is listed now', async () => {
    const { body } = await me('uid-1');
    await t.db.update(users).set({ displayName: 'fuck' }).where(eq(users.id, body.id));
    expect(await patch('uid-1', { displayName: 'fuck', avatarId: 'cassette' })).toMatchObject({
      status: 200,
      body: { displayName: 'fuck', avatarId: 'cassette' },
    });
  });

  it.each([
    ['nothing to change', {}, 'body'],
    ['an unknown field', { avatar: 'microphone' }, 'body'],
    ['avatar av00', { avatarId: 'av00' }, 'avatarId'],
    ['country Israel', { country: 'Israel' }, 'country'],
    ['a null name', { displayName: null }, 'displayName'],
  ])('refuses %s: 400 badRequest', async (_why, body, field) => {
    expect(await patch('uid-1', body)).toMatchObject({ status: 400, body: { error: 'badRequest', field } });
  });

  it('404 notRegistered without an account', async () => {
    expect(await patch('uid-9', { avatarId: 'microphone' })).toMatchObject({
      status: 404,
      body: { error: 'notRegistered' },
    });
  });
});

describe('DELETE /v1/me', () => {
  beforeEach(() => start());

  it('keeps the row, deleted: anonymous name, no email, country or avatar, no Firebase uid', async () => {
    const { body: created } = await register('uid-1', { displayName: 'Dana' });
    await t.db.insert(installs).values({
      id: '7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11',
      platform: 'android',
      appVersion: '0.1.0',
      firstSeen: new Date(NOW),
      lastSeen: new Date(NOW),
      userId: created.id,
    });
    clock.advance(DAY);
    const res = await remove('uid-1');
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const row = await userRow(created.id);
    expect(row).toEqual({
      id: created.id,
      firebaseUid: `deleted:${created.id}`,
      displayName: expect.stringMatching(/^deleted:[0-9a-f-]{36}$/),
      displayNameChangedAt: null,
      country: null,
      avatarId: null,
      email: null,
      createdAt: new Date(NOW),
      deletedAt: new Date(NOW + DAY),
      suspendedAt: null,
      nameResetRequired: false,
      kind: 'person',
    });
    // Ratings stay with the anonymous row (its games keep their players); the install is unlinked.
    expect(await t.db.$count(ratings, eq(ratings.userId, created.id))).toBe(3);
    expect((await t.db.select().from(installs))[0]?.userId).toBeNull();
  });

  it("deletes the server's copy of staged practice (user_levels, level_xp_days), keeps the XP; a new account starts empty", async () => {
    const { body: created } = await register('uid-1', { displayName: 'Dana' });
    const { body: other } = await register('uid-2', { displayName: 'Noa' });
    const levels = { levels: [{ id: 'L001', stars: 3, plays: 2 }] };
    const sync = async (uid: string) =>
      api<LevelsSyncResponse>('PUT', PROGRESS_PATHS.myLevels, { token: await idToken(uid), body: levels });
    expect((await sync('uid-1')).body).toMatchObject({ xp: 30 });
    expect((await sync('uid-2')).status).toBe(200);

    expect((await remove('uid-1')).status).toBe(204);
    expect(await t.db.$count(userLevels, eq(userLevels.userId, created.id))).toBe(0);
    expect(await t.db.$count(levelXpDays, eq(levelXpDays.userId, created.id))).toBe(0);
    // The XP stays with the anonymous row, as all XP does; another player's levels are untouched.
    expect((await t.db.select().from(xp).where(eq(xp.userId, created.id)))[0]?.xp).toBe(30);
    expect(await t.db.$count(userLevels, eq(userLevels.userId, other.id))).toBe(1);

    // The same sign-in registers again: a new id, so no levels.
    const again = await register('uid-1', { displayName: 'Dana' });
    expect(again.status).toBe(201);
    const mine = await api<MyLevels>('GET', PROGRESS_PATHS.myLevels, { token: await idToken('uid-1') });
    expect(mine.body).toEqual<MyLevels>({ levels: [], maxLevel: 300, owedXp: 0 });
  });

  it('the account is gone: 404 for me, a second delete and a change', async () => {
    await register('uid-1');
    expect((await remove('uid-1')).status).toBe(204);
    expect(await me('uid-1')).toMatchObject({ status: 404, body: { error: 'notRegistered' } });
    expect(await remove('uid-1')).toMatchObject({ status: 404, body: { error: 'notRegistered' } });
    expect((await patch('uid-1', { avatarId: 'microphone' })).status).toBe(404);
  });

  it('frees the name at once', async () => {
    await register('uid-1', { displayName: 'Dana' });
    expect((await names('dana')).body).toEqual({ available: false, reason: 'taken' });
    await remove('uid-1');
    expect((await names('dana')).body).toEqual({ available: true });
    expect((await register('uid-2', { displayName: 'DANA' })).status).toBe(201);
  });

  it('the same sign-in may register again (if deleting the Firebase user failed)', async () => {
    const first = await register('uid-1', { displayName: 'Dana' });
    await remove('uid-1');
    const again = await register('uid-1', { displayName: 'Dana' });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(first.body.id);
    expect(await t.db.$count(users)).toBe(2);
  });

  it('two deleted accounts never clash on their anonymous names', async () => {
    await register('uid-1', { displayName: 'Dana' });
    await remove('uid-1');
    await register('uid-2', { displayName: 'Dana' });
    expect((await remove('uid-2')).status).toBe(204);
    expect(await t.db.$count(users)).toBe(2);
  });

  describe('needs a fresh sign-in (ACCOUNT_DELETE_MAX_AUTH_AGE_MS: 5 minutes by default, like Firebase)', () => {
    /** A token issued now (a refresh) for a sign-in `ageMs` ago. */
    const signedInAgo = (uid: string, ageMs: number) =>
      tokens.sign(
        { uid, email: `${uid}@example.com`, extra: { auth_time: (clock.now() - ageMs) / 1000 } },
        clock.now(),
      );

    it('refuses a token whose sign-in is older, with the step-up answer of RFC 9470; nothing is deleted', async () => {
      const { body: created } = await register('uid-1');
      // The app kept refreshing its token for a day (auth_time stays), and nobody typed the password.
      clock.advance(DAY);
      const stale = await api<AccountError>('DELETE', ACCOUNT_PATHS.me, {
        token: await signedInAgo('uid-1', DAY + 60_000),
      });
      expect(stale.status).toBe(401);
      // Not `unauthorized`: refreshing the token would not help (it keeps the sign-in time).
      expect(stale.body).toEqual({
        error: 'reauthRequired',
        message: 'Sign in again: deleting the account needs a sign-in within the last 5 minutes',
      });
      expect(stale.headers.get('www-authenticate')).toBe(
        'Bearer error="insufficient_user_authentication", ' +
          'error_description="A recent sign-in is required", max_age=300',
      );
      expect((await userRow(created.id))?.deletedAt).toBeNull();
      // Just over the limit: still refused.
      const late = await api('DELETE', ACCOUNT_PATHS.me, {
        token: await signedInAgo('uid-1', RECENT_SIGN_IN_MS + 1000),
      });
      expect(late.status).toBe(401);
      // The other routes don't care how old the sign-in is.
      expect((await api('GET', ACCOUNT_PATHS.me, { token: await signedInAgo('uid-1', DAY) })).status).toBe(
        200,
      );
    });

    it('takes a sign-in made within the 5 minutes (re-authenticate, then a fresh token)', async () => {
      const { body: created } = await register('uid-1');
      clock.advance(DAY);
      const res = await api('DELETE', ACCOUNT_PATHS.me, {
        token: await signedInAgo('uid-1', RECENT_SIGN_IN_MS),
      });
      expect(res.status).toBe(204);
      expect((await userRow(created.id))?.deletedAt).toEqual(new Date(NOW + DAY));
    });

    it('development tokens have no sign-in time, and pass (outside production)', async () => {
      const token = 'dev:dana_dev';
      expect((await api('POST', ACCOUNT_PATHS.users, { token, body: fighter() })).status).toBe(201);
      clock.advance(DAY);
      expect((await api('DELETE', ACCOUNT_PATHS.me, { token })).status).toBe(204);
    });

    it('the limit is the setting ACCOUNT_DELETE_MAX_AUTH_AGE_MS', async () => {
      await start({ accountDeleteMaxAuthAgeMs: 60_000 });
      const { body: created } = await register('uid-1');
      const late = await api<AccountError>('DELETE', ACCOUNT_PATHS.me, {
        token: await signedInAgo('uid-1', 90_000),
      });
      expect(late.status).toBe(401);
      expect(late.body).toEqual({
        error: 'reauthRequired',
        message: 'Sign in again: deleting the account needs a sign-in within the last 1 minute',
      });
      expect(late.headers.get('www-authenticate')).toContain('max_age=60');
      const fresh = await api('DELETE', ACCOUNT_PATHS.me, { token: await signedInAgo('uid-1', 30_000) });
      expect(fresh.status).toBe(204);
      expect((await userRow(created.id))?.deletedAt).not.toBeNull();
    });

    it('in production a token without a sign-in time never deletes (even if dev tokens were let in)', async () => {
      await start({ nodeEnv: 'production' }, DEFAULT_ACCOUNT_LIMITS, true);
      const token = 'dev:dana_dev';
      const { body: created } = await api<Me>('POST', ACCOUNT_PATHS.users, { token, body: fighter() });
      const res = await api<AccountError>('DELETE', ACCOUNT_PATHS.me, { token });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('reauthRequired');
      expect((await userRow(created.id))?.deletedAt).toBeNull();
    });
  });
});

describe('GET /v1/names/available', () => {
  beforeEach(() => start());

  it('needs no token (step 1 of registration comes before the Firebase account)', async () => {
    expect(await names('Dana')).toMatchObject({ status: 200, body: { available: true } });
  });

  it('says why a name is not available', async () => {
    await register('uid-1', { displayName: 'Dana' });
    expect((await names('dana')).body).toEqual({ available: false, reason: 'taken' });
    expect((await names('ab')).body).toEqual({ available: false, reason: 'invalid', problem: 'tooShort' });
    expect((await names('a b c')).body).toEqual({
      available: false,
      reason: 'invalid',
      problem: 'invalidChars',
    });
    expect((await names('f.u.c.k')).body).toEqual({ available: false, reason: 'blocked' });
  });

  it('uses the same comparison as the unique index: case and Hebrew final letters', async () => {
    await register('uid-1', { displayName: 'שירן' });
    expect((await names('שירנ')).body).toEqual({ available: false, reason: 'taken' });
    expect((await names('שירן_1')).body).toEqual({ available: true });
  });

  it("the caller's own name is available to them (a case change), not to others", async () => {
    await register('uid-1', { displayName: 'Dana' });
    expect((await names('DANA', await idToken('uid-1'))).body).toEqual({ available: true });
    expect((await names('DANA', await idToken('uid-2'))).body).toEqual({ available: false, reason: 'taken' });
  });

  it('answers a bad token as if there were none', async () => {
    expect(await names('Dana', 'garbage')).toMatchObject({ status: 200, body: { available: true } });
  });

  it('400 without exactly one name', async () => {
    expect(await api('GET', ACCOUNT_PATHS.namesAvailable)).toMatchObject({
      status: 400,
      body: { error: 'badRequest', field: 'name' },
    });
    expect(await api('GET', `${ACCOUNT_PATHS.namesAvailable}?name=a&name=b`)).toMatchObject({ status: 400 });
  });
});

describe('rate limits', () => {
  const small: AccountLimits = {
    perIp: { limit: 20, windowMs: 60_000 },
    names: { limit: 3, windowMs: 60_000 },
    reads: { limit: 2, windowMs: 60_000 },
    writes: { limit: 2, windowMs: 60_000 },
  };
  beforeEach(() => start({}, small));

  it('the name check (typing): 429 with Retry-After past the limit, refilled with time', async () => {
    for (let i = 0; i < 3; i++) expect((await names(`Name${i}`)).status).toBe(200);
    const res = await names('Name4');
    expect(res).toMatchObject({ status: 429, body: { error: 'tooManyRequests' } });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    clock.advance(20_000);
    expect((await names('Name5')).status).toBe(200);
  });

  it('writes, per account', async () => {
    await register('uid-1');
    expect((await patch('uid-1', { avatarId: 'microphone' })).status).toBe(200);
    expect(await patch('uid-1', { avatarId: 'balloon' })).toMatchObject({
      status: 429,
      body: { error: 'tooManyRequests' },
    });
    // Another account has its own.
    expect((await register('uid-2', { displayName: 'Other' })).status).toBe(201);
  });

  it('reads, per account', async () => {
    await register('uid-1');
    expect((await me('uid-1')).status).toBe(200);
    expect((await me('uid-1')).status).toBe(200);
    expect((await me('uid-1')).status).toBe(429);
  });

  it('every account route, per IP', async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await api('GET', ACCOUNT_PATHS.me)).status;
    expect(last).toBe(429);
  });
});

describe('production', () => {
  it('without FIREBASE_PROJECT_ID: every account route answers 503 disabled', async () => {
    await start({ nodeEnv: 'production', firebaseProjectId: null });
    const token = await idToken('uid-1');
    for (const [method, p, body] of [
      ['GET', `${ACCOUNT_PATHS.namesAvailable}?name=Dana`, undefined],
      ['POST', ACCOUNT_PATHS.users, fighter()],
      ['GET', ACCOUNT_PATHS.me, undefined],
      ['PATCH', ACCOUNT_PATHS.me, { avatarId: 'microphone' }],
      ['DELETE', ACCOUNT_PATHS.me, undefined],
    ] as const) {
      const res = await api<AccountError>(method, p, { token, body });
      expect({ method, p, status: res.status, error: res.body.error }).toEqual({
        method,
        p,
        status: 503,
        error: 'disabled',
      });
    }
  });

  it('with a project: Firebase tokens work, development tokens are refused', async () => {
    await start({ nodeEnv: 'production' });
    expect((await register('uid-1')).status).toBe(201);
    const dev = await api<AccountError>('POST', ACCOUNT_PATHS.users, {
      token: 'dev:ana',
      body: fighter({ displayName: 'Ana' }),
    });
    expect(dev).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
  });
});

describe('the admin site sees the accounts', () => {
  it('lists real users, deleted ones marked', async () => {
    await start();
    const { signedInAdmin } = await import('../testing/admin');
    const { body: kept } = await register('uid-1', { displayName: 'Dana' });
    const { body: gone } = await register('uid-2', { displayName: 'Noa' });
    clock.advance(DAY);
    await remove('uid-2');

    const admin = await signedInAdmin(http.url);
    const list = await admin.get<{ items: { id: string; displayName: string; deletedAt: number | null }[] }>(
      '/users',
    );
    expect(list.status).toBe(200);
    const byId = new Map(list.body.items.map((u) => [u.id, u]));
    expect(byId.get(kept.id)).toMatchObject({ displayName: 'Dana', deletedAt: null });
    expect(byId.get(gone.id)).toMatchObject({
      displayName: expect.stringMatching(/^deleted:/),
      deletedAt: NOW + DAY,
    });

    const detail = await admin.get<{ ratings: { key: string }[]; email: string | null }>(`/users/${kept.id}`);
    expect(detail.body.ratings.map((r) => r.key)).toEqual(['fast', 'hard', 'normal']);
    expect(detail.body.email).toBe('uid-1@example.com');
  });
});

describe('avatars (spec §3.4)', () => {
  beforeEach(() => start());

  it('takes any of our own avatars, at registration and later', async () => {
    const created = await register('uid-1', { avatarId: 'coffee-cup' });
    expect(created).toMatchObject({ status: 201, body: { avatarId: 'coffee-cup' } });
    for (const avatarId of [AVATAR_IDS[0], AVATAR_IDS.at(-1), 'baby-dragon']) {
      expect(await patch('uid-1', { avatarId })).toMatchObject({ status: 200, body: { avatarId } });
    }
    expect((await userRow(created.body.id))?.avatarId).toBe('baby-dragon');
  });

  it('refuses an id of the old pack: it is never written again', async () => {
    expect(await register('uid-1', { avatarId: 'av07' as AvatarId })).toMatchObject({
      status: 400,
      body: { error: 'badRequest', field: 'avatarId' },
    });
    expect(await t.db.$count(users)).toBe(0);
    await register('uid-1');
    expect(await patch('uid-1', { avatarId: 'av07' })).toMatchObject({
      status: 400,
      body: { error: 'badRequest', field: 'avatarId' },
    });
  });

  it('reads an old id still in a row as its replacement, and an unknown one as "no avatar"', async () => {
    const created = await register('uid-1');
    await t.db.update(users).set({ avatarId: 'av39' }).where(eq(users.id, created.body.id));
    expect((await me('uid-1')).body.avatarId).toBe(LEGACY_AVATAR_MAP.av39);
    await t.db.update(users).set({ avatarId: 'av36' }).where(eq(users.id, created.body.id));
    expect((await me('uid-1')).body.avatarId).toBe(NO_AVATAR_ID);
  });
});
