import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * How wide a line really is in one of the app's fonts, in dp: the sum of the glyphs' advance widths in the
 * font file the app ships (@expo-google-fonts, as app.json embeds it), for a test that must know whether a
 * label fits. components/ui/testing/layout.ts `textWidth` only estimates, on the wide side. No kerning and
 * no shaping: Hebrew and Latin labels advance letter by letter, near enough. Test-only (reads files).
 */

interface Font {
  unitsPerEm: number;
  advance(codePoint: number): number;
}

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
    advance: (codePoint) => b.readUInt16BE(hmtx + 4 * Math.min(glyph(codePoint), metrics - 1)),
  };
}

/** The width of `line` at `fontSize` (times the phone's text scale) in `family` (e.g. "Rubik_700Bold"). */
export function measuredWidth(
  line: string,
  family: string,
  fontSize: number,
  { fontScale = 1 }: { fontScale?: number } = {},
): number {
  const font = fonts.get(family) ?? load(family);
  fonts.set(family, font);
  // Bidi marks (LRM, RLM, LRI…PDI) take no room.
  const units = [...line.replace(/[‎‏⁦-⁩]/g, '')].reduce(
    (sum, ch) => sum + font.advance(ch.codePointAt(0)!),
    0,
  );
  return (units / font.unitsPerEm) * fontSize * fontScale;
}
