import { LANGUAGES } from '../../../i18n/languages';
import { LOCALE_LOADERS } from '../../../i18n/locales.generated';
import { measuredWidth } from '../../../testing/fontMetrics';
import { text } from '../../../theme';
import {
  DIRECTION_LANGUAGES,
  expectFits,
  expectRoom,
  fixedT,
  LAYOUT_LANGUAGES,
  layoutLanguages,
  lineHeightAs,
  pseudoMisses,
  textWidth,
  VIETNAMESE_MARGIN,
  widthIn,
} from '../testing/layout';

/**
 * The layout tests' tools for every language (localization plan 0טו): which languages they run in, and how wide
 * and how tall a line is in each, measured in the app's font or estimated by script where the language takes the
 * system's font (Jest can't measure that one).
 */

const caption = { fontFamily: 'Rubik_400Regular', fontSize: 13 };

describe('the layout languages', () => {
  it('every language of the app (D124, since 1.1.0) and en-XA; ar-XB for direction', () => {
    expect(LAYOUT_LANGUAGES).toEqual([...LANGUAGES, 'en-XA']);
    expect(DIRECTION_LANGUAGES).toEqual([...LAYOUT_LANGUAGES, 'ar-XB']);
  });

  it('the tests run in those the app has strings for: a folder (all 19 since 1.1.0), and en-XA', () => {
    const folders = LAYOUT_LANGUAGES.filter((lang) => lang in LOCALE_LOADERS);
    expect(layoutLanguages()).toEqual([...folders, 'en-XA']);
    expect(layoutLanguages()).toEqual(expect.arrayContaining(['he', 'en']));
  });

  it('the pseudo languages join them, registered as layout.ts loads (the hook of plan 0יג)', async () => {
    expect(layoutLanguages(DIRECTION_LANGUAGES).slice(-2)).toEqual(['en-XA', 'ar-XB']);
    // Made from English at run time (i18n/pseudo.ts): "Close", accented and between brackets.
    expect((await fixedT('en', 'ui'))('sheet.close')).toBe('Close');
    expect((await fixedT('en-XA', 'ui'))('sheet.close')).toBe('[Çļöšé]');
  });

  it('fixedT answers in the language asked, not in the one the app shows', async () => {
    const he = await fixedT('he', 'ui');
    const en = await fixedT('en', 'ui');
    expect(he('sheet.close')).not.toBe(en('sheet.close'));
  });
});

describe('estimated widths by script (textWidth)', () => {
  it('Hebrew and Latin as before', () => {
    expect(textWidth('Sudoku', 10)).toBeCloseTo((0.74 + 5 * 0.6) * 10, 6);
    expect(textWidth('שלום', 10)).toBeCloseTo(4 * 0.64 * 10, 6);
    expect(textWidth('VS 12', 10, { font: 'Teko' })).toBeCloseTo((2 * 0.74 + 0.28 + 2 * 0.5) * 10, 6);
    expect(textWidth('Go', 10, { bold: true, fontScale: 2 })).toBeCloseTo((0.74 + 0.6) * 10 * 2 * 1.06, 6);
  });

  it('Chinese, kana, Hangul and full-width punctuation: a full em each', () => {
    expect(textWidth('日本語', 10)).toBeCloseTo(30, 6);
    expect(textWidth('ひらがなカタカナ', 10)).toBeCloseTo(80, 6);
    expect(textWidth('한국어', 10)).toBeCloseTo(30, 6);
    expect(textWidth('中文。！', 10)).toBeCloseTo(40, 6);
  });

  it('Thai: about .65 em a letter; its marks above and below the line take none', () => {
    expect(textWidth('ไทย', 10)).toBeCloseTo(3 * 0.65 * 10, 6);
    // ก with a vowel above and a tone mark: one letter wide.
    expect(textWidth('ก\u{E34}\u{E48}', 10)).toBeCloseTo(0.65 * 10, 6);
  });

  it('Vietnamese: its base letters, with 10 % more room for the stacked marks', () => {
    const plain = textWidth('Viet', 10);
    expect(textWidth('Việt', 10)).toBeCloseTo(plain, 6);
    expect(textWidth('Việt', 10, { lang: 'vi' })).toBeCloseTo(plain * VIETNAMESE_MARGIN, 6);
  });

  it('marks and invisible characters take no room', () => {
    expect(textWidth('\u{2066}abc\u{2069}\u{200B}', 10)).toBeCloseTo(textWidth('abc', 10), 6);
  });
});

describe('widthIn: the width in a language’s own font', () => {
  it('a Rubik language is measured in the font file; Arabic with its margin', () => {
    expect(widthIn('he', 'שלום עולם', caption)).toBeCloseTo(
      measuredWidth('שלום עולם', caption.fontFamily, 13),
      6,
    );
    expect(widthIn('ru', 'Привет', caption)).toBeCloseTo(measuredWidth('Привет', caption.fontFamily, 13), 6);
    expect(widthIn('ar', 'مرحبا', caption)).toBeCloseTo(measuredWidth('مرحبا', caption.fontFamily, 13), 6);
  });

  it('a system-font language is estimated by its script, and never fails on letters Rubik lacks', () => {
    expect(widthIn('th', 'ไทย', caption)).toBeCloseTo(textWidth('ไทย', 13), 6);
    expect(widthIn('ja', '日本語', { fontFamily: 'Rubik_700Bold', fontSize: 13 })).toBeCloseTo(
      textWidth('日本語', 13, { bold: true }),
      6,
    );
    expect(widthIn('vi', 'Tiếng Việt', caption)).toBeCloseTo(textWidth('Tiếng Việt', 13, { lang: 'vi' }), 6);
    expect(() => widthIn('he', 'ไทย', caption)).toThrow(/no glyph/);
  });

  it('Teko’s numbers are measured in every language', () => {
    const teko = { fontFamily: 'Teko_600SemiBold', fontSize: 20 };
    for (const lang of ['th', 'ja', 'he']) {
      expect(widthIn(lang, '1200', teko)).toBeCloseTo(measuredWidth('1200', teko.fontFamily, 20), 6);
    }
  });
});

describe('lineHeightAs: a rendered line’s height in another language', () => {
  it('Hebrew and English: the style’s own; a taller script: its least', () => {
    const micro = text('micro');
    expect([lineHeightAs('he', micro), lineHeightAs('en', micro)]).toEqual([12, 12]);
    expect([lineHeightAs('th', micro), lineHeightAs('ar', micro), lineHeightAs('ja', micro)]).toEqual([
      18, 17, 16,
    ]);
    expect(lineHeightAs('th', text('bodyLong'))).toBe(21);
  });

  it('Teko’s numbers keep theirs', () => {
    expect(lineHeightAs('th', text('scoreXL'))).toBe(text('scoreXL').lineHeight);
  });
});

describe('a fit in a layout language (expectFits, expectRoom)', () => {
  it('a real language must fit: a miss fails the test', () => {
    expect(() => expectRoom('de', 'a title', 300, 272)).toThrow();
    expect(() => expectFits('he', 'a name in two lines', false)).toThrow();
    expect(() => expectRoom('he', 'a title', 200, 272)).not.toThrow();
  });

  it('a pseudo language’s miss is noted, not failed, and the test goes on (plan 0יג)', () => {
    const before = pseudoMisses.length;
    expect(() => expectRoom('en-XA', 'a title', 300.2, 272)).not.toThrow();
    expect(() => expectFits('ar-XB', 'a name in two lines', true)).not.toThrow();
    expect(pseudoMisses.slice(before)).toEqual(['en-XA a title: 301 > 272']);
  });
});
