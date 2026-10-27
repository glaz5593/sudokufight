import { candidates, cellName, type Digit, DIGITS, parseCellName, parseGrid, PEERS } from './board';
import { explain, explainSpotError, whyWrong } from './explain';
import { isPlacement, type Technique } from './logic';
import { bankPuzzles } from '../testing/bot';
import { bankRows, designScenarios, gridFrom } from '../testing/fixtures';

/**
 * The explanations as data (spec §13.2): the technique, the steps, their cells and digits. Their words are the
 * app's (apps/mobile/src/i18n/explain.ts, localization plan 0ו), tested there with the sentences these tests
 * used to check.
 */

const NAKED = gridFrom({ D1: 1, D2: 2, D3: 4, D4: 5, D6: 6, D7: 8, A5: 3, H5: 9 });
const HIDDEN = gridFrom({ D6: 1, E4: 2, E5: 3, F4: 4, F5: 5, F6: 6, A4: 7, E1: 7 });
const D5 = parseCellName('D5');

describe('explain: the spec examples (§13.2)', () => {
  it('naked single: D5 → 7, row D missing 3, 7 and 9, column 5 holding 3 and 9', () => {
    const e = explain(NAKED, D5);
    expect(e).toMatchObject({ cell: D5, digit: 7, resolved: true, technique: 'nakedSingle' });
    expect(e.steps).toEqual([
      {
        id: 0,
        deps: [],
        technique: 'nakedSingle',
        cell: D5,
        digit: 7,
        primary: { kind: 'row', index: 3 },
        missing: [3, 7, 9],
        seen: [{ unit: { kind: 'col', index: 4 }, digits: [3, 9] }],
        eliminated: [],
      },
    ]);
  });

  it('hidden single: 7 must appear in box 5, D4 and E6 blocked by column 4 and row E', () => {
    const e = explain(HIDDEN, D5);
    expect(e).toMatchObject({ digit: 7, technique: 'hiddenSingle' });
    expect(e.steps[0]).toMatchObject({
      technique: 'hiddenSingle',
      cell: D5,
      digit: 7,
      unit: { kind: 'box', index: 4 },
      blocked: [
        { cell: parseCellName('D4'), block: { kind: 'unit', unit: { kind: 'col', index: 3 } } },
        { cell: parseCellName('E6'), block: { kind: 'unit', unit: { kind: 'row', index: 4 } } },
      ],
    });
  });

  it('prefers a naked single when a cell is both', () => {
    // A full row but one cell: a naked single and a hidden single at once.
    const g = gridFrom({ A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6, A7: 7, A8: 8 });
    const e = explain(g, parseCellName('A9'));
    expect(e.technique).toBe('nakedSingle');
    expect(e.steps[0]).toMatchObject({ primary: { kind: 'row', index: 0 }, missing: [9], seen: [] });
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
      if (e.steps.length > 1) chains++;
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
        expect(e.steps.length > 0).toBe(e.technique !== 'beyond');
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
    // Box 5's other empty cells, E4 first and F6 last, each blocked by its row's 7.
    const blocked = e.steps[0]!.technique === 'hiddenSingle' ? e.steps[0]!.blocked : [];
    expect(blocked[0]).toMatchObject({
      cell: parseCellName('E4'),
      block: { kind: 'unit', unit: { kind: 'row', index: 4 } },
    });
    expect(blocked[blocked.length - 1]).toMatchObject({
      cell: parseCellName('F6'),
      block: { kind: 'unit', unit: { kind: 'row', index: 5 } },
    });
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
