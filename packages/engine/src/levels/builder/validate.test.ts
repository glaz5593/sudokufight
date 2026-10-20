import { BOT_CONFIG, botConfig } from '../../bot/levels';
import { parseGrid } from '../../sudoku/board';
import { levelPlan, type LevelPlanOf, levelsOfKind } from '../levels.config';
import { LEVEL_RULES } from '../progress';
import type { LevelKind, LevelSpec, LevelSpecOf } from '../spec';
import { transformLevel } from '../transform';
import { CHECKED_ATTEMPTS } from './build';
import { buildChain } from './chain';
import { buildFillRegion } from './fillRegion';
import { buildFind } from './find';
import { buildPointHunter } from './pointHunter';
import { buildPuzzle } from './puzzle';
import { buildSpotError } from './spotError';
import { botConfigFingerprint, fillModelProblem, validateLevel, validateLevelSet } from './validate';

/* levels:validate catches what it must: each rule, broken on purpose, is a problem. */

/** The plan of the first level of a kind (in a chapter): picked by kind, never by a fixed id. */
const planOf = <K extends LevelKind>(kind: K, chapter?: number): LevelPlanOf<K> =>
  levelPlan(levelsOfKind(kind, chapter === undefined ? {} : { chapter })[0]!) as LevelPlanOf<K>;

const find = buildFind(planOf('find', 1)).spec;
/** Chapter 7's box: a hard slot, the next chapter's row (6 missing, a hidden single a must). */
const box = buildFillRegion(planOf('fillBox', 7)).spec;
/** Chapter 7's row: its own row of the ladder (5 missing, 54 around, every digit missing outside). */
const row = buildFillRegion(planOf('fillRow', 7)).spec;
const col = buildFillRegion(planOf('fillCol', 2)).spec;
const spot = buildSpotError(planOf('spotError', 8)).spec;
const hunter = buildPointHunter(planOf('pointHunter')).spec;
const chain = buildChain(planOf('chain', 9)).spec;
/** Chapter 4's puzzle: 4 moving boxes, where the blind swapper rule starts. */
const puzzle = buildPuzzle(planOf('puzzle', 4)).spec;

const problems = (spec: LevelSpec) => validateLevel(spec);
const withGrid = <S extends LevelSpec>(spec: S, edit: (g: number[]) => void): S => {
  const g = parseGrid(spec.board.grid);
  edit(g);
  return { ...spec, board: { ...spec.board, grid: g.join('') } };
};
const withTargets = (
  level: LevelSpecOf<'puzzle'>,
  t: Partial<LevelSpecOf<'puzzle'>['targets']>,
): LevelSpecOf<'puzzle'> => ({ ...level, targets: { ...level.targets, ...t } });

describe('validateLevel', () => {
  it('passes a built level of each kind', () => {
    expect([find, box, row, col, spot, hunter, chain, puzzle].flatMap(problems)).toEqual([]);
  });

  it('a target that is not where the digit must go', () => {
    const t = find.targets.target;
    const other = parseGrid(find.board.grid).findIndex((v, i) => v === 0 && i !== t.cell);
    const broken: LevelSpecOf<'find'> = {
      ...find,
      targets: { target: { ...t, cell: other, accept: [other] } },
    };
    expect(problems(broken).length).toBeGreaterThan(0);
  });

  it('thresholds out of order, or beyond the time limit; a time limit over the kind’s cap (30 s, 60 s) [D68]', () => {
    expect(
      problems({ ...find, stars: { by: 'timeMs', three: 10000, two: 5000, one: 20000 } }),
    ).toContainEqual(`${find.id}: the star thresholds are not ordered`);
    expect(
      problems({ ...find, stars: { by: 'timeMs', three: 5000, two: 10000, one: 25000 } }),
    ).toContainEqual(`${find.id}: a threshold lies beyond the time limit`);
    expect(problems({ ...find, timeLimitMs: 31000 })).toContainEqual(
      `${find.id}: time limit 31000 not within 30000`,
    );
    expect(problems({ ...box, timeLimitMs: 61000 })).toContainEqual(
      `${box.id}: time limit 61000 not within 60000`,
    );
    expect(problems({ ...puzzle, timeLimitMs: 61000 })).toContainEqual(
      `${puzzle.id}: time limit 61000 not within 60000`,
    );
  });

  it('an interference field, a bot pace outside ×0.7–×1.2', () => {
    expect(problems({ ...find, interferences: true } as LevelSpec)).toContainEqual(
      `${find.id}: an interference field`,
    );
    const race = { ...find, bot: { level: 1 as const, pace: 1.3 } };
    expect(problems(race)).toContainEqual(`${find.id}: bot pace 1.3`);
  });

  it('a boss with no bot [D72]', () => {
    expect(problems({ ...box, boss: true })).toContainEqual(`${box.id}: a boss needs its bot`);
  });

  it('givens outside the D43 range of the board type', () => {
    const sparse = withGrid(find, (g) => {
      for (let i = 0, n = 0; i < 81 && n < 6; i++)
        if (g[i] !== 0 && i !== find.targets.target.cell) {
          g[i] = 0;
          n++;
        }
    });
    expect(problems(sparse)).toContainEqual(`${find.id}: 44 givens, not 45–50 (fast)`);
  });

  it('a box that does not need what its row of the ladder needs, or has other empties', () => {
    const one = box.targets.cells[0]!;
    const easier = withGrid(box, (g) => {
      for (const c of box.targets.cells.slice(1)) g[c] = Number(box.board.solution[c]);
    });
    expect(problems({ ...easier, targets: { ...box.targets, cells: [one] } }).length).toBeGreaterThan(0);
  });

  it('a fill level with a given too many around (§4.3)', () => {
    const inside = new Set(row.targets.cells);
    const more = withGrid(row, (g) => {
      const c = g.findIndex((v, i) => v === 0 && !inside.has(i) && Math.floor(i / 9) !== row.targets.row);
      g[c] = Number(row.board.solution[c]);
    });
    expect(problems(more)).toContainEqual(`${row.id}: 55 givens around the row, not 54`);
  });

  it('a digit with no empty cell outside the region (§4.2: every digit missing, from chapter 5)', () => {
    const solution = parseGrid(row.board.solution);
    const inside = new Set(row.targets.cells);
    const filled = withGrid(row, (g) => {
      for (let i = 0; i < 81; i++) if (g[i] === 0 && !inside.has(i) && solution[i] === 7) g[i] = 7;
    });
    expect(problems(filled)).toContainEqual(
      `${row.id}: digit 7 has no empty cell outside the row (every digit must miss)`,
    );
  });

  it('a fill region slower than its ★★ by the good player’s time model [D67, D74] (the stored board only)', () => {
    expect([box, row, col].map(fillModelProblem)).toEqual([null, null, null]);
    const tight = { ...row, stars: { by: 'timeMs' as const, three: 5000, two: 10000, one: 50000 } };
    expect(fillModelProblem(tight)).toMatch(
      new RegExp(`^${row.id}: a good player needs [\\d.]+ s by the model, over its ★★ 10 s$`),
    );
    expect(fillModelProblem(find)).toBeNull();
  });

  it('a fillRow whose region turned into a column (a transposed "שוב") [D69]; its real attempts stay rows', () => {
    const transpose = (g: string) =>
      Array.from({ length: 81 }, (_, i) => g[(i % 9) * 9 + Math.floor(i / 9)]!).join('');
    const turnedCell = (c: number) => (c % 9) * 9 + Math.floor(c / 9);
    const turned: LevelSpecOf<'fillRow'> = {
      ...row,
      board: { grid: transpose(row.board.grid), solution: transpose(row.board.solution) },
      targets: { row: row.targets.row, cells: row.targets.cells.map(turnedCell) },
    };
    expect(problems(turned)).toContainEqual(`${row.id}: editable cells are not the row empties`);
    for (const a of CHECKED_ATTEMPTS) expect(problems(transformLevel(row, a))).toEqual([]);
  });

  it('a puzzle with two valid arrangements (its fixed boxes in one band)', () => {
    const moving = [3, 4, 5, 6, 7, 8];
    const start = [0, 1, 2, ...moving.map((_, k) => moving[(k + 1) % moving.length]!)];
    const out = problems(withTargets(puzzle, { start, fixed: [0, 1, 2] }));
    expect(out.some((p) => /\d+ valid arrangements, not one$/.test(p))).toBe(true);
  });

  it('a puzzle whose moving box starts at home, or whose start is not one cycle', () => {
    const { fixed } = puzzle.targets;
    const moving = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((p) => !fixed.includes(p));
    const [a, b, c, d] = moving as [number, number, number, number];
    const home = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    [home[a], home[b], home[c]] = [b, c, a];
    expect(problems(withTargets(puzzle, { start: home }))).toContainEqual(
      `${puzzle.id}: moving box ${d} starts at home`,
    );
    const two = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    [two[a], two[b], two[c], two[d]] = [b, a, d, c];
    expect(problems(withTargets(puzzle, { start: two }))).toContainEqual(
      `${puzzle.id}: the moving boxes make 2 cycles, not one`,
    );
  });

  it('a puzzle whose moving boxes or lock are not its chapter’s [D70a, D71]', () => {
    expect(problems({ ...puzzle, chapter: 7 })).toContainEqual(`${puzzle.id}: 4 moving boxes, not 5`);
    expect(problems(withTargets(puzzle, { lockOnCorrect: true }))).toContainEqual(
      `${puzzle.id}: lockOnCorrect true, not the chapter's false`,
    );
  });

  it('a puzzle from 4 moving boxes whose ★★★ a blind swapper reaches (§5.3)', () => {
    // Without the 5 s of a wrong swap (D70c), guessing pays, even at the chapter's own ★★★: the penalty is
    // what keeps a guesser out from 4 moving boxes.
    const blind = (spec: LevelSpec, rules = LEVEL_RULES) =>
      validateLevel(spec, rules).some((p) => /a blind swapper gets ★★★ in \d+% of its runs/.test(p));
    const free = { ...LEVEL_RULES, puzzleSwapPenaltyMs: 0 };
    expect([blind(puzzle), blind(puzzle, free)]).toEqual([false, true]);
  });

  it('a silent error that is called visible, a planted error that is right', () => {
    const e = spot.targets.errors[0]!;
    const flipped: LevelSpecOf<'spotError'> = {
      ...spot,
      targets: { errors: spot.targets.errors.map((x) => (x === e ? { ...x, visible: !x.visible } : x)) },
    };
    expect(problems(flipped).length).toBeGreaterThan(0);
  });

  it('a point hunter whose stored best is not the full search', () => {
    if (hunter.stars.by !== 'points') throw new Error('a point hunter goes by points');
    expect(
      problems({ ...hunter, stars: { ...hunter.stars, max: hunter.stars.max + 1 } }).length,
    ).toBeGreaterThan(0);
  });

  it('a chain out of order', () => {
    const [a, b, ...rest] = chain.targets.cells;
    expect(problems({ ...chain, targets: { cells: [b!, a!, ...rest] } }).length).toBeGreaterThan(0);
  });
});

describe('validateLevelSet', () => {
  it('wants the 300 levels in place, every box, row and column used', () => {
    const out = validateLevelSet({ botConfigFingerprint: botConfigFingerprint(), levels: [find] });
    expect(out).toContain('1 levels, not 300');
    expect(out.some((p) => p.startsWith('no fillBox in box'))).toBe(true);
    expect(out.some((p) => p.startsWith('no fillRow in row'))).toBe(true);
    expect(out.some((p) => p.startsWith('no fillCol in column'))).toBe(true);
  });
});

describe('botConfigFingerprint', () => {
  it('is stable, and changes with what the bots of the levels play by', () => {
    expect(botConfigFingerprint()).toBe(botConfigFingerprint(BOT_CONFIG));
    const slower = botConfig({
      levels: BOT_CONFIG.levels.map((l) =>
        l.level === 1 ? { ...l, thinkMs: { min: 16000, max: 25000 } } : l,
      ),
    });
    expect(botConfigFingerprint(slower)).not.toBe(botConfigFingerprint());
    const race = botConfig({
      find: { ...BOT_CONFIG.find, missShare: { ...BOT_CONFIG.find.missShare, 1: 0.2 } },
    });
    expect(botConfigFingerprint(race)).not.toBe(botConfigFingerprint());
  });

  it('not with what a level never uses (interferences, the pace levelBotConfig sets)', () => {
    const other = botConfig({
      levels: BOT_CONFIG.levels.map((l) => ({
        ...l,
        interference: { maxPerGame: 0, minDeficit: null, chance: 0 },
      })),
      pace: { fast: 2, normal: 2, hard: 2 },
    });
    expect(botConfigFingerprint(other)).toBe(botConfigFingerprint());
  });
});
