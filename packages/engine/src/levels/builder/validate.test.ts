import { BOT_CONFIG, botConfig } from '../../bot/levels';
import { parseGrid } from '../../sudoku/board';
import { levelPlan, type LevelPlanOf } from '../levels.config';
import type { LevelSpec, LevelSpecOf } from '../spec';
import { buildChain } from './chain';
import { buildFillBox } from './fillBox';
import { buildFind } from './find';
import { buildPointHunter } from './pointHunter';
import { buildSpotError } from './spotError';
import { botConfigFingerprint, validateLevel, validateLevelSet } from './validate';

/* levels:validate catches what it must: each rule, broken on purpose, is a problem. */

const find = buildFind(levelPlan(1) as LevelPlanOf<'find'>).spec;
const box = buildFillBox(levelPlan(53) as LevelPlanOf<'fillBox'>).spec;
const spot = buildSpotError(levelPlan(77) as LevelPlanOf<'spotError'>).spec;
const hunter = buildPointHunter(levelPlan(66) as LevelPlanOf<'pointHunter'>).spec;
const chain = buildChain(levelPlan(85) as LevelPlanOf<'chain'>).spec;

const problems = (spec: LevelSpec) => validateLevel(spec);
const withGrid = <S extends LevelSpec>(spec: S, edit: (g: number[]) => void): S => {
  const g = parseGrid(spec.board.grid);
  edit(g);
  return { ...spec, board: { ...spec.board, grid: g.join('') } };
};

describe('validateLevel', () => {
  it('passes a built level of each kind', () => {
    expect([find, box, spot, hunter, chain].flatMap(problems)).toEqual([]);
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

  it('thresholds out of order, or beyond the time limit; a time limit over 30 s', () => {
    expect(
      problems({ ...find, stars: { by: 'timeMs', three: 10000, two: 5000, one: 20000 } }),
    ).toContainEqual('L001: the star thresholds are not ordered');
    expect(
      problems({ ...find, stars: { by: 'timeMs', three: 5000, two: 10000, one: 25000 } }),
    ).toContainEqual('L001: a threshold lies beyond the time limit');
    expect(problems({ ...find, timeLimitMs: 31000 })).toContainEqual(
      'L001: time limit 31000 not within 30000',
    );
  });

  it('an interference field, a bot pace outside ×0.7–×1.2', () => {
    expect(problems({ ...find, interferences: true } as LevelSpec)).toContainEqual(
      'L001: an interference field',
    );
    const race = { ...find, bot: { level: 1 as const, pace: 1.3 } };
    expect(problems(race)).toContainEqual('L001: bot pace 1.3');
  });

  it('givens outside the D43 range of the board type', () => {
    const sparse = withGrid(find, (g) => {
      for (let i = 0, n = 0; i < 81 && n < 6; i++)
        if (g[i] !== 0 && i !== find.targets.target.cell) {
          g[i] = 0;
          n++;
        }
    });
    expect(problems(sparse)).toContainEqual('L001: 44 givens, not 45–50 (fast)');
  });

  it('a box that does not need what its band needs, or has other empties', () => {
    const one = box.targets.cells[0]!;
    const easier = withGrid(box, (g) => {
      for (const c of box.targets.cells.slice(1)) g[c] = Number(box.board.solution[c]);
    });
    expect(problems({ ...easier, targets: { ...box.targets, cells: [one] } }).length).toBeGreaterThan(0);
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
  it('wants the 300 levels in place, every box used', () => {
    const out = validateLevelSet({ botConfigFingerprint: botConfigFingerprint(), levels: [find] });
    expect(out).toContain('1 levels, not 300');
    expect(out.some((p) => p.startsWith('no fillBox in box'))).toBe(true);
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
