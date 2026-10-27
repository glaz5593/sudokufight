import { getLocales } from 'expo-localization';

import { I18N_CONFIG } from '../../config/i18n';
import { deviceLanguage, resolveLanguageTag } from '../deviceLanguage';
import { LANGUAGES } from '../languages';

/**
 * The phone's language (localization plan 0א, 6.1 #15; D101, D105): Android's old codes, Chinese by script then
 * region, every Spanish and Portuguese, all of the phone's preferred languages, and English for the rest.
 */

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));
const locales = jest.mocked(getLocales);
const phone = (...tags: string[]) =>
  locales.mockReturnValue(
    tags.map((languageTag) => ({ languageTag })) as unknown as ReturnType<typeof getLocales>,
  );

const ALL = LANGUAGES as readonly string[];

afterEach(() => jest.restoreAllMocks());

describe('a tag as one of our languages (D105)', () => {
  it.each([
    ['he-IL', 'he'],
    ['iw', 'he'],
    ['iw-IL', 'he'],
    ['in', 'id'],
    ['in-ID', 'id'],
    ['id_ID', 'id'],
    ['en-US', 'en'],
    ['en-XA', 'en'],
    ['ar-EG', 'ar'],
    ['ar-XB', 'ar'],
    ['de-AT', 'de'],
    ['es-ES', 'es'],
    ['es-419', 'es'],
    ['es-MX', 'es'],
    ['pt-BR', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['pt', 'pt-BR'],
    ['zh', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh-Hant', 'zh-Hant'],
    ['zh-Hans-HK', 'zh-Hans'],
    ['zh-Hant-CN', 'zh-Hant'],
    ['zh_hant_tw', 'zh-Hant'],
    ['hi-IN', null],
    ['', null],
  ])('%s → %s', (tag, expected) => {
    expect(resolveLanguageTag(tag, ALL)).toBe(expected);
  });

  it('only a language this build offers', () => {
    expect(resolveLanguageTag('fr-FR', ['he', 'en'])).toBeNull();
    expect(resolveLanguageTag('zh-TW', ['he', 'en', 'zh-Hans'])).toBeNull();
    expect(resolveLanguageTag('iw', ['he', 'en'])).toBe('he');
  });

  it("D105's alternative for Portugal (English) is one setting", () => {
    jest.replaceProperty(I18N_CONFIG, 'regionMap', {
      ...I18N_CONFIG.regionMap,
      byTag: { 'pt-PT': 'en' },
    });
    expect(resolveLanguageTag('pt-PT', ALL)).toBe('en');
    expect(resolveLanguageTag('pt-BR', ALL)).toBe('pt-BR');
  });
});

describe("the phone's language", () => {
  it('the first of its preferred languages the app has, not only the first', () => {
    phone('fr-FR', 'he-IL', 'en-US');
    expect(deviceLanguage(['he', 'en'])).toBe('he');
    phone('fr-FR', 'en-GB', 'he-IL');
    expect(deviceLanguage(['he', 'en'])).toBe('en');
    phone('iw-IL');
    expect(deviceLanguage(['he', 'en'])).toBe('he');
  });

  it('a phone in a language the app does not have gets English (D101), Hebrew phones still Hebrew', () => {
    phone('fr-FR');
    expect(deviceLanguage(['he', 'en'])).toBe('en');
    phone('ru-RU', 'de-DE');
    expect(deviceLanguage(['he', 'en'])).toBe('en');
    phone('he');
    expect(deviceLanguage(['he', 'en'])).toBe('he');
  });

  it('nothing to read (no locales, or the module fails): English', () => {
    locales.mockReturnValue([] as unknown as ReturnType<typeof getLocales>);
    expect(deviceLanguage(['he', 'en'])).toBe('en');
    locales.mockImplementation(() => {
      throw new Error('no native module');
    });
    expect(deviceLanguage(['he', 'en'])).toBe('en');
  });

  it("the fallback is the config's (D101)", () => {
    jest.replaceProperty(I18N_CONFIG, 'fallbackLanguage', 'he');
    phone('fr-FR');
    expect(deviceLanguage(['he', 'en'])).toBe('he');
  });
});
