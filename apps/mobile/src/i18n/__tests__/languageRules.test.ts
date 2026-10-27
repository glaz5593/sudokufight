import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';

import { I18N_CONFIG } from '../../config/i18n';
import { deviceLanguage, systemLocaleTag } from '../deviceLanguage';
import {
  defaultLanguagePrefs,
  effectiveLanguage,
  type LanguagePrefs,
  languagePrefsOf,
  readSystemLanguage,
  reconcileLanguage,
  storedLanguagePrefs,
  type SystemLanguageReport,
} from '../languageRules';

/**
 * The language setting and the system (localization plan 0א, 6.1 #16; D102, D103): players from before 1.1.0,
 * new installs, and a language chosen in the system settings, which always wins (doc 5.5): on Android 13+ through
 * its per-app languages, on iOS (and Android 13+ without our module) by comparing with the previous check.
 */

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => []) }));
jest.mock('../../services/appLocale', () => ({
  getAppLocales: jest.fn(() => null),
  setAppLocales: jest.fn(),
  isAppLocaleSupported: jest.fn(() => false),
}));

/** The phone's preferred languages, first to last. */
const phone = (...tags: string[]) =>
  jest
    .mocked(getLocales)
    .mockReturnValue(
      tags.map((languageTag) => ({ languageTag })) as unknown as ReturnType<typeof getLocales>,
    );

const ENABLED = ['he', 'en', 'ar'];

const prefs = (over: Partial<LanguagePrefs> = {}): LanguagePrefs => ({
  language: 'system',
  languageSource: 'default',
  appLocalesSeen: null,
  systemLocaleSeen: null,
  ...over,
});

type Device = 'he' | 'en' | 'ar';
/** A tag the system could report for a language. */
const TAG: Record<Device, string> = { he: 'he-IL', en: 'en-US', ar: 'ar-EG' };

/** Android 13+ with our module: the per-app languages are the source of truth. */
const android13 = (appLocales: string[], device: Device = 'en'): SystemLanguageReport => ({
  appLocales,
  device,
  systemLocale: null,
  compare: false,
});
/** iOS (and Android 13+ without the module): compare with the previous check. */
const ios = (device: Device, systemLocale: string | null = TAG[device]): SystemLanguageReport => ({
  appLocales: null,
  device,
  systemLocale,
  compare: true,
});
/** Below Android 13: no per-app language at all. */
const android12 = (device: Device): SystemLanguageReport => ({
  appLocales: null,
  device,
  systemLocale: null,
  compare: false,
});

afterEach(() => jest.restoreAllMocks());

describe('players before and after 1.1.0 (D102)', () => {
  it('no saved record (never changed a setting): "שפת המכשיר", from the start', () => {
    expect(storedLanguagePrefs(null)).toEqual(prefs());
    expect(storedLanguagePrefs('not json')).toEqual(prefs());
    expect(defaultLanguagePrefs('he')).toEqual(prefs());
  });

  it("a record from before 1.1.0 keeps its language as the player's choice, and says it was migrated", () => {
    const v1 = JSON.stringify({ state: { language: 'he', sound: false }, version: 1 });
    expect(storedLanguagePrefs(v1)).toEqual(prefs({ language: 'he', languageSource: 'migrated' }));
    expect(languagePrefsOf({ language: 'en' }, 1)).toEqual(
      prefs({ language: 'en', languageSource: 'migrated' }),
    );
    // A broken one: as if none.
    expect(languagePrefsOf({ language: 'xx' }, 1)).toEqual(prefs());
  });

  it("D102's other way (migrateExisting 'system') moves them to the device language", () => {
    jest.replaceProperty(I18N_CONFIG, 'migrateExisting', 'system');
    expect(languagePrefsOf({ language: 'he' }, 1)).toEqual(
      prefs({ language: 'system', languageSource: 'migrated' }),
    );
  });

  it('with followDevice off, a new install starts on the phone language as a choice (as until 1.0.4)', () => {
    jest.replaceProperty(I18N_CONFIG, 'followDevice', false);
    expect(defaultLanguagePrefs('he')).toEqual(prefs({ language: 'he' }));
  });

  it('a record of this version is read as it is (the source of the choice is kept from now on)', () => {
    const saved = prefs({
      language: 'en',
      languageSource: 'app',
      appLocalesSeen: 'en',
      systemLocaleSeen: 'he-IL',
    });
    expect(storedLanguagePrefs(JSON.stringify({ state: saved, version: 2 }))).toEqual(saved);
    expect(
      languagePrefsOf({ language: 'en-XA', languageSource: '?', appLocalesSeen: 7, systemLocaleSeen: '' }, 2),
    ).toEqual(prefs({ language: 'en-XA' }));
  });
});

describe('the language the app runs in', () => {
  it("'system' is the phone's; a chosen language is itself; one this build dropped is the phone's", () => {
    expect(effectiveLanguage('system', 'he', ENABLED)).toBe('he');
    expect(effectiveLanguage('ar', 'he', ENABLED)).toBe('ar');
    expect(effectiveLanguage('ja', 'he', ENABLED)).toBe('he');
    expect(effectiveLanguage('en-XA', 'he', ENABLED)).toBe('en-XA');
  });
});

describe('Android 13+: the per-app languages are the source of truth (D103)', () => {
  it('the first look writes an earlier choice to the system, so both pickers agree', () => {
    const r = reconcileLanguage(
      prefs({ language: 'he', languageSource: 'migrated' }),
      android13([]),
      ENABLED,
    );
    expect(r.writeAppLocales).toEqual(['he']);
    expect(r.prefs).toEqual(prefs({ language: 'he', languageSource: 'migrated', appLocalesSeen: 'he' }));
    expect(r.language).toBe('he');
    // "שפת המכשיר": nothing to write.
    const system = reconcileLanguage(prefs(), android13([]), ENABLED);
    expect(system.writeAppLocales).toBeNull();
    expect(system.prefs.appLocalesSeen).toBe('');
  });

  it('a language chosen in the system settings wins, even over an explicit choice in the app', () => {
    const before = prefs({ language: 'he', languageSource: 'app', appLocalesSeen: 'he' });
    const r = reconcileLanguage(before, android13(['ar-EG']), ENABLED);
    expect(r.prefs).toMatchObject({ language: 'ar', languageSource: 'system', appLocalesSeen: 'ar' });
    expect(r.language).toBe('ar');
    expect(r.writeAppLocales).toBeNull();
    // Old codes too: iw is Hebrew.
    expect(reconcileLanguage(prefs({ appLocalesSeen: '' }), android13(['iw-IL']), ENABLED).language).toBe(
      'he',
    );
  });

  it('"System default" in the system settings is "שפת המכשיר"', () => {
    const before = prefs({ language: 'he', languageSource: 'app', appLocalesSeen: 'he' });
    const r = reconcileLanguage(before, android13([], 'en'), ENABLED);
    expect(r.prefs).toMatchObject({ language: 'system', languageSource: 'system', appLocalesSeen: '' });
    expect(r.language).toBe('en');
  });

  it('our own write is not a change: the app keeps its choice and nothing restarts', () => {
    const chosen = prefs({ language: 'en', languageSource: 'app', appLocalesSeen: 'en' });
    const r = reconcileLanguage(chosen, android13(['en']), ENABLED);
    expect(r.prefs).toEqual(chosen);
    expect(r.language).toBe('en');
  });

  it('a first look that finds a language already chosen in the system settings takes it', () => {
    const r = reconcileLanguage(
      prefs({ language: 'he', languageSource: 'migrated' }),
      android13(['en-US']),
      ENABLED,
    );
    expect(r.prefs).toMatchObject({ language: 'en', languageSource: 'system', appLocalesSeen: 'en' });
  });
});

describe('iOS, and Android 13+ without the module: compared with the previous check', () => {
  it('the first check only remembers what the system said', () => {
    const r = reconcileLanguage(prefs({ language: 'en', languageSource: 'app' }), ios('he'), ENABLED);
    expect(r.prefs).toEqual(prefs({ language: 'en', languageSource: 'app', systemLocaleSeen: 'he-IL' }));
    expect(r.language).toBe('en');
  });

  it('the same language as last time: the choice in the app stands', () => {
    const before = prefs({ language: 'en', languageSource: 'app', systemLocaleSeen: 'he-IL' });
    expect(reconcileLanguage(before, ios('he'), ENABLED).prefs).toEqual(before);
  });

  it('another language than last time was chosen in the system settings: it wins', () => {
    const before = prefs({ language: 'en', languageSource: 'app', systemLocaleSeen: 'he-IL' });
    const r = reconcileLanguage(before, ios('ar'), ENABLED);
    expect(r.prefs).toEqual(
      prefs({ language: 'system', languageSource: 'system', systemLocaleSeen: 'ar-EG' }),
    );
    expect(r.language).toBe('ar');
  });

  it('a system that reports no language: nothing to compare, nothing forgotten', () => {
    const before = prefs({ language: 'en', languageSource: 'app', systemLocaleSeen: 'he-IL' });
    expect(reconcileLanguage(before, ios('en', null), ENABLED).prefs).toEqual(before);
  });

  describe('what the system reported, not what this build maps it to', () => {
    /** The system's word on iOS as this build reads it, with these languages enabled. */
    const iosNow = (enabled: readonly string[]): SystemLanguageReport => ({
      appLocales: null,
      device: deviceLanguage(enabled),
      systemLocale: systemLocaleTag(),
      compare: true,
    });
    /** Launches on one build, then on the next (with the phone untouched): what the app runs in each time. */
    function update(chosen: LanguagePrefs, before: readonly string[], after: readonly string[]) {
      const first = reconcileLanguage(chosen, iosNow(before), before);
      const next = reconcileLanguage(first.prefs, iosNow(after), after);
      return { first, next };
    }

    it('an update that enables the phone’s own language keeps the choice made in the app', () => {
      // An iPhone in Spanish, then Hebrew, on a build without Spanish: the player picked English in the app.
      phone('es-ES', 'he-IL');
      const chosen = prefs({ language: 'en', languageSource: 'app' });
      const { first, next } = update(chosen, ['he', 'en'], ['he', 'en', 'es']);
      expect(first.prefs.systemLocaleSeen).toBe('es-ES');
      expect(next.prefs).toEqual(first.prefs);
      expect(next.language).toBe('en');
    });

    it('a phone whose only language was not in the app (English fallback) keeps its Hebrew choice too', () => {
      phone('ja-JP');
      const { next } = update(
        prefs({ language: 'he', languageSource: 'app' }),
        ['he', 'en'],
        ['he', 'en', 'ja'],
      );
      expect(next.prefs).toMatchObject({ language: 'he', languageSource: 'app', systemLocaleSeen: 'ja-JP' });
      expect(next.language).toBe('he');
    });

    it("a change of D105's mapping (Portugal to English) is not a choice in the system settings", () => {
      phone('pt-PT');
      const enabled = ['he', 'en', 'pt-BR'];
      const chosen = prefs({ language: 'he', languageSource: 'app' });
      const first = reconcileLanguage(chosen, iosNow(enabled), enabled);
      jest.replaceProperty(I18N_CONFIG, 'regionMap', { ...I18N_CONFIG.regionMap, byTag: { 'pt-PT': 'en' } });
      const next = reconcileLanguage(first.prefs, iosNow(enabled), enabled);
      expect(next.prefs).toEqual(first.prefs);
      expect(next.language).toBe('he');
    });

    it('a language really chosen in the system settings still wins', () => {
      phone('es-ES', 'he-IL');
      const first = reconcileLanguage(
        prefs({ language: 'en', languageSource: 'app' }),
        iosNow(['he', 'en']),
        ['he', 'en'],
      );
      phone('he-IL', 'es-ES');
      const next = reconcileLanguage(first.prefs, iosNow(['he', 'en']), ['he', 'en']);
      expect(next.prefs).toMatchObject({
        language: 'system',
        languageSource: 'system',
        systemLocaleSeen: 'he-IL',
      });
      expect(next.language).toBe('he');
    });
  });

  it('readSystemLanguage reports the tag as the system spells it, one way (Android’s iw as he)', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    phone('iw_il', 'en-US');
    expect(readSystemLanguage()).toEqual({
      appLocales: null,
      device: 'he',
      systemLocale: 'he-IL',
      compare: true,
    });
    phone('zh_hant_tw');
    expect(readSystemLanguage().systemLocale).toBe('zh-Hant-TW');
    phone();
    expect(readSystemLanguage().systemLocale).toBeNull();
  });
});

describe('below Android 13 (no per-app language)', () => {
  it('a choice in the app stays whatever the phone says; "שפת המכשיר" follows the phone', () => {
    const chosen = prefs({ language: 'en', languageSource: 'app' });
    expect(reconcileLanguage(chosen, android12('he'), ENABLED)).toEqual({
      prefs: chosen,
      language: 'en',
      writeAppLocales: null,
    });
    expect(reconcileLanguage(prefs(), android12('he'), ENABLED).language).toBe('he');
    expect(reconcileLanguage(prefs(), android12('ar'), ENABLED).language).toBe('ar');
  });
});
