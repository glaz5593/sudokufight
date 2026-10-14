import type { CountryCode } from '@sudoku-fight/protocol';

/**
 * How the country search matches (CountryPicker): the query and every name are folded the same way first, so
 * the way a phone keyboard types a name finds it.
 *
 * - Hebrew: the tables write the real geresh and gershayim (צ׳כיה, ארה״ב); Samsung's and Gboard's Hebrew
 *   keyboards type ' and ". Both fold to the ASCII mark, and each name can also be found without it (צכיה).
 * - Latin: accents go (Türkiye → turkiye, Côte d’Ivoire → cote d'ivoire, Curaçao → curacao), by a table of our
 *   own rather than String.prototype.normalize, which the phone's engine need not have.
 * - "&" reads as "and", "St." as "st" or "saint", and dots and dashes go (U.S. → us, Timor-Leste → timor leste).
 * - A few other names people use (USA, UK, Turkey, Holland, אמריקה, אנגליה …): COUNTRY_ALIASES.
 */

/** Latin letters with marks, by their plain letters (lower case: the text is lower-cased first). */
const LATIN: Readonly<Record<string, string>> = (() => {
  const groups: [string, string][] = [
    ['àáâãäåāăą', 'a'],
    ['æ', 'ae'],
    ['çćĉċč', 'c'],
    ['ďđð', 'd'],
    ['èéêëēĕėęě', 'e'],
    ['ĝğġģ', 'g'],
    ['ĥħ', 'h'],
    ['ìíîïĩīĭįı', 'i'],
    ['ĵ', 'j'],
    ['ķ', 'k'],
    ['ĺļľŀł', 'l'],
    ['ñńņňŉ', 'n'],
    ['òóôõöøōŏő', 'o'],
    ['œ', 'oe'],
    ['ŕŗř', 'r'],
    ['śŝşšș', 's'],
    ['ß', 'ss'],
    ['ţťŧț', 't'],
    ['þ', 'th'],
    ['ùúûüũūŭůűų', 'u'],
    ['ŵ', 'w'],
    ['ýÿŷ', 'y'],
    ['źżž', 'z'],
  ];
  const table: Record<string, string> = {};
  for (const [marked, plain] of groups) for (const ch of marked) table[ch] = plain;
  return table;
})();

/** Apostrophes (and the Hebrew geresh) as ', quotation marks (and the gershayim) as ". */
const APOSTROPHES = /[׳‘’‛`´ʼ]/g;
const QUOTES = /[״“”„]/g;

/** A name or a query, folded for matching (see above). */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(/[\u0080-￿]/g, (ch) => LATIN[ch] ?? ch)
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

/** Everything a search for this country may match: its names in both languages and its aliases, folded. */
export function countrySearchTerms(code: CountryCode, names: readonly string[]): string[] {
  const all = [...names, ...(COUNTRY_ALIASES[code] ?? [])];
  return [...new Set(all.flatMap(spellings))];
}
