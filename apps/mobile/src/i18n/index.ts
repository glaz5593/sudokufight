import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';

import enAccount from './locales/en/account.json';
import enBoard from './locales/en/board.json';
import enCommon from './locales/en/common.json';
import enDev from './locales/en/dev.json';
import enGame from './locales/en/game.json';
import enHistory from './locales/en/history.json';
import enHome from './locales/en/home.json';
import enMatch from './locales/en/match.json';
import enPlayer from './locales/en/player.json';
import enReplay from './locales/en/replay.json';
import enUi from './locales/en/ui.json';
import heAccount from './locales/he/account.json';
import heBoard from './locales/he/board.json';
import heCommon from './locales/he/common.json';
import heDev from './locales/he/dev.json';
import heGame from './locales/he/game.json';
import heHistory from './locales/he/history.json';
import heHome from './locales/he/home.json';
import heMatch from './locales/he/match.json';
import hePlayer from './locales/he/player.json';
import heReplay from './locales/he/replay.json';
import heUi from './locales/he/ui.json';

/**
 * Translations (CLAUDE.md: no hard-coded UI strings; spec §22: Hebrew first, and English). Every string goes
 * through t(). One file per area (namespace): common, ui, player, board, home, game, account, dev, replay,
 * history (stage 11) and match (stage 9: matchmaking).
 */
export const LANGUAGES = ['he', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const NAMESPACES = [
  'common',
  'ui',
  'player',
  'board',
  'home',
  'game',
  'account',
  'dev',
  'replay',
  'history',
  'match',
] as const;

export const resources = {
  he: {
    common: heCommon,
    ui: heUi,
    player: hePlayer,
    board: heBoard,
    home: heHome,
    game: heGame,
    account: heAccount,
    dev: heDev,
    replay: heReplay,
    history: heHistory,
    match: heMatch,
  },
  en: {
    common: enCommon,
    ui: enUi,
    player: enPlayer,
    board: enBoard,
    home: enHome,
    game: enGame,
    account: enAccount,
    dev: enDev,
    replay: enReplay,
    history: enHistory,
    match: enMatch,
  },
} as const;

/** Hebrew unless the device asks for English. */
export function deviceLanguage(): Language {
  const code = getLocales()[0]?.languageCode;
  return code === 'en' ? 'en' : 'he';
}

export const isRtlLanguage = (lang: Language): boolean => lang === 'he';

/**
 * Sets the layout direction for a language. React Native applies a direction change only after a reload, so
 * this returns true when the app must restart (see services/restart.ts).
 */
export function applyDirection(lang: Language): boolean {
  const rtl = isRtlLanguage(lang);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  return true;
}

void i18n.use(initReactI18next).init({
  resources,
  ns: [...NAMESPACES],
  defaultNS: 'common',
  lng: deviceLanguage(),
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

export default i18n;
