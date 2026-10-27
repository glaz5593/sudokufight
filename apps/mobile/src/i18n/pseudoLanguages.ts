import { type TestingBuildSources, testingSwitchesAllowed, thisBuild } from '../config/testing';
import { useSettings } from '../state/settings';
import { addLocaleLoader, localeBundle } from './index';
import { isPseudoLanguage, PSEUDO_LANGUAGES } from './languages';
import { pseudoBundle } from './pseudo';

/**
 * The pseudo languages at work (localization plan 0יג): en-XA and ar-XB exist in development and staging builds
 * only, the builds that have the settings' "בדיקה" section (config/testing.ts), and never in a store build.
 * There they are chosen from that section (screens/home/PseudoLanguageSettings.tsx), through the same restart as
 * any language (D104), and the plural check screen (/dev/plurals) is open. The strings are made from English
 * when i18next first asks for the language (pseudo.ts), not at start.
 */

/** Does this build have the pseudo languages and the plural check screen: staging, or development not on production. */
export function pseudoLanguagesAllowed(build: TestingBuildSources = thisBuild()): boolean {
  return testingSwitchesAllowed(build);
}

/** Registers en-XA and ar-XB with i18n (i18n/index.ts addLocaleLoader), made from English when first read. */
export function registerPseudoLanguages(): void {
  for (const lang of PSEUDO_LANGUAGES) {
    addLocaleLoader(lang, () => {
      const english = localeBundle('en');
      if (!english)
        throw new Error('The English strings are missing: the pseudo languages are made from them');
      return pseudoBundle(english, lang);
    });
  }
}

/**
 * The root layout's part, before it applies the language: in a build that allows them, the pseudo languages are
 * registered (a saved one is read again at once, addLocaleLoader); in any other build they don't exist, and a
 * pseudo language saved by a staging build on the same phone goes back to "שפת המכשיר".
 */
export function installPseudoLanguages(build: TestingBuildSources = thisBuild()): void {
  if (pseudoLanguagesAllowed(build)) {
    registerPseudoLanguages();
    return;
  }
  if (isPseudoLanguage(useSettings.getState().language)) {
    useSettings.getState().setLanguagePrefs({ language: 'system', languageSource: 'default' });
  }
}
