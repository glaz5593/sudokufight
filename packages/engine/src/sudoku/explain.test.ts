import { candidates, cellName, type Digit, DIGITS, parseCellName, parseGrid, PEERS } from './board';
import { explain, explainSpotError, whyWrong } from './explain';
import {
  formatBlock,
  formatExplanation,
  formatNotYet,
  formatStep,
  formatWrong,
  LRI,
  PDI,
  stripIsolates,
  techniqueName,
} from './explainText';
import { isPlacement, type Technique } from './logic';
import { bankPuzzles } from '../testing/bot';
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

// ---------------------------------------------------------------------------------------------------------
// Staged practice (dev-plan §2ב)

const SINGLES: Technique[] = ['nakedSingle', 'hiddenSingle'];
const BOX5 = { kind: 'box', index: 4 } as const;
/** D5: a naked single (row D and column 5 hold the rest) and box 5's only place for 7 (rows E, F). */
const BOTH = gridFrom({ D1: 1, D2: 2, D3: 4, D4: 5, D6: 6, D7: 8, A5: 3, H5: 9, E1: 7, F9: 7 });

describe('explain: the frame and the techniques of a level', () => {
  it('frames a hidden single in box 5 even when the cell is a naked single', () => {
    expect(explain(BOTH, D5).technique).toBe('nakedSingle');
    const e = explain(BOTH, D5, undefined, { unit: BOX5 });
    expect(e).toMatchObject({ cell: D5, digit: 7, resolved: true, technique: 'hiddenSingle' });
    expect(e.steps[0]).toMatchObject({ unit: BOX5 });
    const he = stripIsolates(formatExplanation(e, 'he'));
    expect(
      he.startsWith('הספרה 7 חייבת להופיע בריבוע 5. כל שאר המשבצות הריקות בו חסומות: ב־E4 יש 7 בשורה E'),
    ).toBe(true);
    expect(he.endsWith('וב־F6 יש 7 בשורה F. לכן D5 = 7.')).toBe(true);
  });

  it('keeps the classic explanation without options, and falls back when the frame never applies', () => {
    expect(explain(HIDDEN, D5, undefined, {})).toEqual(explain(HIDDEN, D5));
    // Row A does not hold D5: the cell is decided another way, and that step ends the explanation.
    const e = explain(BOTH, D5, undefined, { unit: { kind: 'row', index: 0 } });
    expect(e.resolved).toBe(true);
    const last = e.steps[e.steps.length - 1]!;
    expect(isPlacement(last) && last.cell === D5 && last.digit === 7).toBe(true);
  });

  it('takes the digit without a solution (a chain board may have several), and checks it against one', () => {
    expect(explain(BOTH, D5, undefined, { digit: 7, unit: BOX5 }).technique).toBe('hiddenSingle');
    const { puzzle, solution } = bankRows()[0]!;
    const grid = parseGrid(puzzle);
    const sol = parseGrid(solution);
    const cell = grid.indexOf(0);
    const wrong = DIGITS.find((d) => d !== sol[cell])!;
    expect(() => explain(grid, cell, sol, { digit: wrong })).toThrow(RangeError);
    expect(explain(grid, cell, sol, { digit: sol[cell] as Digit })).toEqual(explain(grid, cell, sol));
  });

  it('limits the steps to the techniques asked for', () => {
    let narrowed = 0;
    for (const p of bankPuzzles('hard', 3)) {
      const grid = parseGrid(p.givens);
      const sol = parseGrid(p.solution);
      for (let cell = 0; cell < 81; cell++) {
        if (grid[cell]) continue;
        const full = explain(grid, cell, sol);
        const singles = explain(grid, cell, sol, { techniques: SINGLES });
        for (const s of singles.steps) expect(SINGLES).toContain(s.technique);
        if (singles.resolved) expect(singles.digit).toBe(sol[cell]);
        if (full.steps.some((s) => !isPlacement(s)) && !singles.resolved) narrowed++;
      }
    }
    expect(narrowed).toBeGreaterThan(0);
  });
});

describe('level sentences', () => {
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
    expect(he).toMatchSnapshot();
    expect(formatBlock(e6, block, 7, 'en')).toBe("E6 can't hold 7: row E has a 7");
    const step = { kind: 'step' as const, step: 1 };
    expect(stripIsolates(formatBlock(e6, step, 7, 'he'))).toBe(
      'E6 לא יכול להכיל 7: הספרה 7 נמחקה ממנו בצעד 2',
    );
    expect(formatBlock(e6, step, 7, 'en')).toBe("E6 can't hold 7: it was ruled out in step 2");
  });

  it('formatNotYet: "עוד אי אפשר לדעת מה נכנס ב־A9 (2 או 5)", with the cell name isolated', () => {
    const a9 = parseCellName('A9');
    const he = formatNotYet(a9, [2, 5], 'he');
    expect(stripIsolates(he)).toBe('עוד אי אפשר לדעת מה נכנס ב־A9 (2 או 5)');
    expect(he).toContain(`ב־${LRI}A9${PDI}`);
    expect(he).toMatchSnapshot();
    expect(formatNotYet(a9, [2, 5], 'en')).toBe("You can't tell yet what goes in A9 (2 or 5)");
    expect(stripIsolates(formatNotYet(a9, [2, 5, 8], 'he'))).toBe(
      'עוד אי אפשר לדעת מה נכנס ב־A9 (2, 5 או 8)',
    );
    expect(formatNotYet(a9, [2, 5, 8], 'en')).toBe("You can't tell yet what goes in A9 (2, 5 or 8)");
    // The chain's toast (D64) names the cell only.
    expect(stripIsolates(formatNotYet(a9, [], 'he'))).toBe('עוד אי אפשר לדעת מה נכנס ב־A9');
  });
});

describe('explainSpotError (plan Idea-1)', () => {
  const { puzzle, solution } = bankRows()[0]!;
  const givens = parseGrid(puzzle);
  const sol = parseGrid(solution);
  const empty = givens.flatMap((v, i) => (v === 0 ? [i] : []));
  /** "My" digits: the solution on the first 20 empty cells, with the planted errors in their cells. */
  const mineWith = (errors: { cell: number; digit: Digit }[]): number[] => {
    const mine = new Array<number>(81).fill(0);
    for (const c of empty.slice(0, 20)) mine[c] = sol[c]!;
    for (const e of errors) mine[e.cell] = e.digit;
    return mine;
  };
  /** The board the player sees, with `cell` emptied. */
  const shownWithout = (mine: readonly number[], cell: number): number[] =>
    mine.map((v, i) => (i === cell ? 0 : givens[i] || v));
  // A visible error clashes with a given; a silent one with nothing the player sees.
  const visibleCell = empty[2]!;
  const visibleDigit = DIGITS.find(
    (d) => d !== sol[visibleCell] && PEERS[visibleCell]!.some((p) => givens[p] === d),
  )!;
  const withVisible = mineWith([{ cell: visibleCell, digit: visibleDigit }]);
  const silentCell = empty.find(
    (c) => c !== visibleCell && candidates(shownWithout(withVisible, c), c).some((d) => d !== sol[c]),
  )!;
  const silentDigit = candidates(shownWithout(withVisible, silentCell), silentCell).find(
    (d) => d !== sol[silentCell],
  )!;
  const errors = [
    { cell: visibleCell, digit: visibleDigit },
    { cell: silentCell, digit: silentDigit },
  ];
  const mine = mineWith(errors);

  it('a visible error: the clash with a given', () => {
    const r = explainSpotError(givens, mine, visibleCell, visibleDigit, sol);
    expect(r.reason).toMatchObject({ kind: 'conflict', digit: visibleDigit });
    if (r.reason.kind !== 'conflict') throw new Error('unreachable');
    expect(givens[r.reason.cell]).toBe(visibleDigit);
    expect(PEERS[visibleCell]).toContain(r.reason.cell);
    expect(r.explanation).toMatchObject({ cell: visibleCell, digit: sol[visibleCell], resolved: true });
  });

  it('a silent error: not the solution, and why the right digit holds', () => {
    const r = explainSpotError(givens, mine, silentCell, silentDigit, sol);
    expect(r.reason).toEqual({ kind: 'notSolution', digit: silentDigit, answer: sol[silentCell] });
    expect(r.explanation).toMatchObject({ cell: silentCell, digit: sol[silentCell], resolved: true });
  });

  it('never throws with other planted errors on the board, and keeps to the techniques', () => {
    const more = [...errors];
    for (const c of empty.slice(20, 26)) more.push({ cell: c, digit: DIGITS.find((d) => d !== sol[c])! });
    const board = mineWith(more);
    for (const e of more) {
      const r = explainSpotError(givens, board, e.cell, e.digit, sol, SINGLES);
      expect(r.explanation.digit).toBe(sol[e.cell]);
      for (const s of r.explanation.steps) expect(SINGLES).toContain(s.technique);
    }
    expect(() => explainSpotError(givens, board, visibleCell, sol[visibleCell] as Digit, sol)).toThrow(
      RangeError,
    );
    const given = givens.findIndex((v) => v !== 0);
    expect(() => explainSpotError(givens, board, given, 1, sol)).toThrow(RangeError);
  });
});
