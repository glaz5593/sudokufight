import ENABLED from './enabled-languages.json';

/**
 * The app's languages (localization plan §1, §2 0א). A leaf: it imports nothing but enabled-languages.json, so
 * any file may import it (deviceLanguage.ts, config/i18n.ts, the countries' tables, the legal links) without an
 * import cycle through i18n/index.ts.
 *
 * - LANGUAGES: the 19 the app is translated into, in the plan's order (Hebrew and English, then the order of
 *   the work, Arabic first and Dutch last). The language picker lists them in this order.
 * - ENABLED_LANGUAGES: those this build offers (enabled-languages.json: he and en in stage 0; each language
 *   stage appends its code). The same file feeds scripts/i18n-check.mjs and plugins/withAppLocales.js.
 * - PSEUDO_LANGUAGES: two made-up languages for development and staging builds (plan 0יג): en-XA, accented
 *   and longer English; ar-XB, English laid out right to left.
 */
export const LANGUAGES = [
  'he',
  'en',
  'ar',
  'es',
  'pt-BR',
  'de',
  'fr',
  'ja',
  'ru',
  'ko',
  'it',
  'tr',
  'zh-Hans',
  'id',
  'pl',
  'zh-Hant',
  'vi',
  'th',
  'nl',
] as const;
export type Language = (typeof LANGUAGES)[number];

export const PSEUDO_LANGUAGES = ['en-XA', 'ar-XB'] as const;
export type PseudoLanguage = (typeof PSEUDO_LANGUAGES)[number];
export type AppLanguage = Language | PseudoLanguage;

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

export const isPseudoLanguage = (value: unknown): value is PseudoLanguage =>
  typeof value === 'string' && (PSEUDO_LANGUAGES as readonly string[]).includes(value);

export const isAppLanguage = (value: unknown): value is AppLanguage =>
  isLanguage(value) || isPseudoLanguage(value);

const RTL: ReadonlySet<string> = new Set(['he', 'ar', 'ar-XB']);

/** Right to left: Hebrew, Arabic and the Arabic pseudo language. Any other code (or none) is left to right. */
export function isRtlLanguage(lang: string): boolean {
  return RTL.has(lang);
}

/**
 * Each language by its own name, the same in every language of the app (the language picker; plan 0י: a player
 * looks for "Deutsch", not "גרמנית"). Not translation keys: these never change with the app's language.
 */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  he: 'עברית',
  en: 'English',
  ar: 'العربية',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  de: 'Deutsch',
  fr: 'Français',
  ja: '日本語',
  ru: 'Русский',
  ko: '한국어',
  it: 'Italiano',
  tr: 'Türkçe',
  'zh-Hans': '简体中文',
  id: 'Bahasa Indonesia',
  pl: 'Polski',
  'zh-Hant': '繁體中文',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  nl: 'Nederlands',
};

/** A language's own name; a pseudo language (or an unknown code) by its code. */
export const languageName = (lang: string): string => (isLanguage(lang) ? LANGUAGE_NAMES[lang] : lang);

/**
 * The languages this build offers, in LANGUAGES' order (whatever order enabled-languages.json lists them in).
 * An unknown code in the file is left out (languages.test.ts fails on it).
 */
export const ENABLED_LANGUAGES: readonly Language[] = LANGUAGES.filter((lang) =>
  (ENABLED as readonly string[]).includes(lang),
);

/**
 * The language to show a piece of content in (a legal page, a country table, an explanation): `lang` when the
 * content exists in it, else English (D101: English is the fallback everywhere, also for a language that is
 * not translated yet).
 */
export function contentLanguage(lang: string, available: readonly string[]): string {
  return available.includes(lang) ? lang : 'en';
}
