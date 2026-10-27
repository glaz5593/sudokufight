import { localeBundle } from '../../i18n';
import { LANGUAGES, PSEUDO_LANGUAGES } from '../../i18n/languages';
import { registerPseudoLanguages } from '../../i18n/pseudoLanguages';
import { APP_LOCALES, readLocales, SAMPLE_LOCALES } from '../../testing/localeFiles';
import { hasGlyph, INVISIBLE, substitutions, SYSTEM_DRAWN } from '../../testing/fontMetrics';
import { tokens } from '../tokens.generated';
import { usesRubik } from '../typeface';

// en-XA and ar-XB, made from English at run time (i18n/pseudo.ts), for "the pseudo languages too" below.
registerPseudoLanguages();

/**
 * Every letter a language writes is in the font it is drawn with (localization plan 6.1 #7, D106, D107):
 * - Which languages Rubik draws is proven from its four font files: all the letters of each language's alphabet
 *   (CLDR's exemplar letters) in every weight, or the system's font (theme/typeface.ts).
 * - Every string of a language in Rubik: every letter and mark (\p{L}, \p{M}) in all four weights, and every
 *   other character too, except what the phone draws from its own fonts: invisible controls (bidi isolates,
 *   joiners), emoji, arrows and ★ (already in the Hebrew and English strings, and not in Rubik) and line breaks.
 * - The words Teko draws (VS, GO!, the dash) only in Teko's characters, in every language (D107).
 */

const RUBIK = Object.values(tokens.font.load.Rubik);
const TEKO = Object.values(tokens.font.load.Teko);

/** Each language's alphabet (CLDR's main exemplar letters, lower and upper case where the script has them). */
const ALPHABETS: Record<(typeof LANGUAGES)[number], string> = {
  he: 'אבגדהוזחטיכךלמםנןסעפףצץקרשת',
  en: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ar: 'ءآأؤإئابةتثجحخدذرزسشصضطظعغفقكلمنهوىي\u{64B}\u{64C}\u{64D}\u{64E}\u{64F}\u{650}\u{651}\u{652}\u{670}',
  es: 'abcdefghijklmnñopqrstuvwxyzáéíóúüÁÉÍÑÓÚÜ',
  'pt-BR': 'abcdefghijklmnopqrstuvwxyzáàâãçéêíóôõúÁÀÂÃÇÉÊÍÓÔÕÚ',
  de: 'abcdefghijklmnopqrstuvwxyzäöüßÄÖÜ',
  fr: 'abcdefghijklmnopqrstuvwxyzàâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ',
  ja: 'あいうえおかきくけこアイウエオカキクケコー日本語中漢字',
  ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  ko: '가나다라마바사아자차카타파하한국어',
  it: 'abcdefghilmnopqrstuvzàèéìòùÀÈÉÌÒÙ',
  tr: 'abcçdefgğhıijklmnoöprsştuüvyzABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ',
  'zh-Hans': '的一是不了人我在有他这中国语简体',
  id: 'abcdefghijklmnopqrstuvwxyz',
  pl: 'aąbcćdeęfghijklłmnńoóprsśtuwyzźżĄĆĘŁŃÓŚŹŻ',
  'zh-Hant': '的一是不了人我在有他這中國語繁體',
  vi: 'aăâbcdđeêghiklmnoôơpqrstuưvxyàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵĂÂĐÊÔƠƯ',
  th: 'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮ\u{E31}\u{E34}\u{E35}\u{E36}\u{E37}\u{E38}\u{E39}\u{E47}\u{E48}\u{E49}\u{E4A}\u{E4B}\u{E4C}',
  nl: 'abcdefghijklmnopqrstuvwxyzáéíóúäëïöüĳ',
};

const missingIn = (families: readonly string[], line: string): string[] => [
  ...new Set([...line].filter((ch) => !families.every((family) => hasGlyph(family, ch)))),
];

const hex = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** What a string of a Rubik language may hold that Rubik lacks: the phone draws it, or it is not drawn. */
const allowed = (ch: string) => INVISIBLE.test(ch) || SYSTEM_DRAWN.test(ch) || /[\n\r\t]/.test(ch);

function strings(tree: unknown, path = '', out: [string, string][] = []): [string, string][] {
  if (typeof tree === 'string') out.push([path, tree]);
  else if (tree && typeof tree === 'object') {
    for (const [k, v] of Object.entries(tree)) strings(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

describe('which languages Rubik draws, from its font files (D106)', () => {
  it.each([...LANGUAGES])('%s', (lang) => {
    const missing = missingIn(RUBIK, ALPHABETS[lang]);
    // Rubik for a language whose whole alphabet it has in every weight; the system's font otherwise.
    expect({ lang, rubik: usesRubik(lang) }).toEqual({ lang, rubik: missing.length === 0 });
    if (!usesRubik(lang)) expect(missing.length).toBeGreaterThan(0);
  });

  it('Rubik shapes Arabic: its letters join (initial, medial and final forms)', () => {
    for (const family of RUBIK) {
      const { scripts, features } = substitutions(family);
      expect(scripts).toContain('arab');
      expect(features).toEqual(expect.arrayContaining(['init', 'medi', 'fina']));
    }
  });
});

describe('every string of a language in Rubik is in Rubik (6.1 #7)', () => {
  const folders = { ...readLocales(SAMPLE_LOCALES), ...readLocales(APP_LOCALES) };
  // The samples' languages (Arabic, Russian, Japanese) until their folders exist; the app's own folders win.
  const languages = Object.keys(folders).sort();

  it('reads the app’s folders and the samples (Hebrew, English, Arabic, Russian and Japanese at least)', () => {
    expect(languages).toEqual(expect.arrayContaining(['he', 'en', 'ar', 'ru', 'ja']));
  });

  it.each(languages)('%s', (lang) => {
    if (!usesRubik(lang)) {
      // The system's font draws it: its letters are not Rubik's (which is why).
      const letters = Object.values(folders[lang]!).flatMap((tree) => strings(tree).map(([, v]) => v));
      expect(missingIn(RUBIK, letters.join('').replace(/[^\p{L}]/gu, '')).length).toBeGreaterThan(0);
      return;
    }
    const problems: string[] = [];
    for (const [ns, tree] of Object.entries(folders[lang]!)) {
      for (const [key, value] of strings(tree)) {
        for (const ch of missingIn(RUBIK, value)) {
          const letter = /[\p{L}\p{M}]/u.test(ch);
          if (letter || !allowed(ch))
            problems.push(`${ns}:${key} ${hex(ch)} "${ch}"${letter ? ' (a letter)' : ''}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the pseudo languages too, once registered (plan 0יג)', () => {
    for (const lang of PSEUDO_LANGUAGES) {
      const bundle = localeBundle(lang);
      if (!bundle) continue;
      const problems = Object.entries(bundle).flatMap(([ns, tree]) =>
        strings(tree).flatMap(([key, value]) =>
          missingIn(RUBIK, value)
            .filter((ch) => /[\p{L}\p{M}]/u.test(ch) || !allowed(ch))
            .map((ch) => `${lang} ${ns}:${key} ${hex(ch)}`),
        ),
      );
      expect(problems).toEqual([]);
    }
  });

  it('the rule finds what Rubik lacks: a Vietnamese or a Thai letter, not an emoji, an arrow or an isolate', () => {
    expect(missingIn(RUBIK, 'Tiếng Việt').filter((ch) => !allowed(ch))).toEqual(['ế', 'ệ']);
    expect(missingIn(RUBIK, 'ไทย').filter((ch) => !allowed(ch))).toHaveLength(3);
    expect(missingIn(RUBIK, '\u{2066}+3\u{2069} → ★ 😂 🇮🇱').filter((ch) => !allowed(ch))).toEqual([]);
  });
});

describe('Teko’s words stay Latin (D107)', () => {
  /** The keys drawn in Teko: the VS badge, the countdown's GO!, and the dash for "no value" in numbers. */
  const TEKO_KEYS: Record<string, readonly string[]> = {
    player: ['vs'],
    match: ['countdown.go'],
    game: ['hud.none', 'results.stats.none'],
    home: ['profile.none'],
    progress: ['common.none'],
  };
  const folders = readLocales(APP_LOCALES);

  it.each(Object.keys(folders).sort())('%s: only Teko’s characters', (lang) => {
    for (const [ns, keys] of Object.entries(TEKO_KEYS)) {
      const values = new Map(strings(folders[lang]![ns] ?? {}));
      for (const key of keys) {
        const value = values.get(key);
        expect({ lang, key: `${ns}:${key}`, exists: value !== undefined }).toEqual({
          lang,
          key: `${ns}:${key}`,
          exists: true,
        });
        expect({
          key: `${ns}:${key}`,
          missing: missingIn(TEKO, value!).filter((ch) => !allowed(ch) && !/\s/.test(ch)),
        }).toEqual({
          key: `${ns}:${key}`,
          missing: [],
        });
      }
    }
  });
});
