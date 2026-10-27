import i18next from 'i18next';

import { LANGUAGES } from '../../i18n/languages';
import {
  createFirebaseAuthProvider,
  type FirebaseAuthModule,
  firebaseLanguageCode,
} from '../firebaseProvider';
import { fakeFirebase } from '../testing/fakeFirebase';

/**
 * Localization plan 0יב, D113: the emails Firebase sends (address verification, password reset) are in the
 * app's language. Until 1.1.0 every player got the template's own language (Hebrew).
 */

function setup(language: () => string | null, failLanguage = false) {
  const fake = fakeFirebase();
  const calls: string[] = [];
  const setLanguageCode = jest.fn(async (_auth: unknown, code: string | null) => {
    calls.push(`language:${code}`);
    if (failLanguage) throw new Error('native');
  });
  fake.mod.sendEmailVerification.mockImplementation(async () => {
    calls.push('verification');
  });
  fake.mod.sendPasswordResetEmail.mockImplementation(async () => {
    calls.push('reset');
  });
  const mod = { ...fake.mod, setLanguageCode } as unknown as FirebaseAuthModule;
  const provider = createFirebaseAuthProvider(() => mod, null, language);
  return { provider, calls, setLanguageCode, fake };
}

describe('Firebase’s emails in the app’s language (D113)', () => {
  it('names each language of the app as Firebase does: Chinese by region, the pseudo languages by their base', () => {
    for (const lang of LANGUAGES)
      expect({ lang, code: firebaseLanguageCode(lang) }).toEqual({
        lang,
        code: lang === 'zh-Hans' ? 'zh-CN' : lang === 'zh-Hant' ? 'zh-TW' : lang,
      });
    expect(firebaseLanguageCode('en-XA')).toBe('en');
    expect(firebaseLanguageCode('ar-XB')).toBe('ar');
    for (const none of [null, undefined, '', 'cimode', 'xx']) expect(firebaseLanguageCode(none)).toBeNull();
  });

  it('sets the language just before the verification email and the password reset email', async () => {
    let language = 'he';
    const { provider, calls, setLanguageCode } = setup(() => language);
    await provider.signUp('player@example.com', 'Arena1234');
    await provider.sendEmailVerification();
    language = 'en';
    await provider.sendPasswordReset(' player@example.com ');
    expect(calls).toEqual(['language:he', 'verification', 'language:en', 'reset']);
    expect(setLanguageCode).toHaveBeenCalledWith(expect.anything(), 'he');
  });

  it('never fails an email for it: no language, a module without setLanguageCode, or a native failure', async () => {
    const none = setup(() => null);
    await none.provider.sendPasswordReset('player@example.com');
    expect(none.calls).toEqual(['reset']);

    const failing = setup(() => 'ar', true);
    await failing.provider.sendPasswordReset('player@example.com');
    expect(failing.calls).toEqual(['language:ar', 'reset']);

    // An older module (or the test stand-in) without the function.
    const fake = fakeFirebase();
    const old = createFirebaseAuthProvider(
      () => fake.mod as unknown as FirebaseAuthModule,
      null,
      () => 'en',
    );
    await expect(old.sendPasswordReset('player@example.com')).resolves.toBeUndefined();
    expect(fake.mod.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('without a signed-in player, the verification email fails as before (noUser), and no language is set', async () => {
    const { provider, setLanguageCode } = setup(() => 'en');
    await expect(provider.sendEmailVerification()).rejects.toMatchObject({ code: 'noUser' });
    expect(setLanguageCode).not.toHaveBeenCalled();
  });

  it('by default, the language i18next has now', async () => {
    const fake = fakeFirebase();
    const setLanguageCode = jest.fn(async () => undefined);
    const mod = { ...fake.mod, setLanguageCode } as unknown as FirebaseAuthModule;
    const before = i18next.language;
    i18next.language = 'zh-Hant';
    try {
      await createFirebaseAuthProvider(() => mod).sendPasswordReset('player@example.com');
      expect(setLanguageCode).toHaveBeenCalledWith(expect.anything(), 'zh-TW');
    } finally {
      i18next.language = before;
    }
  });
});
