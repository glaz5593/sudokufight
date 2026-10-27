/**
 * The rules of the translation check for the app's language files (scripts/i18n-check.mjs: `npm run i18n:check`
 * every day, `npm run i18n:release` before a store build): one language at a time, against English, the source
 * (localization plan 0ד and 6.1 #1, #2, #5, #6, #8, #9; D109, D120). No I/O here, so the Jest tests run the same
 * rules on the real files and on Arabic, Russian and Japanese samples (apps/mobile/src/__tests__/i18nParity.test.ts,
 * i18nAndMotion.test.tsx). Types in i18n-locales.d.mts.
 *
 * errors   - a namespace file or a key English has and the language doesn't (D109: the dev namespace and the
 *            staging-only keys are not needed in the translated languages), or one English doesn't have
 *            [incomplete]
 *          - a value that is not a string, or is empty (a key that IS a space, like match:sentenceSpace, may be)
 *          - a plural without a form the language's CLDR rules use (Arabic 6, Russian and Polish 4…), or without
 *            _zero where English has one (i18next reads key_zero for 0 in every language, before the CLDR form)
 *            [incomplete]
 *          - other {{placeholders}}, $t() references or <tags> than English. A plural form is compared with all of
 *            English's forms of that key: a form that covers several numbers (Russian "one" is 1, 21, 31…; a form
 *            that takes a fraction too, as CLDR's Hebrew "one" takes 0.5) has everything English's "other" has; a
 *            form for one number (Arabic "two") may leave the number out
 *          - a $t() reference to a key that doesn't exist
 *          - an isolate (LRI, RLI, FSI) not closed by a PDI, or a PDI that closes nothing
 *          - Arabic (and ar-XB): less bidi isolation than Hebrew has in the same key [incomplete]
 *          - with --release: a value the same as English (warning otherwise; see below)
 *          [incomplete]: also listed in `incomplete`: what only lags behind Hebrew and English. D120: an enabled
 *            translated language may lag every day (English shows there until its translation pass), so the
 *            daily check reports these as warnings for it; Hebrew, English and --release hold every error.
 * warnings - a plural form the language's rules never pick (English's _two and _many, Hebrew's _many: kept)
 *          - a value the same as English, in a translated language (KEEP_LATIN words, placeholders, numbers and
 *            SAME_AS_ENGLISH_OK aside)
 *          - a space at the start or the end of English's value (sep, listSep) that the language lost (not
 *            after or before full-width punctuation: "、" and "。" carry their own space)
 *          - Latin letters in a language with another script (KEEP_LATIN, cell names, links aside)
 *          - Arabic: a range of numbers (0–3), a signed number (+3.5) or Latin text, not isolated (CLAUDE.md)
 *          - bidi controls in a left-to-right language (most likely copied from Hebrew), and embeddings or
 *            overrides (U+202A–U+202E) anywhere: isolates instead
 *          - French: no no-break space before ! ? : ;   Spanish: a question without ¿
 */

export const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
export const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** English is the source every language is compared with; Hebrew and English are written by hand. */
export const REFERENCE = 'en';
export const SOURCE_LANGUAGES = ['he', 'en'];
/** apps/mobile/src/i18n/enabled-languages.json when it isn't there (the --root test trees). */
export const DEFAULT_ENABLED = ['he', 'en'];
/** As isRtlLanguage (apps/mobile/src/i18n/languages.ts). */
export const RTL_LANGUAGES = ['he', 'ar', 'ar-XB'];
export const PSEUDO_LANGUAGES = ['en-XA', 'ar-XB'];
/** Languages written in another script, where Latin letters are most likely English left over. */
export const NON_LATIN_LANGUAGES = ['ar', 'ru', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'th'];

/**
 * D109: what only developers and testers see, not translated (it shows in English, the fallback): the dev
 * namespace, and these keys (by prefix) elsewhere: the home screen's development links, the settings' "Testing"
 * section (staging builds only) and the development-mode account notes.
 */
export const DEV_ONLY = {
  namespaces: ['dev'],
  keys: {
    home: [
      'dev.',
      'settings.testing',
      'settings.testingHint',
      'settings.chainPenalty',
      'settings.chainPenaltyHint',
      'settings.unlockAll',
      'settings.unlockAllHint',
    ],
    account: ['devMode.'],
  },
};

/** Whether a namespace (key null) or a key is for developers and testers only (D109). */
export function isDevOnly(ns, key = null) {
  if (DEV_ONLY.namespaces.includes(ns)) return true;
  if (key === null) return false;
  const base = key.replace(PLURAL_SUFFIX, '');
  return (DEV_ONLY.keys[ns] ?? []).some((p) => (p.endsWith('.') ? base.startsWith(p) : base === p));
}

/**
 * Stays Latin in every language (D107; the glossary's "do not translate"): the brand, the Teko words, the bots'
 * names, XP, and the names of other companies' products. Not "the same as English", not "Latin letters".
 */
export const KEEP_LATIN = [
  'Sudoku Fight',
  'SUDOKU',
  'FIGHT',
  'VS',
  'GO!',
  'Pip',
  'Biscuit',
  'Mr. Hoot',
  'Maestro',
  'Overlord',
  'XP',
  'Google Play Services',
  'Google Play',
  'Google',
  'App Store',
  'Apple',
  'Firebase',
  'SIL Open Font License',
];

/** { 'ns:key': reason } for each key: the lines of SAME_AS_ENGLISH_OK. */
const same = (reason, ...keys) => Object.fromEntries(keys.map((key) => [key, reason]));
/** D111: in a Latin-script language an avatar's name stays as in English ("Noam", "Maya"). */
const keptNames = (...more) =>
  same(
    'a name, kept as in English in a Latin-script language (D111)',
    ...['noam', 'maya', 'omer', 'dana', 'ido', 'luchador', 'punk', ...more].map(
      (id) => `avatars:names.${id}`,
    ),
  );
/** A unit symbol the language writes as English does (s, min, pts). */
const UNIT = 'a unit symbol (s, min, pts), written the same in this language';

/**
 * A translated value that may be the same as English, with the reason: { lang: { 'ns:key': 'why' } }. A
 * translator adds a line here (a word the language shares with English), rather than translating it worse.
 */
export const SAME_AS_ENGLISH_OK = {
  de: {
    ...keptNames(),
    ...same(
      'the German word too',
      'avatars:names.toaster',
      'avatars:names.joystick',
      'avatars:expressions.neutral',
      'account:fields.avatar',
      'common:appVersion.version',
      'player:bot',
      'player:presence.online',
      'player:presence.online_female',
      'player:league.bronze',
      'player:league.gold',
    ),
    ...same('glossary: boss is Boss in German', 'levels:boss.chip'),
    ...same(
      'glossary: level (bot level, XP level) is Level in German',
      'game:arsenal.level',
      'game:botLevel.label',
      'levels:panel.bot',
      'player:league.level',
      'player:league.levelAfter',
      'progress:common.level',
      'progress:progress.levelWord',
      'progress:home.levelXp',
    ),
  },
  es: {
    ...keptNames('chef'),
    ...same(
      'the Spanish word too',
      'account:fields.avatar',
      'avatars:kinds.animal.one',
      'game:type.normal',
      'home:gameTypes.normal.name',
      'progress:leaderboard.tabs.normal',
      'player:bot',
      'player:rating.provisional',
    ),
    ...same(
      UNIT,
      'game:results.stats.seconds',
      'home:gameType.seconds',
      'home:gameType.minutes',
      'home:botSelect.thinkValue',
      'levels:units.seconds',
      'levels:hud.penalty',
      'levels:hud.chain.notYet',
    ),
  },
  'pt-BR': {
    ...keptNames('chef', 'professor'),
    ...same(
      'the Portuguese word too',
      'avatars:names.panda',
      'avatars:names.banana',
      'avatars:names.falafel',
      'avatars:names.zero',
      'avatars:kinds.animal.one',
      'account:fields.avatar',
      'game:type.normal',
      'home:gameTypes.normal.name',
      'progress:leaderboard.tabs.normal',
      'player:league.bronze',
    ),
    ...same(
      'glossary: rating stays rating in Brazilian Portuguese',
      'home:profile.ratingTitle',
      'progress:card.ratingsNote_other',
    ),
    ...same(
      UNIT,
      'game:arsenal.priceValue',
      'game:arsenal.unit',
      'game:arsenal.cost',
      'game:results.points',
      'game:results.stats.seconds',
      'game:results.awards.value.bestMove',
      'game:results.awards.value.mostPoints',
      'history:card.points',
      'progress:card.points',
      'home:gameType.seconds',
      'home:gameType.minutes',
      'home:botSelect.thinkValue',
      'levels:units.seconds',
      'levels:hud.penalty',
      'levels:hud.chain.notYet',
    ),
  },
  fr: {
    ...keptNames('chef'),
    ...same(
      'the French word too',
      'avatars:names.panda',
      'avatars:names.six',
      'avatars:kinds.animal.one',
      'avatars:kinds.nature.one',
      'avatars:kinds.nature.many',
      'common:appVersion.version',
      'game:connection.self.item.score',
      'player:league.bronze',
      'friends:wait.minutes_other',
      'match:timeout.minutes_other',
    ),
    ...same(
      'point(s) is the French word too',
      'game:arsenal.costPoints_one',
      'game:arsenal.costPoints_other',
      'game:results.opponents.label_one',
      'game:results.opponents.label_other',
      'levels:scale.points',
      'levels:result.metric.points',
      'levels:result.opponentScore_one',
      'levels:result.opponentScore_other',
      'levels:hud.duel.reachPoints_one',
      'levels:hud.duel.reachPoints_other',
      'levels:hud.hunt.goalPoints_one',
      'levels:hud.hunt.goalPoints_other',
      'levels:hud.hunt.points',
      'levels:hud.hunt.scoreLabel_one',
      'levels:hud.hunt.scoreLabel_other',
      'player:points_one',
      'player:points_other',
    ),
    ...same('glossary: boss and bot stay in French', 'levels:boss.chip', 'levels:boss.label', 'player:bot'),
    ...same(UNIT, 'game:arsenal.unit', 'game:results.points', 'levels:units.seconds'),
  },
  it: {
    ...keptNames(),
    ...same(
      'the Italian word too',
      'avatars:names.joystick',
      'avatars:names.banana',
      'avatars:names.falafel',
      'avatars:names.avocado',
      'avatars:names.zero',
      'account:fields.password',
      'account:fields.avatar',
      'friends:seat.host',
      'player:bot',
      'ui:nav.tabs.home',
    ),
    ...same('glossary: boss stays boss in Italian', 'levels:boss.chip'),
  },
  tr: {
    ...keptNames(),
    ...same('the Turkish word too', 'account:fields.avatar', 'player:bot'),
    ...same('glossary: boss stays boss in Turkish', 'levels:boss.chip'),
  },
  id: {
    ...keptNames(),
    ...same('the Indonesian word too', 'player:bot'),
  },
  pl: {
    ...keptNames(),
    ...same('the Polish word too', 'avatars:names.zero', 'player:bot'),
    ...same('glossary: boss stays boss in Polish', 'levels:boss.chip'),
  },
  vi: keptNames(),
  nl: {
    ...keptNames(),
    ...same('the Dutch word too', 'player:bot'),
    ...same(
      'W, for winst: the Dutch short form too',
      'player:result.winShort',
      'progress:card.outcomeShort.win',
    ),
  },
};

/**
 * Full-width punctuation (Japanese and Chinese 、。，：「」) carries its own space: a separator that ends (or starts)
 * with one has lost nothing (docs/i18n/style/ja.md, zh-Hans.md, zh-Hant.md: no space after it).
 */
const FULL_WIDTH_CLOSE = /[、。」』！），．：；？]$/;
const FULL_WIDTH_OPEN = /^[「『（]/;

/** A key that is a space itself (match:sentenceSpace: none in Japanese and Chinese): may be blank or empty. */
export const BLANK_OK = /(^|\.)\w*Space$/;

// ---------------------------------------------------------------- reading values

/** A JSON tree as [dotted key, value] pairs (leaves only). */
export function flatten(tree, prefix = '') {
  return Object.entries(tree).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  );
}

/**
 * A value's placeholders, each once: a language may say one twice where English says it once ("הספרה 7 נמחקה
 * ממנו" for "it was ruled out", explain:block.step), but must say every one English says.
 */
export const placeholdersOf = (s) =>
  [...new Set([...s.matchAll(/{{\s*-?\s*([\w.]+)(?:\s*,[^}]*)?\s*}}/g)].map((m) => m[1]))].sort();
export const nestingOf = (s) => [...s.matchAll(/\$t\(\s*([^,)\s]+)/g)].map((m) => m[1]).sort();
export const tagsOf = (s) =>
  [...s.matchAll(/<\/?\s*([\w-]+)\s*\/?>/g)].map((m) => m[0].replace(/\s/g, '')).sort();

const EXTRACTORS = [
  ['placeholders', placeholdersOf],
  ['$t() references', nestingOf],
  ['tags', tagsOf],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Bounded by Latin letters only: Japanese, Chinese and Thai don't put spaces between words ("Sudoku Fightへ").
const KEEP_LATIN_RE = new RegExp(
  `(?<!\\p{Script=Latin})(?:${[...KEEP_LATIN]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})(?!\\p{Script=Latin})`,
  'gu',
);

/** The text a reader sees of a value: placeholders as `filler`, no $t(), tags or links. */
function visibleText(s, filler = '') {
  return s
    .replace(/\$t\([^)]*\)/g, filler)
    .replace(/{{[^}]*}}/g, filler)
    .replace(/<\/?\s*[\w-]+\s*\/?>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '');
}

/**
 * Words of the language's own: no KEEP_LATIN word, cell name (D5), code (DEVELOPER_ERROR) or Roman numeral in a
 * chapter's name ("Championship II": docs/i18n/README.md keeps II, in Latin letters the app's font has).
 */
const ownWords = (s) =>
  visibleText(s)
    .replace(KEEP_LATIN_RE, '')
    .replace(/\b[IVX]{2,4}\b/g, '')
    .replace(/\b[A-I][1-9]\b/g, '')
    .replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, '');

// ---------------------------------------------------------------- bidi

const ISOLATE = /[⁦⁧⁨]/g;
const PDI = '⁩';
const MARK = /[‎‏؜]/g;
const EMBEDDING = /[‪-‮]/;
const ANY_BIDI = /[⁦-⁩‎‏؜‪-‮]/;
const count = (s, re) => (s.match(re) ?? []).length;

/** What is wrong with a value's isolates, or null: each LRI, RLI or FSI closed by a PDI. */
export function isolateProblem(s) {
  let open = 0;
  for (const ch of s) {
    if (ch === '⁦' || ch === '⁧' || ch === '⁨') open++;
    else if (ch === PDI) {
      if (open === 0) return 'a PDI (U+2069) closes nothing';
      open--;
    }
  }
  return open > 0 ? 'an isolate (LRI/RLI/FSI) is not closed by a PDI (U+2069)' : null;
}

/** Arabic text with what is isolated (LRI…PDI) taken out, for the "not isolated" warnings. */
const outsideIsolates = (s) => visibleText(s, '').replace(/[⁦-⁨][^⁩]*⁩/g, '');

// ---------------------------------------------------------------- one language

/** base → the plural forms it has, for every key with a plural suffix. */
export function pluralBases(keys) {
  const bases = new Map();
  for (const key of keys) {
    const m = key.match(PLURAL_SUFFIX);
    if (!m) continue;
    const base = key.slice(0, -m[0].length);
    if (!bases.has(base)) bases.set(base, new Set());
    bases.get(base).add(m[1]);
  }
  return bases;
}

/** Fractions a count can be (scores move in halves): a form that takes one of them and 1 covers several numbers. */
const FRACTIONS = [0.5, 1.5, 2.5, 0.25];

/**
 * How many numbers each form of a language's rules covers: the whole numbers 0..1000 and FRACTIONS ("zero":
 * i18next's, for 0 only). CLDR's Hebrew "one" (1 and 0.x) covers two, so a "one" that names no number ("בנקודה
 * אחת") would read a 0.5 lead as one point; the app's own rules keep it for 1 only (services/pluralRules.ts).
 */
function numbersPerForm(plural) {
  const covered = new Map([['zero', 1]]);
  for (let n = 0; n <= 1000; n++) {
    const form = plural.select(n);
    covered.set(form, (covered.get(form) ?? 0) + (form === 'zero' ? 0 : 1));
  }
  for (const n of FRACTIONS) {
    const form = plural.select(n);
    if (form !== 'zero') covered.set(form, (covered.get(form) ?? 0) + 1);
  }
  return covered;
}

/** Whether `ref` ('ns:key' or 'key') exists in a dictionary, as a key or a plural's base. */
function refExists(dict, ns, ref) {
  const [refNs, refKey] = ref.includes(':') ? ref.split(':') : [ns, ref];
  const keys = dict[refNs];
  if (!keys) return false;
  if (keys.has(refKey)) return true;
  return PLURAL_FORMS.some((f) => keys.has(`${refKey}_${f}`));
}

/**
 * Checks one language's files against English's. `dict` and `en` (and `he`, for Arabic's isolation): namespace →
 * Map(dotted key → value). `plural`: the language's rules (the app's own, services/pluralRules.ts, in the script
 * and in the tests). `release`: a value the same as English is an error. `devTranslated`: D109 the other way.
 * Returns the errors, the warnings, the plural forms the rules never pick (`ns:key`, summed up by the caller), and
 * `incomplete`: the errors that only lag behind English (and Hebrew), which D120 lets a translated language have
 * every day (see the top of this file).
 */
export function checkLanguage({ lang, dict, en, he, plural, release = false, devTranslated = false }) {
  const errors = [];
  const warnings = [];
  const extraForms = [];
  const incomplete = [];
  /** An error that only lags behind the source languages: not translated yet, or dropped there. */
  const lags = (error) => {
    errors.push(error);
    incomplete.push(error);
  };
  const isReference = lang === REFERENCE;
  const source = SOURCE_LANGUAGES.includes(lang);
  const translated = !source && !PSEUDO_LANGUAGES.includes(lang);
  const rtl = RTL_LANGUAGES.includes(lang);
  const arabic = lang === 'ar' || lang === 'ar-XB';
  const excused = (ns, key = null) => !source && !devTranslated && isDevOnly(ns, key);
  const covered = numbersPerForm(plural);

  for (const ns of Object.keys(en)) {
    if (!dict[ns] && !excused(ns)) lags(`${lang}/${ns}.json: missing (en/${ns}.json has it)`);
  }
  for (const ns of Object.keys(dict)) {
    if (!en[ns]) lags(`${lang}/${ns}.json: there is no en/${ns}.json`);
  }

  for (const ns of Object.keys(dict).filter((n) => en[n])) {
    const here = dict[ns];
    const ref = en[ns];
    const where = `${lang}/${ns}.json`;
    const refBases = pluralBases(ref.keys());
    const hereBases = pluralBases(here.keys());
    const baseOf = (key) => {
      const m = key.match(PLURAL_SUFFIX);
      return m && refBases.has(key.slice(0, -m[0].length)) ? [key.slice(0, -m[0].length), m[1]] : null;
    };

    // Values.
    for (const [key, value] of here) {
      if (typeof value !== 'string') errors.push(`${where}: "${key}" is not a string`);
      else if (!/\S/.test(value) && !BLANK_OK.test(key)) errors.push(`${where}: "${key}" is empty`);
    }

    // Keys, by the plural's base.
    if (!isReference) {
      for (const key of ref.keys()) {
        if (PLURAL_SUFFIX.test(key) || here.has(key) || excused(ns, key)) continue;
        lags(`${where}: "${key}" is missing (en/${ns}.json has it)`);
      }
      for (const key of here.keys()) {
        if (!ref.has(key) && !baseOf(key)) lags(`${where}: "${key}" is not in en/${ns}.json`);
      }
    }
    for (const [base, refForms] of isReference ? hereBases : refBases) {
      const forms = hereBases.get(base) ?? new Set();
      if (forms.size === 0 && excused(ns, base)) continue;
      const needed = [...plural.categories, ...(refForms.has('zero') ? ['zero'] : [])];
      for (const form of needed) {
        if (!forms.has(form)) lags(`${where}: plural "${base}" has no "_${form}" form`);
      }
      for (const form of forms) {
        if (!plural.categories.includes(form) && form !== 'zero') extraForms.push(`${ns}:${base}_${form}`);
      }
    }

    for (const [key, value] of here) {
      if (typeof value !== 'string') continue;
      const pluralKey = baseOf(key);
      const english = ref.get(key) ?? (pluralKey ? ref.get(`${pluralKey[0]}_other`) : undefined);

      // Placeholders, $t() references and tags: as English's.
      if (!isReference) {
        for (const [what, read] of EXTRACTORS) {
          const got = read(value);
          if (!pluralKey) {
            if (typeof english !== 'string') continue;
            const want = read(english);
            if (got.join('\u0000') !== want.join('\u0000'))
              errors.push(
                `${where}: "${key}" has different ${what}: en [${want.join(', ')}], ${lang} [${got.join(', ')}]`,
              );
            continue;
          }
          const [base, form] = pluralKey;
          const englishForms = [...refBases.get(base)].map((f) => ref.get(`${base}_${f}`));
          const allowed = new Set(englishForms.filter((s) => typeof s === 'string').flatMap(read));
          const other = read(typeof ref.get(`${base}_other`) === 'string' ? ref.get(`${base}_other`) : '');
          const one = read(typeof ref.get(`${base}_one`) === 'string' ? ref.get(`${base}_one`) : '');
          // What stands for the number: in English's "other" and not in its "one" (and {{count}} itself).
          const numeric = new Set([
            ...other.filter((x) => !one.includes(x)),
            ...(what === 'placeholders' ? ['count'] : []),
          ]);
          const severalNumbers = (covered.get(form) ?? 0) > 1;
          const required = severalNumbers ? other : other.filter((x) => !numeric.has(x));
          const missing = [...new Set(required.filter((x) => !got.includes(x)))];
          const unknown = [...new Set(got.filter((x) => !allowed.has(x)))];
          if (missing.length || unknown.length) {
            errors.push(
              `${where}: "${key}" has different ${what} from English's forms:` +
                (missing.length ? ` missing [${missing.join(', ')}]` : '') +
                (unknown.length ? ` not in English [${unknown.join(', ')}]` : '') +
                (missing.length && severalNumbers ? ` (the "${form}" form covers several numbers)` : ''),
            );
          }
        }
      }
      for (const nested of nestingOf(value)) {
        if (!refExists(dict, ns, nested) && !refExists(en, ns, nested))
          errors.push(`${where}: "${key}" nests $t(${nested}), which doesn't exist`);
      }

      // Bidi, by the language's direction (not against English, which has none).
      const isolation = isolateProblem(value);
      if (isolation) errors.push(`${where}: "${key}": ${isolation}`);
      if (EMBEDDING.test(value))
        warnings.push(
          `${where}: "${key}" has an embedding or override (U+202A–U+202E): use isolates (LRI…PDI)`,
        );
      if (!rtl && ANY_BIDI.test(value)) {
        warnings.push(
          `${where}: "${key}" has bidi controls, which a left-to-right language doesn't need (from Hebrew?)`,
        );
      }
      if (arabic) {
        const hebrew = he?.[ns]?.get(key) ?? (pluralKey ? he?.[ns]?.get(`${pluralKey[0]}_other`) : undefined);
        if (typeof hebrew === 'string') {
          const heIsolates = count(hebrew, ISOLATE);
          const heMarks = count(hebrew, MARK);
          const isolates = count(value, ISOLATE);
          const marks = count(value, MARK);
          if (isolates < heIsolates || (heMarks > 0 && marks === 0 && isolates <= heIsolates)) {
            lags(
              `${where}: "${key}" isolates less than Hebrew does (he: ${heIsolates} isolate(s), ${heMarks} mark(s); ` +
                `${lang}: ${isolates}, ${marks}): wrap numbers, ranges and Latin text in LRI…PDI as Hebrew does`,
            );
          }
        }
        const outside = outsideIsolates(value);
        if (/\d\s*[–—-]\s*\d/.test(outside))
          warnings.push(
            `${where}: "${key}" has a range of numbers that isn't isolated (LRI…PDI): it shows reversed`,
          );
        if (/(?:^|[^‎\p{L}\p{N}])[+−-]\d/u.test(outside))
          warnings.push(
            `${where}: "${key}" has a signed number that isn't isolated (LRI…PDI, or LRM before it)`,
          );
        if (/\p{Script=Arabic}/u.test(outside) && /[A-Za-z]/.test(outside))
          warnings.push(`${where}: "${key}" has Latin text inside Arabic that isn't isolated (LRI…PDI)`);
      }

      // What a translation lost or kept from English.
      if (isReference || typeof english !== 'string') continue;
      for (const [edge, re, fullWidth] of [
        ['start', /^\s/, FULL_WIDTH_OPEN],
        ['end', /\s$/, FULL_WIDTH_CLOSE],
      ]) {
        if (re.test(english) && !re.test(value) && !fullWidth.test(value) && !BLANK_OK.test(key))
          warnings.push(
            `${where}: "${key}" lost the space at the ${edge} that English has (${JSON.stringify(english)})`,
          );
      }
      if (!translated) continue;
      if (
        value === english &&
        /\p{L}/u.test(ownWords(value)) &&
        !SAME_AS_ENGLISH_OK[lang]?.[`${ns}:${key}`]
      ) {
        (release ? errors : warnings).push(
          `${where}: "${key}" is the same as English (${JSON.stringify(value)})` +
            (release ? '' : ': translate it, or add it to SAME_AS_ENGLISH_OK with the reason'),
        );
      }
      if (NON_LATIN_LANGUAGES.includes(lang) && /[A-Za-z]/.test(ownWords(value)))
        warnings.push(`${where}: "${key}" has Latin letters (${JSON.stringify(value)})`);
      if (lang === 'fr') {
        const text = visibleText(value, '0');
        const missing = [...text.matchAll(/[!?:;]/g)].filter(({ index: i }) => {
          const before = text[i - 1];
          const after = text[i + 1] ?? '';
          if (i === 0 || before === ' ' || before === ' ' || /[!?]/.test(before)) return false;
          return !(text[i] === ':' && /\d/.test(before) && /\d/.test(after));
        });
        if (missing.length)
          warnings.push(
            `${where}: "${key}" needs a no-break space (U+00A0) before ${[...new Set(missing.map((m) => m[0]))].join(' ')}`,
          );
      }
      if (lang === 'es' && count(value, /\?/g) > count(value, /¿/g))
        warnings.push(`${where}: "${key}" asks a question without opening it with ¿`);
    }
  }
  return { errors, warnings, extraForms, incomplete };
}

/** One line for the forms a language's rules never pick: "_two ×62, _many ×60 (e.g. game:x_two)". */
export function extraFormsSummary(lang, extraForms) {
  const byForm = new Map();
  for (const key of extraForms) {
    const form = key.match(PLURAL_SUFFIX)[1];
    byForm.set(form, (byForm.get(form) ?? 0) + 1);
  }
  const forms = [...byForm].map(([form, n]) => `_${form} ×${n}`).join(', ');
  return `${lang}: ${extraForms.length} plural form(s) its rules never pick, kept (${forms}; e.g. ${extraForms[0]})`;
}
