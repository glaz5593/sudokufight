import { COUNTRY_CODES } from '@sudoku-fight/protocol';

import { COUNTRY_NAMES, countryName } from '../countryFlag';

/**
 * Country names are our own tables (i18n/countries/<lang>.json, scripts/gen-country-names.ts), not the
 * phone's: Hermes has no Intl.DisplayNames, so the first APK showed "IL" where "ישראל" belongs (Moshe's
 * device test, 14.10.2026). A code added to COUNTRY_CODES fails here until the generator runs again.
 */

const HEBREW = /[א-ת]/;

describe('country names (he + en, every code the server accepts)', () => {
  it.each(['he', 'en'] as const)('%s names every country in COUNTRY_CODES, and nothing else', (lang) => {
    const table = COUNTRY_NAMES[lang];
    expect(Object.keys(table).sort()).toEqual([...COUNTRY_CODES].sort());
    for (const code of COUNTRY_CODES) {
      const name = table[code]!;
      // A whole name, not the code again (what the phone showed).
      expect([code, name.length > 2 && name === name.trim() && name !== code]).toEqual([code, true]);
    }
  });

  it('Hebrew names are in Hebrew, English ones in Latin letters', () => {
    for (const code of COUNTRY_CODES) {
      expect([code, HEBREW.test(COUNTRY_NAMES.he[code]!)]).toEqual([code, true]);
      expect([code, HEBREW.test(COUNTRY_NAMES.en[code]!), /[A-Za-z]/.test(COUNTRY_NAMES.en[code]!)]).toEqual([
        code,
        false,
        true,
      ]);
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
    } finally {
      Object.defineProperty(Intl, 'DisplayNames', real);
    }
  });

  it('reads the app language: he, he-IL and the old iw in Hebrew, anything else in English', () => {
    expect(countryName('FR', 'he')).toBe('צרפת');
    expect(countryName('FR', 'he-IL')).toBe('צרפת');
    expect(countryName('FR', 'iw')).toBe('צרפת');
    expect(countryName('FR', 'en-GB')).toBe('France');
    expect(countryName('FR', 'de')).toBe('France');
  });

  it('a code it does not know stays a code', () => {
    expect(countryName('qq', 'he')).toBe('QQ');
    expect(countryName('EU', 'en')).toBe('EU');
  });
});
