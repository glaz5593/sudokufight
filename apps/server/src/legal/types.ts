/**
 * The legal pages the server publishes (spec §23: both stores want a privacy policy at a public URL; Google
 * Play also wants a web page for account deletion). Their words live in privacy.ts, terms.ts and
 * deleteAccount.ts, in Hebrew and English; render.ts turns one into a page; router.ts serves it.
 *
 * A text is plain words with a few marks, so no HTML is ever written by hand (render.ts escapes everything
 * first):
 * - `**bold**`
 * - `` `code` `` (an event name, a setting): shown left to right inside Hebrew
 * - `[words](privacy)`: a link to another legal page (privacy, terms, delete-account), in the same language
 * - `{email}`: the contact address (LEGAL_CONTACT_EMAIL), a mailto: link
 * - `{operator}`: who runs the game (LEGAL_OPERATOR_NAME)
 */

export const LEGAL_LANGS = ['he', 'en'] as const;
export type LegalLang = (typeof LEGAL_LANGS)[number];

export const LEGAL_DOCS = ['privacy', 'terms', 'delete-account'] as const;
export type LegalDocId = (typeof LEGAL_DOCS)[number];

/**
 * When the texts last changed: shown as "עודכן לאחרונה". Change it with any change to their meaning (the app
 * links to the current version; the stores keep only the URL).
 */
export const LEGAL_UPDATED = '2026-10-18';

export type Block =
  | string
  | { list: readonly string[]; ordered?: boolean }
  | { table: { head: readonly string[]; rows: readonly (readonly string[])[] } };

export interface LegalSection {
  /** The anchor (#id): the same in both languages. */
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

/** Who runs the game and how to reach them; unset values show as visible placeholders. */
export interface LegalSettings {
  contactEmail: string | null;
  operatorName: string | null;
}
