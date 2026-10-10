// i18n: Hebrew (RTL, default) + English (LTR).
// Every module registers its own strings, namespaced by area:  registerStrings({ he: {'home.play': 'שחק'}, en: {'home.play': 'Play'} })
// Interpolation: t('results.place', { n: 2 }) with "{n}" placeholders.
import { app } from './store.js';
import { bus } from './bus.js';

const dicts = { he: {}, en: {} };

export function registerStrings(obj) {
  for (const [lang, entries] of Object.entries(obj)) {
    dicts[lang] ??= {};
    Object.assign(dicts[lang], entries);
  }
}

export const getLang = () => app.get().lang;
export const isRTL = () => getLang() === 'he';
export const dir = () => (isRTL() ? 'rtl' : 'ltr');

export function t(key, params) {
  const lang = getLang();
  let s = dicts[lang]?.[key] ?? dicts.en?.[key] ?? dicts.he?.[key];
  if (s == null) {
    if (!t._warned.has(key)) { t._warned.add(key); console.warn(`[i18n] missing key: ${key}`); }
    return key;
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
  return s;
}
t._warned = new Set();

/** Pick from a {he, en} object (used by data catalogs). */
export const tr = (obj) => (obj == null ? '' : typeof obj === 'string' ? obj : obj[getLang()] ?? obj.en ?? obj.he ?? '');

export function applyDir() {
  const root = document.documentElement;
  root.lang = getLang();
  root.dir = dir();
}

export function setLang(lang) {
  if (lang === getLang()) return;
  app.set({ lang });
  applyDir();
  bus.emit('lang', { lang });
}

/** Number formatting. Keeps Latin digits in both languages (gaming convention). */
export function fmtNum(n, { decimals = 0, signed = false } = {}) {
  const v = Number(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : '';
  return sign + s;
}

// Shared, cross-screen strings. Screen-specific strings live with their screen.
registerStrings({
  he: {
    'common.back': 'חזרה',
    'common.close': 'סגירה',
    'common.cancel': 'ביטול',
    'common.confirm': 'אישור',
    'common.continue': 'המשך',
    'common.retry': 'נסה שוב',
    'common.loading': 'טוען…',
    'common.points': 'נק׳',
    'common.rating': 'דירוג',
    'common.you': 'אתה',
    'common.online': 'מחובר',
    'common.offline': 'לא מחובר',
    'gameType.fast': 'מהיר',
    'gameType.normal': 'רגיל',
    'gameType.hard': 'קשה',
    'mode.solo': 'אימון לבד',
    'mode.bot': 'אימון מול בוט',
    'mode.ranked2': 'מדורג · 2 שחקנים',
    'mode.ranked3': 'מדורג · 3 שחקנים',
    'mode.ranked4': 'מדורג · 4 שחקנים',
    'league.bronze': 'ארד',
    'league.silver': 'כסף',
    'league.gold': 'זהב',
    'league.diamond': 'יהלום',
    'league.legend': 'אגדה',
  },
  en: {
    'common.back': 'Back',
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.continue': 'Continue',
    'common.retry': 'Try again',
    'common.loading': 'Loading…',
    'common.points': 'pts',
    'common.rating': 'Rating',
    'common.you': 'You',
    'common.online': 'Online',
    'common.offline': 'Offline',
    'gameType.fast': 'Fast',
    'gameType.normal': 'Normal',
    'gameType.hard': 'Hard',
    'mode.solo': 'Solo practice',
    'mode.bot': 'Practice vs bot',
    'mode.ranked2': 'Ranked · 2 players',
    'mode.ranked3': 'Ranked · 3 players',
    'mode.ranked4': 'Ranked · 4 players',
    'league.bronze': 'Bronze',
    'league.silver': 'Silver',
    'league.gold': 'Gold',
    'league.diamond': 'Diamond',
    'league.legend': 'Legend',
  },
});
