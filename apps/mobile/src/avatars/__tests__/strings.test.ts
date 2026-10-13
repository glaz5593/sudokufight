import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { avatarStringsJson } from '../strings';

/**
 * The `avatars` namespace is generated from packages/avatars: names, kinds, expressions and motions. A new or
 * renamed character fails here until `npm run avatars:strings -w @sudoku-fight/mobile` writes the files again.
 */
describe('i18n/locales/*/avatars.json', () => {
  it.each(['he', 'en'] as const)('%s is what the package says', (lang) => {
    const file = join(__dirname, '..', '..', 'i18n', 'locales', lang, 'avatars.json');
    expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(avatarStringsJson(lang));
  });
});
