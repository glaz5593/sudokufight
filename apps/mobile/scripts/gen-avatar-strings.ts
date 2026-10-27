// Writes src/i18n/locales/<lang>/avatars.json from packages/avatars (names, kinds, expressions, motions), after
// a character is added or renamed in the catalog. src/avatars/__tests__/strings.test.ts fails until it is run.
// Only Hebrew and English come from the catalog. The other 17 languages translate en/avatars.json like any other
// namespace (localization plan, D111: names in the local script, titles translated, Latin-script languages keep
// the English name), so a new or renamed avatar needs its strings in those 17 languages too, or
// `npm run i18n:check` reports them missing.
//   npm run avatars:strings -w @sudoku-fight/mobile
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { avatarStringsJson } from '../src/avatars/strings';

for (const lang of ['he', 'en'] as const) {
  const target = join(__dirname, '..', 'src', 'i18n', 'locales', lang, 'avatars.json');
  writeFileSync(target, avatarStringsJson(lang));
  console.log(`Wrote ${target}`);
}
