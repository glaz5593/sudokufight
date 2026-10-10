import { candidates, cellName, parseCellName, parseGrid } from './board';
import { explain, whyWrong } from './explain';
import {
  formatExplanation,
  formatStep,
  formatWrong,
  LRI,
  PDI,
  stripIsolates,
  techniqueName,
} from './explainText';
import { isPlacement } from './logic';
import { bankRows, designScenarios, gridFrom } from '../testing/fixtures';

const NAKED = gridFrom({ D1: 1, D2: 2, D3: 4, D4: 5, D6: 6, D7: 8, A5: 3, H5: 9 });
const HIDDEN = gridFrom({ D6: 1, E4: 2, E5: 3, F4: 4, F5: 5, F6: 6, A4: 7, E1: 7 });
const D5 = parseCellName('D5');

describe('explain: the spec examples (§13.2)', () => {
  it('naked single, in Hebrew, exactly as in the spec', () => {
    const e = explain(NAKED, D5);
    expect(e).toMatchObject({ cell: D5, digit: 7, resolved: true, technique: 'nakedSingle' });
    expect(e.steps).toHaveLength(1);
    const he = formatExplanation(e, 'he');
    expect(stripIsolates(he)).toBe('D5 → 7. בשורה D חסרים 3, 7 ו־9. בעמודה 5 כבר יש 3 ו־9. לכן רק 7.');
    // The formula is isolated left-to-right, so it never turns around inside the Hebrew sentence.
    expect(he.startsWith(`${LRI}D5 → 7${PDI}.`)).toBe(true);
    expect(he).toMatchSnapshot();
  });

  it('naked single, in English', () => {
    expect(formatExplanation(explain(NAKED, D5), 'en')).toBe(
      'D5 → 7. Row D is missing 3, 7 and 9. Column 5 already has 3 and 9. So only 7.',
    );
  });

  it('hidden single, in Hebrew, exactly as in the spec', () => {
    const e = explain(HIDDEN, D5);
    expect(e).toMatchObject({ digit: 7, technique: 'hiddenSingle' });
    const he = formatExplanation(e, 'he');
    expect(stripIsolates(he)).toBe(
      'הספרה 7 חייבת להופיע בריבוע 5. כל שאר המשבצות הריקות בו חסומות: ב־D4 יש 7 בעמודה 4, וב־E6 יש 7 בשורה E. לכן D5 = 7.',
    );
    expect(he).toContain(`ב־${LRI}D4${PDI}`);
    expect(he).toContain(`${LRI}D5 = 7${PDI}`);
    expect(he).toMatchSnapshot();
  });

  it('hidden single, in English', () => {
    expect(formatExplanation(explain(HIDDEN, D5), 'en')).toBe(
      '7 must appear in box 5. All the other empty cells in it are blocked: D4 sees a 7 in column 4 and E6 sees a 7 in row E. So D5 = 7.',
    );
  });

  it('prefers a naked single when a cell is both', () => {
    // A full row but one cell: a naked single and a hidden single at once.
    const g = gridFrom({ A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6, A7: 7, A8: 8 });
    const e = explain(g, parseCellName('A9'));
    expect(e.technique).toBe('nakedSingle');
    expect(stripIsolates(formatExplanation(e, 'he'))).toBe('A9 → 9. בשורה A חסר רק 9.');
    expect(formatExplanation(e, 'en')).toBe('A9 → 9. Row A is only missing 9.');
  });

  it('refuses a filled cell or a board without a solution', () => {
    expect(() => explain(NAKED, parseCellName('D1'))).toThrow(RangeError);
    const deadEnd = gridFrom({ A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6, A7: 7, A8: 8, E9: 9 });
    expect(() => explain(deadEnd, parseCellName('B1'))).toThrow(/no solution/);
  });
});

describe('explain: chains', () => {
  it('a chain ends with the asked cell and keeps only the steps it needs', () => {
    const { puzzle, solution } = bankRows()[0]!;
    const grid = parseGrid(puzzle);
    const sol = parseGrid(solution);
    let chains = 0;
    for (let cell = 0; cell < 81; cell++) {
      if (grid[cell]) continue;
      const e = explain(grid, cell, sol);
      expect(e.resolved).toBe(true);
      expect(e.digit).toBe(sol[cell]);
      const last = e.steps[e.steps.length - 1]!;
      expect(isPlacement(last) && last.cell === cell && last.digit === e.digit).toBe(true);
      // Every step but the last is needed by a later one.
      e.steps.forEach((s, k) => {
        expect(s.id).toBe(k);
        for (const d of s.deps) expect(d).toBeLessThan(k);
        if (k < e.steps.length - 1) expect(e.steps.some((t) => t.deps.includes(k))).toBe(true);
      });
      expect(e.technique).toBe(e.steps.length > 1 ? 'chain' : last.technique);
      if (e.steps.length > 1) {
        chains++;
        const he = stripIsolates(formatExplanation(e, 'he')).split('\n');
        expect(he[0]).toBe(`המשבצת הזו עוד לא נקבעת בצעד אחד. נדרשים ${e.steps.length} צעדים:`);
        expect(he).toHaveLength(e.steps.length + 1);
        expect(he[1]!.startsWith('1. ')).toBe(true);
        expect(formatExplanation(e, 'en').split('\n')[0]).toBe(
          `This cell can't be decided in one step yet. It takes ${e.steps.length} steps:`,
        );
      }
    }
    expect(chains).toBeGreaterThan(0);
  });

  it('explains every empty cell of the first puzzles of the bank, with the solution digit', () => {
    for (const { puzzle, solution } of bankRows().slice(0, 15)) {
      const grid = parseGrid(puzzle);
      const sol = parseGrid(solution);
      for (let cell = 0; cell < 81; cell++) {
        if (grid[cell]) continue;
        const e = explain(grid, cell, sol);
        expect(e.digit).toBe(sol[cell]);
        expect(formatExplanation(e, 'he').length).toBeGreaterThan(0);
        expect(formatExplanation(e, 'en').length).toBeGreaterThan(0);
      }
    }
  });

  it('agrees with the explanations in the design fixtures', () => {
    for (const scenario of Object.values(designScenarios())) {
      const grid = parseGrid(scenario.puzzle);
      const sol = parseGrid(scenario.solution);
      for (const entry of scenario.log) {
        const cell = parseCellName(entry.cell);
        const e = explain(grid, cell, sol);
        expect(e.digit).toBe(entry.expl.digit);
        if (entry.type === 'correct') grid[cell] = entry.digit;
      }
    }
  });

  it('says so when our techniques cannot reach the cell', () => {
    // An empty board has many solutions; the logic finds nothing to do anywhere.
    const empty = new Array<number>(81).fill(0);
    const e = explain(
      empty,
      0,
      parseGrid('864371259325849761971265843436192587198657432257483916689734125713528694542916378'),
    );
    expect(e).toEqual({ cell: 0, digit: 8, resolved: false, steps: [], technique: 'beyond' });
    expect(stripIsolates(formatExplanation(e, 'he'))).toBe(
      'כאן נדרשת טכניקה מתקדמת שהמנוע עוד לא מסביר. התשובה: A1 → 8.',
    );
    expect(formatExplanation(e, 'en')).toBe(
      "This needs an advanced technique the engine can't explain yet. The answer: A1 → 8.",
    );
  });
});

describe('step sentences', () => {
  it('formats box-line reductions and pairs in both languages', () => {
    const pointing = {
      id: 0,
      deps: [],
      technique: 'pointing' as const,
      digit: 2 as const,
      box: 3,
      line: { kind: 'row' as const, index: 4 },
      removed: [parseCellName('E7'), parseCellName('E8')],
    };
    expect(stripIsolates(formatStep(pointing, 'he'))).toBe(
      'בריבוע 4, הספרה 2 יכולה להיות רק בשורה E, ולכן היא נמחקת משאר השורה: E7, E8.',
    );
    expect(formatStep(pointing, 'en')).toBe(
      'In box 4, 2 can only be in row E, so it is removed from the rest of the row: E7, E8.',
    );
    const claiming = { ...pointing, technique: 'claiming' as const, removed: [parseCellName('D1')] };
    expect(stripIsolates(formatStep(claiming, 'he'))).toBe(
      'בשורה E, הספרה 2 יכולה להיות רק בריבוע 4, ולכן היא נמחקת משאר הריבוע: D1.',
    );
    expect(formatStep(claiming, 'en')).toBe(
      'In row E, 2 can only be in box 4, so it is removed from the rest of the box: D1.',
    );
    const nakedPair = {
      id: 0,
      deps: [],
      technique: 'nakedPair' as const,
      unit: { kind: 'row' as const, index: 4 },
      cells: [parseCellName('E2'), parseCellName('E7')] as [number, number],
      digits: [4, 9] as [4, 9],
      removed: [{ cell: parseCellName('E1'), digits: [4] as [4] }],
    };
    expect(stripIsolates(formatStep(nakedPair, 'he'))).toBe(
      'E2 ו־E7 יכולות להכיל רק 4 ו־9, ולכן 4 ו־9 נמחקות משאר שורה E: E1.',
    );
    expect(formatStep(nakedPair, 'en')).toBe(
      'E2 and E7 can only hold 4 and 9, so 4 and 9 are removed from the rest of row E: E1.',
    );
    const hiddenPair = { ...nakedPair, technique: 'hiddenPair' as const };
    expect(stripIsolates(formatStep(hiddenPair, 'he'))).toBe(
      'בשורה E, הספרות 4 ו־9 יכולות להיות רק ב־E2 וב־E7, ולכן שאר האפשרויות נמחקות מהן.',
    );
    expect(formatStep(hiddenPair, 'en')).toBe(
      'In row E, 4 and 9 can only go in E2 and E7, so their other candidates are removed.',
    );
  });

  it('formats singles that rely on earlier eliminations', () => {
    const naked = {
      id: 1,
      deps: [0],
      technique: 'nakedSingle' as const,
      cell: D5,
      digit: 7 as const,
      primary: { kind: 'row' as const, index: 3 },
      missing: [3, 7, 9] as (3 | 7 | 9)[],
      seen: [{ unit: { kind: 'col' as const, index: 4 }, digits: [3] as 3[] }],
      eliminated: [{ digit: 9 as const, step: 0 }],
    };
    expect(stripIsolates(formatStep(naked, 'he'))).toBe(
      'D5 → 7. בשורה D חסרים 3, 7 ו־9. בעמודה 5 כבר יש 3. 9 נמחק מ־D5 בצעד 1. לכן רק 7.',
    );
    expect(formatStep(naked, 'en')).toBe(
      'D5 → 7. Row D is missing 3, 7 and 9. Column 5 already has 3. 9 was ruled out of D5 in step 1. So only 7.',
    );
    const hidden = {
      id: 1,
      deps: [0],
      technique: 'hiddenSingle' as const,
      cell: D5,
      digit: 7 as const,
      unit: { kind: 'box' as const, index: 4 },
      blocked: [{ cell: parseCellName('D4'), block: { kind: 'step' as const, step: 0 } }],
    };
    expect(stripIsolates(formatStep(hidden, 'he'))).toBe(
      'הספרה 7 חייבת להופיע בריבוע 5. כל שאר המשבצות הריקות בו חסומות: ב־D4 הספרה 7 כבר נמחקה (צעד 1). לכן D5 = 7.',
    );
    expect(formatStep(hidden, 'en')).toBe(
      '7 must appear in box 5. All the other empty cells in it are blocked: D4 lost the 7 in step 1. So D5 = 7.',
    );
    const alone = { ...hidden, blocked: [] };
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
    expect(r).toEqual({
      kind: 'conflict',
      digit: 3,
      unit: { kind: 'col', index: 4 },
      cell: parseCellName('A5'),
    });
    expect(stripIsolates(formatWrong(r, 'he'))).toBe('3 כבר נמצא בעמודה 5 (A5).');
    expect(formatWrong(r, 'en')).toBe('3 is already in column 5 (A5).');
  });

  it('otherwise says the solution needs another digit', () => {
    const { puzzle, solution } = bankRows()[0]!;
    const grid = parseGrid(puzzle);
    const sol = parseGrid(solution);
    // The first empty cell that can still take a digit the solution does not have.
    const cell = grid.findIndex((v, i) => v === 0 && candidates(grid, i).length > 1);
    const played = candidates(grid, cell).find((d) => d !== sol[cell])!;
    const r = whyWrong(grid, cell, played, sol);
    expect(r).toEqual({ kind: 'notSolution', digit: played, answer: sol[cell] });
    expect(formatWrong(r, 'he')).toBe(`${played} עוד אפשרי כאן, אבל הפתרון מחייב ${sol[cell]}.`);
    expect(formatWrong(r, 'en')).toBe(`${played} still fits here, but the solution needs ${sol[cell]}.`);
    expect(whyWrong(grid, cell, played)).toEqual(r); // solves the board itself when not given the solution
    expect(cellName(cell)).toMatch(/^[A-I][1-9]$/);
  });
});
