import { act } from '@testing-library/react-native';
import { Dimensions, type ScaledSize, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { isAvatarArtRoot } from '../../../avatars/testing/avatarTesting';
import type { TFunction } from 'i18next';

import i18n, { isPseudoLanguage, localeBundle } from '../../../i18n';
import { registerPseudoLanguages } from '../../../i18n/pseudoLanguages';
import { INVISIBLE, measuredWidth } from '../../../testing/fontMetrics';
import { lineHeightIn, type Typeface, typefaceFor, usesRubik } from '../../../theme';

// The pseudo languages join the layout tests (plan 0יג): en-XA, English about 40 % longer, in every list of
// layout languages; ar-XB, English right to left, in DIRECTION_LANGUAGES. Registered as this file loads, so
// before any test file collects layoutLanguages().
registerPseudoLanguages();

/** The part of a rendered test node these helpers read (RNTL's host elements). */
interface TreeNode {
  type: unknown;
  props: { style?: unknown };
  children: readonly (TreeNode | string)[];
}

function walk(node: TreeNode, out: TreeNode[]): TreeNode[] {
  // An avatar is a picture: its layers sit left to right in either language, on purpose (as the board's cells).
  if (isAvatarArtRoot(node)) return out;
  if (typeof node.type === 'string') out.push(node);
  for (const child of node.children) if (typeof child !== 'string') walk(child, out);
  return out;
}

/**
 * The flattened style of every host element under `root`, except the SVG icons (they mirror on purpose) and
 * the avatars' pictures (they never mirror).
 */
export function hostStyles(root: TreeNode): ViewStyle[] {
  return walk(root, [])
    .filter((n) => !String(n.type).startsWith('RNSVG'))
    .map((n) => (StyleSheet.flatten(n.props.style as ViewStyle) ?? {}) as ViewStyle);
}

/**
 * Layout must follow the app direction by itself: rows are plain `row` (React Native mirrors them in RTL),
 * nothing forces a direction, and nothing pins one side only with left/right.
 */
export function directionProblems(root: TreeNode): string[] {
  return hostStyles(root).flatMap((s) => {
    const problems: string[] = [];
    if (s.flexDirection === 'row-reverse') problems.push('row-reverse');
    if (s.direction !== undefined) problems.push(`direction: ${String(s.direction)}`);
    if ((s.left === undefined) !== (s.right === undefined)) problems.push('one-sided left/right');
    if ((s.marginLeft ?? s.paddingLeft) !== undefined || (s.marginRight ?? s.paddingRight) !== undefined) {
      problems.push('left/right margin or padding');
    }
    return problems;
  });
}

/** The phone Moshe tests on (Samsung S22: 360 × 780 dp), at the normal text size. */
export const PHONE: ScaledSize = { width: 360, height: 780, scale: 3, fontScale: 1 };

/**
 * Sets the window the next renders read (useWindowDimensions): a phone's width, a larger system text size.
 * Returns the way back, to await (Jest's default window is 750 × 1334 at fontScale 2).
 */
export function setWindow(window: Partial<ScaledSize>): () => Promise<void> {
  const before = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  Dimensions.set({ window: { ...before.window, ...window }, screen: before.screen });
  // A screen still on show hears the way back (useWindowDimensions): inside act, as any update in a test.
  return async () => {
    await act(async () => Dimensions.set(before));
  };
}

/**
 * Generous widths of a character, in em: Rubik (every word) and Teko (every number), the app's two fonts, and
 * the scripts a language in the system's font writes (localization plan 0טו): Chinese, kana and Hangul a full
 * em; Thai about .65, its marks above and below the line none; a mark over a letter (Vietnamese, Hebrew
 * points) none. Anything else (Cyrillic, Arabic, symbols) .75.
 */
function charEm(ch: string, font: 'Rubik' | 'Teko'): number {
  if (/\p{M}/u.test(ch)) return 0;
  if (/\s/.test(ch)) return 0.28;
  if (/\d/.test(ch)) return font === 'Teko' ? 0.5 : 0.62;
  if (/[֐-׿]/.test(ch)) return 0.64;
  if (/[A-Z]/.test(ch)) return 0.74;
  if (/[a-z]/.test(ch)) return 0.6;
  if (/[.,:;'’!|·]/.test(ch)) return 0.32;
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u{3000}-\u{303F}\u{FF00}-\u{FFEF}]/u.test(
      ch,
    )
  )
    return 1;
  if (/\p{Script=Thai}/u.test(ch)) return 0.65;
  return 0.75;
}

/** Vietnamese is Latin with marks stacked over and under it: its estimate gets 10 % more room. */
export const VIETNAMESE_MARGIN = 1.1;
const EVERY_INVISIBLE = new RegExp(INVISIBLE.source, 'gu');

/**
 * About how wide one line of text is, in dp. Jest can't measure text, so this errs on the wide side: a test
 * that says a label fits passes only with room to spare on the phone. Bidi marks (LRI, PDI…) take no room. A
 * letter with marks counts as its base letter (NFD), plus Vietnamese's margin when `lang` is 'vi'.
 */
export function textWidth(
  line: string,
  fontSize: number,
  {
    fontScale = 1,
    bold = false,
    font = 'Rubik',
    lang,
  }: { fontScale?: number; bold?: boolean; font?: 'Rubik' | 'Teko'; lang?: string } = {},
): number {
  // A letter and its marks apart (NFD), but a Hangul syllable whole (NFD splits it into its letters).
  const chars = [...line.replace(EVERY_INVISIBLE, '')].flatMap((ch) =>
    /\p{Script=Hangul}/u.test(ch) ? [ch] : [...ch.normalize('NFD')],
  );
  const ems = chars.reduce((sum, ch) => sum + charEm(ch, font), 0);
  return ems * fontSize * fontScale * (bold ? 1.06 : 1) * (lang === 'vi' ? VIETNAMESE_MARGIN : 1);
}

/**
 * How wide a line is in `lang`, in dp, in the font that language draws it with: measured in the app's font file
 * where the language uses Rubik (Arabic with its margin, fontMetrics.ts), estimated by script where it uses the
 * system's (textWidth). Teko, the numbers' font, is the same in every language and always measured. A style in
 * the system's font has no fontFamily (theme uiFont: its weight only), so its weight says whether it is bold.
 */
export function widthIn(
  lang: string,
  line: string,
  style: { fontFamily?: string; fontWeight?: TextStyle['fontWeight']; fontSize: number },
  { fontScale = 1 }: { fontScale?: number } = {},
): number {
  if (style.fontFamily !== undefined && (style.fontFamily.startsWith('Teko') || usesRubik(lang)))
    return measuredWidth(line, style.fontFamily, style.fontSize, { fontScale });
  const bold =
    /_(600|700)/.test(style.fontFamily ?? '') || ['600', '700', 'bold'].includes(String(style.fontWeight));
  return textWidth(line, style.fontSize, { fontScale, bold, lang });
}

/** The typeface `lang` has on the phone (theme/typeface.ts; Android's: iOS differs only in CJK's family names). */
export const typefaceOf = (lang: string): Typeface => typefaceFor(lang, 'android');

/**
 * A rendered word's line height as it is in `lang`. Jest starts the app in Hebrew or English, whose styles have
 * the tokens' line heights; started in a taller script (Arabic, Thai, Vietnamese, CJK), the app gives every
 * style of words the script's least line height (theme text(), rubikStyle), which this adds. Teko's numbers keep
 * theirs. Not for the board's digits (theme DIGIT_TYPES), which keep theirs too.
 */
export function lineHeightAs(
  lang: string,
  style: { fontFamily?: string; fontSize?: number; lineHeight?: number },
): number {
  const lineHeight = style.lineHeight ?? 0;
  if (style.fontFamily?.startsWith('Teko') || style.fontSize === undefined) return lineHeight;
  return lineHeightIn(typefaceOf(lang), style.fontSize, lineHeight);
}

/**
 * The languages layout tests run in: all 19 of the app's (i18n/languages.ts LANGUAGES, in its order), since
 * 1.1.0: D124 holds the screens that must not scroll to every language. Stage 0 (localization plan 0טו) ran
 * one of each kind of trouble: Arabic (right to left, taller lines), German and Russian (long words), Thai and
 * Vietnamese (marks above and below, the system's font), Japanese (no spaces, CJK). And en-XA (English 40 %
 * longer, plan 0יג).
 */
export const LAYOUT_LANGUAGES = [
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
  'en-XA',
] as const;
/** Direction checks (directionProblems) run in these and in ar-XB, English laid out right to left (6.1 #11). */
export const DIRECTION_LANGUAGES = [...LAYOUT_LANGUAGES, 'ar-XB'] as const;
export type LayoutLanguage = (typeof DIRECTION_LANGUAGES)[number];

/**
 * Those of `languages` the app has strings for in this tree: a folder of translations (locales.generated.ts), or
 * a loader registered at run time. Hebrew and English today; each language joins its tests as its strings
 * arrive. The hook for the pseudo languages (plan 0יג): en-XA and ar-XB join every layout test once their module
 * registers them with i18n/index.ts addLocaleLoader before a test file is collected (this file does, as it
 * loads: i18n/pseudoLanguages.ts). Run a test over them with it.each(layoutLanguages()); check a fit with
 * expectFits/expectRoom, where en-XA's misses are noted rather than failed.
 */
export function layoutLanguages(languages: readonly LayoutLanguage[] = LAYOUT_LANGUAGES): LayoutLanguage[] {
  return languages.filter((lang) => localeBundle(lang) !== null);
}

/**
 * `lang`'s t() in namespace `ns`, its strings read first: i18next reads a language only when asked (i18n/index.ts),
 * and getFixedT alone would answer in English for a language not read yet.
 */
export async function fixedT(lang: string, ns: string): Promise<TFunction> {
  await i18n.loadLanguages(lang);
  return i18n.getFixedT(lang, ns);
}

/**
 * en-XA's misses (plan 0יג): where English about 40 % longer does not fit. A layout test checks en-XA as any
 * language, but a miss there is a place to watch, not a failure: en-XA is longer than a translation should be,
 * and a real language that does not fit is shortened there (D124), its own test failing until it is. Printed as
 * the misses happen with I18N_WIDTH_REPORT=1 (the width report's switch, __tests__/widthBudget.test.ts).
 */
export const pseudoMisses: string[] = [];

/** Notes a miss of a pseudo language (pseudoMisses): "en-XA game:arsenal.title: 333 > 272". */
export function notePseudoMiss(lang: string, line: string): void {
  pseudoMisses.push(`${lang} ${line}`);
  if (process.env.I18N_WIDTH_REPORT) console.log(`Does not fit in ${lang}: ${line}`);
}

/**
 * That something fits in a layout language (`place` names it in the failure): a real language must; a pseudo
 * language's miss is noted (pseudoMisses) and the test goes on, so the rest of it is checked in en-XA too.
 */
export function expectFits(lang: string, place: string, fits: boolean): void {
  if (isPseudoLanguage(lang)) {
    if (!fits) notePseudoMiss(lang, place);
    return;
  }
  expect({ lang, place, fits }).toEqual({ lang, place, fits: true });
}

/** That a width fits its room in a layout language (expectFits): "place: 333 > 272" when it doesn't. */
export function expectRoom(lang: string, place: string, width: number, room: number): void {
  expectFits(
    lang,
    width <= room ? place : `${place}: ${Math.ceil(width)} > ${Math.floor(room)}`,
    width <= room,
  );
}
