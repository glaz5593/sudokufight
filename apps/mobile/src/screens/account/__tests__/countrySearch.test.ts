import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { COUNTRY_CODES } from '@sudoku-fight/protocol';

import { countryNames } from '../../../components/player/countryFlag';
import { LANGUAGES } from '../../../i18n/languages';
import { countryOptions, filterCountries } from '../CountryPicker';
import { foldForSearch } from '../countrySearch';

/**
 * The country search in every language (localization plan 0ז, §6.1 #13): the query and the names fold the same
 * way, whatever the app's language, so the letters of each language's keyboard find its names: Turkish İ and ı,
 * Vietnamese tone marks, Russian ё, the Arabic alef forms and ة. The Hebrew and English searches are
 * CountryPicker.test.tsx's.
 */

const codes = (language: string, query: string) =>
  filterCountries(countryOptions(language), query).map((o) => o.code);

describe('Turkish', () => {
  it('"israil" finds İsrail, however the I is typed', () => {
    expect(foldForSearch('İsrail')).toBe('israil');
    expect(codes('tr', 'israil')).toEqual(['IL']);
    expect(codes('tr', 'İsrail')).toEqual(['IL']);
    expect(codes('tr', 'İSRAİL')).toEqual(['IL']);
    // The Turkish keyboard's capital I is dotless; lower-cased plainly it is i, and ı folds to i as well.
    expect(codes('tr', 'ISRAIL')).toEqual(['IL']);
    expect(codes('tr', 'ısraıl')).toEqual(['IL']);
    expect(codes('tr', 'izlanda')).toEqual(['IS']);
    expect(codes('tr', 'irlanda')).toEqual(['IE']);
    expect(codes('tr', 'turkiye')).toEqual(['TR']);
    // The English and Hebrew names still find it in Turkish.
    expect(codes('tr', 'israel')).toEqual(['IL']);
    expect(codes('tr', 'ישראל')).toEqual(['IL']);
  });

  it('no textTransform anywhere in the app: a translation is written in its own letters, never cased by code', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(path);
        } else if (/\.(ts|tsx)$/.test(name) && /textTransform/.test(readFileSync(path, 'utf8'))) {
          found.push(path);
        }
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'app'));
    expect(found).toEqual([]);
  });
});

describe('Vietnamese', () => {
  it('every vowel with its tone and vowel marks folds to the plain letter, and đ to d', () => {
    const tones = ['', '̀', '́', '̉', '̃', '̣'];
    const plain: Record<string, string> = { ă: 'a', â: 'a', ê: 'e', ô: 'o', ơ: 'o', ư: 'u' };
    for (const vowel of 'aăâeêioôơuưy') {
      for (const tone of tones) {
        const letter = (vowel + tone).normalize('NFC');
        const want = plain[vowel] ?? vowel;
        expect([letter, foldForSearch(letter), foldForSearch(letter.toUpperCase())]).toEqual([
          letter,
          want,
          want,
        ]);
      }
    }
    expect(foldForSearch('Đđ')).toBe('dd');
  });

  it('finds a name typed without its marks, or typed decomposed', () => {
    expect(foldForSearch('Hồng Kông')).toBe('hong kong');
    expect(foldForSearch('Hồng Kông'.normalize('NFD'))).toBe('hong kong');
    expect(codes('vi', 'duc')).toEqual(['DE']);
    expect(codes('vi', 'hoa ky')[0]).toBe('US');
    expect(codes('vi', 'viet nam')).toEqual(['VN']);
    expect(codes('vi', 'Việt Nam'.normalize('NFD'))).toEqual(['VN']);
  });
});

describe('Russian', () => {
  it('ё reads as е, both ways', () => {
    expect(foldForSearch('Ёё')).toBe('ее');
    // CLDR writes Тёркс и Кайкос, and Соединенные Штаты with е.
    expect(codes('ru', 'теркс')).toEqual(['TC']);
    expect(codes('ru', 'тёркс')).toEqual(['TC']);
    expect(codes('ru', 'соединённые штаты')).toEqual(['US']);
  });
});

describe('Arabic', () => {
  it('the alef forms read as ا, ى as ي, ة as ه; the hamza leaves و and ي; short vowels and tatweel go', () => {
    expect(foldForSearch('أإآٱ')).toBe('اااا');
    expect(foldForSearch('ى')).toBe('ي');
    expect(foldForSearch('ة')).toBe('ه');
    expect(foldForSearch('عُمان')).toBe('عمان');
    expect(foldForSearch('ؤئ')).toBe('وي');
    expect(foldForSearch('إســرائيل')).toBe('اسراييل');
    // A hamza or madda typed as a combining mark (decomposed) goes the same way.
    expect(foldForSearch('إسرائيل'.normalize('NFD'))).toBe('اسراييل');
    expect(foldForSearch('آيسلندا'.normalize('NFD'))).toBe('ايسلندا');
    expect(codes('ar', 'إسرائيل')).toEqual(['IL']);
    expect(codes('ar', 'اسرائيل')).toEqual(['IL']);
    expect(codes('ar', 'اسراييل')).toEqual(['IL']);
    expect(codes('ar', 'الاردن')).toEqual(['JO']);
    expect(codes('ar', 'ايسلندا')).toEqual(['IS']);
    expect(codes('ar', 'عمان')).toContain('OM');
    expect(codes('ar', 'المملكه المتحده')).toEqual(['GB']);
  });
});

describe('every language', () => {
  it('every Latin-script name folds to plain ASCII: the fold table has every letter the tables use', () => {
    const latin = ['en', 'es', 'pt-BR', 'de', 'fr', 'it', 'tr', 'id', 'pl', 'vi', 'nl'] as const;
    for (const lang of latin) {
      for (const code of COUNTRY_CODES) {
        const folded = foldForSearch(countryNames(lang)[code]!);
        expect([lang, code, folded, /^[\x20-\x7e]*$/.test(folded)]).toEqual([lang, code, folded, true]);
      }
    }
  });

  it.each([...LANGUAGES])('in %s, each country is found by its own name in that language', (lang) => {
    const options = countryOptions(lang);
    for (const o of options) {
      expect([o.code, filterCountries(options, o.name).map((x) => x.code)]).toEqual([
        o.code,
        expect.arrayContaining([o.code]),
      ]);
    }
  });

  it('Hebrew and English search what they searched before: the Hebrew and English names and the aliases', () => {
    const he = countryOptions('he');
    const en = countryOptions('en');
    for (const o of he) {
      expect([o.code, [...o.terms].sort()]).toEqual([
        o.code,
        [...en.find((x) => x.code === o.code)!.terms].sort(),
      ]);
    }
  });
});
