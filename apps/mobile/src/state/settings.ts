import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import {
  defaultLanguagePrefs,
  type LanguagePrefs,
  languagePrefsOf,
  type LanguageSetting,
  type LanguageSource,
  SETTINGS_STORE_KEY,
  SETTINGS_VERSION,
} from '../i18n/languageRules';

/**
 * Read and written synchronously (work plan stage 13). The settings are in the store from the first render,
 * so the root layout never applies the device's language and direction before the player's (which would
 * restart the app into the wrong one), and a language change is on disk before the app restarts for it.
 */
export const syncSettingsStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => Storage.setItemSync(name, value),
  removeItem: (name) => void Storage.removeItemSync(name),
};

/**
 * The player's settings on this phone (spec §4.1 "Settings": sound, haptics, language, reduced motion).
 * Kept in expo-sqlite's key-value store, so they survive restarts.
 *
 * The language (localization plan 0א, D102): 'system' ("שפת המכשיר", where a new install starts) or a language
 * the player chose, with where the choice came from and what the system last said (i18n/languageRules.ts, which
 * also reads this record before the store exists, for i18n/index.ts). Version 2 from 1.1.0: a version 1 record
 * keeps its language as the player's choice (D102). A change of language goes through i18n/languageSync.ts
 * chooseLanguage, which also tells Android 13+; setLanguage alone is for the design system and tests.
 */
export type ReduceMotionSetting = 'system' | 'on' | 'off';

export interface SettingsState extends LanguagePrefs {
  sound: boolean;
  haptics: boolean;
  reduceMotion: ReduceMotionSetting;
  /** The language setting, chosen in the app unless `source` says otherwise. */
  setLanguage: (language: LanguageSetting, source?: LanguageSource) => void;
  /** The language setting's fields, as i18n/languageSync.ts reconciles them with the system. */
  setLanguagePrefs: (prefs: Partial<LanguagePrefs>) => void;
  setSound: (on: boolean) => void;
  setHaptics: (on: boolean) => void;
  setReduceMotion: (value: ReduceMotionSetting) => void;
}

type Persisted = Pick<SettingsState, keyof LanguagePrefs | 'sound' | 'haptics' | 'reduceMotion'>;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultLanguagePrefs(),
      sound: true,
      haptics: true,
      reduceMotion: 'system',
      setLanguage: (language, languageSource = 'app') => set({ language, languageSource }),
      setLanguagePrefs: (prefs) => set(prefs),
      setSound: (sound) => set({ sound }),
      setHaptics: (haptics) => set({ haptics }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    }),
    {
      name: SETTINGS_STORE_KEY,
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => syncSettingsStorage),
      // Version 1 (until 1.0.4): { language: 'he' | 'en', sound, haptics, reduceMotion }.
      migrate: (persisted, version) => ({
        ...(persisted as Partial<Persisted>),
        ...languagePrefsOf(persisted, version),
      }),
      partialize: (s): Persisted => ({
        language: s.language,
        languageSource: s.languageSource,
        appLocalesSeen: s.appLocalesSeen,
        systemLocaleSeen: s.systemLocaleSeen,
        sound: s.sound,
        haptics: s.haptics,
        reduceMotion: s.reduceMotion,
      }),
    },
  ),
);

/** The language part of the settings now. */
export const languagePrefs = (s: LanguagePrefs = useSettings.getState()): LanguagePrefs => ({
  language: s.language,
  languageSource: s.languageSource,
  appLocalesSeen: s.appLocalesSeen,
  systemLocaleSeen: s.systemLocaleSeen,
});
