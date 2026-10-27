import type { TextStyle } from 'react-native';

import { rubikStyle, tekoStyle } from '../../components/player/metrics';
import { LANGUAGES, PSEUDO_LANGUAGES } from '../../i18n/languages';
import { appTypeface, DIGIT_TYPES, text, tokens, type TypeName } from '..';
import { IOS_FAMILIES, LANGUAGE_SCRIPT, lineHeightIn, typefaceFor, usesRubik } from '../typeface';

/**
 * The font and the line heights of each language (localization plan 0ט, D106, D107): Hebrew and English exactly
 * as the design has them; Rubik for the 13 languages it draws (fontCoverage.test.ts proves which from the font
 * files), the system's font for the rest; taller lines for the scripts with marks above and below.
 */

const TYPES = Object.keys(tokens.type) as TypeName[];
const OSES = ['android', 'ios'] as const;
const font = (s: TextStyle) => ({ fontFamily: s.fontFamily, fontWeight: s.fontWeight, fontSize: s.fontSize });
/** The type styles of words: Rubik's, but the board's digits. */
const WORDS = TYPES.filter((name) => tokens.type[name].family === 'Rubik' && !DIGIT_TYPES.has(name));

describe('Hebrew and English look exactly as before (plan 0ט)', () => {
  it.each(['he', 'en'])(
    '%s: every type style is the tokens’ font, size and line height, on both platforms',
    (lang) => {
      for (const os of OSES) {
        const typeface = typefaceFor(lang, os);
        for (const name of TYPES) {
          const t = tokens.type[name];
          const style = text(name, typeface);
          expect({ name, os, ...font(style), lineHeight: style.lineHeight }).toEqual({
            name,
            os,
            fontFamily: t.fontFamily,
            fontWeight: undefined,
            fontSize: t.size,
            lineHeight: t.lineHeight,
          });
        }
        expect(typeface).toMatchObject({ font: 'rubik', minLineHeight: 0, lineBreakStrategyIOS: null });
      }
    },
  );

  it.each(['he', 'en'])(
    '%s: rubikStyle is Rubik at a line of 1.2, as the player components had it',
    (lang) => {
      for (const os of OSES) {
        for (const weight of ['400', '500', '600', '700'] as const) {
          for (const px of [10, 11, 12, 13, 14, 16, 18, 22, 44]) {
            expect(rubikStyle(px, weight, typefaceFor(lang, os))).toEqual({
              fontFamily: tokens.font.load.Rubik[weight],
              fontSize: px,
              lineHeight: Math.round(px * 1.2),
              includeFontPadding: false,
            });
          }
        }
      }
    },
  );

  it('the app under Jest starts in Hebrew or English, so every design test sees the tokens', () => {
    expect(['he', 'en']).toContain(appTypeface().language);
    expect(text('caption')).toEqual(text('caption', typefaceFor('he', 'android')));
  });
});

describe('the font of each language (D106)', () => {
  it('every language and pseudo language has a script', () => {
    expect(Object.keys(LANGUAGE_SCRIPT).sort()).toEqual([...LANGUAGES, ...PSEUDO_LANGUAGES].sort());
  });

  it('Rubik for 13 languages; the system’s font for Vietnamese, Thai, Japanese, Korean and Chinese', () => {
    expect(LANGUAGES.filter(usesRubik)).toEqual([
      'he',
      'en',
      'ar',
      'es',
      'pt-BR',
      'de',
      'fr',
      'ru',
      'it',
      'tr',
      'id',
      'pl',
      'nl',
    ]);
    expect(LANGUAGES.filter((lang) => !usesRubik(lang))).toEqual([
      'ja',
      'ko',
      'zh-Hans',
      'zh-Hant',
      'vi',
      'th',
    ]);
    // The pseudo languages are English in Rubik (plan 0יג).
    expect(PSEUDO_LANGUAGES.filter(usesRubik)).toEqual(['en-XA', 'ar-XB']);
  });

  it.each(['vi', 'th', 'ja', 'ko', 'zh-Hans', 'zh-Hant'])(
    '%s: the system’s font at the token’s weight; on iOS, CJK names its family so Han takes its own forms',
    (lang) => {
      const android = text('button', typefaceFor(lang, 'android'));
      expect(font(android)).toEqual({ fontFamily: undefined, fontWeight: '500', fontSize: 16 });
      const ios = text('h1', typefaceFor(lang, 'ios'));
      expect(font(ios)).toEqual({ fontFamily: IOS_FAMILIES[lang], fontWeight: '700', fontSize: 22 });
      expect(rubikStyle(13, '600', typefaceFor(lang, 'android'))).toMatchObject({ fontWeight: '600' });
      expect(rubikStyle(13, '600', typefaceFor(lang, 'android')).fontFamily).toBeUndefined();
    },
  );

  it('Japanese, Korean and the two Chinese have their own iOS families; Vietnamese and Thai the default', () => {
    expect(IOS_FAMILIES).toEqual({
      ja: 'Hiragino Sans',
      ko: 'Apple SD Gothic Neo',
      'zh-Hans': 'PingFang SC',
      'zh-Hant': 'PingFang TC',
    });
    expect(typefaceFor('vi', 'ios').systemFamily).toBeNull();
    expect(typefaceFor('th', 'ios').systemFamily).toBeNull();
    expect(typefaceFor('ja', 'android').systemFamily).toBeNull();
  });

  it('Teko’s numbers and the board’s digits are the same in every language (D107; the board is 1–9 always)', () => {
    const teko = TYPES.filter((name) => tokens.type[name].family === 'Teko');
    expect(teko.length).toBeGreaterThan(5);
    expect([...DIGIT_TYPES].sort()).toEqual(['digitCell', 'digitCellOwned', 'keyCount', 'wrongDigit']);
    for (const lang of [...LANGUAGES, ...PSEUDO_LANGUAGES]) {
      for (const os of OSES) {
        for (const name of [...teko, ...DIGIT_TYPES]) {
          expect({ lang, os, name, style: text(name, typefaceFor(lang, os)) }).toEqual({
            lang,
            os,
            name,
            style: text(name, typefaceFor('en', os)),
          });
        }
        expect(tekoStyle(17)).toMatchObject({ fontFamily: tokens.font.load.Teko['600'] });
      }
    }
  });
});

describe('the least line height of a script (plan 0ט)', () => {
  const FACTORS: Record<string, number> = {
    ar: 1.35,
    'ar-XB': 1.35,
    th: 1.5,
    vi: 1.4,
    ja: 1.3,
    ko: 1.3,
    'zh-Hans': 1.3,
    'zh-Hant': 1.3,
  };

  it.each(Object.keys(FACTORS))(
    '%s: every style of words is the design’s, or the script’s least when taller',
    (lang) => {
      const typeface = typefaceFor(lang, 'android');
      for (const name of WORDS) {
        const t = tokens.type[name];
        const least = Math.ceil(t.size * FACTORS[lang]!);
        expect({ name, lineHeight: text(name, typeface).lineHeight }).toEqual({
          name,
          lineHeight: Math.max(t.lineHeight, least),
        });
      }
      for (const px of [10, 11, 12, 13, 14, 16]) {
        expect(rubikStyle(px, '500', typeface).lineHeight).toBe(
          Math.max(Math.round(px * 1.2), Math.ceil(px * FACTORS[lang]!)),
        );
      }
    },
  );

  it('micro (12 on a 12 line) is where marks were cut: Thai 18, Vietnamese 17, Arabic 17, CJK 16', () => {
    const micro = (lang: string) => text('micro', typefaceFor(lang, 'android')).lineHeight;
    expect([micro('th'), micro('vi'), micro('ar'), micro('ja'), micro('he'), micro('ru')]).toEqual([
      18, 17, 17, 16, 12, 12,
    ]);
  });

  it('Latin, Cyrillic and Hebrew keep the tokens’ line heights', () => {
    for (const lang of LANGUAGES.filter((l) =>
      ['latin', 'cyrillic', 'hebrew'].includes(LANGUAGE_SCRIPT[l]),
    )) {
      for (const name of WORDS)
        expect(text(name, typefaceFor(lang, 'ios')).lineHeight).toBe(tokens.type[name].lineHeight);
    }
  });

  it('lineHeightIn: never lower than the design’s', () => {
    const thai = typefaceFor('th', 'android');
    expect(lineHeightIn(thai, 12, 30)).toBe(30);
    expect(lineHeightIn(thai, 12, 12)).toBe(18);
    expect(lineHeightIn(typefaceFor('en', 'android'), 12, 12)).toBe(12);
  });
});

describe('line breaking (plan 0ט)', () => {
  it('Korean on iOS breaks between words (hangul-word); nothing else, and nothing on Android', () => {
    expect(typefaceFor('ko', 'ios').lineBreakStrategyIOS).toBe('hangul-word');
    expect(typefaceFor('ko', 'android').lineBreakStrategyIOS).toBeNull();
    for (const lang of [...LANGUAGES, ...PSEUDO_LANGUAGES].filter((l) => l !== 'ko')) {
      expect(typefaceFor(lang, 'ios').lineBreakStrategyIOS).toBeNull();
    }
  });
});
