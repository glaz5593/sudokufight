import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
 * Android's per-app language (localization plan 0א and 0יא, D103): the language chosen for this app in the
 * system settings ("App languages", Android 13 and up), through our own native module (modules/app-locale,
 * LocaleManager). On Android 13+ it is the single source of truth for the app's language: the in-app picker
 * writes it, "device language" clears it ([]), and the app reads it at launch and on every return to the
 * foreground. The system's list of languages comes from res/xml/locales_config.xml (plugins/withAppLocales.js).
 *
 * Unsupported means null and no-ops, never an error: iOS (the module is Android only), Android below 13, a
 * binary built before the module existed, and Jest (no native modules). The caller then compares the language
 * the system reports with the one of the previous launch instead (plan 0א, "without D103").
 *
 * The functions never throw: a native call that fails counts as unsupported (logged in development).
 */

/** The native module's name (AppLocaleModule.kt `Name("AppLocale")`). */
export const APP_LOCALE_MODULE = 'AppLocale';

/** What modules/app-locale exposes (AppLocaleModule.kt). */
export interface AppLocaleNative {
  /** Android 13 (API 33) and up. */
  isSupported(): boolean;
  /** BCP-47 tags, preferred first; [] when the app follows the system; null below Android 13. */
  getApplicationLocales(): string[] | null;
  /** [] = follow the system. False below Android 13 (nothing changed). */
  setApplicationLocales(tags: string[]): boolean;
}

export interface AppLocaleApi {
  /**
   * The app's languages from the system's per-app setting, as BCP-47 tags (preferred first; map them with
   * i18n/deviceLanguage.ts resolveLanguageTag). [] = the app follows the system language. Null when
   * unsupported (see above).
   */
  getAppLocales(): string[] | null;
  /** Writes the system's per-app languages; [] = follow the system. Does nothing when unsupported. */
  setAppLocales(tags: string[]): void;
  /** Whether getAppLocales and setAppLocales reach the system (Android 13+ with the module in the binary). */
  isAppLocaleSupported(): boolean;
}

const isTagList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((tag) => typeof tag === 'string');

/** The API over a native module (tests pass their own `load`). `load` runs once, on first use. */
export function createAppLocale(load: () => AppLocaleNative | null): AppLocaleApi {
  let loaded = false;
  let native: AppLocaleNative | null = null;
  let supported: boolean | null = null;

  const nativeModule = (): AppLocaleNative | null => {
    if (!loaded) {
      loaded = true;
      try {
        native = load();
      } catch (error) {
        report(error);
        native = null;
      }
    }
    return native;
  };

  const isAppLocaleSupported = (): boolean => {
    if (supported === null) {
      const m = nativeModule();
      try {
        supported = m !== null && m.isSupported() === true;
      } catch (error) {
        report(error);
        supported = false;
      }
    }
    return supported;
  };

  const getAppLocales = (): string[] | null => {
    const m = isAppLocaleSupported() ? nativeModule() : null;
    if (!m) return null;
    try {
      const tags = m.getApplicationLocales();
      return isTagList(tags) ? tags.filter((tag) => tag.trim() !== '') : null;
    } catch (error) {
      report(error);
      return null;
    }
  };

  const setAppLocales = (tags: string[]): void => {
    const m = isAppLocaleSupported() ? nativeModule() : null;
    if (!m) return;
    try {
      m.setApplicationLocales(tags.map((tag) => tag.trim()).filter((tag) => tag !== ''));
    } catch (error) {
      report(error);
    }
  };

  return { getAppLocales, setAppLocales, isAppLocaleSupported };
}

/**
 * The module in this binary: Android only; null on iOS, in Jest, or in a build from before the module. Tests
 * pass the platform and the lookup.
 */
export function deviceModule(
  os: string = Platform.OS,
  lookup: (name: string) => AppLocaleNative | null = requireOptionalNativeModule,
): AppLocaleNative | null {
  return os === 'android' ? lookup(APP_LOCALE_MODULE) : null;
}

export const { getAppLocales, setAppLocales, isAppLocaleSupported } = createAppLocale(() => deviceModule());

function report(error: unknown): void {
  if (__DEV__) console.warn('[app-locale]', error);
}
