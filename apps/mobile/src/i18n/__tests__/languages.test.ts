import { I18N_CONFIG } from '../../config/i18n';
import ENABLED from '../enabled-languages.json';
import {
  contentLanguage,
  ENABLED_LANGUAGES,
  isAppLanguage,
  isLanguage,
  isPseudoLanguage,
  isRtlLanguage,
  LANGUAGE_NAMES,
  languageName,
  LANGUAGES,
  PSEUDO_LANGUAGES,
} from '../languages';

/**
 * The app's languages (localization plan §1, 0א): the 19 in the plan's order, each by its own name, which are
 * right to left, which this build offers, and the language content falls back to (D101: English).
 */

describe('the languages (plan 0א)', () => {
  it('are the 19 of the plan, in its order, and two pseudo languages', () => {
    expect(LANGUAGES).toEqual([
      'he',
      'en',
      'ar',
      'es',
      'pt-BR',
      'de',
      'fr',
      'ja',
      'ru',
      'ko',
      'it',
      'tr',
      'zh-Hans',
      'id',
      'pl',
      'zh-Hant',
      'vi',
      'th',
      'nl',
    ]);
    expect(PSEUDO_LANGUAGES).toEqual(['en-XA', 'ar-XB']);
    expect(isLanguage('zh-Hant')).toBe(true);
    expect(isLanguage('zh')).toBe(false);
    expect(isLanguage('en-XA')).toBe(false);
    expect(isPseudoLanguage('ar-XB')).toBe(true);
    expect(isAppLanguage('en-XA')).toBe(true);
    expect(isAppLanguage('system')).toBe(false);
  });

  it('each is named in itself, the same whatever the app speaks', () => {
    expect(Object.keys(LANGUAGE_NAMES)).toEqual([...LANGUAGES]);
    expect(LANGUAGE_NAMES).toMatchObject({
      he: 'עברית',
      en: 'English',
      ar: 'العربية',
      'pt-BR': 'Português (Brasil)',
      de: 'Deutsch',
      ja: '日本語',
      'zh-Hans': '简体中文',
      'zh-Hant': '繁體中文',
      th: 'ไทย',
      nl: 'Nederlands',
    });
    expect(new Set(Object.values(LANGUAGE_NAMES)).size).toBe(LANGUAGES.length);
    expect(languageName('de')).toBe('Deutsch');
    // A pseudo language (development builds) by its code.
    expect(languageName('en-XA')).toBe('en-XA');
  });

  it('Hebrew, Arabic and the Arabic pseudo language are right to left; every other is not', () => {
    expect([...LANGUAGES, ...PSEUDO_LANGUAGES].filter(isRtlLanguage)).toEqual(['he', 'ar', 'ar-XB']);
    expect(isRtlLanguage('')).toBe(false);
  });

  it('this build offers the languages of enabled-languages.json: known codes, Hebrew and English among them', () => {
    expect((ENABLED as string[]).filter((code) => !isLanguage(code))).toEqual([]);
    expect(new Set(ENABLED).size).toBe(ENABLED.length);
    expect(ENABLED_LANGUAGES).toEqual(expect.arrayContaining(['he', 'en']));
    // In LANGUAGES' order, whatever the file's.
    expect(ENABLED_LANGUAGES).toEqual(LANGUAGES.filter((l) => (ENABLED as string[]).includes(l)));
  });

  it('content in a language it does not exist in falls back to English (D101)', () => {
    expect(contentLanguage('he', ['he', 'en'])).toBe('he');
    expect(contentLanguage('ar', ['he', 'en'])).toBe('en');
    expect(contentLanguage('zh-Hant', ['zh-Hans', 'en'])).toBe('en');
    // The same language as the config's fallback (change both together).
    expect(contentLanguage('xx', [])).toBe(I18N_CONFIG.fallbackLanguage);
  });
});
