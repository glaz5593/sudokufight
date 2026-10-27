import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId, TranslatedLegalLang } from '../types';
import { EVENT_DETAILS_AR, LEGAL_CHROME_AR, LEGAL_TEXTS_AR } from './ar';
import { EVENT_DETAILS_DE, LEGAL_CHROME_DE, LEGAL_TEXTS_DE } from './de';
import { EVENT_DETAILS_ES, LEGAL_CHROME_ES, LEGAL_TEXTS_ES } from './es';
import { EVENT_DETAILS_FR, LEGAL_CHROME_FR, LEGAL_TEXTS_FR } from './fr';
import { EVENT_DETAILS_ID, LEGAL_CHROME_ID, LEGAL_TEXTS_ID } from './id';
import { EVENT_DETAILS_IT, LEGAL_CHROME_IT, LEGAL_TEXTS_IT } from './it';
import { EVENT_DETAILS_JA, LEGAL_CHROME_JA, LEGAL_TEXTS_JA } from './ja';
import { EVENT_DETAILS_KO, LEGAL_CHROME_KO, LEGAL_TEXTS_KO } from './ko';
import { EVENT_DETAILS_NL, LEGAL_CHROME_NL, LEGAL_TEXTS_NL } from './nl';
import { EVENT_DETAILS_PL, LEGAL_CHROME_PL, LEGAL_TEXTS_PL } from './pl';
import { EVENT_DETAILS_PT_BR, LEGAL_CHROME_PT_BR, LEGAL_TEXTS_PT_BR } from './pt-BR';
import { EVENT_DETAILS_RU, LEGAL_CHROME_RU, LEGAL_TEXTS_RU } from './ru';
import { EVENT_DETAILS_TH, LEGAL_CHROME_TH, LEGAL_TEXTS_TH } from './th';
import { EVENT_DETAILS_TR, LEGAL_CHROME_TR, LEGAL_TEXTS_TR } from './tr';
import { EVENT_DETAILS_VI, LEGAL_CHROME_VI, LEGAL_TEXTS_VI } from './vi';
import { EVENT_DETAILS_ZH_HANS, LEGAL_CHROME_ZH_HANS, LEGAL_TEXTS_ZH_HANS } from './zh-Hans';
import { EVENT_DETAILS_ZH_HANT, LEGAL_CHROME_ZH_HANT, LEGAL_TEXTS_ZH_HANT } from './zh-Hant';

/**
 * The translated versions of the legal pages (D112, localization stages 1–17), one file per language: each a
 * translation of the English version, with the same sections, links, contact marks and numbers (legal.test.ts).
 * privacy.ts, terms.ts and deleteAccount.ts add their texts to Hebrew's and English's, privacy.ts its event
 * table, and render.ts the words around them. Hebrew and English (the originals) are not here and never change
 * for a translation.
 */
export interface LegalTranslation {
  texts: Readonly<Record<LegalDocId, LegalDoc>>;
  /** Each reported event and what it carries: [what happens, what it carries] (privacy.ts EVENT_DETAILS). */
  events: Readonly<Record<TelemetryEventName, readonly [string, string]>>;
  chrome: LegalChrome;
}

export const LEGAL_TRANSLATIONS: Readonly<Record<TranslatedLegalLang, LegalTranslation>> = {
  ar: { texts: LEGAL_TEXTS_AR, events: EVENT_DETAILS_AR, chrome: LEGAL_CHROME_AR },
  es: { texts: LEGAL_TEXTS_ES, events: EVENT_DETAILS_ES, chrome: LEGAL_CHROME_ES },
  'pt-BR': { texts: LEGAL_TEXTS_PT_BR, events: EVENT_DETAILS_PT_BR, chrome: LEGAL_CHROME_PT_BR },
  de: { texts: LEGAL_TEXTS_DE, events: EVENT_DETAILS_DE, chrome: LEGAL_CHROME_DE },
  fr: { texts: LEGAL_TEXTS_FR, events: EVENT_DETAILS_FR, chrome: LEGAL_CHROME_FR },
  ja: { texts: LEGAL_TEXTS_JA, events: EVENT_DETAILS_JA, chrome: LEGAL_CHROME_JA },
  ru: { texts: LEGAL_TEXTS_RU, events: EVENT_DETAILS_RU, chrome: LEGAL_CHROME_RU },
  ko: { texts: LEGAL_TEXTS_KO, events: EVENT_DETAILS_KO, chrome: LEGAL_CHROME_KO },
  it: { texts: LEGAL_TEXTS_IT, events: EVENT_DETAILS_IT, chrome: LEGAL_CHROME_IT },
  tr: { texts: LEGAL_TEXTS_TR, events: EVENT_DETAILS_TR, chrome: LEGAL_CHROME_TR },
  'zh-Hans': { texts: LEGAL_TEXTS_ZH_HANS, events: EVENT_DETAILS_ZH_HANS, chrome: LEGAL_CHROME_ZH_HANS },
  id: { texts: LEGAL_TEXTS_ID, events: EVENT_DETAILS_ID, chrome: LEGAL_CHROME_ID },
  pl: { texts: LEGAL_TEXTS_PL, events: EVENT_DETAILS_PL, chrome: LEGAL_CHROME_PL },
  'zh-Hant': { texts: LEGAL_TEXTS_ZH_HANT, events: EVENT_DETAILS_ZH_HANT, chrome: LEGAL_CHROME_ZH_HANT },
  vi: { texts: LEGAL_TEXTS_VI, events: EVENT_DETAILS_VI, chrome: LEGAL_CHROME_VI },
  th: { texts: LEGAL_TEXTS_TH, events: EVENT_DETAILS_TH, chrome: LEGAL_CHROME_TH },
  nl: { texts: LEGAL_TEXTS_NL, events: EVENT_DETAILS_NL, chrome: LEGAL_CHROME_NL },
};

/** One part of every translation, by language: { ar: …, es: …, … }. */
export function byTranslation<T>(pick: (t: LegalTranslation) => T): Record<TranslatedLegalLang, T> {
  return Object.fromEntries(Object.entries(LEGAL_TRANSLATIONS).map(([lang, t]) => [lang, pick(t)])) as Record<
    TranslatedLegalLang,
    T
  >;
}
