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

/** fillRow and fillCol (1.0.3): row A's and column 1's empty cells. */
const emptiesOf = (grid: string, inLine: (cell: number) => boolean) =>
  [...grid].flatMap((g, i) => (g === '0' && inLine(i) ? [i] : []));
const FILL_ROW: LevelSpecOf<'fillRow'> = {
  ...FILL_BOX_LEVEL,
  id: 'L004',
  kind: 'fillRow',
  targets: { row: 0, cells: emptiesOf(PUZZLE.givens, (c) => rowOf(c) === 0) },
};
const FILL_COL: LevelSpecOf<'fillCol'> = {
  ...FILL_BOX_LEVEL,
  id: 'L016',
  kind: 'fillCol',
  targets: { col: 0, cells: emptiesOf(PUZZLE.givens, (c) => colOf(c) === 0) },
};
/**
 * A puzzle (1.0.3): the three boxes of the diagonal fixed (different bands and stacks), the other six one cycle:
 * place 1 holds the box of 2, 2 of 3, 3 of 5, 5 of 6, 6 of 7, 7 of 1.
 */
const PUZZLE_LEVEL: LevelSpecOf<'puzzle'> = {
  ...FILL_BOX_LEVEL,
  id: 'L003',
  kind: 'puzzle',
  board: { grid: PUZZLE.solution, solution: PUZZLE.solution },
  timeLimitMs: 60000,
  stars: { by: 'timeMs', three: 45000, two: 55000, one: 60000 },
  targets: { start: [0, 2, 3, 5, 4, 6, 7, 1, 8], fixed: [0, 4, 8], lockOnCorrect: false },
};

const LEVELS: AppLevel[] = [
  ...DIGIT_LEVELS,
  FIND_DUEL,
  BOARD_FIND,
  SPOT_ERROR,
  ALL_CELLS,
  FILL_ROW,
  FILL_COL,
  PUZZLE_LEVEL,
];

// ---------------------------------------------------------------------------------------------------------
// The puzzle, worked out here by brute force (the builder's own counting is levels/builder/puzzle.ts)

const band = (p: number) => Math.floor(p / 3);
const stack = (p: number) => p % 3;

/** The digits of box `home` of a solution, row by row: [i][j]. */
const boxRows = (sol: string, home: number): string[][] =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => sol[(3 * band(home) + i) * 9 + 3 * stack(home) + j]!));

/** The board shown when place p holds the box of at[p]. */
function assemble(sol: string, at: readonly number[]): string {
  const out = new Array<string>(81);
  at.forEach((home, p) => {
    const rows = boxRows(sol, home);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) out[(3 * band(p) + i) * 9 + 3 * stack(p) + j] = rows[i]![j]!;
  });
  return out.join('');
}

const isValidBoard = (grid: string): boolean => isSolvedGrid(parseGrid(grid));

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((x, k) =>
    permutations([...items.slice(0, k), ...items.slice(k + 1)]).map((rest) => [x, ...rest]),
  );
}

/** How many arrangements with the fixed boxes at home make a valid sudoku. */
function validArrangements(level: LevelSpecOf<'puzzle'>): number {
  const { fixed } = level.targets;
  const moving = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((p) => !fixed.includes(p));
  let count = 0;
  for (const homes of permutations(moving)) {
    const at = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    moving.forEach((p, k) => {
      at[p] = homes[k]!;
    });
    if (isValidBoard(assemble(level.board.solution, at))) count++;
  }
  return count;
}

/** Box `home` fits place p beside the placed boxes: no digit twice in a row or a column. */
function fits(sol: string, home: number, p: number, placed: ReadonlyMap<number, number>): boolean {
  const mine = boxRows(sol, home);
  for (const [q, other] of placed) {
    const theirs = boxRows(sol, other);
    for (let k = 0; k < 3; k++) {
      if (band(q) === band(p) && mine[k]!.some((d) => theirs[k]!.includes(d))) return false;
      if (stack(q) === stack(p) && mine.some((r) => theirs.some((s) => s[k] === r[k]))) return false;
    }
  }
  return true;
}

/** Solved one place at a time: a place only one box fits, or a box that fits only one place. */
function solvesStepByStep(level: LevelSpecOf<'puzzle'>): boolean {
  const sol = level.board.solution;
  const placed = new Map<number, number>(level.targets.fixed.map((p) => [p, p]));
  let places = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((p) => !placed.has(p));
  let boxes = places.map((p) => level.targets.start[p]!);
  while (places.length) {
    let step: [number, number] | null = null;
    for (const p of places) {
      const ok = boxes.filter((h) => fits(sol, h, p, placed));
      if (ok.length === 1) step = [p, ok[0]!];
    }
    for (const h of boxes) {
      const ok = places.filter((p) => fits(sol, h, p, placed));
      if (!step && ok.length === 1) step = [ok[0]!, h];
    }
    if (!step) return false;
    const [p, h] = step;
    placed.set(p, h);
    places = places.filter((x) => x !== p);
    boxes = boxes.filter((x) => x !== h);
  }
  return isValidBoard(
    assemble(
      sol,
      [...placed.entries()].sort((a, b) => a[0] - b[0]).map(([, h]) => h),
    ),
  );
}

/** The 72 moves of whole bands and stacks, with or without the transpose. */
function wholeBoxMoves(): { rows: number[]; cols: number[]; transpose: boolean }[] {
  const groups = permutations([0, 1, 2]);
  const spread = (g: number[]) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((r) => 3 * g[Math.floor(r / 3)]! + (r % 3));
  return groups.flatMap((rg) =>
    groups.flatMap((cg) =>
      [false, true].map((transpose) => ({ rows: spread(rg), cols: spread(cg), transpose })),
    ),
  );
}

/** One move of whole boxes and one relabel of the digits take every pair (a → b) at once. */
function sameWholeBoxMove(pairs: readonly (readonly [string, string])[]): boolean {
  return wholeBoxMoves().some(({ rows, cols, transpose }) => {
    const relabel = new Map<string, string>();
    return pairs.every(([a, b]) =>
      [...a].every((d, i) => {
        const r = rows[Math.floor(i / 9)]!;
        const c = cols[i % 9]!;
        const to = b[transpose ? c * 9 + r : r * 9 + c]!;
        const was = relabel.get(d);
        if (was === undefined) relabel.set(d, to);
        return (was ?? to) === to;
      }),
    );
  });
}

/** The moving boxes start as one cycle: following "place → the home of its box" visits them all. */
function isOneCycle(start: readonly number[], fixed: readonly number[]): boolean {
  const moving = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((p) => !fixed.includes(p));
  if (!moving.length) return true;
  const seen = new Set<number>();
  let p = moving[0]!;
  while (!seen.has(p)) {
    seen.add(p);
    p = start[p]!;
  }
  return p === moving[0] && seen.size === moving.length;
}

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

describe('transformLevel: fillRow and fillCol never transpose [D69]', () => {
  it.each(ATTEMPTS)(
    'attempt %i: a row stays a row, a column a column, its empty cells with it',
    (attempt) => {
      const row = transformLevel(FILL_ROW, attempt);
      expect(row.kind).toBe('fillRow');
      expect(row.targets.cells.every((c) => rowOf(c) === row.targets.row)).toBe(true);
      expect([...row.targets.cells].sort((a, b) => a - b)).toEqual(
        emptiesOf(row.board.grid, (c) => rowOf(c) === row.targets.row),
      );
      const col = transformLevel(FILL_COL, attempt);
      expect(col.kind).toBe('fillCol');
      expect(col.targets.cells.every((c) => colOf(c) === col.targets.col)).toBe(true);
      expect([...col.targets.cells].sort((a, b) => a - b)).toEqual(
        emptiesOf(col.board.grid, (c) => colOf(c) === col.targets.col),
      );
      // Still a fair sudoku, as every other kind's.
      expect(hasUniqueSolution(parseGrid(row.board.grid))).toBe(true);
    },
  );

  it('the row and the column do move: not the same index every attempt', () => {
    expect(new Set(ATTEMPTS.map((a) => transformLevel(FILL_ROW, a).targets.row)).size).toBeGreaterThan(1);
    expect(new Set(ATTEMPTS.map((a) => transformLevel(FILL_COL, a).targets.col)).size).toBeGreaterThan(1);
  });
});

describe('transformLevel: the puzzle moves whole boxes only [D63]', () => {
  it('the fixture: one valid arrangement, solved step by step, one cycle of six', () => {
    expect(validArrangements(PUZZLE_LEVEL)).toBe(1);
    expect(solvesStepByStep(PUZZLE_LEVEL)).toBe(true);
    expect(isOneCycle(PUZZLE_LEVEL.targets.start, PUZZLE_LEVEL.targets.fixed)).toBe(true);
  });

  it.each(ATTEMPTS)(
    'attempt %i: the board is its solution, the fixed boxes at home, the moving ones away and one cycle',
    (attempt) => {
      const out = transformLevel(PUZZLE_LEVEL, attempt);
      const { start, fixed, lockOnCorrect } = out.targets;
      expect(out.board.grid).toBe(out.board.solution);
      expect(isSolvedGrid(parseGrid(out.board.solution))).toBe(true);
      expect([...start].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(fixed).toHaveLength(3);
      expect([...fixed].sort((a, b) => a - b)).toEqual(fixed);
      for (let p = 0; p < 9; p++) expect(start[p] === p).toBe(fixed.includes(p));
      expect(new Set(fixed.map(band)).size).toBe(3);
      expect(new Set(fixed.map(stack)).size).toBe(3);
      expect(isOneCycle(start, fixed)).toBe(true);
      expect(lockOnCorrect).toBe(false);
    },
  );

  it.each(ATTEMPTS)(
    'attempt %i: still exactly one valid arrangement, still solved step by step, no box broken',
    (attempt) => {
      const out = transformLevel(PUZZLE_LEVEL, attempt);
      expect(validArrangements(out)).toBe(1);
      expect(solvesStepByStep(out)).toBe(true);
      // One move of whole bands and stacks (and maybe the transpose), and one relabel, takes both the solution
      // and the board as it starts: every box moved as one piece, and the start moved with it.
      expect(
        sameWholeBoxMove([
          [PUZZLE_LEVEL.board.solution, out.board.solution],
          [
            assemble(PUZZLE_LEVEL.board.solution, PUZZLE_LEVEL.targets.start),
            assemble(out.board.solution, out.targets.start),
          ],
        ]),
      ).toBe(true);
    },
  );

  it('a row inside its band never moves alone: a whole-box move always explains an attempt', () => {
    // The default draw would shuffle rows inside their bands: then no whole-box move takes the solution over.
    const moved = ATTEMPTS.map((a) => transformLevel(PUZZLE_LEVEL, a).board.solution);
    for (const sol of moved) expect(sameWholeBoxMove([[PUZZLE_LEVEL.board.solution, sol]])).toBe(true);
    const chain = transformLevel(ALL_CELLS, 2).board.solution;
    expect(sameWholeBoxMove([[PUZZLE.solution, chain]])).toBe(false);
  });

  it('the transpose still happens in some attempts (the start moves with it)', () => {
    const fixedSets = new Set(ATTEMPTS.map((a) => transformLevel(PUZZLE_LEVEL, a).targets.fixed.join()));
    expect(fixedSets.size).toBeGreaterThan(1);
  });
});

describe('attemptLevel: only while LEVEL_RULES.replayTransform is on', () => {
  it('on (the default): the equivalent board; off: the stored one, every attempt', () => {
    expect(attemptLevel(DUEL_LEVEL, 2)).toEqual(transformLevel(DUEL_LEVEL, 2));
    expect(attemptLevel(DUEL_LEVEL, 1)).toBe(DUEL_LEVEL);
    expect(attemptLevel(DUEL_LEVEL, 2, { ...LEVEL_RULES, replayTransform: false })).toBe(DUEL_LEVEL);
  });
});
