import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { I18N_CONFIG } from '../config/i18n';
import { setAppLocales } from '../services/appLocale';
import { directionSettled, restartApp, restartForDirection } from '../services/restart';
import { languagePrefs, useSettings } from '../state/settings';
import { deviceLanguage } from './deviceLanguage';
import i18n, { applyDirection } from './index';
import {
  effectiveLanguage,
  type LanguageSetting,
  languagePrefsDiffer,
  readSystemLanguage,
  reconcileLanguage,
  systemLanguageOf,
} from './languageRules';
import { type AppLanguage, isRtlLanguage } from './languages';

/**
 * The language setting at work (localization plan 0א, D102–D104): the system's word at launch and on every
 * return to the foreground, the in-app picker's choice, and the restart a change needs. The rules themselves
 * are languageRules.ts; the root layout runs useLanguageLifecycle().
 */

/** The language the app should run in now: the setting, or the phone's for "שפת המכשיר". */
export function currentLanguage(): AppLanguage {
  return effectiveLanguage(useSettings.getState().language, deviceLanguage());
}

/**
 * Asks the system (languageRules.ts reconcileLanguage): a language chosen in the system settings wins; on the
 * first look on Android 13+ an earlier choice is written to the system's per-app languages. Saves what changed,
 * and returns the language the app should run in.
 */
export function syncLanguageWithSystem(): AppLanguage {
  const before = languagePrefs();
  const { prefs, language, writeAppLocales } = reconcileLanguage(before, readSystemLanguage());
  if (languagePrefsDiffer(before, prefs)) useSettings.getState().setLanguagePrefs(prefs);
  if (writeAppLocales) setAppLocales(writeAppLocales);
  return language;
}

/**
 * The language a choice would run the app in, or null when it can't be known before the restart: "שפת המכשיר"
 * on Android 13+ while the system holds an explicit choice (the phone's own language shows only once it is
 * cleared).
 */
export function predictLanguage(setting: LanguageSetting): AppLanguage | null {
  if (setting === 'system' && (readSystemLanguage().appLocales?.length ?? 0) > 0) return null;
  return effectiveLanguage(setting, deviceLanguage());
}

/**
 * The in-app picker's choice (plan 0י): saved first (a change is on disk before the restart), then written to
 * Android 13+'s per-app languages, so the system settings show it too ("שפת המכשיר" clears them). What we write
 * is recorded as seen, so it never counts as the player's choice in the system settings. The root layout then
 * switches the language and restarts (useLanguageLifecycle); when the new language can't be known yet
 * (predictLanguage), this restarts by itself.
 */
export function chooseLanguage(setting: LanguageSetting): void {
  const unknown = predictLanguage(setting) === null;
  const report = readSystemLanguage();
  const held = systemLanguageOf(setting);
  const settings = useSettings.getState();
  settings.setLanguagePrefs({
    language: setting,
    languageSource: 'app',
    ...(report.appLocales !== null ? { appLocalesSeen: held ?? '' } : null),
  });
  if (report.appLocales !== null) setAppLocales(held ? [held] : []);
  if (unknown) void restartApp();
}

/**
 * Runs the app in `language`. At launch (the first frame already has it, i18n/index.ts): only the direction,
 * which needs a restart when it is not the one React Native started with (guarded against a second restart in
 * a row, services/restart.ts). While running: switch i18next, set the direction, and restart (D104: on every
 * change, also when the guard keeps a direction from restarting; with restartOnEveryChange off, only when the
 * direction flips). Nothing when it is already running.
 */
export function applyLanguage(language: AppLanguage, { launch }: { launch: boolean }): void {
  const switching = i18n.language !== language;
  if (!launch && !switching) return;
  if (switching) void i18n.changeLanguage(language);
  const flips = applyDirection(language);
  if (launch) {
    if (flips) restartForDirection(isRtlLanguage(language));
    else directionSettled();
    return;
  }
  const restarting = flips && restartForDirection(isRtlLanguage(language));
  if (!restarting && I18N_CONFIG.restartOnEveryChange) void restartApp();
}

/**
 * The root layout's part: the language at launch, a change of the setting (the picker), and the system's word
 * on every return to the foreground (a language chosen in the system settings, or the phone's for "שפת
 * המכשיר").
 */
export function useLanguageLifecycle(): void {
  const setting = useSettings((s) => s.language);
  const launched = useRef(false);

  useEffect(() => {
    const launch = !launched.current;
    launched.current = true;
    applyLanguage(currentLanguage(), { launch });
  }, [setting]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // A changed setting also runs the effect above, which then finds the language already switched.
      applyLanguage(syncLanguageWithSystem(), { launch: false });
    });
    return () => subscription.remove();
  }, []);
}
