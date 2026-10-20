import { createGame } from '../game/engine';
import { defaultRules } from '../game/rules';
import { colOf, parseCellName, rowOf } from '../sudoku/board';
import { PUZZLE } from '../testing/game';
import {
  appLevelOf,
  CHAIN_LEVEL,
  DIGIT_LEVELS,
  DUEL_LEVEL,
  FILL_BOX_LEVEL,
  ME,
  PIP,
  POINT_HUNTER_LEVEL,
} from '../testing/levels';
import { LEVEL_RULES } from './progress';
import {
  type AppLevel,
  type AppLevelOf,
  FILL_LEVEL_KINDS,
  fillRegionOf,
  isFillKind,
  isLevelKind,
  isTapKind,
  LEVEL_KINDS,
  LEVEL_PENALTY_MS,
  levelEngineOf,
  levelGameConfig,
  levelModeFor,
  levelRulesFor,
  levelRunOf,
} from './spec';

/* What a level is, and the rules of each kind (plan §2, §3; dev-plan §2א). */

const target = {
  digit: 7 as const,
  scope: { kind: 'box' as const, index: 4 },
  cell: parseCellName('E5'),
  accept: [parseCellName('E5')],
  tier: 'single' as const,
};
const base = appLevelOf(FILL_BOX_LEVEL);
const FIND: AppLevel = { ...base, kind: 'find', targets: { target }, stars: FILL_BOX_LEVEL.stars };
const FIND_DUEL: AppLevel = {
  ...base,
  kind: 'findDuel',
  targets: { spots: [target] },
  stars: { by: 'spots', three: 4, two: 3, one: 2 },
  bot: { level: 1, pace: 1, findMs: [[8000, 12000]] },
};
const SPOT_ERROR: AppLevel = { ...base, kind: 'spotError', targets: { errors: [] } };

/** The empty cells of a row or a column of the test board (bank puzzle #1). */
const emptiesWhere = (inLine: (cell: number) => boolean) =>
  [...PUZZLE.givens].flatMap((g, i) => (g === '0' && inLine(i) ? [i] : []));
/** fillRow (1.0.3): row A's five empty cells, as fillBox's rules. */
const FILL_ROW: AppLevelOf<'fillRow'> = {
  ...base,
  id: 'L004',
  slot: 4,
  kind: 'fillRow',
  targets: { row: 0, cells: emptiesWhere((c) => rowOf(c) === 0) },
};
/** fillCol (1.0.3): column 1's empty cells. */
const FILL_COL: AppLevelOf<'fillCol'> = {
  ...base,
  id: 'L016',
  chapter: 2,
  slot: 6,
  kind: 'fillCol',
  targets: { col: 0, cells: emptiesWhere((c) => colOf(c) === 0) },
};
/** A puzzle (1.0.3): three boxes in a cycle, six fixed; the board is the solution. */
const PUZZLE_LEVEL: AppLevelOf<'puzzle'> = {
  ...base,
  id: 'L003',
  slot: 3,
  kind: 'puzzle',
  board: { grid: PUZZLE.solution, solution: PUZZLE.solution },
  timeLimitMs: 45000,
  stars: { by: 'timeMs', three: 26000, two: 36000, one: 45000 },
  targets: { start: [0, 5, 2, 3, 4, 6, 1, 7, 8], fixed: [0, 2, 3, 4, 7, 8], lockOnCorrect: false },
};

describe('the kinds', () => {
  it('are the ten of 1.0.3 (the new three at the end), three of them played by tapping', () => {
    expect(LEVEL_KINDS).toEqual([
      'find',
      'findDuel',
      'fillBox',
      'duel',
      'spotError',
      'pointHunter',
      'chain',
      'fillRow',
      'fillCol',
      'puzzle',
    ]);
    expect(LEVEL_KINDS).toHaveLength(10);
    expect(LEVEL_KINDS.filter(isTapKind)).toEqual(['find', 'findDuel', 'spotError']);
    expect(isLevelKind('chain')).toBe(true);
    expect(isLevelKind('puzzle')).toBe(true);
    expect(isLevelKind('boss')).toBe(false); // a boss is a mark on a level of its challenge's kind
  });

  it('fill a region: the box, the row and the column [D69]', () => {
    expect(FILL_LEVEL_KINDS).toEqual(['fillBox', 'fillRow', 'fillCol']);
    expect(LEVEL_KINDS.filter(isFillKind)).toEqual(['fillBox', 'fillRow', 'fillCol']);
  });

  it('which engine plays each: the tap kinds the tap engine, the puzzle its own, the rest the game engine', () => {
    expect(Object.fromEntries(LEVEL_KINDS.map((k) => [k, levelEngineOf(k)]))).toEqual({
      find: 'tap',
      findDuel: 'tap',
      fillBox: 'game',
      duel: 'game',
      spotError: 'tap',
      pointHunter: 'game',
      chain: 'game',
      fillRow: 'game',
      fillCol: 'game',
      puzzle: 'puzzle',
    });
  });
});

describe('fillRegionOf: one path for the box, the row and the column [D69]', () => {
  it('reads the unit, its index and its missing cells', () => {
    expect(fillRegionOf(FILL_BOX_LEVEL)).toEqual({
      unit: 'box',
      index: 4,
      cells: FILL_BOX_LEVEL.targets.cells,
    });
    expect(fillRegionOf(FILL_ROW)).toEqual({ unit: 'row', index: 0, cells: [0, 1, 4, 5, 7] });
    expect(fillRegionOf(FILL_COL)).toEqual({ unit: 'col', index: 0, cells: FILL_COL.targets.cells });
    expect(FILL_COL.targets.cells.length).toBeGreaterThan(0);
    expect(FILL_COL.targets.cells.every((c) => colOf(c) === 0)).toBe(true);
  });

  it('null for every kind that fills no region', () => {
    for (const spec of [
      FIND,
      FIND_DUEL,
      SPOT_ERROR,
      DUEL_LEVEL,
      POINT_HUNTER_LEVEL,
      CHAIN_LEVEL,
      PUZZLE_LEVEL,
    ])
      expect([spec.kind, fillRegionOf(spec)]).toEqual([spec.kind, null]);
  });
});

describe('levelRulesFor: the rules of each kind, in one place', () => {
  it('fillBox: its cells, its time, 5 s a mistake, no lock timer, the lock kept, no wait', () => {
    expect(levelRulesFor(FILL_BOX_LEVEL)).toEqual({
      editableCells: FILL_BOX_LEVEL.targets.cells,
      timeLimitMs: 20000,
      mistakeTimeMs: 5000,
      lockTimeout: false,
      afterMistake: 'keepLock',
      relockCooldownMs: 0,
    });
    expect(LEVEL_PENALTY_MS).toBe(5000);
  });

  it('duel: 30 points and 30 s, and nothing else (the game as it is)', () => {
    expect(levelRulesFor(DUEL_LEVEL)).toEqual({ endAtScore: 30, timeLimitMs: 30000 });
  });

  it('pointHunter: 3 moves, no lock timer, the lock kept, no wait', () => {
    expect(levelRulesFor(POINT_HUNTER_LEVEL)).toEqual({
      maxMoves: 3,
      timeLimitMs: 30000,
      lockTimeout: false,
      afterMistake: 'keepLock',
      relockCooldownMs: 0,
    });
  });

  it('chain: its cells in order, chainNotYet from LEVEL_RULES, 5 s a mistake, the locks of fillBox', () => {
    expect(levelRulesFor(CHAIN_LEVEL)).toEqual({
      chainCells: CHAIN_LEVEL.targets.cells,
      chainNotYet: 'accept',
      mistakeTimeMs: 5000,
      timeLimitMs: 24000,
      lockTimeout: false,
      afterMistake: 'keepLock',
      relockCooldownMs: 0,
    });
    // [D64] 'penalty' (the proposal) is a switch: a staging build's settings turn it on.
    expect(levelRulesFor(CHAIN_LEVEL, { ...LEVEL_RULES, chainNotYet: 'penalty' }).chainNotYet).toBe(
      'penalty',
    );
  });

  it('fillRow and fillCol: exactly fillBox’s rules on their own cells (editable, 5 s, no lock timer)', () => {
    for (const spec of [FILL_ROW, FILL_COL])
      expect(levelRulesFor(spec)).toEqual({
        editableCells: spec.targets.cells,
        timeLimitMs: 20000,
        mistakeTimeMs: LEVEL_PENALTY_MS,
        lockTimeout: false,
        afterMistake: 'keepLock',
        relockCooldownMs: 0,
      });
  });

  it('the tap kinds and the puzzle: only their limit (their own engines read the level itself)', () => {
    for (const spec of [FIND, FIND_DUEL, SPOT_ERROR])
      expect(levelRulesFor(spec)).toEqual({ timeLimitMs: 20000 });
    expect(levelRulesFor(PUZZLE_LEVEL)).toEqual({ timeLimitMs: 45000 });
  });

  it('no kind has an interference key [D49]', () => {
    for (const spec of [...DIGIT_LEVELS, FIND, FIND_DUEL, SPOT_ERROR, FILL_ROW, FILL_COL, PUZZLE_LEVEL])
      expect(Object.keys(levelRulesFor(spec)).filter((k) => k.startsWith('interfer'))).toEqual([]);
  });
});

describe('levelModeFor', () => {
  it('against the bot: findDuel and duel; alone: the rest', () => {
    const modes = [
      FIND,
      FIND_DUEL,
      FILL_BOX_LEVEL,
      DUEL_LEVEL,
      SPOT_ERROR,
      POINT_HUNTER_LEVEL,
      CHAIN_LEVEL,
      FILL_ROW,
      FILL_COL,
      PUZZLE_LEVEL,
    ].map((s) => [s.kind, levelModeFor(s)]);
    expect(modes).toEqual([
      ['find', 'solo'],
      ['findDuel', 'bot'],
      ['fillBox', 'solo'],
      ['duel', 'bot'],
      ['spotError', 'solo'],
      ['pointHunter', 'solo'],
      ['chain', 'solo'],
      ['fillRow', 'solo'],
      ['fillCol', 'solo'],
      ['puzzle', 'solo'],
    ]);
  });

  it('a boss follows its kind', () => {
    const bosses: AppLevel[] = [
      { ...FILL_BOX_LEVEL, boss: true },
      { ...DUEL_LEVEL, boss: true },
      { ...FIND_DUEL, boss: true },
    ];
    expect(bosses.map(levelModeFor)).toEqual(['solo', 'bot', 'bot']);
  });
});

describe('levelGameConfig: the game of a digit level’s attempt', () => {
  it('a duel: mode bot, me and Pip, the game type’s rules with the level’s, the run', () => {
    const config = levelGameConfig(DUEL_LEVEL, { id: 'g1', player: ME, attempt: 2 });
    expect(config).toMatchObject({
      id: 'g1',
      mode: 'bot',
      gameType: 'fast',
      puzzle: { id: 'L021:r1:a2', givens: DUEL_LEVEL.board.grid, solution: DUEL_LEVEL.board.solution },
      players: [ME, PIP],
      level: { id: 'L021', rev: 1, kind: 'duel', attempt: 2, stars: DUEL_LEVEL.stars },
    });
    expect(config.rules).toEqual(defaultRules('bot', 'fast', { endAtScore: 30, timeLimitMs: 30000 }));
    expect(config.rules.interferences).toBe(false);
  });

  it('the bot’s seed comes from the level and the attempt', () => {
    const seed = (attempt: number) => levelGameConfig(DUEL_LEVEL, { id: 'g', player: ME, attempt }).seed;
    expect(seed(1)).toBe(seed(1));
    expect(seed(2)).not.toBe(seed(1));
  });

  it('every digit fixture makes a game the engine takes', () => {
    for (const spec of DIGIT_LEVELS) {
      const config = levelGameConfig(spec, { id: 'g', player: ME, attempt: 1 });
      expect(() => createGame(config, 0)).not.toThrow();
      expect(config.players).toHaveLength(levelModeFor(spec) === 'bot' ? 2 : 1);
    }
  });

  it('the run carries the boss mark and the worth hint only when the level has them', () => {
    expect(levelRunOf(POINT_HUNTER_LEVEL, 1)).toEqual({
      id: 'L066',
      rev: 1,
      kind: 'pointHunter',
      attempt: 1,
      stars: POINT_HUNTER_LEVEL.stars,
      worthHint: true,
    });
    expect(levelRunOf({ ...DUEL_LEVEL, boss: true }, 1)).toMatchObject({ boss: true });
    expect(levelRunOf(FILL_BOX_LEVEL, 1)).not.toHaveProperty('boss');
  });

  it('a tap level is not a game of the engine; an attempt is 1 or more', () => {
    expect(() => levelGameConfig(FIND, { id: 'g', player: ME, attempt: 1 })).toThrow(RangeError);
    expect(() => levelGameConfig(FILL_BOX_LEVEL, { id: 'g', player: ME, attempt: 0 })).toThrow(RangeError);
  });

  it('the puzzle is not a game of the engine either: refused, as the tap kinds', () => {
    expect(() => levelGameConfig(PUZZLE_LEVEL, { id: 'g', player: ME, attempt: 1 })).toThrow(RangeError);
    expect(() => levelGameConfig(PUZZLE_LEVEL, { id: 'g', player: ME, attempt: 1 })).toThrow(/puzzle engine/);
  });

  it('fillRow and fillCol make a game the engine takes: alone, only their cells editable', () => {
    for (const spec of [FILL_ROW, FILL_COL]) {
      const config = levelGameConfig(spec, { id: 'g', player: ME, attempt: 1 });
      expect(() => createGame(config, 0)).not.toThrow();
      expect(config).toMatchObject({ mode: 'solo', players: [ME], level: { kind: spec.kind } });
      expect(config.rules.editableCells).toEqual(spec.targets.cells);
    }
  });
});
