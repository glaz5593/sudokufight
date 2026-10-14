import { createHash } from 'node:crypto';

import { authErrorCodeOf, toAuthError } from '../errors';
import {
  emailOk,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  passwordOk,
  passwordRules,
  passwordStrength,
  strengthLevel,
} from '../password';
import { redirectFor, ROUTES } from '../redirect';
import { sha256Hex } from '../sha256';
import { AuthError } from '../types';
import { canPlayRanked, canPractice } from '../verification';

describe('sha256Hex (the development sign-in hashes passwords with it)', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches Node for UTF-8 text of every width and for long inputs', () => {
    for (const s of ['שלום', 'סודוקו פייט 🎯', 'é', 'x'.repeat(55), 'y'.repeat(64), 'z'.repeat(1000)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});

describe('password rules (spec §3.1: at least 8 characters, nothing else)', () => {
  it('has one rule: the length', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_RULES).toEqual(['length']);
    expect(passwordRules('')).toEqual({ length: false });
    expect(passwordRules('a1')).toEqual({ length: false });
    expect(passwordRules('Arena12')).toEqual({ length: false });
    expect(passwordRules('Arena123')).toEqual({ length: true });
    // Characters, not UTF-16 units: an emoji is one.
    expect(passwordRules('🎯🎯🎯🎯🎯🎯🎯')).toEqual({ length: false });
    expect(passwordRules('🎯🎯🎯🎯🎯🎯🎯🎯')).toEqual({ length: true });
  });

  it('any 8 characters will do: no letter, digit, case or symbol needed ("not a bank account")', () => {
    for (const ok of ['abcdefgh', '12345678', 'ABCDEFGH', 'סיסמהארוכ', '!@#$%^&*', 'Arena1234']) {
      expect([ok, passwordOk(ok)]).toEqual([ok, true]);
    }
    for (const short of ['', 'a', 'abcdefg', '1234567', 'סיסמה']) {
      expect([short, passwordOk(short)]).toEqual([short, false]);
    }
  });

  it('meters the strength in 4 levels', () => {
    expect(passwordStrength('')).toBe(0);
    expect(strengthLevel(0)).toBeNull();
    // Too short: weak.
    expect(passwordStrength('abc')).toBe(1);
    // Predictable: weak, though allowed (the meter only advises).
    expect(passwordStrength('abcdefgh')).toBe(1);
    expect(passwordStrength('12345678')).toBe(1);
    expect(passwordStrength('abcdefg1')).toBe(1);
    expect(passwordStrength('aaaaaaa1')).toBe(1);
    // The rule and no more: fair, letters only too.
    expect(passwordStrength('arena4812')).toBe(2);
    expect(passwordStrength('mosheglz')).toBe(2);
    // Longer, more kinds: good (the design's "Fox.Arena42" is "סיסמה טובה").
    expect(passwordStrength('Fox.Arena42')).toBe(3);
    // Long and every kind: strong.
    expect(passwordStrength('Fox.Arena42!x')).toBe(4);
    expect(passwordStrength('correcthorse4battery')).toBe(2);
    expect(passwordStrength('Correcthorse4battery')).toBe(4);
    expect([1, 2, 3, 4].map((n) => strengthLevel(n as 1 | 2 | 3 | 4))).toEqual([
      'weak',
      'fair',
      'good',
      'strong',
    ]);
  });

  it('checks an email loosely (Firebase has the last word)', () => {
    expect(emailOk('mosheg@example.com')).toBe(true);
    expect(emailOk('  a@b.co ')).toBe(true);
    expect(emailOk('mosheg@example')).toBe(false);
    expect(emailOk('no at sign.com')).toBe(false);
    expect(emailOk('')).toBe(false);
  });
});

describe('Firebase errors in the app’s terms', () => {
  it('maps the codes the screens care about', () => {
    const cases: [string, string][] = [
      ['auth/wrong-password', 'wrongPassword'],
      ['auth/user-not-found', 'userNotFound'],
      ['auth/invalid-credential', 'invalidCredentials'],
      ['auth/too-many-requests', 'tooManyRequests'],
      ['auth/network-request-failed', 'network'],
      ['auth/email-already-in-use', 'emailInUse'],
      ['auth/invalid-email', 'invalidEmail'],
      ['auth/weak-password', 'weakPassword'],
      // A password policy in the Firebase console asking for more than 8 characters.
      ['auth/password-does-not-meet-requirements', 'weakPassword'],
      ['auth/requires-recent-login', 'requiresRecentLogin'],
      ['auth/user-disabled', 'userDisabled'],
      ['auth/something-new', 'unknown'],
    ];
    for (const [code, mapped] of cases) expect(authErrorCodeOf({ code })).toBe(mapped);
    expect(authErrorCodeOf(new Error('x'))).toBe('unknown');
    expect(authErrorCodeOf(null)).toBe('unknown');
  });

  it('wraps anything as an AuthError and keeps the cause', () => {
    const original = Object.assign(new Error('[auth/wrong-password] nope'), { code: 'auth/wrong-password' });
    const e = toAuthError(original);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.code).toBe('wrongPassword');
    expect(e.cause).toBe(original);
    const same = new AuthError('network');
    expect(toAuthError(same)).toBe(same);
    expect(toAuthError('boom').code).toBe('unknown');
  });
});

describe('where each auth status belongs (spec §4.2)', () => {
  it('loading: nowhere yet', () => {
    expect(redirectFor('loading', [])).toBeNull();
    expect(redirectFor('loading', ['login'])).toBeNull();
  });

  it('signed out: login, forgot password and the two registration steps only', () => {
    expect(redirectFor('signedOut', [])).toBe(ROUTES.login);
    expect(redirectFor('signedOut', ['settings'])).toBe(ROUTES.login);
    expect(redirectFor('signedOut', ['verify-email'])).toBe(ROUTES.login);
    for (const s of [['login'], ['forgot-password'], ['register', 'fighter'], ['register', 'account']]) {
      expect(redirectFor('signedOut', s)).toBeNull();
    }
  });

  it('signed in without a profile: step 1 of the registration', () => {
    expect(redirectFor('needsProfile', ['register', 'fighter'])).toBeNull();
    for (const s of [[], ['login'], ['register', 'account'], ['modes']]) {
      expect(redirectFor('needsProfile', s)).toBe(ROUTES.registerFighter);
    }
  });

  it('ready: everything but the sign-in screens, which lead home', () => {
    for (const s of [[], ['modes'], ['game'], ['results', '[id]'], ['verify-email'], ['edit-profile']]) {
      expect(redirectFor('ready', s)).toBeNull();
    }
    for (const s of [['login'], ['forgot-password'], ['register', 'fighter'], ['register', 'account']]) {
      expect(redirectFor('ready', s)).toBe(ROUTES.home);
    }
    // Groups in parentheses are not part of the path.
    expect(redirectFor('ready', ['(auth)', 'login'])).toBe(ROUTES.home);
  });
});

describe('what an unverified email may do [D22]', () => {
  const verified = { uid: 'u', email: 'a@b.co', emailVerified: true, methods: ['password'] as const };
  const unverified = { ...verified, emailVerified: false };
  // A Google sign-in comes with its address verified by Google (Firebase's emailVerified is true).
  const google = { uid: 'g', email: 'gamer@gmail.com', emailVerified: true, methods: ['google'] as const };

  it('practice: always (the V1 setting)', () => {
    expect(canPractice(unverified)).toBe(true);
    expect(canPractice(null)).toBe(true);
  });

  it('ranked: a verified address while the setting asks for it', () => {
    expect(canPlayRanked(verified)).toBe(true);
    expect(canPlayRanked(google)).toBe(true);
    expect(canPlayRanked(unverified)).toBe(false);
    expect(canPlayRanked(null)).toBe(false);
    expect(canPlayRanked(unverified, { blocksPractice: false, requiredForRanked: false })).toBe(true);
    expect(canPractice(unverified, { blocksPractice: true, requiredForRanked: true })).toBe(false);
  });
});
