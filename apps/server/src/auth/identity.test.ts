import {
  defaultIdentityVerifier,
  devIdentityVerifier,
  IdentityError,
  isIdentity,
  refusingIdentityVerifier,
  SIGN_IN_REQUIRED,
} from './identity';

const ask = (options: unknown, token?: string) =>
  devIdentityVerifier().verify({ token, options, ip: '127.0.0.1' });

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof IdentityError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('the dev identity (stage 7, outside production)', () => {
  it('takes devUserId and name from the join options', async () => {
    await expect(ask({ devUserId: 'ana_1', name: 'Ana' })).resolves.toEqual({ userId: 'ana_1', name: 'Ana' });
    await expect(ask({ devUserId: 'b-2', name: 'בני.כהן' })).resolves.toEqual({
      userId: 'b-2',
      name: 'בני.כהן',
    });
    // Other options travel in the same object (create options): they don't matter here.
    await expect(ask({ devUserId: 'c', name: 'Cyd', private: true, playerCount: 2 })).resolves.toMatchObject({
      userId: 'c',
    });
  });

  it('refuses a join without them', async () => {
    expect(await refusal(ask({}))).toMatchObject({ code: 'missing' });
    expect(await refusal(ask({ devUserId: 'ana' }))).toMatchObject({ code: 'missing' });
    expect(await refusal(ask(undefined))).toMatchObject({ code: 'missing' });
    expect(await refusal(ask('ana'))).toMatchObject({ code: 'missing' });
  });

  it.each([
    ['an empty id', { devUserId: '', name: 'Ana' }],
    ['an id with a space', { devUserId: 'a b', name: 'Ana' }],
    ['an id with a colon', { devUserId: 'a:b', name: 'Ana' }],
    ['a 65-character id', { devUserId: 'a'.repeat(65), name: 'Ana' }],
    ['a numeric id', { devUserId: 7, name: 'Ana' }],
    ['a 2-character name', { devUserId: 'ana', name: 'An' }],
    ['a 17-character name', { devUserId: 'ana', name: 'A'.repeat(17) }],
    ['a name with a space', { devUserId: 'ana', name: 'Ana B' }],
    ['a name with markup', { devUserId: 'ana', name: '<b>Ana</b>' }],
  ])('refuses %s', async (_why, options) => {
    expect(await refusal(ask(options))).toMatchObject({ code: 'invalid' });
  });
});

describe('production before stage 8', () => {
  it('refuses everyone, with a message that says why', async () => {
    const v = refusingIdentityVerifier();
    expect(await refusal(v.verify({ token: 'a-firebase-token', options: {}, ip: undefined }))).toEqual({
      code: 'disabled',
      message: SIGN_IN_REQUIRED,
    });
    // The dev identity does not get in either.
    expect(
      await refusal(
        v.verify({ token: undefined, options: { devUserId: 'ana', name: 'Ana' }, ip: undefined }),
      ),
    ).toMatchObject({ code: 'disabled' });
  });

  it('is what defaultIdentityVerifier gives production; development and tests get the dev identity', () => {
    expect(defaultIdentityVerifier({ nodeEnv: 'production' }).kind).toBe('refuse');
    expect(defaultIdentityVerifier({ nodeEnv: 'development' }).kind).toBe('dev');
    expect(defaultIdentityVerifier({ nodeEnv: 'test' }).kind).toBe('dev');
  });
});

describe('isIdentity', () => {
  it('checks what a verifier left on the connection', () => {
    expect(isIdentity({ userId: 'ana', name: 'Ana' })).toBe(true);
    expect(isIdentity({ userId: '', name: 'Ana' })).toBe(false);
    expect(isIdentity({ userId: 'ana' })).toBe(false);
    expect(isIdentity(true)).toBe(false);
    expect(isIdentity(undefined)).toBe(false);
  });
});
