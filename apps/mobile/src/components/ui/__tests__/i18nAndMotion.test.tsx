import { ReduceMotion } from 'react-native-reanimated';

import {
  BLANK_OK,
  checkLanguage,
  type Dictionary,
  flatten,
  SOURCE_LANGUAGES,
} from '../../../../../../scripts/lib/i18n-locales.mjs';
import {
  APP_LOCALES,
  appPluralRules,
  dailyErrors,
  dailyLocales,
  dictionaries,
  readLocales,
} from '../../../testing/localeFiles';
import { motion } from '../../../theme/motion';
import { timing } from '../motion';

/**
 * The ui namespace (the design system's strings) of Hebrew, English and every enabled language, as the daily
 * check holds them (D120: Hebrew and English to every rule; an enabled translated language may lag behind them, as
 * English shows meanwhile; `npm run i18n:release` holds every folder to everything).
 */
const locales = dailyLocales(readLocales(APP_LOCALES));
const ui: Record<string, Dictionary> = Object.fromEntries(
  Object.entries(dictionaries(locales)).map(([lang, d]): [string, Dictionary] => [
    lang,
    d.ui ? { ui: d.ui } : {},
  ]),
);

describe('ui translations', () => {
  it('Hebrew and English have the ui file', () => {
    for (const lang of SOURCE_LANGUAGES)
      expect({ lang, ui: Boolean(locales[lang]?.ui) }).toEqual({ lang, ui: true });
  });

  // Spec §22 and localization plan 0ד: English's keys (by a plural's base, with the forms the language needs).
  it.each(Object.keys(ui))('%s has English’s keys, plural forms and placeholders', (lang) => {
    const result = checkLanguage({
      lang,
      dict: ui[lang]!,
      en: ui.en!,
      he: ui.he,
      plural: appPluralRules(lang),
    });
    expect(dailyErrors(lang, result)).toEqual([]);
  });

  it('has no empty strings', () => {
    for (const [lang, namespaces] of Object.entries(locales)) {
      for (const [key, value] of flatten(namespaces.ui ?? {})) {
        if (BLANK_OK.test(key)) continue;
        expect({ lang, key, value }).toEqual({ lang, key, value: expect.stringMatching(/\S/) });
      }
    }
  });
});

describe('ui motion timings', () => {
  it('uses the full duration normally', () => {
    expect(timing(motion.duration.sheetIn, 'standard', false)).toMatchObject({
      duration: motion.duration.sheetIn,
      reduceMotion: ReduceMotion.Never,
    });
  });

  it('becomes the 200 ms fade under reduced motion, and still plays', () => {
    expect(timing(motion.duration.sheetIn, 'exit', true)).toMatchObject({
      duration: motion.duration.reducedFade,
      reduceMotion: ReduceMotion.Never,
    });
  });
});
