import {
  agreesWith,
  boxOf,
  type CellIndex,
  colOf,
  type Digit,
  filledCount,
  isConsistent,
  isSolvedGrid,
  parseCellName,
  parseGrid,
  rowOf,
} from '../sudoku/board';
import { moveScore } from '../sudoku/scoring';
import { hasUniqueSolution } from '../sudoku/solver';
import { EMPTY, PUZZLE } from '../testing/game';
import { CHAIN_LEVEL, DIGIT_LEVELS, DUEL_LEVEL, FILL_BOX_LEVEL, POINT_HUNTER_LEVEL } from '../testing/levels';
import { LEVEL_RULES } from './progress';
import type { AppLevel, FindScope, FindTarget, LevelSpecOf } from './spec';
import { attemptLevel, transformLevel } from './transform';

/* "שוב" on an equivalent board [D63] (dev-plan §1.3 ה, §3.1). */

const ATTEMPTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const solution = parseGrid(PUZZLE.solution);

const inScope = (cell: CellIndex, scope: FindScope): boolean =>
  scope.kind === 'board' ||
  (scope.kind === 'box' ? boxOf(cell) : scope.kind === 'row' ? rowOf(cell) : colOf(cell)) === scope.index;

/** A find target as the solver gives it: the answer of `name`, in its box, row or column. */
function targetAt(name: string, kind: 'box' | 'row' | 'col'): FindTarget {
  const cell = parseCellName(name);
  const index = kind === 'box' ? boxOf(cell) : kind === 'row' ? rowOf(cell) : colOf(cell);
  return { digit: solution[cell] as Digit, scope: { kind, index }, cell, accept: [cell], tier: 'single' };
}

const FIND_DUEL: LevelSpecOf<'findDuel'> = {
  ...FILL_BOX_LEVEL,
  id: 'L014',
  kind: 'findDuel',
  targets: { spots: [targetAt('E5', 'box'), targetAt('A2', 'row'), targetAt('H9', 'col')] },
  stars: { by: 'spots', three: 4, two: 3, one: 2 },
  bot: { level: 1, pace: 1, findMs: [[8000, 12000]], missShare: 0.1 },
};
const BOARD_FIND: LevelSpecOf<'find'> = {
  ...FILL_BOX_LEVEL,
  id: 'L101',
  kind: 'find',
  targets: {
    target: {
      digit: 7,
      scope: { kind: 'board' },
      cell: null,
      accept: EMPTY.filter((c) => solution[c] === 7),
      tier: 'single',
    },
  },
};
/** "My" digits: every empty cell but two, right but for B1 (a wrong 9: a visible error) and C1 (a silent one). */
const mine = [...PUZZLE.givens].map((g, i) =>
  g !== '0' || i === parseCellName('A1') ? '0' : PUZZLE.solution[i],
);
mine[parseCellName('B1')] = '9';
mine[parseCellName('C1')] = '2';
const SPOT_ERROR: LevelSpecOf<'spotError'> = {
  ...FILL_BOX_LEVEL,
  id: 'L077',
  kind: 'spotError',
  board: { ...FILL_BOX_LEVEL.board, mine: mine.join('') },
  targets: {
    errors: [
      { cell: parseCellName('B1'), digit: 9, visible: true },
      { cell: parseCellName('C1'), digit: 2, visible: false },
    ],
  },
};
/** Every empty cell as a chain, in order: the mapped list gives where each cell went. */
const ALL_CELLS: LevelSpecOf<'chain'> = { ...CHAIN_LEVEL, targets: { cells: EMPTY } };

const LEVELS: AppLevel[] = [...DIGIT_LEVELS, FIND_DUEL, BOARD_FIND, SPOT_ERROR, ALL_CELLS];

describe('transformLevel', () => {
  it('attempt 1 is the stored level itself', () => {
    for (const spec of LEVELS) expect(transformLevel(spec, 1)).toBe(spec);
  });

  it('attempts 2 and 3 differ from the first and from each other, and are the same every time', () => {
    for (const spec of LEVELS) {
      const two = transformLevel(spec, 2);
      const three = transformLevel(spec, 3);
      expect(new Set([spec.board.solution, two.board.solution, three.board.solution]).size).toBe(3);
      expect(transformLevel(spec, 2)).toEqual(two);
    }
  });

  it.each(ATTEMPTS)(
    'attempt %i: a valid sudoku, its givens in its solution, as many as before',
    (attempt) => {
      const out = transformLevel(FILL_BOX_LEVEL, attempt);
      const grid = parseGrid(out.board.grid);
      const sol = parseGrid(out.board.solution);
      expect(isSolvedGrid(sol)).toBe(true);
      expect(isConsistent(grid)).toBe(true);
      expect(agreesWith(grid, sol)).toBe(true);
      expect(filledCount(grid)).toBe(filledCount(parseGrid(PUZZLE.givens)));
      expect(hasUniqueSolution(grid)).toBe(true);
    },
  );

  it.each(ATTEMPTS)(
    'attempt %i: every cell keeps its score (§6.4), the digits relabelled as one',
    (attempt) => {
      const out = transformLevel(ALL_CELLS, attempt);
      const grid = parseGrid(out.board.grid);
      const sol = parseGrid(out.board.solution);
      const relabel = new Map<number, number>();
      out.targets.cells.forEach((to, k) => {
        const from = EMPTY[k]!;
        expect(grid[to]).toBe(0);
        const was = relabel.get(solution[from]!);
        if (was === undefined) relabel.set(solution[from]!, sol[to]!);
        else expect(sol[to]).toBe(was);
        const before = moveScore(parseGrid(PUZZLE.givens), from, solution[from] as Digit);
        expect(moveScore(grid, to, sol[to] as Digit).points).toBe(before.points);
      });
      expect(new Set(relabel.values()).size).toBe(9);
      expect(new Set(out.targets.cells).size).toBe(EMPTY.length);
    },
  );

  it.each(ATTEMPTS)(
    'attempt %i: every target, box, error, chain step and best move moves with its digit',
    (attempt) => {
      const box = transformLevel(FILL_BOX_LEVEL, attempt);
      const boxGrid = parseGrid(box.board.grid);
      const emptyInBox = boxGrid.flatMap((v, i) => (v === 0 && boxOf(i) === box.targets.box ? [i] : []));
      expect([...box.targets.cells].sort((a, b) => a - b)).toEqual(emptyInBox);

      const duel = transformLevel(FIND_DUEL, attempt);
      const duelSol = parseGrid(duel.board.solution);
      for (const t of duel.targets.spots) {
        expect(duelSol[t.cell!]).toBe(t.digit);
        expect(inScope(t.cell!, t.scope)).toBe(true);
        expect(t.accept).toEqual([t.cell]);
        expect(t.tier).toBe('single');
      }

      const all = transformLevel(BOARD_FIND, attempt);
      const allGrid = parseGrid(all.board.grid);
      const allSol = parseGrid(all.board.solution);
      const t = all.targets.target;
      expect(t.scope).toEqual({ kind: 'board' });
      expect([...t.accept].sort((a, b) => a - b)).toEqual(
        allSol.flatMap((v, i) => (v === t.digit && allGrid[i] === 0 ? [i] : [])),
      );

      const spot = transformLevel(SPOT_ERROR, attempt);
      const spotSol = parseGrid(spot.board.solution);
      for (const e of spot.targets.errors) {
        expect(Number(spot.board.mine![e.cell])).toBe(e.digit);
        expect(spotSol[e.cell]).not.toBe(e.digit);
      }

      const hunt = transformLevel(POINT_HUNTER_LEVEL, attempt);
      const huntGrid = parseGrid(hunt.board.grid);
      let points = 0;
      for (const m of hunt.targets.best) {
        expect(parseGrid(hunt.board.solution)[m.cell]).toBe(m.digit);
        const p = moveScore(huntGrid, m.cell, m.digit).points;
        expect(p).toBe(m.points);
        huntGrid[m.cell] = m.digit;
        points += p;
      }
      expect(points).toBe(23.5);

      const chain = transformLevel(CHAIN_LEVEL, attempt);
      for (const c of chain.targets.cells) expect(parseGrid(chain.board.grid)[c]).toBe(0);
    },
  );

  it('the star rule, the limits, the bot and everything else stay', () => {
    for (const spec of LEVELS) {
      const { board: _a, targets: _b, ...rest } = transformLevel(spec, 2);
      const { board: _c, targets: _d, ...stored } = spec;
      expect(rest).toEqual(stored);
    }
    expect(transformLevel(DUEL_LEVEL, 2).targets).toEqual({ endAtScore: 30 });
    expect(transformLevel(POINT_HUNTER_LEVEL, 2).targets.maxMoves).toBe(3);
  });

  it('a scope may turn from a row to a column (the transpose), never lose its cell', () => {
    const kinds = new Set(ATTEMPTS.map((a) => transformLevel(FIND_DUEL, a).targets.spots[1]!.scope.kind));
    expect(kinds).toEqual(new Set(['row', 'col']));
  });

  it('an attempt is 1 or more', () => {
    expect(() => transformLevel(FILL_BOX_LEVEL, 0)).toThrow(RangeError);
    expect(() => transformLevel(FILL_BOX_LEVEL, 1.5)).toThrow(RangeError);
  });
});

describe('attemptLevel: only while LEVEL_RULES.replayTransform is on', () => {
  it('on (the default): the equivalent board; off: the stored one, every attempt', () => {
    expect(attemptLevel(DUEL_LEVEL, 2)).toEqual(transformLevel(DUEL_LEVEL, 2));
    expect(attemptLevel(DUEL_LEVEL, 1)).toBe(DUEL_LEVEL);
    expect(attemptLevel(DUEL_LEVEL, 2, { ...LEVEL_RULES, replayTransform: false })).toBe(DUEL_LEVEL);
  });
});
