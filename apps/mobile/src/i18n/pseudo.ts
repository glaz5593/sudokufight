import { type PluralCategory, pluralCategories } from '../services/pluralRules';
import type { PseudoLanguage } from './languages';
import type { LocaleBundle, Namespace } from './locales.generated';

/**
 * The pseudo languages' strings, made from English at run time (localization plan 0יג; doc 269–291). Android's
 * own pseudo locales change only Android's resource files, and our strings are JSON, so the app makes its own:
 * - en-XA: English with accents on its letters (only letters Rubik has: theme/__tests__/fontCoverage.test.ts),
 *   about 40 % longer, between brackets: "[Þļåý]", "[Ļéåðéŕböåŕð one]". A cut word shows as a missing "]", and a
 *   string that did not go through t() shows as plain English.
 * - ar-XB: English laid out right to left (isRtlLanguage), each word drawn right to left too (Android's way: RLM
 *   and RLO before it, PDF and RLM after), so a string that did not go through t() reads left to right. What an
 *   Arabic translation isolates (LRI…PDI, plan 0יד) is isolated here too: a range or a signed number ("0–3",
 *   "+3.5") and a word never translated ("GO!"), so ar-XB shows the direction a correct translation would.
 *
 * What a translator must not touch stays as it is (plan 0יד): placeholders ({{name}}), $t() references, tags
 * (<accent>), bidi controls, the spaces at either end (a separator's), and the words that are never translated
 * (PSEUDO_KEEP: the brand, VS, GO!, the bots' names, XP). A string with no letters left to change (a separator,
 * "{{label}}: {{value}}", a decimal point, "—") is kept whole, so formats and Teko's dash stay as in English.
 *
 * Plurals (critique-log #25): i18next picks a pseudo language's form by its rule, Arabic's six for ar-XB, so
 * every form of the rule is made: a form English has comes from English, any other from English's _other (so 3,
 * Arabic's "few", never falls back to plain English). Pure: no i18n instance, no React.
 */

/**
 * Never translated (D107; scripts/lib/i18n-locales.mjs KEEP_LATIN, which a test keeps this in step with): left
 * as they are in a pseudo string too, so Teko's VS and GO! stay drawable and the brand stays the brand.
 */
export const PSEUDO_KEEP: readonly string[] = [
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

/**
 * en-XA's accents: each English letter and an accented one Rubik draws in all four weights (Latin-1 and Latin
 * Extended-A, plus ƒ). b, m, q, v and x have none there and stay plain.
 */
const PLAIN = 'acdefghijklnoprstuwyzACDEGHIJKLNOPRSTUWYZ';
const ACCENTED = 'åçðéƒĝĥîĵķļñöþŕšťûŵýžÅÇÐÉĜĤÎĴĶĻÑÖÞŔŠŤÛŴÝŽ';
const ACCENTS: ReadonlyMap<string, string> = new Map([...PLAIN].map((ch, i) => [ch, ACCENTED[i]!]));

/** en-XA's length: about 40 % more than English, the brackets included, in whole words of padding. */
export const PSEUDO_EXPANSION = 1.4;
const PADDING =
  'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen'.split(' ');

const RLM = '\u{200F}';
const RLO = '\u{202E}';
const PDF = '\u{202C}';
const LRI = '\u{2066}';
const PDI = '\u{2069}';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A bidi control: LRM, RLM, ALM, an embedding or override, an isolate. */
const BIDI = '[\u{200E}\u{200F}\u{61C}\u{202A}-\u{202E}\u{2066}-\u{2069}]';

/**
 * What a pseudo string may keep as it is, in the order tried: a placeholder, a $t() reference (one level of
 * parentheses inside), a tag, a bidi control, and a word never translated with any letters around it (those
 * make it part of a longer word, which is changed: "Pipe" is not "Pip"; so no lookbehind is needed).
 */
const KEPT = new RegExp(
  [
    String.raw`\{\{[^{}]*\}\}`,
    String.raw`\$t\((?:[^()]|\([^()]*\))*\)`,
    String.raw`<\/?[A-Za-z0-9_-]+\s*\/?>`,
    BIDI,
    String.raw`\p{L}*(?:${[...PSEUDO_KEEP]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|')})\p{L}*`,
  ].join('|'),
  'gu',
);
const CODE = new RegExp(String.raw`^(?:\{\{|\$t\(|<|${BIDI})`, 'u');
const LETTER = /\p{L}/u;

interface Part {
  text: string;
  /**
   * 'words': English to change. 'keep': a word never translated, shown as it is. 'code': a placeholder, a
   * reference, a tag or a bidi control (not shown as written, so not counted in en-XA's length).
   */
  kind: 'words' | 'keep' | 'code';
}

function parts(value: string): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (const match of value.matchAll(KEPT)) {
    const index = match.index ?? 0;
    if (index > at) out.push({ text: value.slice(at, index), kind: 'words' });
    const kind = CODE.test(match[0]) ? 'code' : PSEUDO_KEEP.includes(match[0]) ? 'keep' : 'words';
    out.push({ text: match[0], kind });
    at = index + match[0].length;
  }
  if (at < value.length) out.push({ text: value.slice(at), kind: 'words' });
  return out;
}

/** Whole words of padding, at least `extra` characters with their spaces ("" when none is needed). */
function padding(extra: number): string {
  let out = '';
  for (let i = 0; out.length < extra; i++) out += ` ${PADDING[i % PADDING.length]}`;
  return out;
}

const accented = (text: string) => text.replace(/[A-Za-z]/g, (ch) => ACCENTS.get(ch) ?? ch);

/** A range of numbers ("0–3", "3-16") or a signed number ("+3.5", "−2"). */
const NUMBERS =
  /[+\u{2212}-]?\d+(?:[.,]\d+)*(?:\s?[\u{2013}\u{2014}-]\s?\d+(?:[.,]\d+)*)+|[+\u{2212}]\d+(?:[.,]\d+)*/u;
const SPLIT_NUMBERS = new RegExp(`(${NUMBERS.source})`, 'u');

/**
 * ar-XB's words: each that has a letter drawn right to left (RLM RLO word PDF RLM); a range or a signed number
 * left to right in an isolate; spaces and other digits and signs as they are.
 */
const rightToLeft = (text: string) =>
  text
    .split(SPLIT_NUMBERS)
    .map((piece, i) =>
      i % 2 === 1
        ? `${LRI}${piece}${PDI}`
        : piece.replace(/\S+/gu, (word) => (LETTER.test(word) ? `${RLM}${RLO}${word}${PDF}${RLM}` : word)),
    )
    .join('');

/** One English string in a pseudo language (the rules at the top of this file). */
export function pseudoText(value: string, lang: PseudoLanguage): string {
  const lead = /^\s*/u.exec(value)![0];
  const trail = value.length > lead.length ? /\s*$/u.exec(value)![0] : '';
  const core = value.slice(lead.length, value.length - trail.length);
  const pieces = parts(core);
  if (!pieces.some((p) => p.kind === 'words' && LETTER.test(p.text))) return value;
  if (lang === 'ar-XB') {
    const body = pieces.map((p) =>
      p.kind === 'words' ? rightToLeft(p.text) : p.kind === 'keep' ? `${LRI}${p.text}${PDI}` : p.text,
    );
    return lead + body.join('') + trail;
  }
  const body = pieces.map((p) => (p.kind === 'words' ? accented(p.text) : p.text)).join('');
  // The length that grows: what the string shows of its own (a placeholder's value is not known here).
  const length = pieces.reduce((sum, p) => sum + (p.kind === 'code' ? 0 : p.text.length), 0);
  const extra = Math.ceil(length * PSEUDO_EXPANSION) - length - 2;
  return `${lead}[${body}${padding(extra)}]${trail}`;
}

const PLURAL = /^(.+)_(zero|one|two|few|many|other)$/;

/** The plural keys of one level of a namespace: each base whose `_other` is a string. */
function pluralBases(level: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(level).flatMap((key) => {
    const match = PLURAL.exec(key);
    return match?.[2] === 'other' && typeof level[key] === 'string' ? [match[1]!] : [];
  });
}

function pseudoLevel(
  level: Readonly<Record<string, unknown>>,
  lang: PseudoLanguage,
  forms: readonly PluralCategory[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(level)) {
    if (typeof value === 'string') out[key] = pseudoText(value, lang);
    else if (value && typeof value === 'object')
      out[key] = pseudoLevel(value as Record<string, unknown>, lang, forms);
    else out[key] = value;
  }
  // Every form of the language's rule: English's own where it has it, else its _other.
  for (const base of pluralBases(level)) {
    for (const form of forms) out[`${base}_${form}`] ??= out[`${base}_other`];
  }
  return out;
}

/** A pseudo language's strings, every namespace, from English's (`english`: i18n/index.ts localeBundle('en')). */
export function pseudoBundle(english: LocaleBundle, lang: PseudoLanguage): LocaleBundle {
  const forms = pluralCategories(lang);
  const out: Partial<Record<Namespace, object>> = {};
  for (const [ns, tree] of Object.entries(english) as [Namespace, object][]) {
    out[ns] = pseudoLevel(tree as Record<string, unknown>, lang, forms);
  }
  return out as LocaleBundle;
}

/**
 * Every plural key of a bundle, as "namespace:key.path" without its form ("game:hit.seconds"), in the bundle's
 * order: the plural check screen lists them, and the tests resolve each one.
 */
export function pluralKeys(bundle: LocaleBundle): string[] {
  const out: string[] = [];
  const walk = (level: Readonly<Record<string, unknown>>, path: string) => {
    for (const base of pluralBases(level)) out.push(`${path}${base}`);
    for (const [key, value] of Object.entries(level)) {
      if (value && typeof value === 'object') walk(value as Record<string, unknown>, `${path}${key}.`);
    }
  };
  for (const [ns, tree] of Object.entries(bundle)) walk(tree as Record<string, unknown>, `${ns}:`);
  return out;
}
