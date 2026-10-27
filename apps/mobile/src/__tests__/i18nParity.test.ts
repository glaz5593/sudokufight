import {
  checkLanguage,
  type Dictionary,
  isDevOnly,
  pluralBases,
  SAME_AS_ENGLISH_OK,
  SOURCE_LANGUAGES,
} from '../../../../scripts/lib/i18n-locales.mjs';
import { ENABLED_LANGUAGES, localeBundle, NAMESPACES } from '../i18n';
import { pluralCategories } from '../services/pluralRules';
import {
  APP_LOCALES,
  appPluralRules,
  dailyErrors,
  dictionaries,
  isDailyLanguage,
  readLocales,
  SAMPLE_LOCALES,
} from '../testing/localeFiles';

/**
 * Spec §22, CLAUDE.md and localization plan 0ד (6.1 #1, #2): every language against English, the source. Each
 * has English's namespaces and keys, compared by a plural's base (a language has the plural forms ITS rules
 * use: Arabic 6, Russian 4, Japanese 1; and _zero wherever English has one), no empty value, the same
 * {{placeholders}}, $t() references and <tags> (a missing one prints a raw "{{name}}"), and bidi isolates that
 * close (Arabic: as many as Hebrew has). The rules are scripts/i18n-check.mjs's (scripts/lib/i18n-locales.mjs),
 * with the app's own plural rules (services/pluralRules.ts). Until the real languages exist, Arabic, Russian and
 * Japanese samples (testing/localeFiles.ts) show the rules at work, that they catch each kind of mistake, and
 * what is only a warning (the same as English, Latin letters, lost spaces, French and Spanish punctuation, bidi
 * controls by direction). Every day (D120) Hebrew and English are held to every rule, an enabled translated
 * language to all but what only lags behind them (a key or form not translated yet shows English); a folder still
 * being translated, and every language before a store build, by `npm run i18n:release`.
 */

const app = dictionaries(readLocales(APP_LOCALES));
const samples = dictionaries(readLocales(SAMPLE_LOCALES));

const check = (tree: Record<string, Dictionary>, lang: string, dict = tree[lang]!, release = false) =>
  checkLanguage({ lang, dict, en: tree.en!, he: tree.he, plural: appPluralRules(lang), release });

/** A copy of a language's dictionary with keys of one namespace changed (undefined: removed). */
function changed(dict: Dictionary, ns: string, edits: Record<string, string | undefined>): Dictionary {
  const keys = new Map(dict[ns]);
  for (const [key, value] of Object.entries(edits)) {
    if (value === undefined) keys.delete(key);
    else keys.set(key, value);
  }
  return { ...dict, [ns]: keys };
}

describe('the app’s languages', () => {
  it('has a folder for every enabled language (i18n/enabled-languages.json), Hebrew and English among them', () => {
    expect(ENABLED_LANGUAGES).toEqual(expect.arrayContaining(['he', 'en']));
    for (const lang of ENABLED_LANGUAGES)
      expect({ lang, folder: lang in app }).toEqual({ lang, folder: true });
  });

  it('loads every namespace of every enabled language (D109: dev may stay English in a translated one)', () => {
    for (const lang of ENABLED_LANGUAGES) {
      // Hebrew and English: all of them. A translated language: the ones it has (D120: the rest shows English).
      const needed = SOURCE_LANGUAGES.includes(lang)
        ? NAMESPACES
        : NAMESPACES.filter((ns) => !isDevOnly(ns) && ns in (app[lang] ?? {}));
      expect({ lang, namespaces: Object.keys(localeBundle(lang) ?? {}).sort() }).toEqual({
        lang,
        namespaces: expect.arrayContaining(needed),
      });
    }
  });

  it.each(Object.keys(app).filter(isDailyLanguage))(
    '%s: English’s keys and plural forms, the same placeholders, no errors',
    (lang) => {
      expect(dailyErrors(lang, check(app, lang))).toEqual([]);
    },
  );

  it('keeps English’s _two and _many and Hebrew’s _many, which their rules never pick: a warning only', () => {
    const en = check(app, 'en').extraForms;
    const he = check(app, 'he').extraForms;
    expect(en.length).toBeGreaterThan(0);
    expect(en.filter((key) => !/_(two|many)$/.test(key))).toEqual([]);
    expect(he.length).toBeGreaterThan(0);
    expect(he.filter((key) => !key.endsWith('_many'))).toEqual([]);
  });

  it('Hebrew has its "two" form wherever English has a plural (now on the phone too: services/pluralRules.ts)', () => {
    for (const [ns, keys] of Object.entries(app.en!)) {
      for (const base of pluralBases(keys.keys()).keys()) {
        expect({ key: `${ns}:${base}`, two: app.he![ns]!.has(`${base}_two`) }).toEqual({
          key: `${ns}:${base}`,
          two: true,
        });
      }
    }
  });
});

describe('Arabic, Russian and Japanese samples', () => {
  it.each(['he', 'en', 'ar', 'ru', 'ja'])('%s: no errors and no warnings', (lang) => {
    const { errors, warnings } = check(samples, lang);
    expect({ errors, warnings }).toEqual({ errors: [], warnings: [] });
  });

  it('have the forms of their languages: Arabic 6, Russian 4, Japanese 1 (and _zero where English has it)', () => {
    const forms = (lang: string, base: string) =>
      [...(pluralBases(samples[lang]!.sample!.keys()).get(base) ?? [])].sort();
    expect(pluralCategories('ar')).toHaveLength(6);
    expect(forms('ar', 'points')).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
    expect(forms('ru', 'points')).toEqual(['few', 'many', 'one', 'other']);
    expect(forms('ja', 'points')).toEqual(['other']);
    expect(forms('ja', 'streak')).toEqual(['other', 'zero']);
  });

  it.each<[string, Record<string, string | undefined>, string]>([
    ['ar', { points_few: undefined }, 'ar/sample.json: plural "points" has no "_few" form'],
    ['ru', { points_many: undefined }, 'ru/sample.json: plural "points" has no "_many" form'],
    ['ja', { streak_zero: undefined }, 'ja/sample.json: plural "streak" has no "_zero" form'],
    ['ja', { title: undefined }, 'ja/sample.json: "title" is missing (en/sample.json has it)'],
    ['ja', { extra: '余分' }, 'ja/sample.json: "extra" is not in en/sample.json'],
    ['ru', { title: ' ' }, 'ru/sample.json: "title" is empty'],
    [
      'ru',
      { greet: 'Привет, {{who}}' },
      'ru/sample.json: "greet" has different placeholders: en [name], ru [who]',
    ],
    ['ja', { score: 'スコア：{{score}}' }, 'ja/sample.json: "score" has different tags'],
    // Russian "one" is 1, 21, 31…: it must show the number.
    [
      'ru',
      { points_one: 'одно очко' },
      'ru/sample.json: "points_one" has different placeholders from English',
    ],
    ['ar', { lead_few: 'يتقدم بـ{{gap}} نقاط' }, 'ar/sample.json: "lead_few" has different placeholders'],
    ['ar', { range: '0–3 نجوم' }, 'ar/sample.json: "range" isolates less than Hebrew does'],
    ['ar', { range: '\u20660–3 نجوم' }, 'ar/sample.json: "range": an isolate (LRI/RLI/FSI) is not closed'],
  ])('%s %j: %s', (lang, edits, error) => {
    const { errors } = check(samples, lang, changed(samples[lang]!, 'sample', edits));
    expect(errors).toEqual([expect.stringContaining(error)]);
  });

  // D120: an enabled translated language lags behind Hebrew and English between translation passes (English
  // shows meanwhile); only what breaks it on screen even so fails every day. Hebrew and English: everything.
  it.each<[string, Record<string, string | undefined>, boolean]>([
    ['ar', { points_few: undefined }, false],
    ['ja', { title: undefined }, false],
    ['ja', { extra: '余分' }, false],
    ['ar', { range: '0–3 نجوم' }, false],
    ['ru', { title: ' ' }, true],
    ['ru', { greet: 'Привет, {{who}}' }, true],
    ['ru', { points_one: 'одно очко' }, true],
    ['ar', { range: '\u20660–3 نجوم' }, true],
  ])('an enabled %s with %j: fails every day: %s', (lang, edits, daily) => {
    const result = check(samples, lang, changed(samples[lang]!, 'sample', edits));
    expect(result.errors).toHaveLength(1);
    expect(dailyErrors(lang, result)).toEqual(daily ? result.errors : []);
    expect(result.incomplete).toEqual(daily ? [] : result.errors);
  });

  it('Hebrew and English: a missing key fails every day (D120)', () => {
    const result = check(samples, 'he', changed(samples.he!, 'sample', { title: undefined }));
    expect(result.incomplete).toHaveLength(1);
    expect(dailyErrors('he', result)).toEqual(result.errors);
  });

  it('a form for one number may leave the number out (Arabic "نقطتان"), a form for several may not', () => {
    expect(samples.ar!.sample!.get('points_two')).not.toContain('{{count}}');
    expect(check(samples, 'ar').errors).toEqual([]);
    const { errors } = check(samples, 'ar', changed(samples.ar!, 'sample', { points_few: 'بعض النقاط' }));
    expect(errors).toEqual([expect.stringContaining('the "few" form covers several numbers')]);
  });

  it('a form that takes a fraction too covers several numbers: CLDR’s Hebrew "one" (1 and 0.5) must show it', () => {
    // Hebrew "one" forms that name no number, as game:live.leadMine_one ("אתה מוביל בנקודה אחת"): the sample's
    // lead_one ("מוביל בנקודה אחת"), points_one and streak_one.
    expect(samples.he!.sample!.get('lead_one')).not.toContain('{{gap}}');
    // The app's rules: "one" is 1 only (services/pluralRules.ts), so they may.
    expect(check(samples, 'he').errors).toEqual([]);
    // CLDR's (Node's), where "one" takes 0.5 too: a 0.5 lead would read as one point.
    const cldr = new Intl.PluralRules('he');
    const plural = {
      categories: cldr.resolvedOptions().pluralCategories,
      select: (n: number) => cldr.select(n),
    };
    const { errors } = checkLanguage({ lang: 'he', dict: samples.he!, en: samples.en!, plural });
    expect(errors.map((e) => /"(\w+)"/.exec(e)?.[1]).sort()).toEqual([
      'lead_one',
      'points_one',
      'streak_one',
    ]);
    for (const error of errors) expect(error).toContain('(the "one" form covers several numbers)');
  });

  it('the dev namespace and the staging-only keys are not needed in a translated language (D109)', () => {
    const en = {
      ...samples.en!,
      dev: new Map([['title', 'Development']]),
      home: new Map([
        ['title', 'Home'],
        ['settings.testing', 'Testing'],
        ['dev.hello', 'Connection check'],
      ]),
    };
    const ar = { ...samples.ar!, home: new Map([['title', 'الرئيسية']]) };
    expect(
      checkLanguage({ lang: 'ar', dict: ar, en, he: samples.he, plural: appPluralRules('ar') }).errors,
    ).toEqual([]);
    // Hebrew is written by hand, as English: it needs them.
    const he = { ...samples.he!, home: new Map([['title', 'בית']]) };
    expect(checkLanguage({ lang: 'he', dict: he, en, plural: appPluralRules('he') }).errors.sort()).toEqual([
      'he/dev.json: missing (en/dev.json has it)',
      'he/home.json: "dev.hello" is missing (en/home.json has it)',
      'he/home.json: "settings.testing" is missing (en/home.json has it)',
    ]);
  });
});

describe('warnings: what a translation may have got wrong, without failing the daily check', () => {
  /** English and a language, one namespace each: the result of checking the language. */
  function checkPair(
    lang: string,
    en: Record<string, string>,
    translated: Record<string, string>,
    release = false,
  ) {
    return checkLanguage({
      lang,
      dict: { sample: new Map(Object.entries(translated)) },
      en: { sample: new Map(Object.entries(en)) },
      plural: appPluralRules(lang),
      release,
    });
  }

  it('the same as English: a warning every day, an error with --release (6.1 #5)', () => {
    const edited = changed(samples.ja!, 'sample', { title: 'Points' });
    const warning = 'ja/sample.json: "title" is the same as English ("Points")';
    expect(check(samples, 'ja', edited).errors).toEqual([]);
    expect(check(samples, 'ja', edited).warnings).toEqual(
      expect.arrayContaining([expect.stringContaining(warning)]),
    );
    expect(check(samples, 'ja', edited, true).errors).toEqual([expect.stringContaining(warning)]);
  });

  it('not "the same as English": the brand, VS, GO!, bot names, XP, codes, numbers, placeholders, the allow-list', () => {
    // The samples' brand ("Sudoku Fight"), vs ("VS") and sep (" · ") are English's own, in every language.
    expect(check(samples, 'ja', samples.ja!, true).errors).toEqual([]);
    const same = {
      a: 'Sudoku Fight',
      b: 'GO!',
      c: '{{score}}',
      d: '+3.5',
      e: 'Mr. Hoot',
      f: 'XP',
      g: 'D5',
      h: 'DEVELOPER_ERROR',
    };
    expect(checkPair('ja', same, same, true)).toEqual({
      errors: [],
      warnings: [],
      extraForms: [],
      incomplete: [],
    });
    SAME_AS_ENGLISH_OK.de = { 'sample:a': 'the same word in German' };
    try {
      expect(checkPair('de', { a: 'Name' }, { a: 'Name' }, true).errors).toEqual([]);
      expect(checkPair('de', { a: 'Name', b: 'Hotel' }, { a: 'Name', b: 'Hotel' }, true).errors).toEqual([
        expect.stringContaining('"b" is the same as English'),
      ]);
    } finally {
      delete SAME_AS_ENGLISH_OK.de;
    }
  });

  it('Latin letters in Arabic, Russian, Japanese…: a warning, the allow-list, cells and links aside (6.1 #6)', () => {
    expect(checkPair('ru', { a: 'Points' }, { a: 'Очки points' }).warnings).toEqual([
      expect.stringContaining('ru/sample.json: "a" has Latin letters'),
    ]);
    // Japanese puts no space between words: "Sudoku Fightへ" is still the brand.
    const allowed = checkPair(
      'ja',
      {
        a: 'Welcome to Sudoku Fight',
        b: 'Put it in D5',
        c: 'Write to {{email}}',
        d: 'Mail support@example.com',
      },
      { a: 'Sudoku Fightへようこそ', b: 'D5に置く', c: '{{email}}に書く', d: 'support@example.com にメール' },
    );
    expect(allowed.warnings).toEqual([]);
    // A chapter's Roman numeral stays Latin (docs/i18n/README.md: "Keep II"; Rubik has no U+2161 "Ⅱ").
    expect(checkPair('ru', { a: 'Championship II' }, { a: 'Чемпионат II' }).warnings).toEqual([]);
    expect(checkPair('ru', { a: 'Championship II' }, { a: 'Чемпионат IIa' }).warnings).toEqual([
      expect.stringContaining('ru/sample.json: "a" has Latin letters'),
    ]);
    // A Latin language: never.
    expect(checkPair('de', { a: 'Points' }, { a: 'Punkte' }).warnings).toEqual([]);
  });

  it('a separator that lost the space at its start or end: a warning (6.1 #9)', () => {
    const { errors, warnings } = check(samples, 'ru', changed(samples.ru!, 'sample', { sep: '· ' }));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('ru/sample.json: "sep" lost the space at the start')]);
    // Full-width punctuation carries its own space (docs/i18n/style/ja.md, zh-Hans.md): ", " as "、" or "，",
    // ". " as "。", and " (" as "（", lost nothing…
    const en = { list: ', ', sentence: '. ', open: ' (' };
    for (const lang of ['ja', 'zh-Hans', 'zh-Hant'])
      expect(checkPair(lang, en, { list: '、', sentence: '。', open: '（' }).warnings).toEqual([]);
    expect(checkPair('zh-Hans', en, { list: '，', sentence: '。', open: '（' }).warnings).toEqual([]);
    // …but a mark that isn't full-width punctuation did.
    expect(checkPair('ja', en, { list: '・', sentence: '.', open: '(' }).warnings).toEqual([
      expect.stringContaining('ja/sample.json: "list" lost the space at the end'),
      expect.stringContaining('ja/sample.json: "sentence" lost the space at the end'),
      expect.stringContaining('ja/sample.json: "open" lost the space at the start'),
    ]);
    // A key that IS a space (match:sentenceSpace) may be empty: Japanese has none between sentences.
    expect(samples.ja!.sample!.get('sentenceSpace')).toBe('');
    expect(check(samples, 'ja').warnings).toEqual([]);
  });

  it('French: a no-break space before ! ? : ; (6.1 #8)', () => {
    const en = { a: 'Ready?', b: 'Result: {{score}}', c: 'Go!', d: 'At 10:30', e: 'Really?!' };
    const noBreak = {
      a: 'Prêt\u00A0?',
      b: 'Résultat\u00A0: {{score}}',
      c: 'Allez\u202F!',
      d: 'À 10:30',
      e: 'Vraiment\u00A0?!',
    };
    expect(checkPair('fr', en, noBreak).warnings).toEqual([]);
    const plain = { a: 'Prêt ?', b: 'Résultat: {{score}}', c: 'Allez !', d: 'À 10:30', e: 'Vraiment ?!' };
    expect(checkPair('fr', en, plain).warnings.sort()).toEqual([
      'fr/sample.json: "a" needs a no-break space (U+00A0) before ?',
      'fr/sample.json: "b" needs a no-break space (U+00A0) before :',
      'fr/sample.json: "c" needs a no-break space (U+00A0) before !',
      'fr/sample.json: "e" needs a no-break space (U+00A0) before ?',
    ]);
  });

  it('Spanish: a question without ¿ (6.1 #8)', () => {
    const en = { a: 'Ready?', b: 'Play again?' };
    expect(checkPair('es', en, { a: '¿Listo?', b: '¿Jugar otra vez?' }).warnings).toEqual([]);
    expect(checkPair('es', en, { a: 'Listo?', b: '¿Jugar otra vez?' }).warnings).toEqual([
      'es/sample.json: "a" asks a question without opening it with ¿',
    ]);
  });

  it('bidi controls in a left-to-right language: a warning (most likely copied from Hebrew)', () => {
    const edited = changed(samples.ru!, 'sample', { range: '\u20660–3\u2069 звезды' });
    expect(check(samples, 'ru', edited).errors).toEqual([]);
    expect(check(samples, 'ru', edited).warnings).toEqual([
      expect.stringContaining('ru/sample.json: "range" has bidi controls'),
    ]);
    // Hebrew and Arabic need theirs.
    expect(check(samples, 'he').warnings).toEqual([]);
    expect(check(samples, 'ar').warnings).toEqual([]);
  });

  it('an isolate not closed by a PDI, or a PDI that closes nothing: an error in every language', () => {
    for (const [lang, range] of [
      ['he', '\u20660–3 כוכבים'],
      ['ru', '0–3\u2069 звезды'],
    ] as const) {
      const { errors } = check(samples, lang, changed(samples[lang]!, 'sample', { range }));
      expect({ lang, errors }).toEqual({
        lang,
        errors: [expect.stringMatching(/"range": (an isolate|a PDI)/)],
      });
    }
  });

  it('an embedding or override (U+202A–U+202E) instead of an isolate: a warning', () => {
    const edited = changed(samples.he!, 'sample', { greet: 'שלום \u202A{{name}}\u202C' });
    expect(check(samples, 'he', edited).warnings).toEqual([
      expect.stringContaining('"greet" has an embedding or override'),
    ]);
  });

  it('Arabic: a range, a signed number or Latin text that isn’t isolated: a warning (CLAUDE.md)', () => {
    const isolationWarnings = (greet: string) =>
      check(samples, 'ar', changed(samples.ar!, 'sample', { greet })).warnings.filter((w) =>
        w.includes('isolated'),
      );
    expect(isolationWarnings('مرحبًا {{name}}، \u2066+3.5\u2069 و\u20661–2\u2069')).toEqual([]);
    expect(isolationWarnings('مرحبًا {{name}}، 1–2')).toEqual([
      expect.stringContaining('a range of numbers'),
    ]);
    expect(isolationWarnings('مرحبًا {{name}}، +3.5')).toEqual([expect.stringContaining('a signed number')]);
    expect(isolationWarnings('مرحبًا {{name}} hello')).toEqual([
      expect.stringContaining('Latin text inside Arabic'),
    ]);
  });

  it('Arabic needs a mark or an isolate where Hebrew has a mark (an RLM after a Latin word)', () => {
    const withKey = (dict: Dictionary, value: string) => changed(dict, 'sample', { brandLine: value });
    const he = withKey(samples.he!, 'שחקו ב־Sudoku Fight\u200F.');
    const en = withKey(samples.en!, 'Play Sudoku Fight.');
    const arabic = (value: string) =>
      checkLanguage({ lang: 'ar', dict: withKey(samples.ar!, value), en, he, plural: appPluralRules('ar') })
        .errors;
    expect(arabic('العب Sudoku Fight.')).toEqual([expect.stringContaining('isolates less than Hebrew does')]);
    expect(arabic('العب Sudoku Fight\u200F.')).toEqual([]);
    expect(arabic('العب \u2066Sudoku Fight\u2069.')).toEqual([]);
  });
});
