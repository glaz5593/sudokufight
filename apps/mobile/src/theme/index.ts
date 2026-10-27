import { Platform, type TextStyle } from 'react-native';

import { I18N_CONFIG } from '../config/i18n';
import i18n from '../i18n';
import { tokens } from './tokens.generated';
import { lineHeightIn, type Typeface, typefaceFor, uiFont, type UiWeight } from './typeface';

/**
 * The design system of direction C, "Calm Night" (spec §24 D30), from docs/design/tokens.json.
 * Components read colors, type, spacing and motion from here and nowhere else.
 */
export { tokens };
export { lineHeightIn, type Typeface, typefaceFor, uiFont, usesRubik } from './typeface';

export const color = tokens.color;
export const space = tokens.space;
export const radius = tokens.radius;
export const size = tokens.size;

export type TypeName = keyof typeof tokens.type;
type TypeToken = (typeof tokens.type)[TypeName];

let launchTypeface: Typeface | null = null;

/**
 * The typeface of the language the app started in (theme/typeface.ts: the font and least line heights of its
 * script). Read once: the app restarts on every change of language (D104), and styles made as a module loads
 * must agree with those made later. Importing i18n here makes it start (with the saved language) before any
 * module that imports the theme.
 */
export function appTypeface(): Typeface {
  launchTypeface ??= typefaceFor(i18n.language || I18N_CONFIG.fallbackLanguage, Platform.OS);
  return launchTypeface;
}

/**
 * Rubik's styles of digits only: the board's (a given, an owned and a wrong digit) and the keypad's counts. The
 * board and the keypad are the same in every language (Western digits 1–9, left to right), so these keep Rubik
 * and the tokens' metrics, as Teko's do.
 */
export const DIGIT_TYPES: ReadonlySet<TypeName> = new Set<TypeName>([
  'digitCell',
  'digitCellOwned',
  'wrongDigit',
  'keyCount',
]);

/**
 * A named text style from the tokens, as a React Native style, in the app's typeface (or `typeface`, for a test
 * of another language). Rubik's styles of words take the language's font and least line height; Teko's
 * (numbers) and the digits' (DIGIT_TYPES) are the same in every language. Hebrew and English get the tokens
 * exactly.
 */
export function text(name: TypeName, typeface: Typeface = appTypeface()): TextStyle {
  const t: TypeToken & { paddingTop?: number; writingDirection?: string; fontVariant?: readonly string[] } =
    tokens.type[name];
  const ui = t.family === 'Rubik' && !DIGIT_TYPES.has(name);
  return {
    ...(ui ? uiFont(typeface, String(t.weight) as UiWeight) : { fontFamily: t.fontFamily }),
    fontSize: t.size,
    lineHeight: ui ? lineHeightIn(typeface, t.size, t.lineHeight) : t.lineHeight,
    letterSpacing: t.letterSpacing,
    ...(t.paddingTop ? { paddingTop: t.paddingTop } : null),
    ...(t.writingDirection === 'ltr' ? { writingDirection: 'ltr' as const } : null),
    // Teko numbers line up as columns (the design's tabular-nums).
    ...(t.family === 'Teko' ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : null),
  };
}

export type PlayerPalette = (typeof tokens.color.players)[number];

/**
 * Colors and shape of a seat as THIS phone shows it: "me" is always P1 (cyan ●), and the others take P2–P4
 * in seat order (spec §2, CLAUDE.md).
 */
export function paletteForSeat(seat: number, mySeat: number | null, seats: number): PlayerPalette {
  const players = tokens.color.players;
  if (mySeat === null) return players[seat % players.length]!;
  if (seat === mySeat) return players[0]!;
  const others = Array.from({ length: seats }, (_, s) => s).filter((s) => s !== mySeat);
  return players[1 + others.indexOf(seat)]!;
}

/** WCAG 2 contrast ratio of two opaque #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
