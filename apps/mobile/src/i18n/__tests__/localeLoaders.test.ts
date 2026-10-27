import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type Storage from 'expo-sqlite/kv-store';

import {
  LOADER_PATH,
  LOCALES_PATH,
  renderLocaleLoaders,
  scanLocales,
} from '../../../scripts/lib/i18n-loader.mjs';

/**
 * One language at a time (localization plan 0ב, D119, 6.1 #19): src/i18n/locales.generated.ts has a function per
 * language folder (`npm run i18n:gen`), and i18next calls it when it first needs that language. The start builds
 * the language the app starts in and English, nothing else; another language is read right before the switch;
 * a string missing in a language shows in English (D101).
 */

const MOBILE = join(__dirname, '..', '..', '..');

describe('the generated loader', () => {
  it('is what `npm run i18n:gen` writes from the folders (run it after adding a namespace or a language)', () => {
    const expected = renderLocaleLoaders(scanLocales(join(MOBILE, LOCALES_PATH)));
    expect(readFileSync(join(MOBILE, LOADER_PATH), 'utf8')).toBe(expected);
  });

  it("takes the namespaces from English, and gives a language's missing file an empty object", () => {
    const text = renderLocaleLoaders([
      { language: 'en', namespaces: ['home', 'common'] },
      { language: 'pt-BR', namespaces: ['common'] },
    ]);
    expect(text).toContain("export const NAMESPACES = [\n  'common',\n  'home',\n] as const;");
    expect(text).toContain(
      "  'pt-BR': () => ({\n    common: require('./locales/pt-BR/common.json'),\n    home: {},\n  }),",
    );
    // Only inside a function: a require() there runs when called (startupGraph.test.ts).
    expect(text).not.toMatch(/^(import|const \w+ = require)/m);
    expect(() => renderLocaleLoaders([{ language: 'he', namespaces: ['common'] }])).toThrow(/en folder/);
  });

  it('lists every language folder, English first', () => {
    const folders = scanLocales(join(MOBILE, LOCALES_PATH));
    expect(folders[0]?.language).toBe('en');
    expect(folders.map((f) => f.language)).toEqual(expect.arrayContaining(['en', 'he']));
  });
});

/**
 * The size of the strings (D119, 6.1 #19): every language is in the app, so each adds to its size. Hebrew is
 * 150 KB and English 127 KB in stage 0; a script of three bytes a letter (Thai, CJK) and D110's explanations
 * still fit. A language over its budget, or all of them over theirs, is a question for Moshe, not a raise here.
 */
const LANGUAGE_BUDGET_KB = 400;
const ALL_LANGUAGES_BUDGET_KB = 5 * 1024;

describe("the strings' size (D119)", () => {
  const folders = scanLocales(join(MOBILE, LOCALES_PATH));
  const kb = (language: string, namespaces: readonly string[]) =>
    namespaces.reduce(
      (sum, ns) => sum + statSync(join(MOBILE, LOCALES_PATH, language, `${ns}.json`)).size / 1024,
      0,
    );

  it.each(folders.map((f) => [f.language, f.namespaces] as const))(
    `%s stays within ${LANGUAGE_BUDGET_KB} KB`,
    (language, namespaces) => {
      expect(kb(language, namespaces)).toBeLessThanOrEqual(LANGUAGE_BUDGET_KB);
    },
  );

  it(`all languages together stay within ${ALL_LANGUAGES_BUDGET_KB / 1024} MB`, () => {
    const total = folders.reduce((sum, f) => sum + kb(f.language, f.namespaces), 0);
    expect(total).toBeLessThanOrEqual(ALL_LANGUAGES_BUDGET_KB);
  });
});

type I18nModule = typeof import('../index');

/** A fresh i18n/index.ts, with the saved settings `saved` and loaders that count their calls. */
function startApp(saved: object | null, extra: Record<string, object> = {}) {
  const read: string[] = [];
  let i18n!: I18nModule;
  jest.isolateModules(() => {
    // The key-value store of this fresh module registry (the one index.ts reads).
    const store = jest.requireMock<{ default: typeof Storage }>('expo-sqlite/kv-store').default;
    store.setItemSync('settings', saved ? JSON.stringify({ state: saved, version: 2 }) : '');
    const real = jest.requireActual<typeof import('../locales.generated')>('../locales.generated');
    const loaders: Record<string, () => object> = {};
    for (const [lang, load] of Object.entries(real.LOCALE_LOADERS)) {
      loaders[lang] = () => {
        read.push(lang);
        return load();
      };
    }
    for (const [lang, bundle] of Object.entries(extra)) {
      loaders[lang] = () => {
        read.push(lang);
        return bundle;
      };
    }
    jest.doMock('../locales.generated', () => ({ ...real, LOCALE_LOADERS: loaders }));
    i18n = jest.requireActual<I18nModule>('../index');
  });
  return { i18n, read };
}

describe('the start reads the language it starts in and English only (D119)', () => {
  it('Hebrew saved: Hebrew and English', () => {
    const { i18n, read } = startApp({ language: 'he' });
    expect(i18n.default.language).toBe('he');
    expect(read.sort()).toEqual(['en', 'he']);
    expect(i18n.default.t('settings.title', { ns: 'home' })).toBe('הגדרות');
  });

  it("a new install on an English phone (Jest's): English alone", () => {
    const { i18n, read } = startApp(null);
    expect(i18n.default.language).toBe('en');
    expect(read).toEqual(['en']);
  });

  it('another language is read right before the switch, at once (no waiting)', () => {
    const { i18n, read } = startApp({ language: 'en' }, { xx: { home: { settings: { title: 'XX' } } } });
    expect(read).toEqual(['en']);
    void i18n.default.changeLanguage('xx');
    // Already switched when changeLanguage returns.
    expect(i18n.default.language).toBe('xx');
    expect(read).toEqual(['en', 'xx']);
    expect(i18n.default.t('settings.title', { ns: 'home' })).toBe('XX');
  });

  it('a string missing in the language shows in English (D101), not Hebrew', () => {
    const { i18n } = startApp({ language: 'en' }, { xx: { home: {} } });
    void i18n.default.changeLanguage('xx');
    expect(i18n.default.t('settings.title', { ns: 'home' })).toBe('Settings');
  });

  it('a pseudo language can bring its strings at run time (addLocaleLoader)', () => {
    const { i18n, read } = startApp({ language: 'en' });
    i18n.addLocaleLoader('en-XA', () => ({ home: { settings: { title: '[Šéţţîñĝš]' } } }) as never);
    void i18n.default.changeLanguage('en-XA');
    expect(i18n.default.t('settings.title', { ns: 'home' })).toBe('[Šéţţîñĝš]');
    expect(read).toEqual(['en']);
  });

  it('…also when the app started in it (a saved pseudo language), before its loader was there', () => {
    const { i18n } = startApp({ language: 'en-XA' });
    expect(i18n.default.language).toBe('en-XA');
    expect(i18n.default.t('settings.title', { ns: 'home' })).toBe('Settings');
    i18n.addLocaleLoader('en-XA', () => ({ home: { settings: { title: '[Šéţţîñĝš]' } } }) as never);
    expect(i18n.default.t('settings.title', { ns: 'home' })).toBe('[Šéţţîñĝš]');
  });
});
