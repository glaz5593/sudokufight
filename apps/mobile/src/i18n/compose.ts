import type { TFunction } from 'i18next';

import { I18N_CONFIG } from '../config/i18n';

/**
 * Text built from parts, in any language (localization plan 0ה, D108). The code glues no words with a literal
 * space, full stop, colon or "%": each comes from a translation key, so a language with other punctuation gets
 * its own ("label : value" in French, "%57" in Turkish, "39,5" in German) and Japanese and Chinese put no space
 * after a sentence. In Hebrew and English every key holds what the code wrote before, so their text is the same
 * byte for byte (__tests__/compose.test.ts).
 *
 * Pure: `t` is any namespace's (the keys here name their own namespace). A leaf besides config/i18n.ts, so any
 * screen or model may import it.
 */

type Part = string | null | false | undefined;
const present = (parts: readonly Part[]): string[] => parts.filter((p): p is string => !!p);

/**
 * Sentences one after another, each already ending as it should: "…נסה שוב. נרשמת עם Google?…". The space after a
 * sentence is match:sentenceSpace (none in Japanese and Chinese). Empty parts are skipped.
 */
export function spaceSentences(parts: readonly Part[], t: TFunction): string {
  return present(parts).join(t('match:sentenceSpace'));
}

/**
 * Parts that are not sentences yet, each closed and put after the other: "הבוס: Pip. מהיר." (match:sep between
 * them, the language's full stop and space: ". ", "。" in Japanese). The last part gets no stop.
 */
export function stopSentences(parts: readonly Part[], t: TFunction): string {
  return present(parts).join(t('match:sep'));
}

/** One sentence closed with the language's full stop: "בריבוע 5." / "ボックス5。" (common:text.sentence). */
export const closeSentence = (text: string, t: TFunction): string => t('common:text.sentence', { text });

/** Words one after another: "7.6 ש׳", "Found 1 of 2" (common:text.wordSpace: none in Japanese, Chinese, Thai). */
export function spaceWords(parts: readonly Part[], t: TFunction): string {
  return present(parts).join(t('common:text.wordSpace'));
}

/** A list: "A8, B3, C1" (player:listSep: "، " in Arabic, "、" in Japanese). */
export function listOf(parts: readonly Part[], t: TFunction): string {
  return present(parts).join(t('player:listSep'));
}

/** "label: value" (common:text.labelValue: "label : value" in French, "label：value" in Japanese). */
export const labelValue = (label: string, value: string, t: TFunction): string =>
  t('common:text.labelValue', { label, value });

/** "text (note)": "NinaVolt (אני)" (common:text.parenthetical: full-width brackets in Japanese and Chinese). */
export const parenthetical = (text: string, note: string, t: TFunction): string =>
  t('common:text.parenthetical', { text, note });

// ---------------------------------------------------------------------------------------------------------
// Numbers and dates (D108: Western digits in every language)

/**
 * The language's decimal separator: "." in Hebrew and English, "," in German (common:number.decimal). From a key,
 * not from Intl.NumberFormat, so the phone shows exactly what the tests check on every Android version. The
 * formatters of components/player/format.ts are worklets (a count-up formats on the UI thread, where t() is not):
 * a screen reads this once and passes it to them.
 */
export const decimalSeparator = (t: TFunction): string => t('common:number.decimal');

/**
 * A percent in the language's pattern, not isolated: "57%", "%57" in Turkish, "57 %" in French
 * (common:number.percent). In RTL text the caller wraps it in an LTR isolate (format.ts `ltr`).
 */
export const percent = (value: number, t: TFunction): string => t('common:number.percent', { value });

/**
 * The locale Intl formats dates in: the app's language with Western digits ("ar-u-nu-latn": 23/10/2026 on every
 * phone; plain 'ar' is Western on a new Android and ٢٣/١٠/٢٠٢٦ on some, as 'ar-SA' is in Node). D108's
 * alternative (I18N_CONFIG.westernDigitsEverywhere off): the language alone, the system's own digits. Thai keeps
 * the Buddhist year: that is its calendar, not its digits.
 *
 * Not checked on a phone yet: whether Hermes' Intl honours the -u-nu-latn extension (Node does). If the debug
 * screen (plan 0יג) shows Arabic-Indic digits, pass `numberingSystem: 'latn'` among the options in dateFormat too.
 */
export function intlLocale(language: string): string {
  return I18N_CONFIG.westernDigitsEverywhere ? `${language}-u-nu-latn` : language;
}

/** Intl.DateTimeFormat in the app's language (intlLocale). Throws as Intl does on a tag it can't read. */
export function dateFormat(language: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(language), options);
}
