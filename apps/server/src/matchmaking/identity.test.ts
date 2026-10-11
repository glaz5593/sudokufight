import { devToken } from '@sudoku-fight/protocol';

import { ACCOUNTS_OFF, EMAIL_NOT_VERIFIED } from '../accounts/identity';
import { IdentityError } from '../auth/identity';
import type { NodeEnv } from '../config';
import { users } from '../db/schema';
import { fakeClock } from '../testing/clock';
import { createTestDb, type TestDb } from '../testing/db';
import { testTokens, type TestTokens } from '../testing/tokens';
import { matchmakingIdentityVerifier } from './identity';

/**
 * Who may join the ranked queue (spec §3, §21; D22): a live account, and with RANKED_REQUIRES_VERIFIED_EMAIL
 * (the default) one whose token says the email is verified. Development tokens count as verified, and are
 * taken only outside production.
 */

const NOW = Date.UTC(2026, 9, 11, 12);
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

const queue = (nodeEnv: NodeEnv, rankedRequiresVerifiedEmail = true, projectId?: string | null) =>
  matchmakingIdentityVerifier({
    config: { nodeEnv, rankedRequiresVerifiedEmail },
    tokens: tokens.verifier(clock.now, {
      devTokens: nodeEnv !== 'production',
      ...(projectId === undefined ? {} : { projectId }),
    }),
    db: () => t.db,
  });

const join = (verifier: ReturnType<typeof queue>, token: string | undefined) =>
  verifier.verify({ token, options: { queueKey: 'fast-2p' }, ip: '127.0.0.1' });

/** A Firebase token of uid-1, its email verified or not. */
const firebase = (emailVerified: boolean, uid = 'uid-1') =>
  tokens.sign({ uid, email: `${uid}@example.com`, emailVerified }, NOW);

async function refusalOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof IdentityError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('expected a refusal');
}

const DANA = { userId: 'user-1', name: 'Dana' };

describe.each(['production', 'test'] as const)('the ranked queue (%s)', (env) => {
  it('takes an account whose email is verified, and refuses one whose email is not', async () => {
    await expect(join(queue(env), await firebase(true))).resolves.toEqual(DANA);
    expect(await refusalOf(join(queue(env), await firebase(false)))).toEqual({
      code: 'emailNotVerified',
      message: EMAIL_NOT_VERIFIED,
    });
    // A sign-in with no email at all has none verified.
    expect((await refusalOf(join(queue(env), await tokens.sign({ uid: 'uid-1' }, NOW)))).code).toBe(
      'emailNotVerified',
    );
  });

  it('RANKED_REQUIRES_VERIFIED_EMAIL=false: an unverified email is let in', async () => {
    await expect(join(queue(env, false), await firebase(false))).resolves.toEqual(DANA);
    await expect(join(queue(env, false), await firebase(true))).resolves.toEqual(DANA);
  });

  it('no account, no token or a bad one is "invalid" or "missing" first, verified or not', async () => {
    for (const verified of [true, false]) {
      expect((await refusalOf(join(queue(env), await firebase(verified, 'uid-9')))).code).toBe('invalid');
      expect((await refusalOf(join(queue(env), await firebase(verified, 'deleted:user-2')))).code).toBe(
        'invalid',
      );
    }
    expect((await refusalOf(join(queue(env), undefined))).code).toBe('missing');
    expect((await refusalOf(join(queue(env), 'garbage'))).code).toBe('invalid');
  });
});

describe('development tokens', () => {
  it('count as verified outside production, with or without an email', async () => {
    const dan = { userId: 'user-3', name: 'Dev_Dan' };
    await expect(join(queue('test'), devToken('devuid3'))).resolves.toEqual(dan);
    await expect(join(queue('development'), devToken('devuid3', 'dan@example.com'))).resolves.toEqual(dan);
  });

  it('are refused in production, as before', async () => {
    expect((await refusalOf(join(queue('production'), devToken('devuid3')))).code).toBe('invalid');
  });
});

it('production without FIREBASE_PROJECT_ID: nobody searches, and the message says why', async () => {
  expect(await refusalOf(join(queue('production', true, null), await firebase(true)))).toEqual({
    code: 'disabled',
    message: ACCOUNTS_OFF,
  });
});
