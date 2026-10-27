import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  candidates,
  createRng,
  type Digit,
  explain,
  generatePuzzle,
  parseCellName,
  parseGrid,
  parsePuzzleCsv,
  type Step,
  whyWrong,
} from '@sudoku-fight/engine';

import { flatten, placeholdersOf } from '../../../../../scripts/lib/i18n-locales.mjs';
import i18n from '..';
import {
  formatBlock,
  formatExplanation,
  formatNotYet,
  formatStep,
  formatWrong,
  stripIsolates,
  techniqueName,
} from '../explain';

/**
 * The explanations in words (spec §13.2; localization plan 0ו): the sentences the engine's tests used to check
 * (packages/engine/src/sudoku/explain.test.ts and generate.test.ts, which keep the data: techniques, cells,
 * digits), word for word, now from the 'explain' namespace. Hebrew follows the spec's examples exactly once the
 * direction isolates are removed; a cell name or formula is an LTR isolate in a right-to-left language only.
 */

const LRI = '⁦';
const PDI = '⁩';
const REPO = join(__dirname, '..', '..', '..', '..', '..');

/** A board with the given cells filled ({ D5: 7 }). */
function gridFrom(cells: Record<string, number>): number[] {
  const grid = new Array<number>(81).fill(0);
  for (const [name, digit] of Object.entries(cells)) grid[parseCellName(name)] = digit;
  return grid;
}

/** The original bank (assets/puzzles), as CSV rows. */
const bankRows = () =>
  parsePuzzleCsv(readFileSync(join(REPO, 'assets', 'puzzles', 'sudoku-bank-690.csv'), 'utf8'));

const NAKED = gridFrom({ D1: 1, D2: 2, D3: 4, D4: 5, D6: 6, D7: 8, A5: 3, H5: 9 });
const HIDDEN = gridFrom({ D6: 1, E4: 2, E5: 3, F4: 4, F5: 5, F6: 6, A4: 7, E1: 7 });
const D5 = parseCellName('D5');

beforeAll(async () => {
  await i18n.loadLanguages(['he', 'en']);
});

describe('explanations: the spec examples (§13.2)', () => {
  it('naked single, in Hebrew, exactly as in the spec', () => {
    const he = formatExplanation(explain(NAKED, D5), 'he');
    expect(stripIsolates(he)).toBe('D5 → 7. בשורה D חסרים 3, 7 ו־9. בעמודה 5 כבר יש 3 ו־9. לכן רק 7.');
    // The formula is isolated left-to-right, so it never turns around inside the Hebrew sentence.
    expect(he.startsWith(`${LRI}D5 → 7${PDI}.`)).toBe(true);
    expect(he).toBe('⁦D5 → 7⁩. בשורה D חסרים 3, 7 ו־9. בעמודה 5 כבר יש 3 ו־9. לכן רק 7.');
  });

  it('naked single, in English', () => {
    expect(formatExplanation(explain(NAKED, D5), 'en')).toBe(
      'D5 → 7. Row D is missing 3, 7 and 9. Column 5 already has 3 and 9. So only 7.',
    );
  });

  it('hidden single, in Hebrew, exactly as in the spec', () => {
    const he = formatExplanation(explain(HIDDEN, D5), 'he');
    expect(stripIsolates(he)).toBe(
      'הספרה 7 חייבת להופיע בריבוע 5. כל שאר המשבצות הריקות בו חסומות: ב־D4 יש 7 בעמודה 4, וב־E6 יש 7 בשורה E. לכן D5 = 7.',
    );
    expect(he).toContain(`ב־${LRI}D4${PDI}`);
    expect(he).toContain(`${LRI}D5 = 7${PDI}`);
    expect(he).toBe(
      'הספרה 7 חייבת להופיע בריבוע 5. כל שאר המשבצות הריקות בו חסומות: ב־⁦D4⁩ יש 7 בעמודה 4, וב־⁦E6⁩ יש 7 בשורה E. לכן ⁦D5 = 7⁩.',
    );
  });

  it('hidden single, in English', () => {
    expect(formatExplanation(explain(HIDDEN, D5), 'en')).toBe(
      '7 must appear in box 5. All the other empty cells in it are blocked: D4 sees a 7 in column 4 and E6 sees a 7 in row E. So D5 = 7.',
    );
  });

  it('a cell that is both a naked and a hidden single, said as the naked one', () => {
    const g = gridFrom({ A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6, A7: 7, A8: 8 });
    const e = explain(g, parseCellName('A9'));
    expect(stripIsolates(formatExplanation(e, 'he'))).toBe('A9 → 9. בשורה A חסר רק 9.');
    expect(formatExplanation(e, 'en')).toBe('A9 → 9. Row A is only missing 9.');
  });

  it('isolates by direction: Arabic (right to left) like Hebrew, a left-to-right language not at all', () => {
    const e = explain(HIDDEN, D5);
    // Arabic has no strings yet, so its words are English's; the isolates are its own.
    expect(formatExplanation(e, 'ar')).toContain(`${LRI}D5 = 7${PDI}`);
    expect(formatExplanation(e, 'ar-XB')).toContain(`${LRI}D4${PDI}`);
    expect(formatExplanation(e, 'de')).not.toMatch(/[⁦-⁩]/);
    expect(formatNotYet(parseCellName('A9'), [], 'ar')).toContain(`${LRI}A9${PDI}`);
  });

  it('every place that words an explanation passes the running language, not "English, else Hebrew"', () => {
    const MOBILE = join(__dirname, '..', '..', '..');
    for (const file of [
      'src/screens/replay/ReplayScreen.tsx',
      'src/screens/replay/replayModel.ts',
      'src/screens/levels/hud/ChainHud.tsx',
      'src/screens/levels/levelExplain.ts',
      'src/screens/levels/levelChrome.tsx',
      'src/levels/levelSession.ts',
      'app/levels/play.tsx',
    ]) {
      const source = readFileSync(join(MOBILE, file), 'utf8');
      expect({ file, choice: /=== 'en' \? 'en' : 'he'|'he' \| 'en'|type Lang\b/.test(source) }).toEqual({
        file,
        choice: false,
      });
    }
  });
});

describe('explanations: chains', () => {
  it('a chain is numbered, one step per line, under its head', () => {
    const { puzzle, solution } = bankRows()[0]!;
    const grid = parseGrid(puzzle);
    const sol = parseGrid(solution);
    let chains = 0;
    for (let cell = 0; cell < 81; cell++) {
      if (grid[cell]) continue;
      const e = explain(grid, cell, sol);
      if (e.steps.length < 2) continue;
      chains++;
      const he = stripIsolates(formatExplanation(e, 'he')).split('\n');
      expect(he[0]).toBe(`המשבצת הזו עוד לא נקבעת בצעד אחד. נדרשים ${e.steps.length} צעדים:`);
      expect(he).toHaveLength(e.steps.length + 1);
      expect(he[1]!.startsWith('1. ')).toBe(true);
      expect(formatExplanation(e, 'en').split('\n')[0]).toBe(
        `This cell can't be decided in one step yet. It takes ${e.steps.length} steps:`,
      );
    }
    expect(chains).toBeGreaterThan(0);
  });

  it('words every empty cell of the first puzzles of the bank', () => {
    for (const { puzzle, solution } of bankRows().slice(0, 15)) {
      const grid = parseGrid(puzzle);
      const sol = parseGrid(solution);
      for (let cell = 0; cell < 81; cell++) {
        if (grid[cell]) continue;
        const e = explain(grid, cell, sol);
        expect(formatExplanation(e, 'he').length).toBeGreaterThan(0);
        expect(formatExplanation(e, 'en').length).toBeGreaterThan(0);
      }
    }
  });

  it('says so when our techniques cannot reach the cell', () => {
    const e = explain(
      new Array<number>(81).fill(0),
      0,
      parseGrid('864371259325849761971265843436192587198657432257483916689734125713528694542916378'),
    );
    expect(stripIsolates(formatExplanation(e, 'he'))).toBe(
      'כאן נדרשת טכניקה מתקדמת שהמנוע עוד לא מסביר. התשובה: A1 → 8.',
    );
    expect(formatExplanation(e, 'en')).toBe(
      "This needs an advanced technique the engine can't explain yet. The answer: A1 → 8.",
    );
  });

  it('words a generated hard puzzle, eliminations included (from the generator test)', () => {
    const p = generatePuzzle(createRng(11), 'hard', { attempts: 40 })!;
    const texts: string[] = [];
    for (let cell = 0; cell < 81; cell++) {
      if (p.givens[cell]) continue;
      const e = explain(p.givens, cell, p.solution);
      if (e.resolved) texts.push(formatExplanation(e, 'he'));
    }
    expect(texts.some((t) => /נמחק/.test(t))).toBe(true);
  });
});

describe('step sentences', () => {
  it('words box-line reductions and pairs in both languages', () => {
    const pointing: Step = {
      id: 0,
      deps: [],
      technique: 'pointing',
      digit: 2,
      box: 3,
      line: { kind: 'row', index: 4 },
      removed: [parseCellName('E7'), parseCellName('E8')],
    };
    expect(stripIsolates(formatStep(pointing, 'he'))).toBe(
      'בריבוע 4, הספרה 2 יכולה להיות רק בשורה E, ולכן היא נמחקת משאר השורה: E7, E8.',
    );
    expect(formatStep(pointing, 'en')).toBe(
      'In box 4, 2 can only be in row E, so it is removed from the rest of the row: E7, E8.',
    );
    const claiming: Step = { ...pointing, technique: 'claiming', removed: [parseCellName('D1')] };
    expect(stripIsolates(formatStep(claiming, 'he'))).toBe(
      'בשורה E, הספרה 2 יכולה להיות רק בריבוע 4, ולכן היא נמחקת משאר הריבוע: D1.',
    );
    expect(formatStep(claiming, 'en')).toBe(
      'In row E, 2 can only be in box 4, so it is removed from the rest of the box: D1.',
    );
    const nakedPair: Step = {
      id: 0,
      deps: [],
      technique: 'nakedPair',
      unit: { kind: 'row', index: 4 },
      cells: [parseCellName('E2'), parseCellName('E7')],
      digits: [4, 9],
      removed: [{ cell: parseCellName('E1'), digits: [4] }],
    };
    expect(stripIsolates(formatStep(nakedPair, 'he'))).toBe(
      'E2 ו־E7 יכולות להכיל רק 4 ו־9, ולכן 4 ו־9 נמחקות משאר שורה E: E1.',
    );
    expect(formatStep(nakedPair, 'en')).toBe(
      'E2 and E7 can only hold 4 and 9, so 4 and 9 are removed from the rest of row E: E1.',
    );
    const hiddenPair: Step = { ...nakedPair, technique: 'hiddenPair' };
    expect(stripIsolates(formatStep(hiddenPair, 'he'))).toBe(
      'בשורה E, הספרות 4 ו־9 יכולות להיות רק ב־E2 וב־E7, ולכן שאר האפשרויות נמחקות מהן.',
    );
    expect(formatStep(hiddenPair, 'en')).toBe(
      'In row E, 4 and 9 can only go in E2 and E7, so their other candidates are removed.',
    );
  });

  it('words singles that rely on earlier eliminations', () => {
    const naked: Step = {
      id: 1,
      deps: [0],
      technique: 'nakedSingle',
      cell: D5,
      digit: 7,
      primary: { kind: 'row', index: 3 },
      missing: [3, 7, 9],
      seen: [{ unit: { kind: 'col', index: 4 }, digits: [3] }],
      eliminated: [{ digit: 9, step: 0 }],
    };
    expect(stripIsolates(formatStep(naked, 'he'))).toBe(
      'D5 → 7. בשורה D חסרים 3, 7 ו־9. בעמודה 5 כבר יש 3. 9 נמחק מ־D5 בצעד 1. לכן רק 7.',
    );
    expect(formatStep(naked, 'en')).toBe(
      'D5 → 7. Row D is missing 3, 7 and 9. Column 5 already has 3. 9 was ruled out of D5 in step 1. So only 7.',
    );
    const hidden: Step = {
      id: 1,
      deps: [0],
      technique: 'hiddenSingle',
      cell: D5,
      digit: 7,
      unit: { kind: 'box', index: 4 },
      blocked: [{ cell: parseCellName('D4'), block: { kind: 'step', step: 0 } }],
    };
    expect(stripIsolates(formatStep(hidden, 'he'))).toBe(
      'הספרה 7 חייבת להופיע בריבוע 5. כל שאר המשבצות הריקות בו חסומות: ב־D4 הספרה 7 כבר נמחקה (צעד 1). לכן D5 = 7.',
    );
    expect(formatStep(hidden, 'en')).toBe(
      '7 must appear in box 5. All the other empty cells in it are blocked: D4 lost the 7 in step 1. So D5 = 7.',
    );
    const alone: Step = { ...hidden, blocked: [] };
    expect(stripIsolates(formatStep(alone, 'he'))).toBe(
      'הספרה 7 חייבת להופיע בריבוע 5, ו־D5 היא המשבצת הריקה היחידה בו. לכן D5 = 7.',
    );
    expect(formatStep(alone, 'en')).toBe('7 must appear in box 5, and D5 is its only empty cell. So D5 = 7.');
  });

  it('names the techniques', () => {
    expect(techniqueName('nakedSingle', 'he')).toBe('בודד גלוי');
    expect(techniqueName('hiddenSingle', 'he')).toBe('בודד נסתר');
    expect(techniqueName('pointing', 'he')).toBe('צמצום ריבוע־שורה');
    expect(techniqueName('nakedPair', 'he')).toBe('זוג גלוי');
    expect(techniqueName('hiddenPair', 'he')).toBe('זוג נסתר');
    expect(techniqueName('chain', 'he')).toBe('טכניקה מתקדמת');
    expect(techniqueName('beyond', 'en')).toBe('Beyond the engine’s techniques');
    expect(techniqueName('claiming', 'en')).toBe('Box-line reduction');
  });
});

describe('why a digit is wrong', () => {
  it('points at the clash when there is one', () => {
    const r = whyWrong(NAKED, D5, 3);
    expect(stripIsolates(formatWrong(r, 'he'))).toBe('3 כבר נמצא בעמודה 5 (A5).');
    expect(formatWrong(r, 'en')).toBe('3 is already in column 5 (A5).');
  });

  it('otherwise says the solution needs another digit', () => {
    const { puzzle, solution } = bankRows()[0]!;
    const grid = parseGrid(puzzle);
    const sol = parseGrid(solution);
    const cell = grid.findIndex((v, i) => v === 0 && candidates(grid, i).length > 1);
    const played = candidates(grid, cell).find((d) => d !== sol[cell])!;
    const r = whyWrong(grid, cell, played, sol);
    expect(formatWrong(r, 'he')).toBe(`${played} עוד אפשרי כאן, אבל הפתרון מחייב ${sol[cell]}.`);
    expect(formatWrong(r, 'en')).toBe(`${played} still fits here, but the solution needs ${sol[cell]}.`);
  });
});

describe('the explain namespace', () => {
  const read = (lang: string) =>
    new Map(
      flatten(
        JSON.parse(readFileSync(join(__dirname, '..', 'locales', lang, 'explain.json'), 'utf8')) as object,
      ),
    );

  it('Hebrew says every placeholder English says; one may come twice ("הספרה 7 נמחקה ממנו" for "it")', () => {
    const en = read('en');
    const he = read('he');
    expect([...he.keys()].filter((k) => !en.has(k) && !k.endsWith('_two'))).toEqual([]);
    for (const [key, value] of he) {
      const english = en.get(key) ?? en.get(key.replace(/_two$/, '_other'));
      expect({ key, placeholders: placeholdersOf(value as string) }).toEqual({
        key,
        placeholders: placeholdersOf(english as string),
      });
    }
    expect(placeholdersOf(he.get('block.step') as string)).toEqual(['cell', 'digit', 'step']);
    expect(placeholdersOf('{{b}} {{a}}, {{a}}')).toEqual(['a', 'b']);
  });

  it('every unit sentence has a key per kind (no capitalizing or gluing in code)', () => {
    const en = read('en');
    for (const base of [
      'naked.onlyMissing',
      'naked.missing',
      'naked.seen',
      'hidden.alone',
      'hidden.blocked',
      'hidden.clause.unit',
      'nakedPair',
      'hiddenPair',
      'wrong.conflict',
      'block.unit',
    ])
      for (const kind of ['row', 'col', 'box']) expect(en.has(`${base}.${kind}`)).toBe(true);
    for (const base of ['pointing', 'claiming'])
      expect([en.has(`${base}.row`), en.has(`${base}.col`)]).toEqual([true, true]);
  });
});

describe('a level’s frame and sentences', () => {
  it('a hidden single framed in box 5, though the cell is a naked single', () => {
    const both = gridFrom({ D1: 1, D2: 2, D3: 4, D4: 5, D6: 6, D7: 8, A5: 3, H5: 9, E1: 7, F9: 7 });
    const e = explain(both, D5, undefined, { unit: { kind: 'box', index: 4 } });
    const he = stripIsolates(formatExplanation(e, 'he'));
    expect(
      he.startsWith('הספרה 7 חייבת להופיע בריבוע 5. כל שאר המשבצות הריקות בו חסומות: ב־E4 יש 7 בשורה E'),
    ).toBe(true);
    expect(he.endsWith('וב־F6 יש 7 בשורה F. לכן D5 = 7.')).toBe(true);
  });

  it('formatBlock: "E6 לא יכול להכיל 7: בשורה E יש 7", with the cell name isolated', () => {
    const e6 = parseCellName('E6');
    const block = {
      kind: 'unit' as const,
      unit: { kind: 'row' as const, index: 4 },
      cell: parseCellName('E1'),
    };
    const he = formatBlock(e6, block, 7, 'he');
    expect(stripIsolates(he)).toBe('E6 לא יכול להכיל 7: בשורה E יש 7');
    expect(he.startsWith(`${LRI}E6${PDI} `)).toBe(true);
    expect(he).toBe('⁦E6⁩ לא יכול להכיל 7: בשורה E יש 7');
    expect(formatBlock(e6, block, 7, 'en')).toBe("E6 can't hold 7: row E has a 7");
    const step = { kind: 'step' as const, step: 1 };
    expect(stripIsolates(formatBlock(e6, step, 7, 'he'))).toBe(
      'E6 לא יכול להכיל 7: הספרה 7 נמחקה ממנו בצעד 2',
    );
    expect(formatBlock(e6, step, 7, 'en')).toBe("E6 can't hold 7: it was ruled out in step 2");
  });

  it('formatNotYet: "עוד אי אפשר לדעת מה נכנס ב־A9 (2 או 5)", with the cell name isolated', () => {
    const a9 = parseCellName('A9');
    const two: Digit[] = [2, 5];
    const he = formatNotYet(a9, two, 'he');
    expect(stripIsolates(he)).toBe('עוד אי אפשר לדעת מה נכנס ב־A9 (2 או 5)');
    expect(he).toContain(`ב־${LRI}A9${PDI}`);
    expect(he).toBe('עוד אי אפשר לדעת מה נכנס ב־⁦A9⁩ (2 או 5)');
    expect(formatNotYet(a9, two, 'en')).toBe("You can't tell yet what goes in A9 (2 or 5)");
    expect(stripIsolates(formatNotYet(a9, [2, 5, 8], 'he'))).toBe(
      'עוד אי אפשר לדעת מה נכנס ב־A9 (2, 5 או 8)',
    );
    expect(formatNotYet(a9, [2, 5, 8], 'en')).toBe("You can't tell yet what goes in A9 (2, 5 or 8)");
    // The chain's toast (D64) names the cell only.
    expect(stripIsolates(formatNotYet(a9, [], 'he'))).toBe('עוד אי אפשר לדעת מה נכנס ב־A9');
  });
});
