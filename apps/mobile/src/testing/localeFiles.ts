import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  type CheckLanguageResult,
  type Dictionary,
  flatten,
  type LanguageRules,
  SOURCE_LANGUAGES,
} from '../../../../scripts/lib/i18n-locales.mjs';
import { ENABLED_LANGUAGES } from '../i18n/languages';
import { pluralCategories, pluralCategory } from '../services/pluralRules';

/**
 * Test-only: the language files as they are on disk, for the tests that check every language (i18nParity,
 * i18nAndMotion, pluralDisplay) with the rules of scripts/i18n-check.mjs (scripts/lib/i18n-locales.mjs). Besides
 * the app's own folders, small Arabic, Russian and Japanese samples (one "sample" namespace, with Hebrew and
 * English) stand for languages with 6, 4 and 1 plural forms until the real ones exist: they live with the tests,
 * never in the app's locales folder.
 */

/** The app's language folders: src/i18n/locales/<lang>/<namespace>.json. */
export const APP_LOCALES = join(__dirname, '..', 'i18n', 'locales');
/** The samples: src/__tests__/__fixtures__/locales/<lang>/sample.json (he, en, ar, ru, ja). */
export const SAMPLE_LOCALES = join(__dirname, '..', '__tests__', '__fixtures__', 'locales');

/** lang → namespace → the JSON tree. */
export type LocaleTrees = Record<string, Record<string, object>>;

/** Every language folder under a locales folder, and its namespace files. */
export function readLocales(root: string): LocaleTrees {
  const trees: LocaleTrees = {};
  for (const lang of readdirSync(root)
    .filter((d) => statSync(join(root, d)).isDirectory())
    .sort()) {
    trees[lang] = {};
    for (const file of readdirSync(join(root, lang)).filter((f) => f.endsWith('.json'))) {
      trees[lang][file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(root, lang, file), 'utf8'));
    }
  }
  return trees;
}

/**
 * The languages the tests check every day, as `npm run i18n:check` does (D120): Hebrew, English and the enabled
 * ones (i18n/enabled-languages.json), each held to dailyErrors. A folder still being translated, not enabled yet,
 * is held to every rule by `npm run i18n:release`.
 */
export const isDailyLanguage = (lang: string): boolean =>
  SOURCE_LANGUAGES.includes(lang) || (ENABLED_LANGUAGES as readonly string[]).includes(lang);

/**
 * The errors a daily language may not have (D120, as `npm run i18n:check`): every one for Hebrew and English; for
 * an enabled translated language, all but what only lags behind them (`incomplete`: a namespace, key or plural
 * form not translated yet, one English dropped), as English shows there until its translation pass. What breaks it
 * on screen even so (other placeholders, an empty value, an isolate not closed) fails every day.
 */
export function dailyErrors(
  lang: string,
  result: Pick<CheckLanguageResult, 'errors' | 'incomplete'>,
): string[] {
  if (SOURCE_LANGUAGES.includes(lang)) return result.errors;
  const lagging = new Set(result.incomplete);
  return result.errors.filter((error) => !lagging.has(error));
}

/** Only the daily languages' folders of a tree. */
export const dailyLocales = (trees: LocaleTrees): LocaleTrees =>
  Object.fromEntries(Object.entries(trees).filter(([lang]) => isDailyLanguage(lang)));

/** The same, as the check reads them: namespace → Map(dotted key → value). */
export function dictionaries(trees: LocaleTrees): Record<string, Dictionary> {
  return Object.fromEntries(
    Object.entries(trees).map(([lang, namespaces]) => [
      lang,
      Object.fromEntries(Object.entries(namespaces).map(([ns, tree]) => [ns, new Map(flatten(tree))])),
    ]),
  );
}

/** A language's plural rules, the app's own (services/pluralRules.ts), as the check takes them. */
export const appPluralRules = (lang: string): LanguageRules => ({
  categories: pluralCategories(lang),
  select: (n) => pluralCategory(lang, n),
});
