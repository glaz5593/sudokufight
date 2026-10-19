import { cellName, type Digit, unitLabel } from './board';
import type { Explanation, WrongReason } from './explain';
import type { Block, Step, Technique, UnitRef } from './logic';

/**
 * Explanation text in Hebrew and English (spec §13.2). The board is LTR in both languages: cells are named
 * by row letter and column number (D5), and digits are Latin.
 *
 * Hebrew follows the spec's examples word for word (once the direction marks below are removed):
 *   "D5 → 7. בשורה D חסרים 3, 7 ו־9. בעמודה 5 כבר יש 3 ו־9. לכן רק 7."
 *   "הספרה 7 חייבת להופיע בריבוע 5. כל שאר המשבצות הריקות בו חסומות: ב־D4 יש 7 בעמודה 4, וב־E6 יש 7 בשורה E.
 *    לכן D5 = 7."
 * In Hebrew every cell name and formula is wrapped in LEFT-TO-RIGHT ISOLATE … POP DIRECTIONAL ISOLATE
 * (U+2066 … U+2069), so "D5 → 7" never turns around inside right-to-left text (work plan, stage 1).
 */

export type Lang = 'he' | 'en';

/** U+2066 LEFT-TO-RIGHT ISOLATE */
export const LRI = '⁦';
/** U+2069 POP DIRECTIONAL ISOLATE */
export const PDI = '⁩';
/** Removes the direction isolates, e.g. to compare with plain text. */
export const stripIsolates = (s: string): string => s.replace(/[⁦-⁩]/g, '');

const TECHNIQUE_NAMES: Record<Lang, Record<Technique | 'chain' | 'beyond', string>> = {
  he: {
    nakedSingle: 'בודד גלוי',
    hiddenSingle: 'בודד נסתר',
    pointing: 'צמצום ריבוע־שורה',
    claiming: 'צמצום ריבוע־שורה',
    nakedPair: 'זוג גלוי',
    hiddenPair: 'זוג נסתר',
    chain: 'טכניקה מתקדמת',
    beyond: 'מעבר לטכניקות של המנוע',
  },
  en: {
    nakedSingle: 'Naked single',
    hiddenSingle: 'Hidden single',
    pointing: 'Box-line reduction',
    claiming: 'Box-line reduction',
    nakedPair: 'Naked pair',
    hiddenPair: 'Hidden pair',
    chain: 'Advanced technique',
    beyond: 'Beyond the engine’s techniques',
  },
};

export const techniqueName = (t: Technique | 'chain' | 'beyond', lang: Lang): string =>
  TECHNIQUE_NAMES[lang][t];

// -- words ------------------------------------------------------------------------------------------------

/** LTR text inside Hebrew gets isolated; English needs nothing. */
const ltr = (s: string, lang: Lang): string => (lang === 'he' ? `${LRI}${s}${PDI}` : s);

/** "D5", isolated in Hebrew. */
const cell = (i: number, lang: Lang): string => ltr(cellName(i), lang);

/** "שורה D" / "row D" */
function unitName(u: UnitRef, lang: Lang): string {
  const label = unitLabel(u);
  if (lang === 'he') return `${u.kind === 'row' ? 'שורה' : u.kind === 'col' ? 'עמודה' : 'ריבוע'} ${label}`;
  return `${u.kind === 'row' ? 'row' : u.kind === 'col' ? 'column' : 'box'} ${label}`;
}

/** "בשורה D" / "in row D" */
const inUnit = (u: UnitRef, lang: Lang): string =>
  lang === 'he' ? `ב${unitName(u, lang)}` : `in ${unitName(u, lang)}`;

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "3 ו־9", "3, 7 ו־9" / "3 and 9", "3, 7 and 9" */
function andList(items: readonly (string | number)[], lang: Lang): string {
  const s = items.map(String);
  if (s.length <= 1) return s.join('');
  const last = s[s.length - 1]!;
  const head = s.slice(0, -1).join(', ');
  return lang === 'he' ? `${head} ו־${last}` : `${head} and ${last}`;
}

/** Hebrew clauses joined as "א, ב, וג" (the last one takes ו). */
function heClauses(clauses: readonly string[]): string {
  if (clauses.length <= 1) return clauses.join('');
  return `${clauses.slice(0, -1).join(', ')}, ו${clauses[clauses.length - 1]!}`;
}

const cellList = (cells: readonly number[], lang: Lang): string => cells.map((c) => cell(c, lang)).join(', ');

/** "D5 → 7" (one isolated formula in Hebrew) */
const assign = (c: number, digit: Digit, lang: Lang): string => ltr(`${cellName(c)} → ${digit}`, lang);

/** "D5 = 7" */
const equals = (c: number, digit: Digit, lang: Lang): string => ltr(`${cellName(c)} = ${digit}`, lang);

/** Why `digit` can't go in cell `c` of a hidden single. */
function blockClause(c: number, block: Block, digit: Digit, lang: Lang): string {
  if (lang === 'he')
    return block.kind === 'step'
      ? `ב־${cell(c, lang)} הספרה ${digit} כבר נמחקה (צעד ${block.step + 1})`
      : `ב־${cell(c, lang)} יש ${digit} ${inUnit(block.unit, lang)}`;
  return block.kind === 'step'
    ? `${cellName(c)} lost the ${digit} in step ${block.step + 1}`
    : `${cellName(c)} sees a ${digit} ${inUnit(block.unit, lang)}`;
}

// -- steps ------------------------------------------------------------------------------------------------

/** One step as a sentence (or a few). */
export function formatStep(step: Step, lang: Lang): string {
  switch (step.technique) {
    case 'nakedSingle': {
      const { cell: c, digit, primary, missing, seen, eliminated } = step;
      const parts = [`${assign(c, digit, lang)}.`];
      if (missing.length === 1) {
        parts.push(
          lang === 'he'
            ? `${inUnit(primary, lang)} חסר רק ${digit}.`
            : `${capitalize(unitName(primary, lang))} is only missing ${digit}.`,
        );
        return parts.join(' ');
      }
      parts.push(
        lang === 'he'
          ? `${inUnit(primary, lang)} חסרים ${andList(missing, lang)}.`
          : `${capitalize(unitName(primary, lang))} is missing ${andList(missing, lang)}.`,
      );
      for (const s of seen)
        parts.push(
          lang === 'he'
            ? `${inUnit(s.unit, lang)} כבר יש ${andList(s.digits, lang)}.`
            : `${capitalize(unitName(s.unit, lang))} already has ${andList(s.digits, lang)}.`,
        );
      for (const e of eliminated)
        parts.push(
          lang === 'he'
            ? `${e.digit} נמחק מ־${cell(c, lang)} בצעד ${e.step + 1}.`
            : `${e.digit} was ruled out of ${cellName(c)} in step ${e.step + 1}.`,
        );
      parts.push(lang === 'he' ? `לכן רק ${digit}.` : `So only ${digit}.`);
      return parts.join(' ');
    }
    case 'hiddenSingle': {
      const { cell: c, digit, unit, blocked } = step;
      const result = equals(c, digit, lang);
      if (!blocked.length)
        return lang === 'he'
          ? `הספרה ${digit} חייבת להופיע ${inUnit(unit, lang)}, ו־${cell(c, lang)} היא המשבצת הריקה היחידה בו. לכן ${result}.`
          : `${digit} must appear ${inUnit(unit, lang)}, and ${cellName(c)} is its only empty cell. So ${result}.`;
      const clauses = blocked.map((b) => blockClause(b.cell, b.block, digit, lang));
      return lang === 'he'
        ? `הספרה ${digit} חייבת להופיע ${inUnit(unit, lang)}. כל שאר המשבצות הריקות בו חסומות: ${heClauses(clauses)}. לכן ${result}.`
        : `${digit} must appear ${inUnit(unit, lang)}. All the other empty cells in it are blocked: ${andList(clauses, lang)}. So ${result}.`;
    }
    case 'pointing': {
      const box: UnitRef = { kind: 'box', index: step.box };
      const rest = step.line.kind === 'row' ? 'השורה' : 'העמודה';
      return lang === 'he'
        ? `${inUnit(box, lang)}, הספרה ${step.digit} יכולה להיות רק ${inUnit(step.line, lang)}, ולכן היא נמחקת משאר ${rest}: ${cellList(step.removed, lang)}.`
        : `${capitalize(inUnit(box, lang))}, ${step.digit} can only be ${inUnit(step.line, lang)}, so it is removed from the rest of the ${step.line.kind === 'row' ? 'row' : 'column'}: ${cellList(step.removed, lang)}.`;
    }
    case 'claiming': {
      const box: UnitRef = { kind: 'box', index: step.box };
      return lang === 'he'
        ? `${inUnit(step.line, lang)}, הספרה ${step.digit} יכולה להיות רק ${inUnit(box, lang)}, ולכן היא נמחקת משאר הריבוע: ${cellList(step.removed, lang)}.`
        : `${capitalize(inUnit(step.line, lang))}, ${step.digit} can only be ${inUnit(box, lang)}, so it is removed from the rest of the box: ${cellList(step.removed, lang)}.`;
    }
    case 'nakedPair': {
      const [a, b] = step.cells.map((c) => cell(c, lang)) as [string, string];
      const digits = andList(step.digits, lang);
      const removed = cellList(
        step.removed.map((r) => r.cell),
        lang,
      );
      return lang === 'he'
        ? `${a} ו־${b} יכולות להכיל רק ${digits}, ולכן ${digits} נמחקות משאר ${unitName(step.unit, lang)}: ${removed}.`
        : `${a} and ${b} can only hold ${digits}, so ${digits} are removed from the rest of ${unitName(step.unit, lang)}: ${removed}.`;
    }
    case 'hiddenPair': {
      const [a, b] = step.cells.map((c) => cell(c, lang)) as [string, string];
      const digits = andList(step.digits, lang);
      return lang === 'he'
        ? `${inUnit(step.unit, lang)}, הספרות ${digits} יכולות להיות רק ב־${a} וב־${b}, ולכן שאר האפשרויות נמחקות מהן.`
        : `${capitalize(inUnit(step.unit, lang))}, ${digits} can only go in ${a} and ${b}, so their other candidates are removed.`;
    }
  }
}

/** The whole explanation as text. A chain is numbered, one step per line. */
export function formatExplanation(expl: Explanation, lang: Lang): string {
  if (expl.technique === 'beyond')
    return lang === 'he'
      ? `כאן נדרשת טכניקה מתקדמת שהמנוע עוד לא מסביר. התשובה: ${assign(expl.cell, expl.digit, lang)}.`
      : `This needs an advanced technique the engine can't explain yet. The answer: ${assign(expl.cell, expl.digit, lang)}.`;
  if (expl.technique !== 'chain') return formatStep(expl.steps[0]!, lang);
  const head =
    lang === 'he'
      ? `המשבצת הזו עוד לא נקבעת בצעד אחד. נדרשים ${expl.steps.length} צעדים:`
      : `This cell can't be decided in one step yet. It takes ${expl.steps.length} steps:`;
  return [head, ...expl.steps.map((s, k) => `${k + 1}. ${formatStep(s, lang)}`)].join('\n');
}

/** Why a played digit was wrong. */
export function formatWrong(reason: WrongReason, lang: Lang): string {
  if (reason.kind === 'conflict')
    return lang === 'he'
      ? `${reason.digit} כבר נמצא ${inUnit(reason.unit, lang)} (${cell(reason.cell, lang)}).`
      : `${reason.digit} is already ${inUnit(reason.unit, lang)} (${cellName(reason.cell)}).`;
  return lang === 'he'
    ? `${reason.digit} עוד אפשרי כאן, אבל הפתרון מחייב ${reason.answer}.`
    : `${reason.digit} still fits here, but the solution needs ${reason.answer}.`;
}

// -- staged practice (dev-plan §2ב) -------------------------------------------------------------------------

/** "2 או 5", "2, 5 או 8" / "2 or 5", "2, 5 or 8" */
function orList(items: readonly (string | number)[], lang: Lang): string {
  const s = items.map(String);
  if (s.length <= 1) return s.join('');
  const last = s[s.length - 1]!;
  const head = s.slice(0, -1).join(', ');
  return lang === 'he' ? `${head} או ${last}` : `${head} or ${last}`;
}

/**
 * Why `digit` can't go in `cell`, as one sentence with no full stop (a level's "why?", a wrong tap):
 * "E6 לא יכול להכיל 7: בשורה E יש 7" / "E6 can't hold 7: row E has a 7".
 */
export function formatBlock(c: number, block: Block, digit: Digit, lang: Lang): string {
  if (lang === 'he')
    return block.kind === 'step'
      ? `${cell(c, lang)} לא יכול להכיל ${digit}: הספרה ${digit} נמחקה ממנו בצעד ${block.step + 1}`
      : `${cell(c, lang)} לא יכול להכיל ${digit}: ${inUnit(block.unit, lang)} יש ${digit}`;
  return block.kind === 'step'
    ? `${cellName(c)} can't hold ${digit}: it was ruled out in step ${block.step + 1}`
    : `${cellName(c)} can't hold ${digit}: ${unitName(block.unit, lang)} has a ${digit}`;
}

/**
 * A digit in a chain cell that can't be known yet [D64], with no full stop: "עוד אי אפשר לדעת מה נכנס ב־A9
 * (2 או 5)" / "You can't tell yet what goes in A9 (2 or 5)". Without candidates the brackets are left out.
 */
export function formatNotYet(c: number, candidates: readonly Digit[], lang: Lang): string {
  const options = candidates.length ? ` (${orList(candidates, lang)})` : '';
  return lang === 'he'
    ? `עוד אי אפשר לדעת מה נכנס ב־${cell(c, lang)}${options}`
    : `You can't tell yet what goes in ${cellName(c)}${options}`;
}
