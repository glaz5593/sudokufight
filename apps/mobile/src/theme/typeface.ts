import type { TextStyle } from 'react-native';

import type { AppLanguage } from '../i18n/languages';
import { tokens } from './tokens.generated';

/**
 * The font and the line heights of each language (localization plan 0ט, D106, D107). A leaf: theme/index.ts
 * applies it to every type style, components/player/metrics.ts to its own sizes, the base Text
 * (components/ui/Text.tsx) to line breaking, and the layout tests read it to measure a language.
 *
 * - Rubik, the app's font, for the 13 languages whose letters it has: Hebrew, English, Arabic (with its joining
 *   forms), Russian and the Latin ones. fontCoverage.test.ts proves the list from the font files.
 * - The system's font for Vietnamese (Rubik lacks its stacked marks, ơ ư ạ ả …), Thai, Japanese, Korean and
 *   Chinese (no CJK font is added: tens of MB). On iOS Japanese, Chinese and Korean name their family, so Han
 *   characters take that language's forms (a Japanese 直 is not a Chinese one).
 * - Teko, the font of numbers, stays in every language (D107): it has Latin letters and digits only, so its
 *   words (VS, GO!, the dash) stay Latin. The board's and the keypad's digits (Rubik: theme/index.ts
 *   DIGIT_TYPES) stay as they are too, 1–9 in every language.
 * - A least line height for scripts with marks above or below the line: Arabic ×1.35, Thai ×1.5, Vietnamese ×1.4,
 *   CJK ×1.3 of the font size. Some type styles have a line height equal to the size (micro 12/12), where those
 *   marks would be cut. Hebrew, Latin and Cyrillic keep the tokens' line heights exactly.
 *
 * The app's language is fixed while it runs (D104: every change restarts it), so these are read once, as it
 * starts (theme/index.ts appTypeface).
 */

export type Script = 'hebrew' | 'latin' | 'cyrillic' | 'arabic' | 'vietnamese' | 'thai' | 'cjk';

/** Each language's script; a code not here (none of ours) is Latin. */
export const LANGUAGE_SCRIPT: Readonly<Record<AppLanguage, Script>> = {
  he: 'hebrew',
  en: 'latin',
  ar: 'arabic',
  es: 'latin',
  'pt-BR': 'latin',
  de: 'latin',
  fr: 'latin',
  ja: 'cjk',
  ru: 'cyrillic',
  ko: 'cjk',
  it: 'latin',
  tr: 'latin',
  'zh-Hans': 'cjk',
  id: 'latin',
  pl: 'latin',
  'zh-Hant': 'cjk',
  vi: 'vietnamese',
  th: 'thai',
  nl: 'latin',
  // The pseudo languages of development builds (plan 0יג): accented English in Rubik; English laid out right to
  // left, with Arabic's line heights, so a tester sees Arabic's taller lines before there is Arabic.
  'en-XA': 'latin',
  'ar-XB': 'arabic',
};

interface ScriptType {
  /** 'rubik': the app's own font files; 'system': the platform's font. */
  font: 'rubik' | 'system';
  /** The least line height as a multiple of the font size; 0: the tokens' own. */
  minLineHeight: number;
}

const SCRIPT_TYPE: Readonly<Record<Script, ScriptType>> = {
  hebrew: { font: 'rubik', minLineHeight: 0 },
  latin: { font: 'rubik', minLineHeight: 0 },
  cyrillic: { font: 'rubik', minLineHeight: 0 },
  arabic: { font: 'rubik', minLineHeight: 1.35 },
  vietnamese: { font: 'system', minLineHeight: 1.4 },
  thai: { font: 'system', minLineHeight: 1.5 },
  cjk: { font: 'system', minLineHeight: 1.3 },
};

/** iOS: the system family that draws a CJK language in its own forms (PingFang, Hiragino, Apple SD Gothic). */
export const IOS_FAMILIES: Readonly<Record<string, string>> = {
  ja: 'Hiragino Sans',
  ko: 'Apple SD Gothic Neo',
  'zh-Hans': 'PingFang SC',
  'zh-Hant': 'PingFang TC',
};

export interface Typeface {
  /** The language it is for. */
  language: string;
  script: Script;
  font: 'rubik' | 'system';
  /** The system font's family to name (iOS: Japanese, Korean, Chinese), or null for the platform's default. */
  systemFamily: string | null;
  /** The least line height as a multiple of the font size; 0: the tokens' own line heights. */
  minLineHeight: number;
  /** iOS: break Korean lines between words, not inside one (React Native has no such prop on Android). */
  lineBreakStrategyIOS: 'hangul-word' | null;
}

/** The typeface of `lang` on `os` ('ios', 'android', …). */
export function typefaceFor(lang: string, os: string): Typeface {
  const script = (LANGUAGE_SCRIPT as Readonly<Record<string, Script>>)[lang] ?? 'latin';
  const { font, minLineHeight } = SCRIPT_TYPE[script];
  return {
    language: lang,
    script,
    font,
    systemFamily: font === 'system' && os === 'ios' ? (IOS_FAMILIES[lang] ?? null) : null,
    minLineHeight,
    lineBreakStrategyIOS: lang === 'ko' && os === 'ios' ? 'hangul-word' : null,
  };
}

/** The languages the app's own font draws (the rest take the system's). */
export const usesRubik = (lang: string): boolean => typefaceFor(lang, 'android').font === 'rubik';

export type UiWeight = keyof typeof tokens.font.load.Rubik;

/**
 * The font of interface text at `weight` in a typeface: Rubik's file of that weight ("Rubik_700Bold"), or the
 * system font at that weight (with its family where one is named).
 */
export function uiFont(typeface: Typeface, weight: UiWeight): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  if (typeface.font === 'rubik') return { fontFamily: tokens.font.load.Rubik[weight] };
  return typeface.systemFamily
    ? { fontFamily: typeface.systemFamily, fontWeight: weight }
    : { fontWeight: weight };
}

/** A line height in a typeface: the design's, or the script's least for this size when that is taller. */
export function lineHeightIn(typeface: Typeface, fontSize: number, lineHeight: number): number {
  if (!typeface.minLineHeight) return lineHeight;
  return Math.max(lineHeight, Math.ceil(fontSize * typeface.minLineHeight));
}
