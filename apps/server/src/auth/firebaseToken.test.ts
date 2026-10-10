import { generateKeyPair, SignJWT } from 'jose';

import { fakeClock } from '../testing/clock';
import { TEST_FIREBASE_PROJECT_ID } from '../testing/config';
import { TEST_KID, testTokens, type TestTokens } from '../testing/tokens';
import {
  bearerToken,
  createTokenVerifier,
  DEFAULT_CLOCK_SKEW_SEC,
  MAX_TOKEN_LENGTH,
  tokenVerifierFor,
  type VerifyResult,
} from './firebaseToken';
import { KeysUnavailableError } from './googleKeys';

const NOW = Date.UTC(2026, 9, 9, 12);
const clock = fakeClock(NOW);
let tokens: TestTokens;

beforeAll(async () => {
  tokens = await testTokens();
});
beforeEach(() => clock.set(NOW));

const verify = (token: string, options?: Parameters<TestTokens['verifier']>[1]) =>
  tokens.verifier(clock.now, options).verifyIdToken(token);

const failure = (r: VerifyResult) => (r.ok ? 'ok' : r.failure);

describe('Firebase ID tokens', () => {
  it('takes a good token: the uid, the email, whether it is verified, and when the user signed in', async () => {
    const token = await tokens.sign({ uid: 'abc123', email: 'dana@example.com', emailVerified: false }, NOW);
    expect(await verify(token)).toEqual({
      ok: true,
      token: {
        uid: 'abc123',
        email: 'dana@example.com',
        emailVerified: false,
        kind: 'firebase',
        // testTokens signs in a minute before issuing the token.
        signedInAt: NOW - 60_000,
      },
    });
    const verified = await tokens.sign({ uid: 'abc123', email: 'dana@example.com' }, NOW);
    expect(await verify(verified)).toMatchObject({ ok: true, token: { emailVerified: true } });
  });

  it('a token without an email has email null, unverified', async () => {
    expect(await verify(await tokens.sign({ uid: 'u' }, NOW))).toMatchObject({
      ok: true,
      token: { uid: 'u', email: null, emailVerified: false },
    });
  });

  it('refuses another project: wrong audience or issuer', async () => {
    const aud = await tokens.sign({ extra: { aud: 'someone-else' } }, NOW);
    expect(await verify(aud)).toMatchObject({
      ok: false,
      failure: 'invalid',
      message: expect.stringMatching(/aud/),
    });
    const iss = await tokens.sign({ extra: { iss: 'https://securetoken.google.com/someone-else' } }, NOW);
    expect(await verify(iss)).toMatchObject({
      ok: false,
      failure: 'invalid',
      message: expect.stringMatching(/iss/),
    });
    const google = await tokens.sign({ extra: { iss: 'https://accounts.google.com' } }, NOW);
    expect(failure(await verify(google))).toBe('invalid');
  });

  it('refuses other algorithms, even with our key id', async () => {
    const secret = new TextEncoder().encode('a shared secret that is long enough for HS256!!');
    const hs = await new SignJWT({ sub: 'u', aud: TEST_FIREBASE_PROJECT_ID })
      .setProtectedHeader({ alg: 'HS256', kid: TEST_KID })
      .sign(secret);
    expect(await verify(hs)).toMatchObject({ ok: false, failure: 'invalid' });

    const ec = await generateKeyPair('ES256');
    expect(failure(await verify(await tokens.sign({}, NOW, { alg: 'ES256', key: ec.privateKey })))).toBe(
      'invalid',
    );

    const ps = await generateKeyPair('PS256');
    expect(failure(await verify(await tokens.sign({}, NOW, { alg: 'PS256', key: ps.privateKey })))).toBe(
      'invalid',
    );

    // alg "none": header {"alg":"none"}, no signature.
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', kid: TEST_KID })}.${b64({ sub: 'u' })}.`;
    expect(failure(await verify(none))).toBe('invalid');
  });

  it('refuses an unknown key id, a missing one, and a forged signature', async () => {
    expect(await verify(await tokens.sign({}, NOW, { kid: 'other-key' }))).toMatchObject({
      ok: false,
      failure: 'invalid',
      message: expect.stringMatching(/ERR_JWKS_NO_MATCHING_KEY/),
    });
    expect(await verify(await tokens.sign({}, NOW, { kid: null }))).toMatchObject({
      ok: false,
      failure: 'invalid',
      message: 'no key id (kid)',
    });
    const forger = await generateKeyPair('RS256');
    expect(await verify(await tokens.sign({}, NOW, { key: forger.privateKey }))).toMatchObject({
      ok: false,
      failure: 'invalid',
      message: expect.stringMatching(/signature/),
    });
  });

  it('refuses an expired token as expired (the app refreshes it); a little skew is fine', async () => {
    const token = await tokens.sign({}, NOW);
    clock.set(NOW + 3600_000 + DEFAULT_CLOCK_SKEW_SEC * 1000 - 1000);
    expect(failure(await verify(token))).toBe('ok');
    clock.set(NOW + 3600_000 + DEFAULT_CLOCK_SKEW_SEC * 1000 + 1000);
    expect(await verify(token)).toMatchObject({ ok: false, failure: 'expired' });
  });

  it('refuses a token issued in the future, beyond the skew', async () => {
    const soon = await tokens.sign({}, NOW + (DEFAULT_CLOCK_SKEW_SEC - 5) * 1000);
    expect(failure(await verify(soon))).toBe('ok');
    const later = await tokens.sign({}, NOW + (DEFAULT_CLOCK_SKEW_SEC + 5) * 1000);
    expect(await verify(later)).toMatchObject({
      ok: false,
      failure: 'invalid',
      message: 'issued in the future (iat)',
    });
  });

  it('keeps the sign-in time of a refreshed token (auth_time stays, iat moves on)', async () => {
    const signedIn = NOW - 3 * 3600_000;
    const refreshed = await tokens.sign({ extra: { auth_time: signedIn / 1000 } }, NOW);
    expect(await verify(refreshed)).toMatchObject({ ok: true, token: { signedInAt: signedIn } });
  });

  it('refuses a sign-in time (auth_time) in the future, or none', async () => {
    const future = await tokens.sign({ extra: { auth_time: NOW / 1000 + 3600 } }, NOW);
    expect(await verify(future)).toMatchObject({ ok: false, message: 'signed in in the future (auth_time)' });
    const missing = await tokens.sign({ extra: { auth_time: undefined } }, NOW);
    expect(await verify(missing)).toMatchObject({ ok: false, message: expect.stringMatching(/auth_time/) });
    const text = await tokens.sign({ extra: { auth_time: 'yesterday' } }, NOW);
    expect(failure(await verify(text))).toBe('invalid');
  });

  it('refuses a token without a subject (uid)', async () => {
    const missing = await tokens.sign({ extra: { sub: undefined } }, NOW);
    expect(await verify(missing)).toMatchObject({
      ok: false,
      failure: 'invalid',
      message: expect.stringMatching(/sub/),
    });
    const empty = await tokens.sign({ extra: { sub: '' } }, NOW);
    expect(await verify(empty)).toMatchObject({ ok: false, message: 'no subject (sub)' });
    const long = await tokens.sign({ extra: { sub: 'u'.repeat(129) } }, NOW);
    expect(failure(await verify(long))).toBe('invalid');
    const number = await tokens.sign({ extra: { sub: 42 } }, NOW);
    expect(failure(await verify(number))).toBe('invalid');
  });

  it('refuses tokens without exp or iat', async () => {
    expect(failure(await verify(await tokens.sign({ extra: { exp: undefined } }, NOW)))).toBe('invalid');
    expect(failure(await verify(await tokens.sign({ extra: { iat: undefined } }, NOW)))).toBe('invalid');
  });

  it.each([
    ['empty', ''],
    ['garbage', 'not-a-token'],
    ['three dots of garbage', 'a.b.c'],
    ['too long', 'x'.repeat(MAX_TOKEN_LENGTH + 1)],
  ])('refuses %s', async (_why, token) => {
    expect(failure(await verify(token))).toBe('invalid');
  });

  it('refuses Firebase tokens when the server has no Firebase project', async () => {
    const token = await tokens.sign({}, NOW);
    expect(await verify(token, { projectId: null })).toMatchObject({
      ok: false,
      failure: 'invalid',
      message: expect.stringMatching(/FIREBASE_PROJECT_ID/),
    });
  });

  it("answers unavailable when Google's keys can't be fetched", async () => {
    const verifier = createTokenVerifier({
      projectId: TEST_FIREBASE_PROJECT_ID,
      devTokens: false,
      now: clock.now,
      keys: () => Promise.reject(new KeysUnavailableError('down')),
    });
    expect(await verifier.verifyIdToken(await tokens.sign({}, NOW))).toEqual({
      ok: false,
      failure: 'unavailable',
      message: 'down',
    });
  });
});

describe('development tokens', () => {
  it('outside production: dev:<uid> is taken as is, its uid kept apart from Firebase uids', async () => {
    expect(await verify('dev:ana_1')).toEqual({
      ok: true,
      token: { uid: 'dev:ana_1', email: null, emailVerified: false, kind: 'dev', signedInAt: null },
    });
    expect(await verify('dev:ana:ana@example.com')).toEqual({
      ok: true,
      token: { uid: 'dev:ana', email: 'ana@example.com', emailVerified: true, kind: 'dev', signedInAt: null },
    });
    // Without Firebase too: that's what they are for.
    expect(failure(await verify('dev:ana', { projectId: null }))).toBe('ok');
  });

  it('refuses a malformed one', async () => {
    expect(failure(await verify('dev:a b'))).toBe('invalid');
    expect(failure(await verify('dev:'))).toBe('invalid');
  });

  it('refuses every dev token in production', async () => {
    const production = tokenVerifierFor({ nodeEnv: 'production', firebaseProjectId: 'p-roject' }, clock.now);
    expect(production.devTokens).toBe(false);
    expect(await production.verifyIdToken('dev:ana')).toEqual({
      ok: false,
      failure: 'invalid',
      message: 'development tokens are refused here',
    });
    expect(tokenVerifierFor({ nodeEnv: 'development', firebaseProjectId: null }, clock.now).devTokens).toBe(
      true,
    );
    expect(tokenVerifierFor({ nodeEnv: 'test', firebaseProjectId: null }, clock.now).devTokens).toBe(true);
  });
});

describe('bearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer dev:ana', 'dev:ana'],
    ['BEARER   x  ', 'x'],
    [undefined, undefined],
    ['', undefined],
    ['Bearer', undefined],
    ['Bearer ', undefined],
    ['Basic dXNlcjpwYXNz', undefined],
    ['Bearer a b', undefined],
    ['Bearerabc', undefined],
  ])('%j → %j', (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });
});
