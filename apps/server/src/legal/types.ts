/**
 * The legal pages the server publishes (spec §23: both stores want a privacy policy at a public URL; Google
 * Play also wants a web page for account deletion). Their words live in privacy.ts, terms.ts and
 * deleteAccount.ts, one version per language of LEGAL_LANGS; render.ts turns one into a page; router.ts serves
 * it, in English for a language without a version.
 *
 * Translated versions (D112, Moshe 2026-10-23): Hebrew and English are the originals and never change for
 * this; every other version is a translation of the English one, with the same sections, links and contact
 * details (legal.test.ts), and a line at its top that the English version prevails (render.ts
 * LegalChrome.translationNotice). Adding one: its code here, and its file in translations/ (texts, events and
 * the words around them) in translations/index.ts LEGAL_TRANSLATIONS (TypeScript asks for every one).
 *
 * A text is plain words with a few marks, so no HTML is ever written by hand (render.ts escapes everything
 * first):
 * - `**bold**`
 * - `` `code` `` (an event name, a setting): shown left to right inside Hebrew
 * - `[words](privacy)`: a link to another legal page (privacy, terms, delete-account), in the same language
 * - `{email}`: the contact address (LEGAL_CONTACT_EMAIL), a mailto: link
 * - `{operator}`: who runs the game (LEGAL_OPERATOR_NAME)
 */

/**
 * The languages with a version, in the order of the pages' language links (PAGE_LANGUAGES' order): all 19 of
 * the app's since 1.1.0 (localization stages 1–17; their texts in translations/).
 */
export const LEGAL_LANGS = [
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
export type LegalLang = (typeof LEGAL_LANGS)[number];

/** The originals: every other version is a translation of the English one. */
export const LEGAL_ORIGINALS: readonly LegalLang[] = ['he', 'en'];
export type OriginalLegalLang = 'he' | 'en';
/** A translated version (D112): translations/index.ts LEGAL_TRANSLATIONS. */
export type TranslatedLegalLang = Exclude<LegalLang, OriginalLegalLang>;

export const LEGAL_DOCS = ['privacy', 'terms', 'delete-account'] as const;
export type LegalDocId = (typeof LEGAL_DOCS)[number];

/**
 * When the texts last changed: shown as "עודכן לאחרונה". Change it with any change to their meaning (the app
 * links to the current version; the stores keep only the URL).
 */
export const LEGAL_UPDATED = '2026-10-20';

export type Block =
  | string
  | { list: readonly string[]; ordered?: boolean }
  | { table: { head: readonly string[]; rows: readonly (readonly string[])[] } };

export interface LegalSection {
  /** The anchor (#id): the same in every language. */
  id: string;
  title: string;
  blocks: readonly Block[];
}

export interface LegalDoc {
  title: string;
  /** One line under the title. */
  lead: string;
  sections: readonly LegalSection[];
}

export type LegalTexts = Record<LegalLang, LegalDoc>;
/** Hebrew's and English's version of a document, written here (privacy.ts, terms.ts, deleteAccount.ts). */
export type OriginalTexts = Record<OriginalLegalLang, LegalDoc>;

/** Who runs the game and how to reach them; unset values show as visible placeholders. */
export interface LegalSettings {
  contactEmail: string | null;
  operatorName: string | null;
}
