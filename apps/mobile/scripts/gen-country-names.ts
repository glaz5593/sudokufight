// Writes src/i18n/countries/<lang>.json for every language of the app (LANGUAGES in src/i18n/languages.ts, all
// 19, not only the enabled ones): the name of every country the server accepts (COUNTRY_CODES in
// packages/protocol), taken once from Node's ICU (CLDR region names, the long form). This is CLDR data, not a
// translation, so a language's table exists before its strings do.
// The app can't ask the phone for them: Hermes has no Intl.DisplayNames, so without these tables the country
// picker showed two-letter codes (Moshe's device test, 14.10.2026). Run it again after COUNTRY_CODES or
// LANGUAGES changes; src/components/player/__tests__/countryNames.test.ts fails until every code has a name in
// every language. It needs a Node with full ICU (the default build since Node 13).
//   npm run countries:names -w @sudoku-fight/mobile
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { COUNTRY_CODES } from '@sudoku-fight/protocol';

import { LANGUAGES } from '../src/i18n/languages';

for (const lang of LANGUAGES) {
  const names = new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' });
  // A Node with small ICU falls back to English for a locale it lacks: zh-Hant would quietly get English names.
  const resolved = names.resolvedOptions().locale;
  if (resolved !== lang) {
    throw new Error(`ICU resolved ${lang} as ${resolved}: run this with a Node that has full ICU.`);
  }
  const table: Record<string, string> = {};
  for (const code of COUNTRY_CODES) {
    const name = names.of(code);
    if (!name || name === code) {
      throw new Error(`No ${lang} name for ${code}: run this with a Node that has full ICU.`);
    }
    table[code] = name;
  }
  const target = join(__dirname, '..', 'src', 'i18n', 'countries', `${lang}.json`);
  // Two-space JSON and a final newline, as Prettier writes it.
  writeFileSync(target, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`Wrote ${target} (${COUNTRY_CODES.length} countries, ICU ${process.versions.icu})`);
}
