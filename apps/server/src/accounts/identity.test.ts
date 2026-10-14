import { devToken } from '@sudoku-fight/protocol';
import { eq } from 'drizzle-orm';

import { devIdentityVerifier, IdentityError, SIGN_IN_REQUIRED } from '../auth/identity';
import { users } from '../db/schema';
import { fakeClock } from '../testing/clock';
import { createTestDb, type TestDb } from '../testing/db';
import { testTokens, type TestTokens } from '../testing/tokens';
import { ACCOUNT_SUSPENDED, accountIdentityVerifier, ACCOUNTS_OFF, roomIdentityVerifier } from './identity';

const NOW = Date.UTC(2026, 9, 9, 12);
const clock = fakeClock(NOW);

let t: TestDb;
let tokens: TestTokens;
beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
}, 30_000);
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await t.db.insert(users).values([
    { id: 'user-1', firebaseUid: 'uid-1', displayName: 'Dana' },
    { id: 'user-2', firebaseUid: 'deleted:user-2', displayName: 'deleted:x', deletedAt: new Date(NOW) },
    { id: 'user-3', firebaseUid: 'dev:devuid3', displayName: 'Dev_Dan' },
  ]);
});

const ask = (token: string | undefined, options: unknown = {}, withFallback = false) =>
  accountIdentityVerifier({
    tokens: tokens.verifier(clock.now),
    db: () => t.db,
    fallback: withFallback ? devIdentityVerifier() : undefined,
  }).verify({ token, options, ip: '127.0.0.1' });

async function refusal(p: Promise<unknown>) {
  return (await refusalOf(p)).code;
}

async function refusalOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof IdentityError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('the account identity of a room join', () => {
  it('is the account of the token: users.id and the display name, never the Firebase uid', async () => {
    await expect(ask(await tokens.sign({ uid: 'uid-1' }, NOW))).resolves.toEqual({
      userId: 'user-1',
      name: 'Dana',
    });
  });

  it('refuses no token, a bad token, and a sign-in without a (live) account', async () => {
    expect(await refusal(ask(undefined))).toBe('missing');
    expect(await refusal(ask('garbage'))).toBe('invalid');
    expect(await refusal(ask(await tokens.sign({ uid: 'uid-9' }, NOW)))).toBe('invalid');
  });

  it('refuses a suspended account (spec §3.5), before the email check; lifting it lets the account in', async () => {
    await t.db
      .update(users)
      .set({ suspendedAt: new Date(NOW) })
      .where(eq(users.id, 'user-1'));
    const token = await tokens.sign({ uid: 'uid-1', emailVerified: false }, NOW);
    const strict = accountIdentityVerifier({
      tokens: tokens.verifier(clock.now),
      db: () => t.db,
      requireVerifiedEmail: true,
    });
    const refused = await refusalOf(strict.verify({ token, options: {}, ip: undefined }));
    expect(refused).toEqual({ code: 'suspended', message: ACCOUNT_SUSPENDED });
    await t.db.update(users).set({ suspendedAt: null }).where(eq(users.id, 'user-1'));
    expect(await refusal(strict.verify({ token, options: {}, ip: undefined }))).toBe('emailNotVerified');
    await expect(ask(await tokens.sign({ uid: 'uid-1' }, NOW))).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('without a token, the fallback (the development identity) decides', async () => {
    await expect(ask(undefined, { devUserId: 'ana', name: 'Ana' }, true)).resolves.toEqual({
      userId: 'ana',
      name: 'Ana',
    });
    // A token still wins over the join options.
    await expect(
      ask(await tokens.sign({ uid: 'uid-1' }, NOW), { devUserId: 'ana', name: 'Ana' }, true),
    ).resolves.toEqual({
      userId: 'user-1',
      name: 'Dana',
    });
  });
});

describe('roomIdentityVerifier: who may join a game room on this server', () => {
  const room = (nodeEnv: 'production' | 'development' | 'test', projectId?: string | null) =>
    roomIdentityVerifier({
      config: { nodeEnv },
      tokens: tokens.verifier(clock.now, {
        devTokens: nodeEnv !== 'production',
        ...(projectId === undefined ? {} : { projectId }),
      }),
      db: () => t.db,
    });
  const join = (nodeEnv: 'production' | 'development' | 'test', token: string | undefined, options = {}) =>
    room(nodeEnv).verify({ token, options, ip: '127.0.0.1' });
  const DEV_JOIN = { devUserId: 'ana', name: 'Ana' };

  it('production: a Firebase token of a live account, nothing else', async () => {
    expect(room('production').kind).toBe('account');
    await expect(join('production', await tokens.sign({ uid: 'uid-1' }, NOW))).resolves.toEqual({
      userId: 'user-1',
      name: 'Dana',
    });
    // The development identity and development tokens are refused, even for an account that exists.
    expect(await refusalOf(join('production', undefined, DEV_JOIN))).toEqual({
      code: 'missing',
      message: SIGN_IN_REQUIRED,
    });
    expect(await refusal(join('production', devToken('devuid3')))).toBe('invalid');
    expect(await refusal(join('production', devToken('devuid3', 'dan@example.com'), DEV_JOIN))).toBe(
      'invalid',
    );
    // A deleted account, an unregistered sign-in, an expired, forged or foreign token.
    expect(await refusal(join('production', await tokens.sign({ uid: 'deleted:user-2' }, NOW)))).toBe(
      'invalid',
    );
    expect(await refusal(join('production', await tokens.sign({ uid: 'uid-9' }, NOW)))).toBe('invalid');
    expect(await refusal(join('production', await tokens.sign({ uid: 'uid-1' }, NOW - 2 * 3600_000)))).toBe(
      'invalid',
    );
    const foreign = await testTokens();
    expect(await refusal(join('production', await foreign.sign({ uid: 'uid-1' }, NOW)))).toBe('invalid');
  });

  it('production without FIREBASE_PROJECT_ID: nobody joins, and the message says why', async () => {
    const off = room('production', null);
    expect(off.kind).toBe('refuse');
    expect(
      await refusalOf(off.verify({ token: await tokens.sign({ uid: 'uid-1' }, NOW), options: {}, ip: '' })),
    ).toEqual({ code: 'disabled', message: ACCOUNTS_OFF });
  });

  it('production refuses to start with a verifier that takes development tokens (a wiring bug)', () => {
    expect(() =>
      roomIdentityVerifier({
        config: { nodeEnv: 'production' },
        tokens: tokens.verifier(clock.now, { devTokens: true }),
        db: () => t.db,
      }),
    ).toThrow(/development tokens/);
  });

  it.each(['development', 'test'] as const)(
    '%s: a token of a live account (Firebase or dev), else the development identity',
    async (env) => {
      expect(room(env).kind).toBe('account+dev');
      await expect(join(env, devToken('devuid3'))).resolves.toEqual({ userId: 'user-3', name: 'Dev_Dan' });
      await expect(join(env, await tokens.sign({ uid: 'uid-1' }, NOW))).resolves.toEqual({
        userId: 'user-1',
        name: 'Dana',
      });
      await expect(join(env, undefined, DEV_JOIN)).resolves.toEqual({ userId: 'ana', name: 'Ana' });
      // A token that does not hold up is refused, not swapped for the identity in the options.
      expect(await refusal(join(env, devToken('nobody'), DEV_JOIN))).toBe('invalid');
      expect(await refusal(join(env, 'garbage', DEV_JOIN))).toBe('invalid');
    },
  );
});
