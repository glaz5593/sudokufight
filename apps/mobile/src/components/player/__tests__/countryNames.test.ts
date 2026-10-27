import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { COUNTRY_CODES } from '@sudoku-fight/protocol';

import { LANGUAGES, type Language } from '../../../i18n/languages';
import { eagerImports } from '../../../testing/importGraph';
import { countryName, countryNames, countryNamesLanguage } from '../countryFlag';

/**
 * Country names are our own tables (i18n/countries/<lang>.json, scripts/gen-country-names.ts), not the
 * phone's: Hermes has no Intl.DisplayNames, so the first APK showed "IL" where "ישראל" belongs (Moshe's
 * device test, 14.10.2026). Every language of the app has its table (localization plan 0ז, §6.1 #14: 250
 * codes × 19 languages), read the first time a name is shown in that language. A code added to COUNTRY_CODES,
 * or a language added to LANGUAGES, fails here until the generator runs again.
 */

const COUNTRIES_DIR = join(__dirname, '..', '..', '..', 'i18n', 'countries');

/** The script each language's names are written in (a letter of it in every name). */
const SCRIPT: Readonly<Record<Language, RegExp>> = (() => {
  const latin = /[A-Za-z]/;
  return {
    he: /[א-ת]/,
    en: latin,
    ar: /[؀-ۿ]/,
    es: latin,
    'pt-BR': latin,
    de: latin,
    fr: latin,
    ja: /[぀-ヿ一-鿿]/,
    ru: /[а-яё]/i,
    ko: /[가-힯]/,
    it: latin,
    tr: latin,
    'zh-Hans': /[一-鿿]/,
    id: latin,
    pl: latin,
    'zh-Hant': /[一-鿿]/,
    vi: latin,
    th: /[฀-๿]/,
    nl: latin,
  };
})();

describe('country names (19 languages, every code the server accepts)', () => {
  it('there is one table per language of the app, and no other', () => {
    const files = readdirSync(COUNTRIES_DIR).filter((f) => f.endsWith('.json'));
    expect(files.map((f) => f.replace(/\.json$/, '')).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each([...LANGUAGES])('%s names every country in COUNTRY_CODES, and nothing else', (lang) => {
    const table = countryNames(lang);
    expect(Object.keys(table).sort()).toEqual([...COUNTRY_CODES].sort());
    for (const code of COUNTRY_CODES) {
      const name = table[code]!;
      // A whole name (one letter can be one: 괌, Guam), not the code again (what the phone showed), in the
      // language's own script.
      expect([
        code,
        name.length > 0 && name === name.trim() && name !== code,
        SCRIPT[lang].test(name),
      ]).toEqual([code, true, true]);
    }
  });

  it('Hebrew names are in Hebrew, English ones in Latin letters', () => {
    for (const code of COUNTRY_CODES) {
      expect([code, /[א-ת]/.test(countryNames('he')[code]!)]).toEqual([code, true]);
      expect([
        code,
        /[א-ת]/.test(countryNames('en')[code]!),
        /[A-Za-z]/.test(countryNames('en')[code]!),
      ]).toEqual([code, false, true]);
    }
  });

  it('names countries without Intl.DisplayNames, as on the phone (Hermes)', () => {
    const real = Object.getOwnPropertyDescriptor(Intl, 'DisplayNames')!;
    Object.defineProperty(Intl, 'DisplayNames', { ...real, value: undefined });
    try {
      expect(typeof Intl.DisplayNames).toBe('undefined');
      expect(countryName('IL', 'he')).toBe('ישראל');
      expect(countryName('US', 'he')).toBe('ארצות הברית');
      expect(countryName('de', 'en')).toBe('Germany');
      expect(countryName('XK', 'en')).toBe('Kosovo');
      expect(countryName('GB', 'he')).toBe('בריטניה');
      expect(countryName('IL', 'tr')).toBe('İsrail');
      expect(countryName('DE', 'ja')).toBe('ドイツ');
    } finally {
      Object.defineProperty(Intl, 'DisplayNames', real);
    }
  });

  it('reads the table of the whole language code, after the device mapping (D105)', () => {
    expect(countryName('FR', 'he')).toBe('צרפת');
    expect(countryName('FR', 'he-IL')).toBe('צרפת');
    expect(countryName('FR', 'iw')).toBe('צרפת');
    expect(countryName('FR', 'en')).toBe('France');
    expect(countryName('FR', 'en-GB')).toBe('France');
    expect(countryName('FR', 'de')).toBe('Frankreich');
    expect(countryName('FR', 'tr')).toBe('Fransa');
    expect(countryName('FR', 'es-MX')).toBe('Francia');
    expect(countryName('FR', 'pt-PT')).toBe('França');
    expect(countryName('FR', 'in')).toBe('Prancis');
    // zh-Hans and zh-Hant are two tables, not one "zh".
    expect(countryName('US', 'zh-Hans')).toBe('美国');
    expect(countryName('US', 'zh-Hant')).toBe('美國');
    expect(countryName('US', 'zh-TW')).toBe('美國');
    expect(countryName('US', 'zh-HK')).toBe('美國');
    expect(countryName('US', 'zh-CN')).toBe('美国');
    expect(countryName('US', 'zh')).toBe('美国');
  });

  it('the pseudo languages and a language the app lacks read English (D101)', () => {
    expect(countryNamesLanguage('en-XA')).toBe('en');
    expect(countryNamesLanguage('ar-XB')).toBe('en');
    expect(countryNamesLanguage('hi')).toBe('en');
    expect(countryNamesLanguage('')).toBe('en');
    expect(countryName('FR', 'ar-XB')).toBe('France');
    expect(countryName('FR', 'hi')).toBe('France');
    expect(countryNamesLanguage('ar')).toBe('ar');
    expect(countryNamesLanguage('zh-Hant')).toBe('zh-Hant');
    expect(countryNamesLanguage('pt-BR')).toBe('pt-BR');
  });

  it('a code it does not know stays a code', () => {
    expect(countryName('qq', 'he')).toBe('QQ');
    expect(countryName('EU', 'en')).toBe('EU');
    expect(countryName('EU', 'ko')).toBe('EU');
  });
});

describe('the tables load on first use', () => {
  const table = (lang: Language) => `../../../i18n/countries/${lang}.json`;

  afterEach(() => {
    for (const lang of LANGUAGES) jest.dontMock(table(lang));
  });

  it('countryFlag imports no table when it loads (the start reads none of them)', () => {
    const file = join(__dirname, '..', 'countryFlag.ts');
    expect(eagerImports(file).filter((spec) => spec.includes('/countries/'))).toEqual([]);
  });

  it('the first name in a language reads that table once, and no other', () => {
    jest.isolateModules(() => {
      const read: string[] = [];
      for (const lang of LANGUAGES) {
        jest.doMock(table(lang), () => {
          read.push(lang);
          return { FR: `FR in ${lang}` };
        });
      }
      const flag = jest.requireActual<typeof import('../countryFlag')>('../countryFlag');
      expect(read).toEqual([]);
      expect(flag.countryName('FR', 'tr')).toBe('FR in tr');
      expect(flag.countryName('DE', 'tr')).toBe('DE');
      expect(read).toEqual(['tr']);
      expect(flag.countryName('FR', 'zh-TW')).toBe('FR in zh-Hant');
      expect(read).toEqual(['tr', 'zh-Hant']);
    });
  });
});
