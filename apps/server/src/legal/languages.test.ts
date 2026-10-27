import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FALLBACK_PAGE_LANGUAGE,
  negotiatePageLanguage,
  PAGE_LANGUAGE_NAMES,
  PAGE_LANGUAGES,
  pageDir,
  pageLanguageOfQuery,
  pageLanguageOfTag,
  versionOf,
} from './languages';

/**
 * The languages of the public pages (localization plan 0יב, D101, D105): the app's 19, the tags a browser
 * sends read as the app reads the phone's, and English for a language a page has no version of.
 */

const REPO = path.join(__dirname, '..', '..', '..', '..');

describe('the pages’ languages', () => {
  it('are the app’s, in its order, each by the name the app’s language picker shows', () => {
    const source = readFileSync(path.join(REPO, 'apps', 'mobile', 'src', 'i18n', 'languages.ts'), 'utf8');
    const list = /export const LANGUAGES = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? '';
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...PAGE_LANGUAGES]);
    for (const lang of PAGE_LANGUAGES) expect(source).toContain(`'${PAGE_LANGUAGE_NAMES[lang]}'`);
    expect(Object.keys(PAGE_LANGUAGE_NAMES)).toEqual([...PAGE_LANGUAGES]);
    expect(PAGE_LANGUAGES).toHaveLength(19);
  });

  it('right to left: Hebrew and Arabic only', () => {
    expect(PAGE_LANGUAGES.filter((l) => pageDir(l) === 'rtl')).toEqual(['he', 'ar']);
  });

  it('a tag reads as the app reads the phone’s (D105)', () => {
    const cases: [string, string | null][] = [
      ['he', 'he'],
      ['he-IL', 'he'],
      ['iw', 'he'],
      ['iw-IL', 'he'],
      ['EN-us', 'en'],
      ['en_GB', 'en'],
      ['ar-EG', 'ar'],
      ['es', 'es'],
      ['es-ES', 'es'],
      ['es-419', 'es'],
      ['pt', 'pt-BR'],
      ['pt-PT', 'pt-BR'],
      ['pt-BR', 'pt-BR'],
      ['de-AT', 'de'],
      ['fr-CA', 'fr'],
      ['in', 'id'],
      ['id-ID', 'id'],
      ['zh', 'zh-Hans'],
      ['zh-CN', 'zh-Hans'],
      ['zh-SG', 'zh-Hans'],
      ['zh-Hans', 'zh-Hans'],
      ['zh-Hans-HK', 'zh-Hans'],
      ['zh-TW', 'zh-Hant'],
      ['zh-HK', 'zh-Hant'],
      ['zh-MO', 'zh-Hant'],
      ['zh-Hant', 'zh-Hant'],
      ['zh-Hant-CN', 'zh-Hant'],
      ['zh_TW', 'zh-Hant'],
      ['th-TH', 'th'],
      ['nl-BE', 'nl'],
      ['hi', null],
      ['sw-KE', null],
      ['*', null],
      ['', null],
    ];
    for (const [tag, lang] of cases) expect({ tag, lang: pageLanguageOfTag(tag) }).toEqual({ tag, lang });
  });

  it('?lang= is exactly one of the codes', () => {
    expect(pageLanguageOfQuery('pt-BR')).toBe('pt-BR');
    expect(pageLanguageOfQuery('zh-Hant')).toBe('zh-Hant');
    for (const value of ['pt-br', 'EN', 'iw', 'xx', '', undefined, ['en'], { en: 1 }])
      expect(pageLanguageOfQuery(value)).toBeNull();
  });

  it('a language without a version: English (D101)', () => {
    expect(FALLBACK_PAGE_LANGUAGE).toBe('en');
    expect(versionOf('ar', ['he', 'en'])).toBe('en');
    expect(versionOf('he', ['he', 'en'])).toBe('he');
    expect(versionOf('ar', ['he', 'en', 'ar'])).toBe('ar');
    expect(() => versionOf('ar', ['he'])).toThrow(/English/);
  });

  it('Accept-Language: the most preferred of the versions; `*` and no header: the page’s own default; else English', () => {
    const versions = ['he', 'en', 'ar', 'pt-BR', 'zh-Hant'] as const;
    const pick = (header: string | undefined) => negotiatePageLanguage(header, versions, 'he');
    expect(pick(undefined)).toBe('he');
    expect(pick(' ')).toBe('he');
    expect(pick('*')).toBe('he');
    expect(pick('ar-SA,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(pick('pt-PT,pt;q=0.9')).toBe('pt-BR');
    expect(pick('zh-HK, en;q=0.5')).toBe('zh-Hant');
    expect(pick('zh-CN, en;q=0.5')).toBe('en'); // simplified Chinese has no version here
    expect(pick('fr-FR, de;q=0.9')).toBe('en');
    expect(pick('en;q=0.5, ar;q=0.6')).toBe('ar');
    expect(pick('en;q=0, he;q=0.1')).toBe('he');
    expect(pick('ar;q=abc, en')).toBe('en');
    expect(pick('en, ar')).toBe('en'); // a tie: the first
  });
});
