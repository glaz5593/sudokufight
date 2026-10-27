/**
 * Our own Intl.PluralRules (localization plan 0ג, D123): which plural form ("one", "two", "few"…) a number takes
 * in each of the app's languages, for i18next's key_one / key_two / key_few… Hermes on the phone has no
 * Intl.PluralRules (or, in another build, one with an older CLDR), and without it i18next falls back to
 * one/other: Hebrew never showed its "two" form, and Arabic, Russian and Polish would come out wrong. So
 * services/hermesPolyfills.ts installs this one first, and ALWAYS, over the engine's own: the phone then picks
 * exactly the forms the tests check. No imports and no side effects here (testing/hermesGlobals.ts imports it).
 *
 * The rules are CLDR 48's cardinal rules, what Node's ICU 78 gives, for the 19 languages (he, en, ar, es, pt-BR,
 * de, fr, ja, ru, ko, it, tr, zh-Hans, id, pl, zh-Hant, vi, th, nl) and the pseudo-languages (ar-XB takes
 * Arabic's rules, en-XA English's). services/__tests__/pluralRules.test.ts compares every one with Node: 0 to 1000,
 * the halves, negatives, more decimals and millions. One exception, on purpose: Hebrew 0.x is "other" here, as the
 * phone always showed it (see the Hebrew rule below).
 *
 * A number is read the way Intl (ICU) reads it: its shortest decimal form, rounded half away from zero to 3
 * fraction digits (Intl's default), trailing zeros dropped, the sign ignored. So 39.5 has a fraction, and 1.0005
 * is 1.001. Of CLDR's operands, the rules here need n (that value), i (its integer digits: like ICU, only the last
 * 18, which only matters past 10^18) and v (how many fraction digits are left). The exponent (e) is always 0
 * outside compact notation.
 *
 * A language that isn't here gets English's rules (D101: English is the fallback). A region or a script doesn't
 * change the rules: pt-PT gets Brazil's, as its texts are pt-BR (D105). Cardinal numbers only: i18next asks for
 * ordinals only with { ordinal: true }, which the app never passes.
 */

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** CLDR's operands of a number, as far as the rules here read them. */
interface Operands {
  /** The absolute value, after rounding. */
  n: number;
  /** The integer digits (the last 18 of them, as ICU keeps them). */
  i: number;
  /** i % 10, i % 100 and i % 1000000. */
  i10: number;
  i100: number;
  i1e6: number;
  /** How many fraction digits are visible: 0 for a whole number. */
  v: number;
}

interface RuleSet {
  /** In CLDR's order (zero, one, two, few, many, other), as Intl's resolvedOptions() lists them. */
  categories: readonly PluralCategory[];
  select(o: Operands): PluralCategory;
}

const between = (x: number, low: number, high: number) => x >= low && x <= high;

/** e = 0 and i != 0 and i % 1000000 = 0 and v = 0: a whole number of millions (es, fr, it, pt "many"). */
const millions = (o: Operands) => o.v === 0 && o.i !== 0 && o.i1e6 === 0;

/** i = 1 and v = 0 (en, de, nl, it, he). */
const exactlyOne = (o: Operands) => o.i === 1 && o.v === 0;

/** n % 100 in low..high: a whole value only (n = 103.5 is not "3..10"). */
const n100Between = (o: Operands, low: number, high: number) => {
  const n100 = o.n % 100;
  return Number.isInteger(n100) && between(n100, low, high);
};

const ONE_OTHER: RuleSet = {
  categories: ['one', 'other'],
  select: (o) => (exactlyOne(o) ? 'one' : 'other'),
};

/** n = 1 (tr; es's "one"). */
const N_ONE_OTHER: RuleSet = {
  categories: ['one', 'other'],
  select: (o) => (o.n === 1 ? 'one' : 'other'),
};

const OTHER_ONLY: RuleSet = { categories: ['other'], select: () => 'other' };

/** v = 0 and i % 10 = 2..4 and i % 100 != 12..14 (ru, pl "few"). */
const slavicFew = (o: Operands) => between(o.i10, 2, 4) && !between(o.i100, 12, 14);

const RULES = {
  en: ONE_OTHER,
  // CLDR 42 dropped Hebrew's "many" (20, 30…): the files keep their _many keys, which nothing picks any more.
  // The one deliberate difference from CLDR (and Node): "one" is exactly 1. CLDR also puts 0.x there (i = 0 and
  // v != 0), but the phone never showed it (until 1.0.4 it had no PluralRules: i18next's fallback picks "one" for 1
  // only), and plan §2 keeps Hebrew as it was but for the "two" form. With CLDR's rule a 0.5 lead would read
  // "אתה מוביל בנקודה אחת" (game:live.leadMine_one names no number) and 0.5 points "0.5 נקודה".
  he: {
    categories: ['one', 'two', 'other'],
    select: (o) => (exactlyOne(o) ? 'one' : o.i === 2 && o.v === 0 ? 'two' : 'other'),
  },
  // n = 0 / 1 / 2, n % 100 = 3..10, n % 100 = 11..99.
  ar: {
    categories: ['zero', 'one', 'two', 'few', 'many', 'other'],
    select: (o) => {
      if (o.n === 0) return 'zero';
      if (o.n === 1) return 'one';
      if (o.n === 2) return 'two';
      if (n100Between(o, 3, 10)) return 'few';
      return n100Between(o, 11, 99) ? 'many' : 'other';
    },
  },
  es: {
    categories: ['one', 'many', 'other'],
    select: (o) => (o.n === 1 ? 'one' : millions(o) ? 'many' : 'other'),
  },
  // i = 0..1: 0, 0.5 and 1.5 are "one" too.
  pt: {
    categories: ['one', 'many', 'other'],
    select: (o) => (o.i <= 1 ? 'one' : millions(o) ? 'many' : 'other'),
  },
  // i = 0,1: as Portuguese.
  fr: {
    categories: ['one', 'many', 'other'],
    select: (o) => (o.i <= 1 ? 'one' : millions(o) ? 'many' : 'other'),
  },
  it: {
    categories: ['one', 'many', 'other'],
    select: (o) => (exactlyOne(o) ? 'one' : millions(o) ? 'many' : 'other'),
  },
  ru: {
    categories: ['one', 'few', 'many', 'other'],
    select: (o) => {
      if (o.v !== 0) return 'other';
      if (o.i10 === 1 && o.i100 !== 11) return 'one';
      return slavicFew(o) ? 'few' : 'many';
    },
  },
  pl: {
    categories: ['one', 'few', 'many', 'other'],
    select: (o) => {
      if (o.v !== 0) return 'other';
      if (o.i === 1) return 'one';
      return slavicFew(o) ? 'few' : 'many';
    },
  },
} satisfies Record<string, RuleSet>;

/** A language subtag → the locale Intl resolves it to, and its rules. iw and in are Android's old codes. */
const LANGUAGES: Record<string, { locale: string; rules: RuleSet }> = {
  he: { locale: 'he', rules: RULES.he },
  iw: { locale: 'he', rules: RULES.he },
  en: { locale: 'en', rules: RULES.en },
  ar: { locale: 'ar', rules: RULES.ar },
  es: { locale: 'es', rules: RULES.es },
  pt: { locale: 'pt', rules: RULES.pt },
  de: { locale: 'de', rules: ONE_OTHER },
  fr: { locale: 'fr', rules: RULES.fr },
  ja: { locale: 'ja', rules: OTHER_ONLY },
  ru: { locale: 'ru', rules: RULES.ru },
  ko: { locale: 'ko', rules: OTHER_ONLY },
  it: { locale: 'it', rules: RULES.it },
  tr: { locale: 'tr', rules: N_ONE_OTHER },
  zh: { locale: 'zh', rules: OTHER_ONLY },
  id: { locale: 'id', rules: OTHER_ONLY },
  in: { locale: 'id', rules: OTHER_ONLY },
  pl: { locale: 'pl', rules: RULES.pl },
  vi: { locale: 'vi', rules: OTHER_ONLY },
  th: { locale: 'th', rules: OTHER_ONLY },
  nl: { locale: 'nl', rules: ONE_OTHER },
};

const FALLBACK = LANGUAGES.en!;

/** The rules for a BCP 47 tag ('zh-Hant', 'pt_BR', 'ar-XB'), by its language subtag; English's when unknown. */
function languageOf(tag: unknown): { locale: string; rules: RuleSet } | undefined {
  if (typeof tag !== 'string' && !(typeof tag === 'object' && tag !== null)) return undefined;
  const language = String(tag).toLowerCase().split(/[-_]/)[0] ?? '';
  return LANGUAGES[language];
}

function resolve(locales: unknown): { locale: string; rules: RuleSet } {
  const list = Array.isArray(locales) ? locales : locales === undefined ? [] : [locales];
  for (const tag of list) {
    const found = languageOf(tag);
    if (found) return found;
  }
  return FALLBACK;
}

/** A JS number's shortest decimal form ("39.5", "1e+21", "5e-7"): its digits and where the point goes. */
const DECIMAL = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

/** Adds one at the last digit of int.frac (frac: exactly 3 digits). */
function roundUp(int: string, frac: string): [string, string] {
  const digits = (int + frac).split('');
  let k = digits.length - 1;
  while (k >= 0 && digits[k] === '9') digits[k--] = '0';
  if (k < 0) digits.unshift('1');
  else digits[k] = String(Number(digits[k]) + 1);
  const all = digits.join('');
  return [all.slice(0, all.length - frac.length), all.slice(all.length - frac.length)];
}

/** The operands of a number, or null for NaN and ±Infinity (always "other"). */
function operands(value: number): Operands | null {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs)) return null;
  const match = DECIMAL.exec(String(abs));
  if (!match) return null;
  const head = match[1]!;
  const digits = head + (match[2] ?? '');
  const point = head.length + Number(match[3] ?? 0);
  let int: string;
  let frac: string;
  if (point <= 0) {
    int = '0';
    frac = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    int = digits + '0'.repeat(point - digits.length);
    frac = '';
  } else {
    int = digits.slice(0, point);
    frac = digits.slice(point);
  }
  if (frac.length > 3) {
    const up = frac[3]! >= '5';
    frac = frac.slice(0, 3);
    if (up) [int, frac] = roundUp(int, frac);
  }
  frac = frac.replace(/0+$/, '');
  const i = Number(int.slice(-18));
  return {
    n: Number(frac ? `${int}.${frac}` : int),
    i,
    i10: i % 10,
    i100: i % 100,
    i1e6: i % 1e6,
    v: frac.length,
  };
}

function select(rules: RuleSet, value: number): PluralCategory {
  const o = operands(value);
  return o ? rules.select(o) : 'other';
}

/** The plural form of n in a language (i18next's suffix: key_one, key_few…). */
export function pluralCategory(lang: string, n: number): PluralCategory {
  return select(resolve(lang).rules, n);
}

/** Every form a language has, in CLDR's order ('ar': zero, one, two, few, many, other). */
export function pluralCategories(lang: string): readonly PluralCategory[] {
  return resolve(lang).rules.categories;
}

export interface PluralRulesOptions {
  type?: string;
  localeMatcher?: string;
}

/** Intl.PluralRules, as much of it as i18next uses: new PluralRules(lng).select(n) and resolvedOptions(). */
export class PluralRules {
  private readonly language: { locale: string; rules: RuleSet };

  constructor(locales?: string | readonly string[], options?: PluralRulesOptions) {
    const type = options?.type ?? 'cardinal';
    if (type !== 'cardinal') {
      throw new RangeError(`PluralRules: type "${String(type)}" is not supported here (cardinal only)`);
    }
    this.language = resolve(locales);
  }

  select(value: number): PluralCategory {
    // ToNumber, as Intl does ('2' is 2; a BigInt throws).
    return select(this.language.rules, +value);
  }

  resolvedOptions() {
    return {
      locale: this.language.locale,
      type: 'cardinal' as const,
      minimumIntegerDigits: 1,
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
      pluralCategories: [...this.language.rules.categories],
      roundingIncrement: 1,
      roundingMode: 'halfExpand' as const,
      roundingPriority: 'auto' as const,
      trailingZeroDisplay: 'auto' as const,
    };
  }

  /** The tags of the list that have their own rules here (the others would get English's). */
  static supportedLocalesOf(locales?: string | readonly string[]): string[] {
    const list = Array.isArray(locales) ? locales : locales === undefined ? [] : [locales];
    return list.filter((tag): tag is string => languageOf(tag) !== undefined);
  }
}

/**
 * Puts PluralRules on target.Intl (globalThis by default), over whatever is there: always, even when the engine
 * has its own (see above). Never throws: a frozen Intl keeps its own.
 */
export function installPluralRules(target: object = globalThis): void {
  const owner = target as { Intl?: Record<string, unknown> };
  try {
    if (typeof owner.Intl !== 'object' || owner.Intl === null) owner.Intl = {};
    Object.defineProperty(owner.Intl, 'PluralRules', {
      value: PluralRules,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  } catch {
    try {
      owner.Intl!.PluralRules = PluralRules;
    } catch {
      // Nothing more to try: i18next then reads the engine's own rules.
    }
  }
}
