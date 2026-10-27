/* eslint-disable @typescript-eslint/no-require-imports -- hermesPolyfills.ts is loaded fresh, for its side effect */
import {
  installPluralRules,
  pluralCategories,
  pluralCategory,
  PluralRules,
  type PluralCategory,
} from '../pluralRules';

/**
 * Localization plan 0ג and 6.1 #4 (D123): our own Intl.PluralRules gives exactly what Node's (ICU 78, CLDR 48)
 * gives, in the 19 languages and the two pseudo-languages: every whole number 0 to 1000, the halves, their
 * negatives, decimals that round at the 4th digit, millions and huge numbers; but Hebrew 0.x, "other" on purpose
 * (plan §2: Hebrew stays as the phone showed it, but for the "two" form). And services/hermesPolyfills.ts installs
 * it always, over the engine's own.
 */

const NodePluralRules = Intl.PluralRules;

const LANGUAGES = [
  'he',
  'en',
  'ar',
  'es',
  'pt-BR',
  'de',
  'fr',
  'ja',
  'ru',
  'ko',
  'it',
  'tr',
  'zh-Hans',
  'id',
  'pl',
  'zh-Hant',
  'vi',
  'th',
  'nl',
] as const;
const PSEUDO = ['ar-XB', 'en-XA'] as const;
/** Other spellings the phone or i18next may hand over: Android's old codes, plain zh/pt, regions. */
const ALIASES = ['iw', 'in', 'pt', 'zh', 'zh-TW', 'es-419', 'he-IL', 'ar-SA'] as const;

function numbers(): number[] {
  const list: number[] = [];
  for (let n = 0; n <= 1000; n++) list.push(n, n + 0.5);
  // Decimals with 1-4 fraction digits (the 4th rounds: 1.0005 is 1.001, 0.9995 is 1, 1.0004999 is 1).
  for (const d of [0.1, 0.25, 0.125, 0.0005, 0.0004999, 0.9995, 0.999, 0.001, 0.01]) {
    for (const i of [0, 1, 2, 3, 5, 11, 21, 22, 100, 101, 111]) list.push(i + d);
  }
  list.push(39.5, 1e-7, 5e-324, 0.0001, 0.00049, 0.0005);
  // Millions ("many" in es, fr, it, pt), and numbers far past 2^53 and 1e21 (written with an exponent).
  list.push(1e6, 2e6, 1e6 + 1, 1e6 + 0.5, 1e7, 1.5e6, 999999, 1000001, 21e6, 1e9, 2 ** 53, 2 ** 53 + 2);
  list.push(1e21, 1.5e21, 2.5e22, 1e100, 123456789012345680000, 1.7976931348623157e308);
  return [...list, ...list.map((n) => -n), -0];
}

const NUMBERS = numbers();

/** Hebrew (and Android's iw): the one place our rules differ from CLDR, on purpose (see the next test). */
const isHebrew = (lang: string) => /^(he|iw)\b/.test(lang);

/**
 * CLDR's Hebrew "one" covers 0.x too (i = 0 and v != 0); ours is exactly 1, as the phone always showed it (no
 * PluralRules until 1.0.4: i18next's fallback picks "one" for 1 only), so a 0.5 lead is not "בנקודה אחת".
 */
const hebrewFraction = (lang: string, n: number, node: string, ours: string) =>
  isHebrew(lang) && node === 'one' && ours === 'other' && Math.abs(n) > 0 && Math.abs(n) < 1;

describe('PluralRules: the same as Node', () => {
  it.each([...LANGUAGES, ...PSEUDO, ...ALIASES])('%s: every number', (lang) => {
    const node = new NodePluralRules(lang);
    const ours = new PluralRules(lang);
    const different = NUMBERS.filter(
      (n) => ours.select(n) !== node.select(n) && !hebrewFraction(lang, n, node.select(n), ours.select(n)),
    ).map((n) => `${n}: ${ours.select(n)} (Node: ${node.select(n)})`);
    expect(different).toEqual([]);
  });

  it.each(['he', 'iw', 'he-IL'])('%s 0.x: "other", where CLDR says "one" (the one difference)', (lang) => {
    for (const n of [0.5, 0.1, 0.25, 0.999, -0.5]) {
      expect({ n, ours: new PluralRules(lang).select(n) }).toEqual({ n, ours: 'other' });
      expect({ n, node: new NodePluralRules(lang).select(n) }).toEqual({ n, node: 'one' });
    }
    // Everything else as CLDR: exactly 1 is "one" (0.9995 rounds to 1), 2 "two", 0, 1.5 and 2.5 "other".
    const ours = new PluralRules(lang);
    expect([1, 0.9995, 2, 0, 1.5, 2.5, 0.0004].map((n) => ours.select(n))).toEqual([
      'one',
      'one',
      'two',
      'other',
      'other',
      'other',
      'other',
    ]);
    const differ = NUMBERS.filter((n) => ours.select(n) !== new NodePluralRules(lang).select(n));
    expect(differ.length).toBeGreaterThan(0);
    expect(differ.filter((n) => !(Math.abs(n) > 0 && Math.abs(n) < 1))).toEqual([]);
  });

  it.each([...LANGUAGES, ...PSEUDO, ...ALIASES])('%s: the same forms and locale', (lang) => {
    const node = new NodePluralRules(lang).resolvedOptions();
    const ours = new PluralRules(lang).resolvedOptions();
    expect(ours).toEqual({ ...node });
    expect(pluralCategories(lang)).toEqual(node.pluralCategories);
  });

  it('NaN and ±Infinity are "other", as in Node', () => {
    for (const lang of LANGUAGES) {
      for (const n of [NaN, Infinity, -Infinity]) {
        expect({ lang, n, form: new PluralRules(lang).select(n) }).toEqual({
          lang,
          n,
          form: new NodePluralRules(lang).select(n),
        });
      }
    }
  });

  it('reads strings as numbers, as Intl does', () => {
    expect(new PluralRules('he').select('2' as unknown as number)).toBe('two');
  });

  it('reads a tag with an underscore (pt_BR) as its language, where Node throws', () => {
    expect(new PluralRules('pt_BR').resolvedOptions().locale).toBe('pt');
    expect(new PluralRules('zh_Hant').resolvedOptions().pluralCategories).toEqual(['other']);
  });

  it('takes the first known language of a list, and English for an unknown one', () => {
    expect(new PluralRules(['xx', 'ar']).resolvedOptions().locale).toBe('ar');
    expect(new PluralRules('xx').resolvedOptions()).toMatchObject({
      locale: 'en',
      pluralCategories: ['one', 'other'],
    });
    expect(new PluralRules().resolvedOptions().locale).toBe('en');
    expect(PluralRules.supportedLocalesOf(['he', 'xx', 'zh-Hant'])).toEqual(['he', 'zh-Hant']);
  });

  it('is cardinal only: ordinals throw a RangeError (i18next then falls back)', () => {
    expect(() => new PluralRules('en', { type: 'ordinal' })).toThrow(RangeError);
    expect(new PluralRules('en', { type: 'cardinal' }).select(1)).toBe('one');
  });
});

describe('pluralCategory', () => {
  // The cases the plan names (0ג, 6.1 #3), and one per form of the languages with many forms.
  it.each<[string, number, PluralCategory]>([
    ['ar', 3, 'few'],
    ['ar', 0, 'zero'],
    ['ar', 2, 'two'],
    ['ar', 11, 'many'],
    ['ar', 100, 'other'],
    ['ar', 1.5, 'other'],
    ['ja', 1, 'other'],
    ['he', 2, 'two'],
    ['he', 20, 'other'],
    ['he', 1.5, 'other'],
    ['ru', 21, 'one'],
    ['ru', 22, 'few'],
    ['ru', 25, 'many'],
    ['ru', 1.5, 'other'],
    ['pl', 1, 'one'],
    ['pl', 21, 'many'],
    ['pl', 22, 'few'],
    ['fr', 0, 'one'],
    ['fr', 1.5, 'one'],
    ['fr', 1e6, 'many'],
    ['pt-BR', 0, 'one'],
    ['es', 1e6, 'many'],
    ['es', 39.5, 'other'],
    ['en', -1, 'one'],
    ['ar-XB', 3, 'few'],
    ['en-XA', 1, 'one'],
  ])('%s %d → %s', (lang, n, form) => {
    expect(pluralCategory(lang, n)).toBe(form);
    expect(new NodePluralRules(lang).select(n)).toBe(form);
  });
});

describe('installPluralRules', () => {
  it('replaces the engine’s own PluralRules, always', () => {
    const target = { Intl: { PluralRules: NodePluralRules } };
    installPluralRules(target);
    expect(target.Intl.PluralRules).toBe(PluralRules);
  });

  it('creates Intl when the engine has none', () => {
    const target: { Intl?: { PluralRules?: unknown } } = {};
    installPluralRules(target);
    expect(target.Intl?.PluralRules).toBe(PluralRules);
  });

  it('never throws, even on a frozen Intl', () => {
    const target = { Intl: Object.freeze({ PluralRules: NodePluralRules }) };
    expect(() => installPluralRules(target)).not.toThrow();
  });
});

describe('services/hermesPolyfills.ts', () => {
  afterEach(() => {
    Object.defineProperty(Intl, 'PluralRules', {
      value: NodePluralRules,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  it('installs our PluralRules even where the engine has one (an older CLDR would answer differently)', () => {
    expect(Intl.PluralRules).toBe(NodePluralRules);
    let ours: unknown;
    jest.isolateModules(() => {
      require('../hermesPolyfills');
      ours = require('../pluralRules').PluralRules;
    });
    expect(Intl.PluralRules).toBe(ours);
  });

  it('installs it where the engine has none (Hermes on Android)', () => {
    delete (Intl as { PluralRules?: unknown }).PluralRules;
    jest.isolateModules(() => {
      require('../hermesPolyfills');
    });
    expect(new Intl.PluralRules('he').select(2)).toBe('two');
  });

  it('installs it first, before the other stand-ins', () => {
    const source = jest
      .requireActual<typeof import('node:fs')>('node:fs')
      .readFileSync(require.resolve('../hermesPolyfills'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const statements = code
      .split('\n')
      .filter((line) => /^\S/.test(line) && !/^(import|type|export \{)/.test(line));
    expect(statements[0]).toBe('installPluralRules();');
  });
});
