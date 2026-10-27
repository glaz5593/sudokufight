import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * How wide a line really is in one of the app's fonts, in dp: the sum of the glyphs' advance widths in the
 * font file the app ships (@expo-google-fonts, as app.json embeds it), for a test that must know whether a
 * label fits. components/ui/testing/layout.ts `textWidth` only estimates, on the wide side (and is what a
 * language in the system's font gets: layout.ts widthIn). No kerning and no shaping: Hebrew and Latin labels
 * advance letter by letter, near enough; Arabic's joined letters are measured apart, so they get 10 % more
 * (localization plan 0טו). A character the font has no glyph for fails the measure: a silent "missing glyph"
 * width would let a label in another script pass. Test-only (reads files).
 */

interface Font {
  unitsPerEm: number;
  /** The glyph of a character, 0 when the font has none. */
  glyph(codePoint: number): number;
  advance(codePoint: number): number;
}

/**
 * Characters that take no room and no glyph: zero-width space, joiners, bidi marks (LRM, RLM, ALM), embeddings
 * and isolates (LRI…PDI), the word joiner and the BOM.
 */
export const INVISIBLE = /[\u{200B}-\u{200F}\u{61C}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]/u;
const EVERY_INVISIBLE = new RegExp(INVISIBLE.source, 'gu');

/**
 * Characters no font of the app has and the phone draws from its own (they are in the Hebrew and English
 * strings already: plan 6.1 #7): emoji and flags (with their variation selectors and keycaps), arrows, and the
 * stars ★ ☆. A measure counts each as 1.2 em, wide on purpose.
 */
export const SYSTEM_DRAWN =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{20E3}\u{2190}-\u{21FF}\u{2794}\u{27A1}\u{27F0}-\u{27FF}\u{2900}-\u{297F}\u{2B05}-\u{2B07}\u{2605}\u{2606}]/u;
const SYSTEM_DRAWN_EM = 1.2;

/** Arabic letters and marks (Rubik draws them joined, which this measure can't): 10 % more room. */
const ARABIC = /[\u{600}-\u{6FF}\u{750}-\u{77F}\u{8A0}-\u{8FF}\u{FB50}-\u{FDFF}\u{FE70}-\u{FEFC}]/u;
export const ARABIC_MARGIN = 1.1;

const fonts = new Map<string, Font>();

/** "Rubik_700Bold" → node_modules/@expo-google-fonts/rubik/700Bold/Rubik_700Bold.ttf. */
function fontFile(family: string): string {
  const [name, weight] = family.split('_');
  if (!name || !weight) throw new Error(`Not a font family of the app: ${family}`);
  const pkg = dirname(require.resolve(`@expo-google-fonts/${name.toLowerCase()}/package.json`));
  return join(pkg, weight, `${family}.ttf`);
}

/** The tables a width needs: head (units per em), hhea and hmtx (advances), cmap format 4 (characters). */
function load(family: string): Font {
  const b = readFileSync(fontFile(family));
  const tables = new Map<string, number>();
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    tables.set(b.toString('ascii', at, at + 4), b.readUInt32BE(at + 8));
  }
  const table = (tag: string) => {
    const at = tables.get(tag);
    if (at === undefined) throw new Error(`${family} has no ${tag} table`);
    return at;
  };
  const unitsPerEm = b.readUInt16BE(table('head') + 18);
  const metrics = b.readUInt16BE(table('hhea') + 34);
  const hmtx = table('hmtx');
  const cmap = table('cmap');
  let sub = -1;
  for (let i = 0; i < b.readUInt16BE(cmap + 2); i++) {
    const at = cmap + 4 + i * 8;
    const offset = cmap + b.readUInt32BE(at + 4);
    if (b.readUInt16BE(at) === 3 && b.readUInt16BE(at + 2) === 1 && b.readUInt16BE(offset) === 4)
      sub = offset;
  }
  if (sub < 0) throw new Error(`${family} has no Unicode BMP cmap`);
  const segments = b.readUInt16BE(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const ranges = deltas + 2 * segments;
  const glyph = (c: number): number => {
    for (let i = 0; i < segments; i++) {
      if (c > b.readUInt16BE(ends + 2 * i)) continue;
      const start = b.readUInt16BE(starts + 2 * i);
      if (c < start) return 0;
      const delta = b.readInt16BE(deltas + 2 * i);
      const range = b.readUInt16BE(ranges + 2 * i);
      if (range === 0) return (c + delta) & 0xffff;
      const g = b.readUInt16BE(ranges + 2 * i + range + 2 * (c - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  return {
    unitsPerEm,
    glyph,
    advance: (codePoint) => b.readUInt16BE(hmtx + 4 * Math.min(glyph(codePoint), metrics - 1)),
  };
}

function fontOf(family: string): Font {
  const font = fonts.get(family) ?? load(family);
  fonts.set(family, font);
  return font;
}

/** Whether `family` (e.g. "Rubik_700Bold") has a glyph for `char` (its first code point). */
export function hasGlyph(family: string, char: string): boolean {
  return fontOf(family).glyph(char.codePointAt(0)!) !== 0;
}

/** The advance width of `char`'s glyph in `family`, in em, as the font file has it (no margin). */
export function advanceEm(family: string, char: string): number {
  const font = fontOf(family);
  return font.advance(char.codePointAt(0)!) / font.unitsPerEm;
}

/**
 * The OpenType layout of `family` (e.g. "Rubik_500Medium"): the scripts and the features of its GSUB table, as
 * tags ('arab'; 'init', 'medi', 'fina', 'rlig'…), for a test that the font shapes a script (Arabic's joined
 * letters), which its character map alone can't show.
 */
export function substitutions(family: string): { scripts: string[]; features: string[] } {
  const b = readFileSync(fontFile(family));
  let gsub = -1;
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    if (b.toString('ascii', at, at + 4) === 'GSUB') gsub = b.readUInt32BE(at + 8);
  }
  if (gsub < 0) return { scripts: [], features: [] };
  const tags = (list: number) =>
    Array.from({ length: b.readUInt16BE(list) }, (_, i) =>
      b.toString('ascii', list + 2 + 6 * i, list + 6 + 6 * i),
    );
  return {
    scripts: [...new Set(tags(gsub + b.readUInt16BE(gsub + 4)))],
    features: [...new Set(tags(gsub + b.readUInt16BE(gsub + 6)))],
  };
}

/**
 * The width of `line` at `fontSize` (times the phone's text scale) in `family` (e.g. "Rubik_700Bold"). Throws
 * on a character the font lacks, unless the phone draws it from its own fonts anyway (SYSTEM_DRAWN); a space the
 * font lacks (French's narrow no-break space) is as wide as its own space.
 */
export function measuredWidth(
  line: string,
  family: string,
  fontSize: number,
  { fontScale = 1 }: { fontScale?: number } = {},
): number {
  const font = fontOf(family);
  const units = [...line.replace(EVERY_INVISIBLE, '')].reduce((sum, ch) => {
    const codePoint = ch.codePointAt(0)!;
    if (font.glyph(codePoint) === 0) {
      if (SYSTEM_DRAWN.test(ch)) return sum + SYSTEM_DRAWN_EM * font.unitsPerEm;
      if (/\s/u.test(ch)) return sum + font.advance(0x20);
      const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
      throw new Error(`${family} has no glyph for U+${hex} "${ch}" in "${line}"`);
    }
    return sum + font.advance(codePoint) * (ARABIC.test(ch) ? ARABIC_MARGIN : 1);
  }, 0);
  return (units / font.unitsPerEm) * fontSize * fontScale;
}
