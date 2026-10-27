// `npm run i18n:gen` (in apps/mobile): writes src/i18n/locales.generated.ts, the function per language that
// reads its strings when the app first needs them (localization plan 0ב). Run it after adding or removing a
// namespace file (e.g. explain.json: add he and en, then this) or a language folder;
// src/i18n/__tests__/localeLoaders.test.ts fails until then. The pure parts are in lib/i18n-loader.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOADER_PATH, LOCALES_PATH, renderLocaleLoaders, scanLocales } from './lib/i18n-loader.mjs';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(MOBILE, LOADER_PATH);
const locales = scanLocales(join(MOBILE, LOCALES_PATH));
const text = renderLocaleLoaders(locales);

let before = null;
try {
  before = readFileSync(target, 'utf8');
} catch {
  // A first run: no file yet.
}
if (before === text) {
  console.log(`${LOADER_PATH} is up to date (${locales.length} languages).`);
} else {
  writeFileSync(target, text);
  console.log(`Wrote ${LOADER_PATH}: ${locales.map((l) => l.language).join(', ')}.`);
}
