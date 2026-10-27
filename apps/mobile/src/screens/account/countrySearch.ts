import type { CountryCode } from '@sudoku-fight/protocol';

/**
 * How the country search matches (CountryPicker): the query and every name are folded the same way first, so
 * the way a phone keyboard types a name finds it.
 *
 * - Hebrew: the tables write the real geresh and gershayim (צ׳כיה, ארה״ב); Samsung's and Gboard's Hebrew
 *   keyboards type ' and ". Both fold to the ASCII mark, and each name can also be found without it (צכיה).
 * - Latin: accents go (Türkiye → turkiye, Côte d’Ivoire → cote d'ivoire, Curaçao → curacao), by a table of our
 *   own rather than String.prototype.normalize, which the phone's engine need not have. Vietnamese letters lose
 *   their tone and vowel marks too (Hồng Kông → hong kong, Đức → duc), and loose combining marks go, so a query
 *   typed decomposed matches as well.
 * - Turkish: İ and ı both read as i ("israil" finds İsrail). Plain toLowerCase turns İ into i and a combining
 *   dot, and the dot goes with the other marks, so no locale-aware lower-casing is needed: every language's
 *   letters fold the same way, whatever language the app is in.
 * - Russian: ё reads as е (most text writes е).
 * - Arabic: the alef forms (أ إ آ ٱ, and ى) read as ا and ي, the hamza leaves its seat on و and ي too (ؤ ئ, so
 *   a letter typed composed or decomposed folds the same), ة reads as ه, and the short vowels and the tatweel go.
 * - "&" reads as "and", "St." as "st" or "saint", and dots and dashes go (U.S. → us, Timor-Leste → timor leste).
 * - A few other names people use (USA, UK, Turkey, Holland, אמריקה, אנגליה …): COUNTRY_ALIASES.
 */

/**
 * Letters with marks, and the other forms above, by the plain letters a keyboard types (lower case: the text is
 * lower-cased first).
 */
const FOLD: Readonly<Record<string, string>> = (() => {
  const groups: [string, string][] = [
    // Latin, Vietnamese included (ả ạ, ă ằ ắ ẳ ẵ ặ, â ầ ấ ẩ ẫ ậ, ơ ờ …, ư ừ …).
    ['àáâãäåāăąảạằắẳẵặầấẩẫậ', 'a'],
    ['æ', 'ae'],
    ['çćĉċč', 'c'],
    ['ďđð', 'd'],
    ['èéêëēĕėęěẻẽẹềếểễệ', 'e'],
    ['ĝğġģ', 'g'],
    ['ĥħ', 'h'],
    // İ too, for an engine whose lower-casing keeps it whole.
    ['ìíîïĩīĭįıỉịİ', 'i'],
    ['ĵ', 'j'],
    ['ķ', 'k'],
    ['ĺļľŀł', 'l'],
    ['ñńņňŉ', 'n'],
    ['òóôõöøōŏőỏọồốổỗộơờớởỡợ', 'o'],
    ['œ', 'oe'],
    ['ŕŗř', 'r'],
    ['śŝşšș', 's'],
    ['ß', 'ss'],
    ['ţťŧț', 't'],
    ['þ', 'th'],
    ['ùúûüũūŭůűųủụưừứửữự', 'u'],
    ['ŵ', 'w'],
    ['ýÿŷỳỷỹỵ', 'y'],
    ['źżž', 'z'],
    // Cyrillic.
    ['ё', 'е'],
    // Arabic: hamza above or below the alef, madda and wasla; hamza on waw and yeh; alef maqsura; ta marbuta.
    ['أإآٱ', 'ا'],
    ['ؤ', 'و'],
    ['ئى', 'ي'],
    ['ة', 'ه'],
  ];
  const table: Record<string, string> = {};
  for (const [marked, plain] of groups) for (const ch of marked) table[ch] = plain;
  return table;
})();

/** Apostrophes (and the Hebrew geresh) as ', quotation marks (and the gershayim) as ". */
const APOSTROPHES = /[׳‘’‛`´ʼ]/g;
const QUOTES = /[״“”„]/g;
/**
 * Marks that go: Latin combining marks (a decomposed é, the dot lower-casing leaves on İ), and the Arabic short
 * vowels, the combining madda and hamza (a decomposed أ), superscript alef and tatweel. Hebrew, Thai and the CJK
 * scripts keep theirs: there they are letters. Written as escapes: the marks themselves are invisible.
 */
const MARKS = /[\u0300-\u036f\u0640\u064b-\u065f\u0670]/g;

/** A name or a query, folded for matching (see above). */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(/[\u0080-￿]/g, (ch) => FOLD[ch] ?? ch)
    .replace(MARKS, '')
    .replace(/&/g, ' and ')
    .replace(/[.]/g, '')
    .replace(/[-‐-―]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Names the tables don't use but people type, in either language. Only for the search: the list shows the
 * tables' names.
 */
export const COUNTRY_ALIASES: Readonly<Partial<Record<CountryCode, readonly string[]>>> = {
  US: ['USA', 'US', 'America', 'United States of America', 'אמריקה', 'ארה״ב'],
  GB: [
    'UK',
    'Britain',
    'Great Britain',
    'England',
    'Scotland',
    'Wales',
    'Northern Ireland',
    'אנגליה',
    'סקוטלנד',
  ],
  TR: ['Turkey'],
  CZ: ['Czech Republic'],
  CI: ['Ivory Coast'],
  NL: ['Holland'],
  SZ: ['Swaziland', 'סווזילנד'],
  CV: ['Cabo Verde'],
  TL: ['East Timor'],
  CD: ['DR Congo', 'DRC'],
  AE: ['UAE', 'Emirates'],
  VA: ['Holy See'],
};

/** How a name may be written: as it is, and without its apostrophes and quotation marks. */
function spellings(name: string): string[] {
  const folded = foldForSearch(name);
  const bare = folded.replace(/['"]/g, '');
  const saint = folded.replace(/\bst /g, 'saint ');
  return [...new Set([folded, bare, saint])];
}

/**
 * Everything a search for this country may match: the names it is given (CountryPicker: the app language's,
 * Hebrew and English) and its aliases, folded.
 */
export function countrySearchTerms(code: CountryCode, names: readonly string[]): string[] {
  const all = [...names, ...(COUNTRY_ALIASES[code] ?? [])];
  return [...new Set(all.flatMap(spellings))];
}
