import { Platform } from 'react-native';

import { I18N_CONFIG } from '../config/i18n';
import { getAppLocales, isAppLocaleSupported } from '../services/appLocale';
import { deviceLanguage, resolveLanguageTag, systemLocaleTag } from './deviceLanguage';
import {
  type AppLanguage,
  ENABLED_LANGUAGES,
  isAppLanguage,
  isLanguage,
  isPseudoLanguage,
  type Language,
} from './languages';

/**
 * Which language the app runs in (localization plan 0א, D102, D103): the language setting, and the rules that
 * let a choice made in the system settings win (doc 5.5: "a choice in the system settings always wins", even
 * over an explicit choice in the app). No React, no store: settings.ts persists what these return, and
 * i18n/index.ts reads the saved record with them before anything else runs (it may not import settings.ts).
 *
 * - Android 13 and up, with our native module (services/appLocale.ts) and D103 on: the system's per-app
 *   language is the source of truth. The in-app picker writes it, "שפת המכשיר" clears it, and it is read at
 *   launch and on every return to the foreground. A list that differs from the one last seen (or written by us)
 *   was changed in the system settings, and wins. Our own write is recorded as seen, so it never counts.
 * - iOS, and Android 13+ without the module: the language the system reports for the app (its first preferred
 *   tag, as reported: not mapped to the app's languages, which an update may add to) is compared with the one
 *   seen at the previous check; when it changed (the player chose a language for the app in the system settings,
 *   or changed the phone's), it wins: the setting goes back to "שפת המכשיר".
 * - Below Android 13 the system has no per-app language: an explicit choice stays, and "שפת המכשיר" follows
 *   the phone.
 */

/** The record's key in expo-sqlite's key-value store (state/settings.ts persists under it). */
export const SETTINGS_STORE_KEY = 'settings';
/** The record's version: 2 from 1.1.0 (the language may be 'system', with its source and what was seen). */
export const SETTINGS_VERSION = 2;

/** 'system' follows the phone (and Android 13+'s per-app language); otherwise the language chosen. */
export type LanguageSetting = 'system' | AppLanguage;

/**
 * Where the setting came from, saved from 1.1.0 on so a later version never has to guess (D102):
 * 'default' never chosen (a new install, or a player who never changed a setting); 'migrated' saved before
 * 1.1.0, when any change of sound or haptics saved the language too; 'app' the in-app picker; 'system' the
 * system settings.
 */
export type LanguageSource = 'default' | 'migrated' | 'app' | 'system';

export interface LanguagePrefs {
  language: LanguageSetting;
  languageSource: LanguageSource;
  /**
   * Android 13+: the system's per-app language as last seen or written by us ('' = the app follows the system),
   * or null before the first look.
   */
  appLocalesSeen: Language | '' | null;
  /**
   * iOS and Android 13+ without the module: the phone's first preferred language as the system reported it at the
   * previous check (deviceLanguage.ts systemLocaleTag: "he-IL", never mapped to the app's languages), or null.
   */
  systemLocaleSeen: string | null;
}

/** What a player starts with: "שפת המכשיר" (D102), or, with followDevice off, the phone's language as a choice. */
export function defaultLanguagePrefs(device: Language = deviceLanguage()): LanguagePrefs {
  return {
    language: I18N_CONFIG.followDevice ? 'system' : device,
    languageSource: 'default',
    appLocalesSeen: null,
    systemLocaleSeen: null,
  };
}

const isSetting = (value: unknown): value is LanguageSetting => value === 'system' || isAppLanguage(value);
const SOURCES: readonly LanguageSource[] = ['default', 'migrated', 'app', 'system'];

/**
 * The language part of a saved settings record of `version` (D102): a record from before 1.1.0 (version 1, a
 * language of he or en) keeps its language as the player's choice ('migrated'), or with migrateExisting
 * 'system' follows the phone; a record of this version is read as it is, a broken field by its default.
 */
export function languagePrefsOf(state: unknown, version: number): LanguagePrefs {
  const s = (typeof state === 'object' && state !== null ? state : {}) as Record<string, unknown>;
  const defaults = defaultLanguagePrefs();
  if (version < SETTINGS_VERSION) {
    if (!isLanguage(s.language)) return defaults;
    const keep = I18N_CONFIG.migrateExisting === 'explicit';
    return { ...defaults, language: keep ? s.language : 'system', languageSource: 'migrated' };
  }
  const seen = s.appLocalesSeen;
  return {
    language: isSetting(s.language) ? s.language : defaults.language,
    languageSource: SOURCES.includes(s.languageSource as LanguageSource)
      ? (s.languageSource as LanguageSource)
      : defaults.languageSource,
    appLocalesSeen: seen === '' || isLanguage(seen) ? seen : null,
    systemLocaleSeen:
      typeof s.systemLocaleSeen === 'string' && s.systemLocaleSeen !== '' ? s.systemLocaleSeen : null,
  };
}

/**
 * The language part of the record in the key-value store's text (zustand persist's { state, version }); no
 * record, or one that does not parse, is a player who never changed a setting.
 */
export function storedLanguagePrefs(raw: string | null): LanguagePrefs {
  if (!raw) return defaultLanguagePrefs();
  try {
    const parsed = JSON.parse(raw) as { state?: unknown; version?: unknown } | null;
    const version = typeof parsed?.version === 'number' ? parsed.version : 0;
    return languagePrefsOf(parsed?.state, version);
  } catch {
    return defaultLanguagePrefs();
  }
}

/** What the system says about the app's language now (readSystemLanguage). */
export interface SystemLanguageReport {
  /** Android 13+'s per-app languages where they are the source of truth (D103), as tags; null elsewhere. */
  appLocales: readonly string[] | null;
  /** The phone's language for the app (deviceLanguage: its preferred languages, the per-app one first). */
  device: Language;
  /**
   * What the compare rule remembers: the first preferred tag as the system reports it (systemLocaleTag), null when
   * it reports none. Not `device`, which maps the tag to this build's languages: an update that enables another
   * one would change it with nothing changed on the phone.
   */
  systemLocale: string | null;
  /** The system may hold a per-app choice we cannot read (iOS, Android 13+ without the module): compare. */
  compare: boolean;
}

/** iOS, and Android 13 (API 33) and up: the system settings have a language for each app. */
const systemHasPerAppLanguage = (): boolean =>
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 33);

/** Reads the system: the per-app languages (Android 13+, D103), the phone's language, and which rule applies. */
export function readSystemLanguage(): SystemLanguageReport {
  const device = deviceLanguage();
  const owns = Platform.OS === 'android' && I18N_CONFIG.syncAndroidAppLocale && isAppLocaleSupported();
  const appLocales = owns ? getAppLocales() : null;
  const compare = appLocales === null && systemHasPerAppLanguage();
  return { appLocales, device, systemLocale: compare ? systemLocaleTag() : null, compare };
}

/** An explicit choice the system can hold (not "שפת המכשיר", not a pseudo language), or null. */
export const systemLanguageOf = (setting: LanguageSetting): Language | null =>
  setting === 'system' || isPseudoLanguage(setting) ? null : setting;

/** Android's per-app list as one of ours: '' when it is empty (follow the system) or none of ours. */
function appLocalesLanguage(tags: readonly string[], enabled: readonly string[]): Language | '' {
  for (const tag of tags) {
    const lang = resolveLanguageTag(tag, enabled);
    if (lang) return lang;
  }
  return '';
}

/**
 * The language the app runs in for a setting: the phone's for 'system'; a pseudo language as it is; a language
 * this build has, as it is; anything else (a language a later build dropped) the phone's.
 */
export function effectiveLanguage(
  setting: LanguageSetting,
  device: Language,
  enabled: readonly string[] = ENABLED_LANGUAGES,
): AppLanguage {
  if (setting === 'system') return device;
  if (isPseudoLanguage(setting) || enabled.includes(setting)) return setting;
  return device;
}

export interface ReconciledLanguage {
  /** The setting after the system's word (the same object's values when nothing changed). */
  prefs: LanguagePrefs;
  /** The language the app runs in. */
  language: AppLanguage;
  /** Tags to write to Android's per-app languages (the first look on Android 13+ with an explicit choice), or null. */
  writeAppLocales: string[] | null;
}

/** The setting and the system, reconciled (the rules at the top of this file). Pure. */
export function reconcileLanguage(
  prefs: LanguagePrefs,
  report: SystemLanguageReport,
  enabled: readonly string[] = ENABLED_LANGUAGES,
): ReconciledLanguage {
  let next: LanguagePrefs = { ...prefs };
  let writeAppLocales: string[] | null = null;
  if (report.appLocales !== null) {
    const current = appLocalesLanguage(report.appLocales, enabled);
    if (prefs.appLocalesSeen === null && current === '') {
      // The first look: the system holds nothing yet. A choice made before (1.0.x, or below Android 13) is
      // written to it, so the two pickers show the same language.
      const ours = systemLanguageOf(prefs.language);
      const held = ours && enabled.includes(ours) ? ours : null;
      if (held) writeAppLocales = [held];
      next.appLocalesSeen = held ?? '';
    } else if (current !== prefs.appLocalesSeen) {
      // Changed in the system settings: it wins.
      next = { ...next, language: current === '' ? 'system' : current, languageSource: 'system' };
      next.appLocalesSeen = current;
    }
  } else if (report.compare && report.systemLocale !== null) {
    const seen = prefs.systemLocaleSeen;
    if (seen !== null && report.systemLocale !== seen && prefs.language !== 'system') {
      // The system reports another language than at the previous check: chosen there, so it wins.
      next = { ...next, language: 'system', languageSource: 'system' };
    }
    next.systemLocaleSeen = report.systemLocale;
  }
  return { prefs: next, language: effectiveLanguage(next.language, report.device, enabled), writeAppLocales };
}

/** Whether two settings differ in anything saved. */
export const languagePrefsDiffer = (a: LanguagePrefs, b: LanguagePrefs): boolean =>
  a.language !== b.language ||
  a.languageSource !== b.languageSource ||
  a.appLocalesSeen !== b.appLocalesSeen ||
  a.systemLocaleSeen !== b.systemLocaleSeen;
