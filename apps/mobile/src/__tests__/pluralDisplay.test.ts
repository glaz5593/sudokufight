import i18next, { type TFunction } from 'i18next';

import { pluralBases, placeholdersOf } from '../../../../scripts/lib/i18n-locales.mjs';
import { ENABLED_LANGUAGES } from '../i18n/languages';
import { pluralCategory, PluralRules } from '../services/pluralRules';
import { takeAwayHermesMissingGlobals } from '../testing/hermesGlobals';
import {
  APP_LOCALES,
  dailyLocales,
  dictionaries,
  type LocaleTrees,
  readLocales,
  SAMPLE_LOCALES,
} from '../testing/localeFiles';

/**
 * Localization plan 0ג and 6.1 #3: every plural key, in every language, with 0, 1, 2, 5, 11, 21, 100, 0.5, 1.5 and
 * a million, shows the form its language's rules pick, from its own file (never another form; English's only
 * where the language has no translation yet, as i18next falls back: D120), twice: on Node (its own
 * Intl.PluralRules, CLDR), and as on the phone (Hermes: Node's taken away, the app's own in its place:
 * testing/hermesGlobals.ts). The two say the same but for Hebrew 0.5, where the app keeps the plural on purpose
 * (services/pluralRules.ts). And against the phone until 1.0.4, which had no PluralRules (i18next fell back to
 * one/other), Hebrew and English show exactly what they showed then, but for Hebrew's "two" (the 7 keys where it
 * differs, listed below): the only plural change plan §2 allows.
 * The languages: the app's daily ones (Hebrew, English and the enabled: testing/localeFiles.ts), and the
 * Arabic, Russian and Japanese samples.
 */

const COUNTS = [0, 1, 2, 5, 11, 21, 100, 0.5, 1.5, 1_000_000];

/** Which plural form a count takes in a language: the app's own rules, or another engine's. */
type Category = (lang: string, count: number) => string;

/** The app's daily languages, plus the samples' namespace for every sample language. */
function languages(): LocaleTrees {
  const trees: LocaleTrees = dailyLocales(readLocales(APP_LOCALES));
  for (const [lang, namespaces] of Object.entries(readLocales(SAMPLE_LOCALES))) {
    trees[lang] = { ...trees[lang], ...namespaces };
  }
  return trees;
}

const trees = languages();
const flat = dictionaries(trees);

/** Every plural base of every language: [lang, ns, base, its forms]. */
const PLURALS = Object.entries(flat).flatMap(([lang, dict]) =>
  Object.entries(dict).flatMap(([ns, keys]) =>
    [...pluralBases(keys.keys())].map(([base, forms]) => ({ lang, ns, base, forms })),
  ),
);

/** $t(ns:key, {"count": {{x}} }) in a value: a nested plural (rule 21, a sentence with a second number). */
const NESTED = /\$t\(\s*([^,)\s]+)\s*,[^)]*\)/g;

/**
 * A value for every placeholder of a key's forms (count aside): <name>, and the number itself for one a nested
 * plural takes as its count (its value goes into JSON), so the nested plural shows the same count's form.
 */
function variables(lang: string, ns: string, base: string, count: number): Record<string, string | number> {
  const keys = flat[lang]![ns]!;
  const values = [...keys].filter(([key]) => key.startsWith(`${base}_`)).map(([, value]) => value);
  const names = values.flatMap((value) => (typeof value === 'string' ? placeholdersOf(value) : []));
  const nestedCounts = values.flatMap((value) =>
    typeof value === 'string'
      ? [...value.matchAll(/["']count["']\s*:\s*{{\s*(\w+)\s*}}/g)].map((m) => m[1]!)
      : [],
  );
  return Object.fromEntries(
    names.filter((n) => n !== 'count').map((n) => [n, nestedCounts.includes(n) ? count : `<${n}>`]),
  );
}

/**
 * What i18next must show: the form the language's rules pick (key_zero for 0, where there is one), with a nested
 * plural's own form for the same count. A form the language doesn't have yet shows English's (i18next's fallback:
 * an enabled language may lag behind Hebrew and English until its translation pass, D120).
 */
function expected(
  lang: string,
  ns: string,
  base: string,
  count: number,
  category: Category = pluralCategory,
): string {
  const keys = flat[lang]?.[ns] ?? new Map<string, unknown>();
  const form = count === 0 && keys.has(`${base}_zero`) ? 'zero' : category(lang, count);
  const value = keys.get(`${base}_${form}`);
  if (typeof value !== 'string') {
    if (lang !== 'en') return expected('en', ns, base, count, category);
    return `(no "${base}_${form}" in ${lang}/${ns}.json)`;
  }
  return value
    .replace(NESTED, (_, ref: string) => {
      const [refNs, refKey] = ref.includes(':') ? ref.split(':') : [ns, ref];
      return expected(lang, refNs!, refKey!, count, category);
    })
    .replace(/{{\s*([\w.]+)\s*}}/g, (_, name: string) => (name === 'count' ? String(count) : `<${name}>`));
}

/** Every plural, every count, through a fresh i18next (its plural rules are read from Intl when first needed). */
function render(): Map<string, string> {
  const instance = i18next.createInstance();
  void instance.init({
    resources: trees,
    ns: [...new Set(Object.values(trees).flatMap((t) => Object.keys(t)))],
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  const shown = new Map<string, string>();
  for (const { lang, ns, base } of PLURALS) {
    const t: TFunction = instance.getFixedT(lang, ns);
    for (const count of COUNTS)
      shown.set(`${lang} ${ns}:${base} ${count}`, t(base, { ...variables(lang, ns, base, count), count }));
  }
  return shown;
}

function asOnThePhone<T>(run: () => T, options?: { appPluralRules: boolean }): T {
  const onHermes = takeAwayHermesMissingGlobals(options);
  try {
    return run();
  } finally {
    onHermes.restore();
  }
}

const NodePluralRules = Intl.PluralRules;
const nodeCategory: Category = (lang, count) => new NodePluralRules(lang).select(count);

/** The plurals whose shown text is not the expected one under `category`. */
const wrongIn = (shown: Map<string, string>, category: Category) =>
  PLURALS.flatMap(({ lang, ns, base }) =>
    COUNTS.map(
      (count) => [`${lang} ${ns}:${base} ${count}`, expected(lang, ns, base, count, category)] as const,
    ).filter(([id, want]) => shown.get(id) !== want),
  ).map(([id, want]) => `${id}: "${shown.get(id)}", expected "${want}"`);

describe('plurals as they show', () => {
  const onNode = render();
  const onPhone = asOnThePhone(render);
  // The phone until 1.0.4: no PluralRules at all.
  const onOldPhone = asOnThePhone(render, { appPluralRules: false });

  it('covers every enabled language (all 19 since 1.1.0) and the Arabic, Russian and Japanese samples', () => {
    expect(ENABLED_LANGUAGES).toHaveLength(19);
    expect([...new Set(PLURALS.map((p) => p.lang))].sort()).toEqual(
      [...new Set([...ENABLED_LANGUAGES, 'ar', 'ru', 'ja'])].sort(),
    );
  });

  it('on Node: every plural shows the form CLDR picks', () => {
    expect(wrongIn(onNode, nodeCategory)).toEqual([]);
  });

  it('as on the phone (Hermes, with the app’s own PluralRules): every plural shows the form they pick', () => {
    expect(Intl.PluralRules).toBe(NodePluralRules);
    expect(wrongIn(onPhone, pluralCategory)).toEqual([]);
  });

  it('the phone and Node differ only in Hebrew 0.5, which the app keeps plural (CLDR: singular)', () => {
    const different = [...onNode].filter(([id, text]) => onPhone.get(id) !== text).map(([id]) => id);
    expect(different.length).toBeGreaterThan(0);
    expect(different.filter((id) => !/^he \S+ 0\.5$/.test(id))).toEqual([]);
    // The case that made it so: a 0.5 lead, which CLDR's "one" reads as a lead of one point.
    expect(onNode.get('he game:live.leadMine 0.5')).toBe(flat.he!.game!.get('live.leadMine_one'));
    expect(onPhone.get('he game:live.leadMine 0.5')).toBe(
      String(flat.he!.game!.get('live.leadMine_other'))
        .replace('{{count}}', '0.5')
        .replace('{{gap}}', '<gap>'),
    );
  });

  it('Hebrew and English show what the phone showed until 1.0.4 (no PluralRules), but Hebrew’s "two"', () => {
    // Every count (0.5 too, plan §2): the app's own files, not the samples.
    const changed = [...onOldPhone]
      .filter(([id, text]) => /^(he|en) /.test(id) && !id.includes(' sample:') && onPhone.get(id) !== text)
      .map(([id]) => id);
    // The 7 keys below with a "two" of their own, but game:hit.seconds, whose "two" reads as its plural at 2.
    expect(changed.sort()).toEqual(
      [
        'game:live.leadMine',
        'game:live.leadTheirs',
        'levels:hud.puzzle.fixed',
        'levels:hud.puzzle.moving',
        'moderation:report.errors.rateLimited',
        'player:mistakes.long',
      ].map((key) => `he ${key} 2`),
    );
  });

  it('as on the phone: Arabic 3 is "few", Japanese 1 is "other", Hebrew 2 is "two"', () => {
    asOnThePhone(() => {
      expect(Intl.PluralRules).toBe(PluralRules);
      const t = (lang: string) => {
        const instance = i18next.createInstance();
        void instance.init({ resources: trees, ns: ['sample', 'game'], lng: lang, fallbackLng: 'en' });
        return instance.getFixedT(lang);
      };
      expect(t('ar')('sample:points', { count: 3 })).toBe('3 نقاط');
      expect(flat.ar!.sample!.get('points_few')).toBe('{{count}} نقاط');
      expect(t('ja')('sample:points', { count: 1 })).toBe('1ポイント');
      expect(t('he')('sample:points', { count: 2 })).toBe(flat.he!.sample!.get('points_two'));
      expect(t('he')('player:mistakes.long', { count: 2 })).toBe(flat.he!.player!.get('mistakes.long_two'));
    });
  });

  // The phone before the app had its own PluralRules: i18next fell back to one/other.
  it('without the app’s own PluralRules, Hebrew 2 showed the plural, not "two" (the bug it fixes)', () => {
    asOnThePhone(
      () => {
        expect(Intl.PluralRules).toBeUndefined();
        const instance = i18next.createInstance();
        void instance.init({ resources: trees, ns: ['player'], lng: 'he', fallbackLng: 'en' });
        expect(instance.getFixedT('he')('player:mistakes.long', { count: 2 })).toBe(
          String(flat.he!.player!.get('mistakes.long_other')).replace('{{count}}', '2'),
        );
      },
      { appPluralRules: false },
    );
  });

  // The 7 Hebrew keys whose "two" differs from the plural: these now show on the phone (an allowed change).
  it('lists the Hebrew keys whose "two" form the phone shows now', () => {
    const differ = PLURALS.filter(({ lang, ns }) => lang === 'he' && ns !== 'sample').flatMap(
      ({ ns, base }) => {
        const keys = flat.he![ns]!;
        return keys.get(`${base}_two`) !== keys.get(`${base}_other`) ? [`${ns}:${base}`] : [];
      },
    );
    expect(differ.sort()).toEqual([
      'game:hit.seconds',
      'game:live.leadMine',
      'game:live.leadTheirs',
      'levels:hud.puzzle.fixed',
      'levels:hud.puzzle.moving',
      'moderation:report.errors.rateLimited',
      'player:mistakes.long',
    ]);
  });
});
