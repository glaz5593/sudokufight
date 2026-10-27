/**
 * The languages of the server's public pages: the legal pages and a room link's page (localization plan 0יב,
 * D105, D112, D113). They are the app's 19 (apps/mobile/src/i18n/languages.ts LANGUAGES, in its order; a test
 * keeps them equal). A page has a version in some of them (legal: LEGAL_LANGS; a room link: LINK_LANGS), and
 * every other language gets English (D101).
 *
 * Each translation stage adds its language to a page's list, with that page's words in it; nothing here
 * changes. All of it is additive: an older app keeps asking for `?lang=he` or `?lang=en` and gets what it got.
 */

export const PAGE_LANGUAGES = [
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
export type PageLanguage = (typeof PAGE_LANGUAGES)[number];

/** What a page shows in a language it has no version of (D101). */
export const FALLBACK_PAGE_LANGUAGE = 'en' satisfies PageLanguage;

/** Each language by its own name: the pages' language links (the same names as the app's language picker). */
export const PAGE_LANGUAGE_NAMES: Readonly<Record<PageLanguage, string>> = {
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

export const isPageLanguage = (value: unknown): value is PageLanguage =>
  typeof value === 'string' && (PAGE_LANGUAGES as readonly string[]).includes(value);

/** Right to left: Hebrew and Arabic. */
export const pageDir = (lang: PageLanguage): 'rtl' | 'ltr' =>
  lang === 'he' || lang === 'ar' ? 'rtl' : 'ltr';

/** Chinese written in the traditional script when a tag has no script: Taiwan, Hong Kong and Macau (D105). */
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/**
 * One language tag (BCP 47, any case, `_` as well as `-`) → the page language it reads as, or null for one
 * the app does not have (D105): the old codes iw → he and in → id; Chinese by its script, else by its region;
 * every Spanish → es; every Portuguese → pt-BR; anything else by its first part (de-AT → de).
 */
export function pageLanguageOfTag(tag: string): PageLanguage | null {
  const [primary = '', ...rest] = tag.trim().replace(/_/g, '-').toLowerCase().split('-');
  switch (primary) {
    case 'iw':
      return 'he';
    case 'in':
      return 'id';
    case 'es':
      return 'es';
    case 'pt':
      return 'pt-BR';
    case 'zh':
      if (rest.includes('hant')) return 'zh-Hant';
      if (rest.includes('hans')) return 'zh-Hans';
      return rest.some((part) => TRADITIONAL_REGIONS.has(part)) ? 'zh-Hant' : 'zh-Hans';
    default:
      return PAGE_LANGUAGES.find((lang) => lang === primary) ?? null;
  }
}

/**
 * `?lang=`: exactly one of the page languages' codes (as the app and the pages' own links write them), else
 * null (none, unknown, another case, repeated).
 */
export const pageLanguageOfQuery = (value: unknown): PageLanguage | null =>
  isPageLanguage(value) ? value : null;

/** A language a page has a version of: `lang` itself, else English (D101). */
export function versionOf<L extends PageLanguage>(lang: PageLanguage, available: readonly L[]): L {
  const own = available.find((l) => l === lang);
  if (own !== undefined) return own;
  const fallback = available.find((l) => l === FALLBACK_PAGE_LANGUAGE);
  if (fallback === undefined) throw new Error('a page without an English version');
  return fallback;
}

/**
 * A page's language from the browser's Accept-Language: the most preferred (by `q`; on a tie, the first) of
 * the languages the page has (tags read by pageLanguageOfTag), where `*` stands for `none`. No header at all:
 * `none`. A header naming none of them (say, only Swahili, or only Arabic before Arabic has a version): English.
 */
export function negotiatePageLanguage<L extends PageLanguage>(
  header: string | undefined,
  available: readonly L[],
  none: L,
): L {
  if (header === undefined || header.trim() === '') return none;
  let best: { lang: L; q: number } | undefined;
  for (const part of header.split(',').slice(0, 32)) {
    const [tag = '', ...params] = part.split(';').map((s) => s.trim());
    const named = tag === '*' ? none : pageLanguageOfTag(tag);
    const lang = available.find((l) => l === named);
    if (lang === undefined) continue;
    const qParam = params.find((p) => /^q=/i.test(p));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));
    if (!(q > 0 && q <= 1)) continue; // q=0: "not this one"; anything else malformed
    if (best === undefined || q > best.q) best = { lang, q };
  }
  return best?.lang ?? versionOf(FALLBACK_PAGE_LANGUAGE, available);
}
