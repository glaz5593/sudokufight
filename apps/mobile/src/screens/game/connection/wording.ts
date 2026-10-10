import type { TFunction } from 'i18next';

import type { Gender } from '../../../components/player/wording';
import { isolateName } from '../hit/hitModel';

/**
 * The words of the connection UI (namespace "game", keys "connection.*"), as pure functions of t(), shared
 * by the components and their tests. Hebrew verbs about the opponent are gendered in the design ("איבדה
 * חיבור"); the profile has no gender yet (components.md §17.8), so the base form is the default and
 * `gender: 'female'` picks the "_female" context form, as in the player namespace.
 */

export type GameT = TFunction<'game'>;

/**
 * A stand-in for a number that a sentence styles on its own ("יש לך עוד ⟨11⟩ שניות לחזור"): the sentence is
 * translated whole, with this in the number's place, and split around it.
 */
export const MARK = '⁣⁣';

/** A translated sentence around its marked number: [before, after]; the number is drawn between them. */
export function splitMarked(sentence: string): [before: string, after: string] | null {
  const at = sentence.indexOf(MARK);
  if (at < 0) return null;
  return [sentence.slice(0, at), sentence.slice(at + MARK.length)];
}

/** A room code letter by letter, so a screen reader spells it ("A B C 2 3 4") rather than reading a word. */
export const spellCode = (code: string): string => [...code].join(' ');

/** A player's name inside a sentence: the opponent's own, or "היריב"; isolated, so a Latin name keeps its order. */
export const nameOf = (name: string | null, t: GameT): string => (name ? isolateName(name) : t('opponent'));

/** My own name, or "אני". */
export const myNameOf = (name: string | null, t: GameT): string => (name ? isolateName(name) : t('me'));

/** A part that already ends a sentence ("מתחבר מחדש…", "נסנכרן:") takes no full stop after it. */
const ENDS_SENTENCE = /[.…!?:]$/;

/**
 * Sentences joined as one announcement or label: "החיבור שלך אבד. מתחבר מחדש…" and then "ניסיון 2" with a
 * space only, since the part before it already ends with its own mark.
 */
export function sentences(parts: readonly (string | null | false | undefined)[], t: GameT): string {
  const sep = t('connection.sep');
  return parts
    .filter((p): p is string => !!p)
    .reduce(
      (all, part) => (!all ? part : ENDS_SENTENCE.test(all) ? `${all} ${part}` : `${all}${sep}${part}`),
      '',
    );
}

/** The context option of a gendered sentence about the opponent. */
export const about = (gender?: Gender): { context?: Gender } => (gender ? { context: gender } : {});
