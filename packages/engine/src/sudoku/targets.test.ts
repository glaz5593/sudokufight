import type { FindTarget } from '../levels/spec';
import { bankPuzzles } from '../testing/bot';
import { bankRows, gridFrom } from '../testing/fixtures';
import { DIGITS, parseCellName, parseGrid } from './board';
import { LogicBoard, type Technique, TECHNIQUES } from './logic';
import { knowableCells } from './reading';
import { solve } from './solver';
import { boardScopeTarget, findTargets, placementsBefore, requiresTechniques, targetTier } from './targets';

const SINGLES: Technique[] = ['nakedSingle', 'hiddenSingle'];
const D5 = parseCellName('D5');
const BOX5 = { kind: 'box', index: 4 } as const;

/** 7 must go in D5 in box 5: D4 sees the 7 of column 4, E6 the 7 of row E (the spec's §13.2 example). */
const HIDDEN = gridFrom({ D6: 1, E4: 2, E5: 3, F4: 4, F5: 5, F6: 6, A4: 7, E1: 7 });
/** Row D leaves the 7 only D5 (D4 sees the 7 of column 4), but box 5 still has D5 and E6 for it. */
const ROW_ONLY = gridFrom({ D1: 1, D2: 2, D3: 3, D6: 4, D7: 5, D8: 6, D9: 8, A4: 7, E5: 1, F5: 2, F6: 3 });
/**
 * Box 2 has two places for the 1, A6 and C6 (row B sees B8, C4 and C5 see D4 and H5); box 1 keeps its 1 in
 * row A (pointing), which takes A6 away. Row C alone says C6 already.
 */
const POINTING = gridFrom({ B1: 2, B2: 3, B3: 4, C1: 5, C2: 6, C3: 7, B8: 1, D4: 1, H5: 1 });
/** HIDDEN without the 7 of row E: E9 must be 7 (column 9 and row E hold the rest), and then box 5 says D5. */
const TWO_STEP = gridFrom({
  D6: 1,
  E4: 2,
  E5: 3,
  F4: 4,
  F5: 5,
  F6: 6,
  A4: 7,
  A9: 1,
  B9: 4,
  C9: 5,
  G9: 6,
  H9: 8,
  I9: 9,
});

const target = (over: Partial<FindTarget> & Pick<FindTarget, 'digit' | 'scope' | 'cell'>): FindTarget => ({
  accept: over.cell === null ? [] : [over.cell],
  tier: 'single',
  ...over,
});

describe('find targets are scoped (plan §2.1, dev-plan §2ב)', () => {
  it('lists the 7 of box 5 in D5 as a single', () => {
    expect(findTargets(HIDDEN, { scopes: ['box'] })).toContainEqual({
      digit: 7,
      scope: BOX5,
      cell: D5,
      accept: [D5],
      tier: 'single',
    });
  });

  it('a 7 forced only by row D is not a target of box 5, although hiddenSingleAt finds it', () => {
    const board = new LogicBoard(ROW_ONLY);
    expect(board.hiddenSingleAt(D5, 7)).toMatchObject({ unit: { kind: 'row', index: 3 } });
    expect(board.placesOf(BOX5, 7)).toEqual([D5, parseCellName('E6')]);
    // Not even with every technique: box 5 keeps both places.
    expect(findTargets(ROW_ONLY, { scopes: ['box'] }).filter((t) => t.digit === 7)).toEqual([]);
    expect(requiresTechniques(ROW_ONLY, target({ digit: 7, scope: BOX5, cell: D5 }), TECHNIQUES, [])).toBe(
      false,
    );
    // It is a target of its row.
    expect(findTargets(ROW_ONLY, { scopes: ['row'] })).toContainEqual(
      target({ digit: 7, scope: { kind: 'row', index: 3 }, cell: D5 }),
    );
  });

  it('a target known only after a pointing has tier pointing and needs it', () => {
    const c6 = parseCellName('C6');
    const box2 = target({ digit: 1, scope: { kind: 'box', index: 1 }, cell: c6, tier: 'pointing' });
    expect(findTargets(POINTING, { scopes: ['box'] })).toContainEqual(box2);
    expect(targetTier(POINTING, box2)).toBe('pointing');
    expect(requiresTechniques(POINTING, box2, TECHNIQUES, ['pointing'])).toBe(true);
    expect(requiresTechniques(POINTING, box2, TECHNIQUES, ['claiming'])).toBe(false); // known without claiming
    // Without the pointing it is no target at all.
    expect(findTargets(POINTING, { scopes: ['box'], techniques: SINGLES })).toEqual([]);
    // The same cell is a plain single of row C.
    expect(targetTier(POINTING, { ...box2, scope: { kind: 'row', index: 2 } })).toBe('single');
  });

  it('requiresTechniques with an empty mustNeed only checks that the target is known', () => {
    const h = target({ digit: 7, scope: BOX5, cell: D5 });
    expect(requiresTechniques(HIDDEN, h, SINGLES, [])).toBe(true);
    expect(requiresTechniques(HIDDEN, h, TECHNIQUES, ['pointing'])).toBe(false); // known without the pointing
    expect(requiresTechniques(HIDDEN, h, ['nakedSingle'], [])).toBe(false); // a scoped target is a hidden single
    expect(requiresTechniques(TWO_STEP, h, TECHNIQUES, [])).toBe(false); // known only after E9
  });
});

describe('placementsBefore and chain2', () => {
  it('0 for a direct single, 1 for a target known after one other cell', () => {
    const h = target({ digit: 7, scope: BOX5, cell: D5 });
    expect(placementsBefore(HIDDEN, solve(HIDDEN)!, h)).toBe(0);
    const sol = solve(TWO_STEP)!;
    // Box 5 still has D5 and E6 for the 7; E9 is the only cell the singles know, and it is a 7.
    expect(new LogicBoard(TWO_STEP).placesOf(BOX5, 7)).toEqual([D5, parseCellName('E6')]);
    expect(knowableCells(TWO_STEP, SINGLES)).toEqual([parseCellName('E9')]);
    expect(placementsBefore(TWO_STEP, sol, h, SINGLES)).toBe(1);
    expect(placementsBefore(TWO_STEP, sol, h, SINGLES, 0)).toBeNull();
    expect(targetTier(TWO_STEP, h, SINGLES)).toBe('chain2');
    expect(findTargets(TWO_STEP, { scopes: ['box'], techniques: SINGLES, chain2: true })).toContainEqual({
      ...h,
      tier: 'chain2',
    });
    expect(findTargets(TWO_STEP, { scopes: ['box'], techniques: SINGLES })).not.toContainEqual(
      expect.objectContaining({ digit: 7, scope: BOX5 }),
    );
  });

  it('on bank boards every chain2 target takes exactly one placement', () => {
    for (const p of bankPuzzles('normal', 3)) {
      const grid = parseGrid(p.givens);
      const sol = parseGrid(p.solution);
      const chain2 = findTargets(grid, { chain2: true }).filter((t) => t.tier === 'chain2');
      expect(chain2.length).toBeGreaterThan(0);
      for (const t of chain2.slice(0, 5)) {
        expect(t.digit).toBe(sol[t.cell!]);
        expect(placementsBefore(grid, sol, t)).toBe(1);
      }
    }
  });
});

describe('targets on the bank', () => {
  it('every target digit is the solution digit of its cell (all 690 boards)', () => {
    let count = 0;
    for (const { puzzle, solution } of bankRows()) {
      const grid = parseGrid(puzzle);
      const sol = parseGrid(solution);
      for (const t of findTargets(grid)) {
        count++;
        expect(t.cell).not.toBeNull();
        expect(t.accept).toEqual([t.cell]);
        expect(sol[t.cell!]).toBe(t.digit);
      }
    }
    expect(count).toBeGreaterThan(690 * 20);
  });

  it('the tier is the easiest rung that knows the target', () => {
    const { puzzle } = bankRows()[0]!;
    const grid = parseGrid(puzzle);
    const all = findTargets(grid);
    const singles = findTargets(grid, { techniques: SINGLES });
    // Every single of the singles' list is a single of the full list too, and nothing else is.
    expect(all.filter((t) => t.tier === 'single')).toEqual(singles);
    for (const t of all) expect(targetTier(grid, t)).toBe(t.tier);
  });
});

describe('the scope "board" (plan §2.1)', () => {
  it('accepts every empty cell whose answer is the digit', () => {
    const p = bankPuzzles('fast', 1)[0]!;
    const grid = parseGrid(p.givens);
    const sol = parseGrid(p.solution);
    for (const d of DIGITS) {
      const t = boardScopeTarget(grid, sol, d);
      const cells = grid.flatMap((v, i) => (v === 0 && sol[i] === d ? [i] : []));
      if (!cells.length) {
        expect(t).toBeNull();
        continue;
      }
      expect(t).toMatchObject({ digit: d, scope: { kind: 'board' }, cell: null, accept: cells });
      expect(knowableCells(grid).some((c) => cells.includes(c))).toBe(true);
    }
  });

  it('is null when no cell of the digit is known', () => {
    let checked = 0;
    for (const p of bankPuzzles('hard', 30)) {
      const grid = parseGrid(p.givens);
      const sol = parseGrid(p.solution);
      const known = knowableCells(grid);
      for (const d of DIGITS) {
        const hasKnown = known.some((c) => sol[c] === d);
        const t = boardScopeTarget(grid, sol, d);
        if (hasKnown) expect(t).not.toBeNull();
        else {
          expect(t).toBeNull();
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    // No single among the techniques: nothing is ever known.
    const p = bankPuzzles('fast', 1)[0]!;
    expect(boardScopeTarget(parseGrid(p.givens), parseGrid(p.solution), 1, ['pointing'])).toBeNull();
  });
});
