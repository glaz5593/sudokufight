import blockedWordsFile from '../../data/blocked-words.json';

/**
 * The offensive-word filter for display names (spec §3.1; the list: apps/server/data/blocked-words.json, whose
 * `_doc` explains the two kinds of word).
 *
 * A name and every word are compared folded: lower case, NFKD without marks (niqqud, accents), Hebrew final
 * letters as regular ones. The name is then read a few ways, each keeping letters only:
 * - leetspeak as letters (0→o, 3→e, 4→a, 5→s, 7→t, 8→b, 9→g, @→a, $→s, +→t), with 1, ! and | read once as
 *   i and once as l;
 * - digits and symbols dropped.
 * A word matches with each of its letters repeated any number of times (fuuuck, זונננה).
 * - `substring` words: anywhere in a reading of the whole name (separators are gone: f.u_c.k).
 * - `exact` words: a reading of the whole name, or of one of its parts, is the word. Parts split at
 *   separators (anything but letters, digits and leet symbols), at a change from lower to upper case
 *   (BigDick), and at a change between Hebrew and Latin letters.
 * - `allow` words (innocent words with a substring word inside, like the surname Shitrit) are cut out of a
 *   reading before the substring words are looked for.
 */

export interface WordList {
  substring: readonly string[];
  exact: readonly string[];
}

export interface BlockedWordsFile {
  en: WordList;
  he: WordList;
  reserved: WordList;
  allow: readonly string[];
}

export type WordListName = 'en' | 'he' | 'reserved';

export interface BlockedMatch {
  /** The word as written in the list. */
  word: string;
  list: WordListName;
  kind: keyof WordList;
}

const FINALS: Readonly<Record<string, string>> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '+': 't',
};
const ONE_LIKE = new Set(['1', '!', '|']);
const SEPARATOR = /[^\p{L}\p{N}@$!|+]/u;
const HEBREW = /^[֐-׿יִ-ﭏ]$/;
const LATIN = /^\p{Script=Latin}$/u;

/** Lower case, NFKD without combining marks, Hebrew final letters as regular ones. Keeps everything else. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c);
}

const lettersOnly = (s: string) => s.replace(/[^\p{L}]/gu, '');

/** The letters-only readings of a folded text: leet as i, leet as l, and with digits and symbols dropped. */
export function readingsOf(folded: string): string[] {
  const read = (one: string) =>
    lettersOnly([...folded].map((c) => (ONE_LIKE.has(c) ? one : (LEET[c] ?? c))).join(''));
  return [...new Set([read('i'), read('l'), lettersOnly(folded)])].filter((r) => r !== '');
}

/** The parts of a name: split at separators, lower→upper case changes, and Hebrew↔Latin changes. */
export function partsOf(name: string): string[] {
  const text = name.normalize('NFKD').replace(/\p{M}/gu, '');
  const parts: string[] = [];
  let part = '';
  let prev = '';
  for (const ch of text) {
    if (SEPARATOR.test(ch)) {
      if (part !== '') parts.push(part);
      part = '';
      prev = '';
      continue;
    }
    const caseChange = prev !== '' && /\p{Ll}/u.test(prev) && /\p{Lu}/u.test(ch);
    const scriptChange =
      prev !== '' && ((HEBREW.test(prev) && LATIN.test(ch)) || (LATIN.test(prev) && HEBREW.test(ch)));
    if (caseChange || scriptChange) {
      parts.push(part);
      part = '';
    }
    part += ch;
    prev = ch;
  }
  if (part !== '') parts.push(part);
  return parts;
}

interface Compiled extends BlockedMatch {
  pattern: RegExp;
}

/**
 * A folded word as a pattern of its letters, each repeated any number of times: anchored for an exact word,
 * global for an allowed one (it is cut out with replace), neither for a substring word (test() on a global
 * pattern would carry lastIndex from one name to the next).
 */
function compile(word: string, where: string, use: 'exact' | 'substring' | 'allow'): RegExp {
  const folded = foldText(word);
  if (!/^\p{L}+$/u.test(folded))
    throw new Error(`blocked-words.json: "${word}" (${where}) must be letters only`);
  // Letters need no escaping.
  const body = [...folded].map((c) => `${c}+`).join('');
  return new RegExp(use === 'exact' ? `^${body}$` : body, use === 'allow' ? 'gu' : 'u');
}

export class BlockedWords {
  private readonly substring: Compiled[] = [];
  private readonly exact: Compiled[] = [];
  private readonly allow: RegExp[];

  constructor(file: BlockedWordsFile) {
    for (const list of ['en', 'he', 'reserved'] as const) {
      for (const kind of ['substring', 'exact'] as const) {
        for (const word of file[list][kind]) {
          const pattern = compile(word, `${list}.${kind}`, kind);
          (kind === 'exact' ? this.exact : this.substring).push({ word, list, kind, pattern });
        }
      }
    }
    this.allow = file.allow.map((word) => compile(word, 'allow', 'allow'));
  }

  /** Words in the list. */
  get size(): number {
    return this.substring.length + this.exact.length;
  }

  /** The first listed word in `name`, or null. */
  match(name: string): BlockedMatch | null {
    const whole = readingsOf(foldText(name));
    // A space where an allowed word was: no letters on its two sides join into a word.
    const masked = whole.map((r) => this.allow.reduce((s, a) => s.replace(a, ' '), r));
    for (const w of this.substring) {
      if (masked.some((r) => w.pattern.test(r))) return strip(w);
    }
    const candidates = [...whole, ...partsOf(name).flatMap((p) => readingsOf(foldText(p)))];
    for (const w of this.exact) {
      if (candidates.some((r) => w.pattern.test(r))) return strip(w);
    }
    return null;
  }
}

const strip = ({ word, list, kind }: Compiled): BlockedMatch => ({ word, list, kind });

let defaultWords: BlockedWords | undefined;

/** The list in apps/server/data/blocked-words.json (bundled with the server), compiled once. */
export function defaultBlockedWords(): BlockedWords {
  defaultWords ??= new BlockedWords(blockedWordsFile satisfies BlockedWordsFile);
  return defaultWords;
}
