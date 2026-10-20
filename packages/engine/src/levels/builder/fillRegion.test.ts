import { BOXES, type CellIndex, COLS, parseGrid, ROWS } from '../../sudoku/board';
import type { Technique } from '../../sudoku/logic';
import { seedFromString } from '../../util/random';
import { type FillLevelKind, fillRegionOf, FILL_LEVEL_KINDS, type LevelSpecOf } from '../spec';
import { transformLevel } from '../transform';
import { BuildError } from './common';
import {
  buildFillRegion,
  digitGapsOutside,
  FILL_CELL_NEEDS,
  type FillRegionPlan,
  fillRegionModelMs,
  fillRegionSolve,
  type FillTimeModel,
  fillUnitOf,
  givensAround,
  regionCellsOf,
  regionCloses,
} from './fillRegion';

/*
 * "Fill a region" (levels-content.md §4) [D67, D69]: one generator for the box, the row and the column; the
 * ladder of §4.3, the rule "every digit missing at least once" of §4.2, one answer by the chapter's
 * techniques, and the time model's inputs (§4.4). The plans here are the plan's own rows, not levels.config's,
 * so this file pins the builder whatever the config says.
 */

const NAKED: readonly Technique[] = ['nakedSingle'];
const SINGLES: readonly Technique[] = ['nakedSingle', 'hiddenSingle'];
const LOCKED: readonly Technique[] = ['pointing', 'claiming'];
const PAIRS: readonly Technique[] = ['nakedPair', 'hiddenPair'];
const ALL: readonly Technique[] = [...SINGLES, ...LOCKED, ...PAIRS];

interface LadderRow {
  chapter: number;
  missing: number;
  around: number;
  gaps: number;
  techniques: readonly Technique[];
  mustNeed: readonly Technique[];
}

/**
 * The table of §4.3 (the base slots' numbers): 2 → 9 missing, fewer givens around, every digit missing from
 * chapter 5, and the band's technique. 16–30 at the hard end of each band (the fewest givens around).
 */
const LADDER: readonly LadderRow[] = [
  { chapter: 1, missing: 2, around: 72, gaps: 0, techniques: NAKED, mustNeed: [] },
  { chapter: 2, missing: 3, around: 72, gaps: 0, techniques: NAKED, mustNeed: [] },
  { chapter: 3, missing: 3, around: 68, gaps: 0, techniques: NAKED, mustNeed: [] },
  { chapter: 4, missing: 4, around: 66, gaps: 0, techniques: NAKED, mustNeed: [] },
  { chapter: 5, missing: 4, around: 63, gaps: 1, techniques: NAKED, mustNeed: [] },
  { chapter: 6, missing: 5, around: 58, gaps: 1, techniques: SINGLES, mustNeed: ['hiddenSingle'] },
  { chapter: 7, missing: 5, around: 54, gaps: 1, techniques: SINGLES, mustNeed: ['hiddenSingle'] },
  { chapter: 8, missing: 6, around: 50, gaps: 1, techniques: SINGLES, mustNeed: ['hiddenSingle'] },
  { chapter: 9, missing: 6, around: 46, gaps: 1, techniques: SINGLES, mustNeed: ['hiddenSingle'] },
  { chapter: 10, missing: 7, around: 43, gaps: 1, techniques: SINGLES, mustNeed: ['hiddenSingle'] },
  { chapter: 11, missing: 7, around: 40, gaps: 1, techniques: SINGLES, mustNeed: [] },
  { chapter: 12, missing: 8, around: 38, gaps: 1, techniques: SINGLES, mustNeed: [] },
  { chapter: 13, missing: 8, around: 36, gaps: 1, techniques: SINGLES, mustNeed: [] },
  { chapter: 14, missing: 9, around: 35, gaps: 1, techniques: SINGLES, mustNeed: [] },
  { chapter: 15, missing: 9, around: 34, gaps: 1, techniques: SINGLES, mustNeed: [] },
  { chapter: 20, missing: 9, around: 30, gaps: 1, techniques: [...SINGLES, ...LOCKED], mustNeed: LOCKED },
  { chapter: 25, missing: 9, around: 27, gaps: 1, techniques: ALL, mustNeed: PAIRS },
  { chapter: 30, missing: 9, around: 24, gaps: 1, techniques: ALL, mustNeed: [...LOCKED, ...PAIRS] },
];

const rowOf = (chapter: number): LadderRow => LADDER.find((r) => r.chapter === chapter)!;

function planOf<K extends FillLevelKind>(
  kind: K,
  row: LadderRow,
  salt: string | number = 0,
  extra: Partial<FillRegionPlan<K>> = {},
): FillRegionPlan<K> {
  return {
    id: `T${row.chapter}`,
    rev: 2,
    chapter: row.chapter,
    slot: 5,
    kind,
    boss: false,
    seed: seedFromString(`${kind}:${row.chapter}:${salt}`),
    gameType: 'fast',
    timeLimitMs: 60000,
    missing: row.missing,
    around: row.around,
    minDigitGaps: row.gaps,
    stars: { by: 'timeMs', three: 10000, two: 15000, one: 20000 },
    logic: { techniques: row.techniques, mustNeed: row.mustNeed },
    ...extra,
  };
}

const builtOnce = new Map<string, LevelSpecOf<FillLevelKind>>();

/** The level of a ladder row, built once for the whole file (the hard rows take a fraction of a second each). */
function ladderLevel(kind: FillLevelKind, chapter: number): LevelSpecOf<FillLevelKind> {
  const key = `${kind}:${chapter}`;
  let spec = builtOnce.get(key);
  if (!spec) {
    spec = buildFillRegion(planOf(kind, rowOf(chapter))).spec;
    builtOnce.set(key, spec);
  }
  return spec;
}

const grids = (spec: LevelSpecOf<FillLevelKind>) => ({
  grid: parseGrid(spec.board.grid),
  solution: parseGrid(spec.board.solution),
});

/** The region of a built level, through the engine's one reader (fillRegionOf). */
function regionOf(spec: LevelSpecOf<FillLevelKind>) {
  const region = fillRegionOf(spec)!;
  return { ...region, all: regionCellsOf(region.unit, region.index) };
}

/** The time model's numbers for a "good" player (§4.4): assumptions, the profiles' to calibrate (D74). */
const GOOD: FillTimeModel = {
  orientMs: 2000,
  typeMs: 1000,
  thinkMs: { fullBoard: 2000, single: 3000, hiddenSingle: 4500, locked: 9000, pair: 12000, last: 500 },
};

describe('regions', () => {
  it('a fill kind plays its unit: fillBox a box, fillRow a row, fillCol a column [D69]', () => {
    expect(FILL_LEVEL_KINDS.map(fillUnitOf)).toEqual(['box', 'row', 'col']);
  });

  it("a region's nine cells, ascending: the box, the row (A–I) or the column (1–9)", () => {
    expect(regionCellsOf('box', 4)).toEqual(BOXES[4]!.cells);
    expect(regionCellsOf('row', 3)).toEqual([27, 28, 29, 30, 31, 32, 33, 34, 35]);
    expect(regionCellsOf('col', 5)).toEqual([5, 14, 23, 32, 41, 50, 59, 68, 77]);
    expect(regionCellsOf('col', 5)).toEqual(COLS[5]!.cells);
    expect(regionCellsOf('row', 8)).toEqual(ROWS[8]!.cells);
    for (const bad of [-1, 9, 1.5]) expect(() => regionCellsOf('row', bad)).toThrow(RangeError);
  });

  it('givens around a region, and every digit counted where it is missing outside the region (§4.2)', () => {
    const solution = parseGrid(buildFillRegion(planOf('fillRow', rowOf(1))).spec.board.solution);
    const grid = solution.slice();
    const row0 = regionCellsOf('row', 0);
    for (const c of row0.slice(0, 4)) grid[c] = 0; // inside: never counted
    grid[9] = 0; // B1, outside
    grid[80] = 0; // I9, outside
    expect(givensAround(grid, row0)).toBe(70);
    const gaps = digitGapsOutside(grid, solution, row0);
    const expected = new Array<number>(9).fill(0);
    expected[solution[9]! - 1]!++;
    expected[solution[80]! - 1]!++;
    expect(gaps).toEqual(expected);
  });
});

describe.each(FILL_LEVEL_KINDS)('buildFillRegion: %s', (kind) => {
  const unit = fillUnitOf(kind);

  it.each(LADDER.map((r) => [r.chapter, r] as const))(
    'the ladder (§4.3), chapter %i: the plan exactly, every digit missing outside, one answer by its techniques',
    (_, row) => {
      const plan = planOf(kind, row);
      const spec = ladderLevel(kind, row.chapter);
      const { grid, solution } = grids(spec);
      const region = regionOf(spec);
      // The kind's region and its shape (fillBox {box}, fillRow {row}, fillCol {col}).
      expect(spec.kind).toBe(kind);
      expect(region.unit).toBe(unit);
      expect(Object.keys(spec.targets).sort()).toEqual(['cells', unit].sort());
      // The editable cells are the region's empties, ascending, the plan's number of them.
      expect(region.cells).toEqual(region.all.filter((c) => grid[c] === 0));
      expect(region.cells).toHaveLength(row.missing);
      // The givens around: the plan's number, and they agree with the solution.
      expect(givensAround(grid, region.all)).toBe(row.around);
      expect(grid.every((v, c) => v === 0 || v === solution[c])).toBe(true);
      // Every digit missing at least `gaps` times outside the region (from chapter 5).
      const gaps = digitGapsOutside(grid, solution, region.all);
      if (row.gaps) expect(Math.min(...gaps)).toBeGreaterThanOrEqual(row.gaps);
      if (row.around === 72) expect(gaps.every((n) => n === 0)).toBe(true);
      // The region fills by itself with the chapter's techniques; where it must need one, not without it.
      expect(regionCloses(grid, region.cells, row.techniques)).toBe(true);
      const lean = row.techniques.filter((t) => !row.mustNeed.includes(t));
      if (row.mustNeed.length) expect(regionCloses(grid, region.cells, lean)).toBe(false);
      // The head and the check, as every built level has them.
      expect(spec).toMatchObject({
        id: plan.id,
        rev: 2,
        chapter: row.chapter,
        slot: 5,
        boss: false,
        seed: plan.seed,
        gameType: 'fast',
        timeLimitMs: 60000,
        stars: plan.stars,
        check: { techniques: [...row.techniques], mustNeed: [...row.mustNeed] },
      });
    },
  );

  it('the same seed builds the same level; another seed another one', () => {
    const plan = planOf(kind, rowOf(8), 'det');
    const a = buildFillRegion(plan);
    expect(buildFillRegion(plan)).toEqual(a);
    expect(buildFillRegion({ ...plan, seed: plan.seed + 1 }).spec.board).not.toEqual(a.spec.board);
  });

  it('the region goes round: the seed draws it, and a plan can set it', () => {
    const drawn = new Set(
      Array.from(
        { length: 14 },
        (_, k) => fillRegionOf(buildFillRegion(planOf(kind, rowOf(3), k)).spec)!.index,
      ),
    );
    expect(drawn.size).toBeGreaterThan(4);
    for (const index of [0, 4, 8]) {
      const spec = buildFillRegion(planOf(kind, rowOf(6), `i${index}`, { index })).spec;
      expect(fillRegionOf(spec)!.index).toBe(index);
    }
  });

  it('two empty cells of every digit outside, when the plan asks for two', () => {
    const plan = planOf(kind, rowOf(12), 'two', { minDigitGaps: 2, around: 36 });
    const { spec } = buildFillRegion(plan);
    const { grid, solution } = grids(spec);
    expect(Math.min(...digitGapsOutside(grid, solution, regionOf(spec).all))).toBeGreaterThanOrEqual(2);
    expect(givensAround(grid, regionOf(spec).all)).toBe(36);
  });

  it('"שוב" keeps it: attempts 2–8 are still a region of the kind, with the same counts and every digit missing', () => {
    const { spec } = buildFillRegion(planOf(kind, rowOf(9), 'again'));
    for (let attempt = 2; attempt <= 8; attempt++) {
      const moved = transformLevel(spec, attempt);
      const { grid, solution } = grids(moved);
      const region = regionOf(moved);
      expect(region.unit).toBe(unit);
      expect([...region.cells].sort((a, b) => a - b)).toEqual(region.all.filter((c) => grid[c] === 0));
      expect(givensAround(grid, region.all)).toBe(46);
      expect(Math.min(...digitGapsOutside(grid, solution, region.all))).toBeGreaterThanOrEqual(1);
      // Singles read the same on any equivalent board: it still needs its hidden single.
      expect(regionCloses(grid, region.cells, SINGLES)).toBe(true);
      expect(regionCloses(grid, region.cells, NAKED)).toBe(false);
    }
  });
});

describe('buildFillRegion: plans it cannot build', () => {
  it('refuses numbers that cannot be: missing, around, the room for every digit, the region', () => {
    const row = rowOf(5);
    const bad: Partial<FillRegionPlan>[] = [
      { missing: 0 },
      { missing: 10 },
      { missing: 2.5 },
      { around: 73 },
      { around: -1 },
      { minDigitGaps: -1 },
      { around: 64 }, // one empty cell for each of the 9 digits leaves at most 63
      { minDigitGaps: 2, around: 55 }, // two each: at most 54
      { index: 9 },
    ];
    for (const extra of bad)
      expect(() => buildFillRegion(planOf('fillBox', row, 'bad', extra))).toThrow(BuildError);
    expect(() =>
      buildFillRegion(planOf('fillBox', row, 'bad', { minDigitGaps: 2, around: 54 })),
    ).not.toThrow();
  });

  it('gives up after its tries when the techniques never fill the region', () => {
    const plan = planOf('fillCol', { ...rowOf(1), techniques: ['pointing'] }, 'never');
    expect(() => buildFillRegion(plan)).toThrow(/T1: no col of 2 with 72 around in 400 tries/);
  });
});

describe('fillRegionSolve: the time model inputs (§4.4)', () => {
  it.each(FILL_LEVEL_KINDS)(
    '%s: every empty cell of the region once, with its digit, the easiest first, the last one "last"',
    (kind) => {
      for (const row of [rowOf(3), rowOf(10), rowOf(20), rowOf(30)]) {
        const spec = ladderLevel(kind, row.chapter);
        const { grid, solution } = grids(spec);
        const solve = fillRegionSolve(grid, spec.targets.cells, row.techniques)!;
        expect(solve.fullBoard).toBe(false);
        expect(solve.steps.map((s) => s.cell).sort((a, b) => a - b)).toEqual([...spec.targets.cells]);
        expect(solve.steps.every((s) => s.digit === solution[s.cell])).toBe(true);
        expect(solve.steps.map((s) => s.need === 'last')).toEqual(
          solve.steps.map((_, i) => i === row.missing - 1),
        );
        expect(solve.steps.every((s) => FILL_CELL_NEEDS.includes(s.need))).toBe(true);
      }
    },
  );

  it.each(FILL_LEVEL_KINDS)('%s: what the chapter needs shows in the steps', (kind) => {
    const needs = (chapter: number) => {
      const row = rowOf(chapter);
      const spec = ladderLevel(kind, chapter);
      return new Set(
        fillRegionSolve(parseGrid(spec.board.grid), spec.targets.cells, row.techniques)!.steps.map(
          (s) => s.need,
        ),
      );
    };
    // Naked singles only (chapters 1–5): nothing harder than a single.
    for (const c of [1, 4, 5]) expect([...needs(c)].every((n) => n === 'single' || n === 'last')).toBe(true);
    // A hidden single must (6–10), pointing or claiming (16–20), a pair (21–25), any elimination (26–30).
    expect(needs(7).has('hiddenSingle')).toBe(true);
    expect(needs(20).has('locked')).toBe(true);
    expect(needs(20).has('pair')).toBe(false);
    expect(needs(25).has('pair')).toBe(true);
    const n30 = needs(30);
    expect(n30.has('locked') || n30.has('pair')).toBe(true);
  });

  it('the first chapters by the model are the table\'s "זמן משוער" for a good player (6.5, 9.5, 11.5, 15.5 s)', () => {
    for (const kind of FILL_LEVEL_KINDS)
      for (const [chapter, seconds] of [
        [1, 6.5],
        [2, 9.5],
        [3, 11.5],
        [4, 15.5],
      ] as const)
        for (const salt of [0, 1, 2]) {
          const row = rowOf(chapter);
          const { spec } = buildFillRegion(planOf(kind, row, salt));
          const solve = fillRegionSolve(parseGrid(spec.board.grid), spec.targets.cells, row.techniques)!;
          expect(solve.fullBoard).toBe(row.around === 72);
          expect(fillRegionModelMs(solve, GOOD)).toBe(seconds * 1000);
        }
  });

  it('prices each need by the model: orientation, then typing and thinking a cell', () => {
    const cell = (need: (typeof FILL_CELL_NEEDS)[number]) => ({ cell: 0, digit: 1 as const, need });
    const steps = [cell('single'), cell('hiddenSingle'), cell('locked'), cell('pair'), cell('last')];
    expect(fillRegionModelMs({ fullBoard: false, steps }, GOOD)).toBe(
      2000 + 5 * 1000 + 3000 + 4500 + 9000 + 12000 + 500,
    );
    // On a full board a single is quicker to see; nothing else changes.
    expect(fillRegionModelMs({ fullBoard: true, steps }, GOOD)).toBe(
      2000 + 5 * 1000 + 2000 + 4500 + 9000 + 12000 + 500,
    );
    expect(fillRegionModelMs({ fullBoard: true, steps: [] }, GOOD)).toBe(2000);
  });

  it('null exactly when the techniques leave the region unfilled, as regionCloses says', () => {
    expect(fillRegionSolve(new Array<number>(81).fill(0), regionCellsOf('row', 0), ALL)).toBeNull();
    for (const kind of FILL_LEVEL_KINDS)
      for (const chapter of [7, 20, 25]) {
        const row = rowOf(chapter);
        const spec = ladderLevel(kind, chapter);
        const grid = parseGrid(spec.board.grid);
        const lean = row.techniques.filter((t) => !row.mustNeed.includes(t));
        expect(fillRegionSolve(grid, spec.targets.cells, lean)).toBeNull();
        expect(fillRegionSolve(grid, spec.targets.cells, row.techniques)).not.toBeNull();
      }
  });

  it('a region already full has no steps', () => {
    const spec = ladderLevel('fillBox', 1);
    const solution = parseGrid(spec.board.solution);
    const cells: CellIndex[] = [...spec.targets.cells];
    expect(fillRegionSolve(solution, cells, NAKED)).toEqual({ fullBoard: true, steps: [] });
  });
});
