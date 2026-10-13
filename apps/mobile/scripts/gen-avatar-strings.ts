// Writes src/i18n/locales/<lang>/avatars.json from packages/avatars (names, kinds, expressions, motions), after
// a character is added or renamed in the catalog. src/avatars/__tests__/strings.test.ts fails until it is run.
//   npm run avatars:strings -w @sudoku-fight/mobile
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { avatarStringsJson } from '../src/avatars/strings';

for (const lang of ['he', 'en'] as const) {
  const target = join(__dirname, '..', 'src', 'i18n', 'locales', lang, 'avatars.json');
  writeFileSync(target, avatarStringsJson(lang));
  console.log(`Wrote ${target}`);
}
