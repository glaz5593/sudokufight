import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { deviceLanguage, type Language } from '../i18n';

/**
 * The player's settings on this phone (spec §4.1 "Settings": sound, haptics, language, reduced motion).
 * Kept in expo-sqlite's key-value store, so they survive restarts.
 */
export type ReduceMotionSetting = 'system' | 'on' | 'off';

export interface SettingsState {
  language: Language;
  sound: boolean;
  haptics: boolean;
  reduceMotion: ReduceMotionSetting;
  setLanguage: (language: Language) => void;
  setSound: (on: boolean) => void;
  setHaptics: (on: boolean) => void;
  setReduceMotion: (value: ReduceMotionSetting) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      language: deviceLanguage(),
      sound: true,
      haptics: true,
      reduceMotion: 'system',
      setLanguage: (language) => set({ language }),
      setSound: (sound) => set({ sound }),
      setHaptics: (haptics) => set({ haptics }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    }),
    {
      name: 'settings',
      version: 1,
      storage: createJSONStorage(() => Storage),
      partialize: ({ language, sound, haptics, reduceMotion }) => ({
        language,
        sound,
        haptics,
        reduceMotion,
      }),
    },
  ),
);
