import { advanceEm, ARABIC_MARGIN, hasGlyph, measuredWidth, substitutions } from '../fontMetrics';

/**
 * The real width of a line in the app's fonts (localization plan 0טו): a character the font has no glyph for
 * fails the measure, instead of passing as the width of the "missing glyph" box, so a label in a script the font
 * lacks can't pass a width test by mistake.
 */

const RUBIK = 'Rubik_500Medium';
const sum = (line: string, family = RUBIK) => [...line].reduce((w, ch) => w + advanceEm(family, ch), 0);

describe('measuredWidth', () => {
  it('Hebrew and Latin: the glyphs’ advances, letter by letter, as before', () => {
    for (const line of ['צור משתמש והיכנס לזירה', 'Sudoku Fight', 'Ранг', 'Çağrı İstanbul', 'Größe']) {
      expect(measuredWidth(line, RUBIK, 16)).toBeCloseTo(sum(line) * 16, 6);
    }
    expect(measuredWidth('ab', RUBIK, 10, { fontScale: 1.3 })).toBeCloseTo(sum('ab') * 13, 6);
  });

  it('bidi marks, isolates, joiners and the zero-width space take no room', () => {
    const plain = measuredWidth('שלב 300', RUBIK, 14);
    expect(
      measuredWidth(
        '\u{2068}שלב\u{2069} \u{2066}300\u{2069}\u{200F}\u{200E}\u{200B}\u{200D}\u{61C}',
        RUBIK,
        14,
      ),
    ).toBeCloseTo(plain, 6);
  });

  it.each([
    ['Thai', 'ไทย'],
    ['Vietnamese', 'Tiếng Việt: ơ ư'],
    ['Japanese', '日本語'],
    ['Korean', '한국어'],
  ])('fails on a letter the font lacks (%s in Rubik), naming it', (_script, line) => {
    expect(() => measuredWidth(line, RUBIK, 14)).toThrow(/Rubik_500Medium has no glyph for U\+[0-9A-F]{4}/);
  });

  it('fails on a Hebrew word in Teko, the numbers’ font (D107: its words stay Latin)', () => {
    expect(() => measuredWidth('שלב', 'Teko_600SemiBold', 20)).toThrow(
      /Teko_600SemiBold has no glyph for U\+05E9/,
    );
    expect(measuredWidth('VS', 'Teko_600SemiBold', 20)).toBeGreaterThan(0);
  });

  it('what the phone draws from its own fonts (emoji, arrows, ★) counts as 1.2 em, wide on purpose', () => {
    for (const ch of ['★', '→', '←', '😂']) {
      expect(hasGlyph(RUBIK, ch)).toBe(false);
      expect(measuredWidth(ch, RUBIK, 10)).toBeCloseTo(12, 6);
    }
    // A flag is two regional letters: each counted.
    expect(measuredWidth('🇮🇱', RUBIK, 10)).toBeCloseTo(24, 6);
  });

  it('a space the font lacks (French’s narrow no-break space) is as wide as a space', () => {
    expect(hasGlyph(RUBIK, '\u{202F}')).toBe(false);
    expect(measuredWidth('a\u{202F}!', RUBIK, 16)).toBeCloseTo(measuredWidth('a !', RUBIK, 16), 6);
  });

  it('Arabic: its letters measured apart (no joining here), with 10 % more room', () => {
    expect(ARABIC_MARGIN).toBe(1.1);
    const word = 'مرحبا بك';
    const letters = [...word].reduce((w, ch) => w + advanceEm(RUBIK, ch) * (ch === ' ' ? 1 : 1.1), 0);
    expect(measuredWidth(word, RUBIK, 16)).toBeCloseTo(letters * 16, 6);
    expect(measuredWidth(word, RUBIK, 16)).toBeGreaterThan(sum(word) * 16);
  });
});

describe('substitutions (the font’s shaping)', () => {
  it('Rubik joins Arabic letters: the arab script with initial, medial and final forms', () => {
    for (const weight of ['Rubik_400Regular', 'Rubik_500Medium', 'Rubik_600SemiBold', 'Rubik_700Bold']) {
      const { scripts, features } = substitutions(weight);
      expect(scripts).toEqual(expect.arrayContaining(['arab', 'hebr', 'latn', 'cyrl']));
      expect(features).toEqual(expect.arrayContaining(['init', 'medi', 'fina', 'rlig']));
    }
  });

  it('Teko writes no Arabic, Hebrew or Cyrillic', () => {
    expect(substitutions('Teko_600SemiBold').scripts).not.toEqual(expect.arrayContaining(['arab']));
    expect(hasGlyph('Teko_600SemiBold', 'ب')).toBe(false);
    expect(hasGlyph('Teko_600SemiBold', 'Ж')).toBe(false);
  });
});
