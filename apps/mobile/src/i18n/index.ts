import Storage from 'expo-sqlite/kv-store';
import i18n, { type BackendModule, type ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager, Platform } from 'react-native';

import { I18N_CONFIG } from '../config/i18n';
import { deviceLanguage } from './deviceLanguage';
import {
  readSystemLanguage,
  reconcileLanguage,
  SETTINGS_STORE_KEY,
  storedLanguagePrefs,
} from './languageRules';
import { type AppLanguage, isRtlLanguage } from './languages';
import { LOCALE_LOADERS, type LocaleBundle, NAMESPACES, type Namespace } from './locales.generated';

/**
 * Translations (CLAUDE.md: no hard-coded UI strings; spec §22). Every string goes through t(). One file per area
 * (namespace) in each language folder, locales/<lang>/<namespace>.json: common, ui, player, board, home, game,
 * account, dev, replay, history (stage 11), match (stage 9: matchmaking), progress (stage 12: the leaderboard,
 * the player card, progress and the interferences collection), avatars (the characters' names, kinds,
 * expressions and motions, generated from packages/avatars by scripts/gen-avatar-strings.ts), moderation
 * (spec §3.5: reporting and blocking players, the blocked list, a name an admin reset, a suspended account),
 * levels (1.0.2, staged practice: the map, a stage and its result; English says "Stage", never "Level", for a
 * stage) and friends (1.0.4: the friends room, joining with a code, a room link and a pending invitation).
 *
 * Localization (docs/handoff/2026-10-23/localization/plan.md, stage 0):
 * - The languages are languages.ts (19, of which this build offers ENABLED_LANGUAGES); a missing string, and a
 *   phone in a language the app doesn't have, get English (D101, config/i18n.ts fallbackLanguage).
 * - One language at a time (0ב, D119): locales.generated.ts (`npm run i18n:gen`) has a function per language
 *   folder, and the backend below calls it when i18next first needs that language. The start builds the
 *   language the app starts in and English only; changeLanguage() reads another one right before switching
 *   (synchronously: the files are in the bundle, so the switch and t() need no waiting).
 * - The language the app starts in is the saved setting, reconciled with the system (languageRules.ts), read
 *   here straight from the key-value store: this file may not import state/settings.ts.
 */
export * from './languages';
export { deviceLanguage, resolveLanguageTag } from './deviceLanguage';
export { type LocaleBundle, type Namespace, NAMESPACES } from './locales.generated';

const bundles = new Map<string, LocaleBundle>();
const extraLoaders = new Map<string, () => LocaleBundle>();

/** A language's strings by namespace, read once; null when the app has no folder (or loader) for it. */
export function localeBundle(lang: string): LocaleBundle | null {
  let bundle = bundles.get(lang);
  if (!bundle) {
    const load = extraLoaders.get(lang) ?? LOCALE_LOADERS[lang];
    if (!load) return null;
    bundle = load();
    bundles.set(lang, bundle);
  }
  return bundle;
}

/**
 * Strings for a language that has no folder (the pseudo languages of development builds can be made from
 * English at run time, plan 0יג). Best before i18next first asks for the language; a language already in use
 * (the app started in a saved pseudo language, before this was called) is read again at once.
 */
export function addLocaleLoader(lang: string, load: () => LocaleBundle): void {
  extraLoaders.set(lang, load);
  bundles.delete(lang);
  if (i18n.isInitialized && i18n.languages.includes(lang)) void i18n.reloadResources([lang]);
}

/** i18next's source of strings: the bundled files, a language at a time, answered at once. */
const localeBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(language, namespace, callback) {
    const bundle = localeBundle(language);
    callback(null, (bundle?.[namespace as Namespace] ?? {}) as ResourceKey);
  },
};

/** The language the app starts in: the saved setting, after the system's word (languageRules.ts). */
function launchLanguage(): AppLanguage {
  try {
    const prefs = storedLanguagePrefs(Storage.getItemSync(SETTINGS_STORE_KEY));
    return reconcileLanguage(prefs, readSystemLanguage()).language;
  } catch {
    return deviceLanguage();
  }
}

/**
 * Sets the layout direction for a language. React Native applies a direction change only after a reload, so
 * this returns true when the app must restart (see services/restart.ts). On iOS a left-to-right language also
 * disallows RTL: there React Native lays out right to left whenever RTL is allowed and the app's preferred
 * language is (a Hebrew iPhone), whatever was forced, so English would restart for ever (plan 0יא). Android
 * reads no such preference.
 */
export function applyDirection(lang: string): boolean {
  const rtl = isRtlLanguage(lang);
  I18nManager.allowRTL(rtl || Platform.OS !== 'ios');
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  return true;
}

void i18n
  .use(localeBackend)
  .use(initReactI18next)
  .init({
    ns: [...NAMESPACES],
    defaultNS: 'common',
    lng: launchLanguage(),
    fallbackLng: I18N_CONFIG.fallbackLanguage,
    // 'zh-Hant' is its own language: no 'zh' step between it and English.
    load: 'currentOnly',
    // The backend answers at once: init and every changeLanguage() finish before they return.
    initAsync: false,
    interpolation: { escapeValue: false },
  });

export default i18n;
