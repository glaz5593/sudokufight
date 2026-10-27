import {
  type Block,
  type CellIndex,
  cellName,
  type Digit,
  type Explanation,
  type Step,
  type Technique,
  unitLabel,
  type WrongReason,
} from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';

import { spaceSentences } from './compose';
import i18n from './index';
import { isRtlLanguage } from './languages';

/**
 * The explanations in words (spec §13.2; localization plan 0ו, D110): the Replay's, a stage's "למה?" and the
 * chain's toast. The engine explains as data (explain, whyWrong, explainSpotError: techniques, cells, digits);
 * this file says it in the app's language, from the 'explain' namespace, so a new language is a translation
 * file and nothing more. Hebrew and English are word for word what the engine used to write
 * (__tests__/explainGolden.test.ts holds its output on a corpus of boards).
 *
 * Every sentence is a whole key with placeholders. What the code used to glue is a key too:
 * - lists: "3, 7 ו־9" / "3, 7 and 9" are explain:list.sep and explain:list.last ("{{head}} and {{last}}"),
 *   "2 or 5" is list.lastOr, and the blocked cells of a hidden single are clauses.sep / clauses.last (Hebrew's
 *   "א, ב, וג"). Intl.ListFormat is not on Hermes.
 * - a unit's kind: a key per kind (naked.missing.row, .col, .box), so "Row D" opening a sentence and "row D"
 *   inside one are each their own words, with no capitalizing in code.
 * The board is LTR in every language: cells are named by row letter and column number (D5) and digits are Latin.
 * In a right-to-left language each cell name and formula ("D5 → 7") is an LTR isolate (LRI…PDI), so it never
 * turns around inside the sentence; a left-to-right one needs none.
 *
 * `lang` is the language to write in (i18n.language): its strings must be loaded, as the running language's are.
 */

type ExplainT = TFunction<'explain'>;

/** U+2066 LEFT-TO-RIGHT ISOLATE */
const LRI = '⁦';
/** U+2069 POP DIRECTIONAL ISOLATE */
const PDI = '⁩';
/** Removes the direction isolates, e.g. to compare with plain text. */
export const stripIsolates = (s: string): string => s.replace(/[⁦-⁩]/g, '');

/** A language's words: its strings, and whether LTR parts need an isolate. */
interface Words {
  t: ExplainT;
  rtl: boolean;
}

function wordsOf(lang: string): Words {
  return { t: i18n.getFixedT(lang, 'explain') as ExplainT, rtl: isRtlLanguage(lang) };
}

/** LTR text inside a right-to-left sentence gets isolated; a left-to-right one needs nothing. */
const ltr = (w: Words, s: string): string => (w.rtl ? `${LRI}${s}${PDI}` : s);

/** "D5", isolated in a right-to-left language. */
const cell = (w: Words, i: CellIndex): string => ltr(w, cellName(i));

/** "D5 → 7" (one isolated formula in a right-to-left language) */
const assign = (w: Words, c: CellIndex, digit: Digit): string =>
  ltr(w, w.t('formula.assign', { cell: cellName(c), digit }));

/** "D5 = 7" */
const equals = (w: Words, c: CellIndex, digit: Digit): string =>
  ltr(w, w.t('formula.equals', { cell: cellName(c), digit }));

/** Items with the language's separator, the last after its own word: "3, 7 ו־9", "2, 5 or 8". */
function joined(
  w: Words,
  items: readonly (string | number)[],
  sep: 'list.sep' | 'clauses.sep',
  last: 'list.last' | 'list.lastOr' | 'clauses.last',
): string {
  const s = items.map(String);
  if (s.length <= 1) return s.join('');
  return w.t(last, { head: s.slice(0, -1).join(w.t(sep)), last: s[s.length - 1]! });
}

/** "3 ו־9", "3, 7 ו־9" / "3 and 9", "3, 7 and 9" */
const andList = (w: Words, items: readonly (string | number)[]): string =>
  joined(w, items, 'list.sep', 'list.last');

/** "D1, E7, E8": cells, each isolated in a right-to-left language. */
const cellList = (w: Words, cells: readonly CellIndex[]): string =>
  cells.map((c) => cell(w, c)).join(w.t('list.sep'));

/** Why `digit` can't go in cell `c` of a hidden single: one clause of its list. */
function blockClause(w: Words, c: CellIndex, block: Block, digit: Digit): string {
  return block.kind === 'step'
    ? w.t('hidden.clause.step', { cell: cell(w, c), digit, step: block.step + 1 })
    : w.t(`hidden.clause.unit.${block.unit.kind}`, { cell: cell(w, c), digit, label: unitLabel(block.unit) });
}

function stepText(step: Step, w: Words): string {
  const { t } = w;
  switch (step.technique) {
    case 'nakedSingle': {
      const { cell: c, digit, primary, missing, seen, eliminated } = step;
      const label = unitLabel(primary);
      const parts = [t('naked.answer', { formula: assign(w, c, digit) })];
      if (missing.length === 1) {
        parts.push(t(`naked.onlyMissing.${primary.kind}`, { label, digit }));
        return spaceSentences(parts, t);
      }
      parts.push(t(`naked.missing.${primary.kind}`, { label, digits: andList(w, missing) }));
      for (const s of seen)
        parts.push(
          t(`naked.seen.${s.unit.kind}`, { label: unitLabel(s.unit), digits: andList(w, s.digits) }),
        );
      for (const e of eliminated)
        parts.push(t('naked.eliminated', { digit: e.digit, cell: cell(w, c), step: e.step + 1 }));
      parts.push(t('naked.only', { digit }));
      return spaceSentences(parts, t);
    }
    case 'hiddenSingle': {
      const { cell: c, digit, unit, blocked } = step;
      const values = { digit, label: unitLabel(unit), cell: cell(w, c), result: equals(w, c, digit) };
      if (!blocked.length) return t(`hidden.alone.${unit.kind}`, values);
      const clauses = blocked.map((b) => blockClause(w, b.cell, b.block, digit));
      return t(`hidden.blocked.${unit.kind}`, {
        ...values,
        clauses: joined(w, clauses, 'clauses.sep', 'clauses.last'),
      });
    }
    case 'pointing':
    case 'claiming': {
      const values = {
        box: unitLabel({ kind: 'box', index: step.box }),
        line: unitLabel(step.line),
        digit: step.digit,
        cells: cellList(w, step.removed),
      };
      return step.technique === 'pointing'
        ? t(`pointing.${step.line.kind}`, values)
        : t(`claiming.${step.line.kind}`, values);
    }
    case 'nakedPair':
    case 'hiddenPair': {
      const values = {
        a: cell(w, step.cells[0]),
        b: cell(w, step.cells[1]),
        digits: andList(w, step.digits),
        label: unitLabel(step.unit),
      };
      return step.technique === 'nakedPair'
        ? t(`nakedPair.${step.unit.kind}`, {
            ...values,
            cells: cellList(
              w,
              step.removed.map((r) => r.cell),
            ),
          })
        : t(`hiddenPair.${step.unit.kind}`, values);
    }
  }
}

/** One step as a sentence (or a few), in `lang`. */
export const formatStep = (step: Step, lang: string): string => stepText(step, wordsOf(lang));

/** The whole explanation as text, in `lang`. A chain is numbered, one step per line. */
export function formatExplanation(expl: Explanation, lang: string): string {
  const w = wordsOf(lang);
  if (expl.technique === 'beyond') return w.t('beyond', { formula: assign(w, expl.cell, expl.digit) });
  if (expl.technique !== 'chain') return stepText(expl.steps[0]!, w);
  const head = w.t('chain.head', { count: expl.steps.length });
  return [head, ...expl.steps.map((s, k) => w.t('chain.line', { n: k + 1, text: stepText(s, w) }))].join(
    '\n',
  );
}

/** Why a played digit was wrong, in `lang`. */
export function formatWrong(reason: WrongReason, lang: string): string {
  const w = wordsOf(lang);
  if (reason.kind === 'conflict')
    return w.t(`wrong.conflict.${reason.unit.kind}`, {
      digit: reason.digit,
      label: unitLabel(reason.unit),
      cell: cell(w, reason.cell),
    });
  return w.t('wrong.notSolution', { digit: reason.digit, answer: reason.answer });
}

/**
 * Why `digit` can't go in `cell`, as one sentence with no full stop (a level's "why?", a wrong tap):
 * "E6 לא יכול להכיל 7: בשורה E יש 7" / "E6 can't hold 7: row E has a 7".
 */
export function formatBlock(c: CellIndex, block: Block, digit: Digit, lang: string): string {
  const w = wordsOf(lang);
  return block.kind === 'step'
    ? w.t('block.step', { cell: cell(w, c), digit, step: block.step + 1 })
    : w.t(`block.unit.${block.unit.kind}`, { cell: cell(w, c), digit, label: unitLabel(block.unit) });
}

/**
 * A digit in a chain cell that can't be known yet [D64], with no full stop: "עוד אי אפשר לדעת מה נכנס ב־A9
 * (2 או 5)" / "You can't tell yet what goes in A9 (2 or 5)". Without candidates the brackets are left out.
 */
export function formatNotYet(c: CellIndex, candidates: readonly Digit[], lang: string): string {
  const w = wordsOf(lang);
  return candidates.length
    ? w.t('notYet.options', { cell: cell(w, c), options: joined(w, candidates, 'list.sep', 'list.lastOr') })
    : w.t('notYet.cell', { cell: cell(w, c) });
}

/** A technique's name, in `lang`: "Hidden single". */
export const techniqueName = (technique: Technique | 'chain' | 'beyond', lang: string): string =>
  wordsOf(lang).t(`technique.${technique}`);
