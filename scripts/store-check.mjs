#!/usr/bin/env node
/**
 * Store listings check (localization plan §4; D93, D115): `npm run store:check` at the root, in `npm run verify`
 * and in CI. Reads docs/store/locales/<code>.json, one file per language of the app but Hebrew and English, and
 * checks each as docs/store/locales/README.md describes it: the rules are in scripts/lib/store-check.mjs (field
 * limits, the brand in the names, Google Play's metadata policy, the App Store keywords, no "real people only"
 * claim, the 19 languages line).
 *
 * Prints one line per problem ("error …", "warning …") and a summary; exit code 1 on any error (with --strict, on
 * warnings too). --dir <folder> checks another folder (the tests).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkStoreLocales, STORE_LOCALES } from './lib/store-check.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const dirArg = args.indexOf('--dir');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = dirArg >= 0 ? resolve(args[dirArg + 1] ?? '.') : join(ROOT, 'docs', 'store', 'locales');

const files = {};
for (const name of readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const lang = name.slice(0, -'.json'.length);
  try {
    files[lang] = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  } catch (error) {
    files[lang] = error instanceof Error ? error : new Error(String(error));
  }
}

const { errors, warnings } = checkStoreLocales(files);
for (const line of warnings) console.warn(`warning  ${line}`);
for (const line of errors) console.error(`error    ${line}`);
console.log(
  `store listings: ${Object.keys(files).length} file(s) of ${Object.keys(STORE_LOCALES).length} languages · ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length > 0 || (strict && warnings.length > 0) ? 1 : 0);
