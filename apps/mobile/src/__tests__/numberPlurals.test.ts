import i18next from 'i18next';

import { pluralCategory } from '../services/pluralRules';
import { takeAwayHermesMissingGlobals } from '../testing/hermesGlobals';
import { APP_LOCALES, readLocales } from '../testing/localeFiles';
import FIXTURE from './__fixtures__/numberPlurals.json';

/**
 * Localization plan 0ה, "strings with a number that are not plurals" (the source document: every string with a
 * number, points, wins, minutes, players, must be a plural resource; rule 21 of scripts/i18n-check.mjs keeps it
 * so). Each string with a counted number became a plural, and a sentence with two such numbers nests one plural
 * per number ($t(ns:key, {"count": {{x}} })). This proves the wording didn't change: in Hebrew and English, for
 * every number whose plural form is not "one", each string shows exactly what it showed before (the values before
 * the change are in __fixtures__/numberPlurals.json, rendered by the same i18next, as on the phone: with the app's
 * own plural rules). What differs is listed there ("changes") and checked here, all of it deliberate: the singular
 * for 1, "1 point" for "1 points" and "שנייה אחת" for "1 שניות". Where the number may be a fraction (points),
 * Hebrew 0.5 stays plural ("0.5 נקודות", as the phone always showed it: services/pluralRules.ts keeps Hebrew's
 * "one" for 1 only), and Hebrew's "two" forms are the plural, unchanged.
 */

type Lang = 'en' | 'he';
interface KeySpec {
  /** The values before the change, by their flat key in the namespace. */
  before: Record<Lang, Record<string, string>>;
  /** The placeholder that shows the one number (also the plural's count), and how ("0–{n}"). */
  shows?: string;
  as?: string;
  /** A sentence with two numbers: placeholder → n or m. */
  numbers?: Record<string, 'n' | 'm'>;
  /** The number may be a fraction (true), or which of the two may. */
  fractional?: true | 'n' | 'm';
  /** The key itself, when the id is a context form (player:lead.label_female). */
  key?: string;
  context?: string;
}
const KEYS = FIXTURE.keys as Record<string, KeySpec>;
const CHANGES = FIXTURE.changes as Record<string, string>;
const LANGS: Lang[] = ['en', 'he'];

const COUNTS = [0, 1, 2, 3, 5, 11, 21, 100, 1000];
const FRACTIONS = [0.5, 1.5, 2.5];
const GRID = [0, 1, 2, 5, 21];

/** A flat namespace as a tree, as the JSON files have it. */
function unflatten(flat: Record<string, string>): object {
  const tree: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = tree;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts[parts.length - 1]!] = value;
  }
  return tree;
}

function instance(resources: Record<string, Record<string, object>>) {
  const i18n = i18next.createInstance();
  void i18n.init({
    resources,
    lng: 'en',
    fallbackLng: false,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return i18n;
}

/** Before: only the converted keys, with their old values. Now: the app's files. */
const before = instance(
  Object.fromEntries(
    LANGS.map((lang) => {
      const namespaces: Record<string, Record<string, string>> = {};
      for (const [id, spec] of Object.entries(KEYS))
        Object.assign((namespaces[id.split(':')[0]!] ??= {}), spec.before[lang]);
      return [
        lang,
        Object.fromEntries(Object.entries(namespaces).map(([ns, flat]) => [ns, unflatten(flat)])),
      ];
    }),
  ),
);
const locales = readLocales(APP_LOCALES);
const now = instance({ en: locales.en!, he: locales.he! });

const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]!);

/** A case of a key: its numbers, and the options a call passes (other placeholders as <name>). */
interface Case {
  label: string;
  numbers: number[];
  values: Record<string, string | number>;
}

function casesOf(spec: KeySpec): Case[] {
  const all = LANGS.flatMap((lang) => Object.values(spec.before[lang])).join(' ');
  const tokens: Record<string, string | number> = Object.fromEntries(
    placeholders(all).map((p) => [p, `<${p}>`]),
  );
  if (spec.numbers) {
    const grid = (which: 'n' | 'm') => (spec.fractional === which ? [...GRID, 0.5] : GRID);
    return grid('n').flatMap((n) =>
      grid('m').map((m) => {
        const values = { ...tokens };
        for (const [p, which] of Object.entries(spec.numbers!)) values[p] = which === 'n' ? n : m;
        return { label: `${n},${m}`, numbers: [n, m], values };
      }),
    );
  }
  return (spec.fractional ? [...COUNTS, ...FRACTIONS] : COUNTS).map((n) => ({
    label: String(n),
    numbers: [n],
    values: {
      ...tokens,
      [spec.shows!]: (spec.as ?? '{n}').replace('{n}', String(n)),
      count: n,
      ...(spec.context ? { context: spec.context } : {}),
    },
  }));
}

/**
 * Every key and case in both languages: before, now, and whether a number takes the "one" form. Rendered as on
 * the phone: with the app's own plural rules (Node's taken away: testing/hermesGlobals.ts), which keep Hebrew 0.5
 * plural where CLDR (Node) has it singular.
 */
const onPhone = takeAwayHermesMissingGlobals();
const RESULTS = Object.entries(KEYS).flatMap(([id, spec]) => {
  const [ns, key] = (spec.key ?? id).split(':') as [string, string];
  return LANGS.flatMap((lang) =>
    casesOf(spec).map(({ label, numbers, values }) => ({
      id: `${lang} ${id} ${label}`,
      was: before.getFixedT(lang, ns)(key, values),
      is: now.getFixedT(lang, ns)(key, values),
      one: numbers.some((n) => pluralCategory(lang, n) === 'one'),
    })),
  );
});
onPhone.restore();

describe('strings with a number, as plurals (plan 0ה, rule 21)', () => {
  it('covers every converted key, in Hebrew and English', () => {
    expect(Object.keys(KEYS).length).toBeGreaterThanOrEqual(76);
    for (const [id, spec] of Object.entries(KEYS)) {
      expect({ id, he: Object.keys(spec.before.he).length > 0 }).toEqual({ id, he: true });
      expect({ id, en: Object.keys(spec.before.en).length > 0 }).toEqual({ id, en: true });
      expect({ id, plan: Boolean(spec.shows ?? spec.numbers) }).toEqual({ id, plan: true });
    }
  });

  it('every key now is a plural, or nests one for each number', () => {
    for (const [id, spec] of Object.entries(KEYS)) {
      const [ns, key] = (spec.key ?? id).split(':') as [string, string];
      for (const lang of LANGS) {
        const resource = now.getResource(lang, ns, `${key}${spec.context ? `_${spec.context}` : ''}_other`);
        const nests = now.getResource(lang, ns, key);
        expect({ id, lang, plural: typeof resource === 'string' || /\$t\(/.test(String(nests)) }).toEqual({
          id,
          lang,
          plural: true,
        });
      }
    }
  });

  it('shows exactly what it showed before, for every number that takes no "one" form', () => {
    const changed = RESULTS.filter((r) => !r.one && r.is !== r.was);
    expect(changed.map((r) => `${r.id}: "${r.is}", was "${r.was}"`)).toEqual([]);
  });

  it('nothing is left unrendered: no {{placeholder}}, no $t(…), no key instead of its words', () => {
    const broken = RESULTS.filter((r) => /{{|\$t\(|^[\w.]+$/.test(r.is));
    expect(broken.map((r) => `${r.id}: "${r.is}"`)).toEqual([]);
  });

  it('lists every deliberate change: the singular forms, for 1 only', () => {
    const changes = Object.fromEntries(
      RESULTS.filter((r) => r.one && r.is !== r.was).map((r) => [r.id, r.is]),
    );
    expect(changes).toEqual(CHANGES);
  });

  it('some of the changes, spelled out', () => {
    expect(CHANGES['en game:results.scoreLabel 1']).toBe('Final score: 1 point');
    expect(CHANGES['he game:results.scoreLabel 1']).toBe('ניקוד סופי: 1 נקודה');
    expect(CHANGES['he account:splash.tips.lock 1']).toBe('משבצת שבחרת ננעלת רק לך: שנייה אחת במשחק <type>.');
    expect(CHANGES['he levels:hud.box.mistakesLabel 2,1']).toBe('2 טעויות, נוספה שנייה אחת');
    expect(CHANGES['en levels:hud.hunt.goal 5,1']).toBe('Score 5 points in 1 move.');
    // An abbreviation stays (נק׳): Hebrew's tip doesn't change for one, only English's noun does.
    expect(CHANGES['en game:connection.connecting.tips.lastCell 1']).toContain('just 1 point:');
    expect(CHANGES['he game:connection.connecting.tips.lastCell 1']).toBeUndefined();
    // Hebrew 0.5 points: plural, as before (CLDR's singular, "0.5 נקודה", is not what the phone shows).
    expect(CHANGES['he game:results.scoreLabel 0.5']).toBeUndefined();
    expect(CHANGES['he game:arsenal.costLabelShort 1,0.5']).toBe(
      'מחיר ההפרעה נקודה אחת. הניקוד שלך <score>, חסרות 0.5 נקודות',
    );
  });
});
