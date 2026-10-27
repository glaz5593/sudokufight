import type { Language } from '../i18n/languages';

/**
 * The localization project's decisions (docs/handoff/2026-10-23/localization/plan.md §2 and §7; Moshe approved
 * the plan with every default on 2026-10-23: "מאשר, ברירות המחדל"). Each is a setting here, at its default, so
 * it is easy to change (CLAUDE.md), with a test that flips it where code reads it. Read them through I18N_CONFIG
 * at the time of use (not copied into a const at import), so a test can flip one with jest.replaceProperty.
 *
 * A leaf: only type imports, so i18n/deviceLanguage.ts and i18n/index.ts read it without an import cycle.
 */

/** How a phone's language tag becomes one of ours (D105; i18n/deviceLanguage.ts resolveLanguageTag). */
export interface RegionMap {
  /** Android's old codes, read as today's: iw is Hebrew, in is Indonesian. */
  legacy: Readonly<Record<string, string>>;
  /**
   * A whole tag ("pt-PT", lower-case language and upper-case region) that goes elsewhere than its language
   * would. Empty by default; D105's alternative for Portugal is { 'pt-PT': 'en' }.
   */
  byTag: Readonly<Record<string, Language>>;
  /** A language every variant of which gets one of ours: every Spanish 'es' (Spain's too), every Portuguese 'pt-BR'. */
  byLanguage: Readonly<Record<string, Language>>;
  /** Chinese by its script (Hans, Hant); without one, by its region (Traditional in these, Simplified elsewhere). */
  chinese: { Hans: Language; Hant: Language; traditionalRegions: readonly string[] };
}

export interface I18nSettings {
  /**
   * [D101, Moshe 2026-10-23] The language of a phone whose languages the app has none of, and of a string that is
   * missing in the app's language: English (it was Hebrew until 1.0.4).
   */
  fallbackLanguage: Language;
  /**
   * [D102] The app follows the phone's language: "שפת המכשיר" is the first choice of the picker, and a new install
   * (or a player who never changed a setting) starts on it. Off: a new install starts on the phone's language as
   * an explicit choice, as until 1.0.4.
   */
  followDevice: boolean;
  /**
   * [D102] A player whose settings were saved before 1.1.0: 'explicit' (the default) keeps the saved language as
   * their own choice (any change of sound or haptics saved it too, so a guess could move a player who chose
   * Hebrew on purpose); 'system' moves them to "שפת המכשיר" too.
   */
  migrateExisting: 'explicit' | 'system';
  /**
   * [D103] Android 13+: the system's per-app language ("App languages", services/appLocale.ts) is the single source
   * of truth, written by the in-app picker and read at launch and on every return to the foreground. Off (or
   * without the native module): the language the system reports is compared with the previous launch's, as on iOS.
   */
  syncAndroidAppLocale: boolean;
  /** [D104] Restart the app on every language change (fonts and line heights are set as it starts); off: only when the direction flips. */
  restartOnEveryChange: boolean;
  /** [D105] Regional languages. */
  regionMap: RegionMap;
  /**
   * [D108] Western digits in every language, in Arabic running text too; the decimal separator and the percent
   * pattern come from common:number.decimal / common:number.percent, dates from Intl with -u-nu-latn.
   */
  westernDigitsEverywhere: boolean;
  /** [D109] The developer screens and testing switches (the dev namespace) are not translated: English. */
  devNamespacesTranslated: boolean;
  /**
   * [D112, Moshe 2026-10-23] Which version of the privacy policy and the terms a language opens: 'own', its own
   * translation where the server has one (else English); 'english', English for every language but Hebrew.
   */
  legalLanguageFor: 'own' | 'english';
  /**
   * [D124] A screen that must not scroll ("משחק חדש", the interference sheet) and does not fit in a long
   * language: 'shorten' its wording in that language (then New game's bottom line goes); 'scroll' lets it scroll.
   */
  scrollFallback: 'shorten' | 'scroll';
}

export const I18N_CONFIG: I18nSettings = {
  fallbackLanguage: 'en',
  followDevice: true,
  migrateExisting: 'explicit',
  syncAndroidAppLocale: true,
  restartOnEveryChange: true,
  regionMap: {
    legacy: { iw: 'he', in: 'id' },
    byTag: {},
    byLanguage: { es: 'es', pt: 'pt-BR' },
    chinese: { Hans: 'zh-Hans', Hant: 'zh-Hant', traditionalRegions: ['TW', 'HK', 'MO'] },
  },
  westernDigitsEverywhere: true,
  devNamespacesTranslated: false,
  legalLanguageFor: 'own',
  scrollFallback: 'shorten',
};
