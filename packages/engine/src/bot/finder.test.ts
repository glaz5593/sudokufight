import { TARGET_TIERS } from '../levels/spec';
import { BOXES, parseCellName, parseGrid, ROWS } from '../sudoku/board';
import { boardTarget, target } from '../testing/findLevels';
import { PUZZLE } from '../testing/game';
import { createRng } from '../util/random';
import { BOT_MISS_AT, chooseWrongTap, findMsRange } from './finder';
import { BOT_CONFIG, BOT_LEVEL_IDS, botConfig } from './levels';

/* The bot of the race (plan §2.2; spec §9) [D61]: its search ranges, and its plausible wrong taps. */

describe('findMsRange (plan §2.2): the level, × 1.3 for every tier but a single, × the pace', () => {
  it.each(BOT_LEVEL_IDS)('level %i: a single at pace 1 is its base', (level) => {
    const { min, max } = BOT_CONFIG.find.ms[level];
    expect(findMsRange(level, 'single', 1)).toEqual([min, max]);
  });

  it('× 1.3 for every tier that is not a single', () => {
    for (const tier of TARGET_TIERS.filter((t) => t !== 'single'))
      expect([tier, findMsRange(1, tier, 1)]).toEqual([tier, [10_400, 15_600]]);
  });

  it('× the pace, which is final: a boss at ×0.9 of a ×1.1 chapter is just 0.99, no boss factor on top', () => {
    expect(findMsRange(4, 'single', 0.8)).toEqual([3200, 4800]);
    expect(findMsRange(4, 'pointing', 1.1)).toEqual([5720, 8580]);
    expect(findMsRange(2, 'single', 1.1 * 0.9)).toEqual([Math.round(6500 * 0.99), Math.round(10_000 * 0.99)]);
    expect(findMsRange.length).toBe(3); // level, tier, pace (and the config): nothing for a boss
  });

  it('reads the config it is given, and refuses a pace that is not positive', () => {
    const config = botConfig({
      find: { ...BOT_CONFIG.find, tierFactor: { ...BOT_CONFIG.find.tierFactor, single: 2 } },
    });
    expect(findMsRange(5, 'single', 1, config)).toEqual([6000, 9000]);
    expect(() => findMsRange(1, 'single', 0)).toThrow(RangeError);
    expect(() => findMsRange(1, 'single', Number.NaN)).toThrow(RangeError);
  });
});

describe('chooseWrongTap (plan §2.2): an empty cell of the scope that is not the answer', () => {
  const grid = parseGrid(PUZZLE.givens);

  it('a box: one of its other empty cells, each of them in time', () => {
    const t = target(9, 'box', 4, 'D5');
    const empty = BOXES[4]!.cells.filter((c) => grid[c] === 0 && c !== t.cell);
    const rng = createRng(1);
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const cell = chooseWrongTap(grid, t, rng)!;
      expect(empty).toContain(cell);
      seen.add(cell);
    }
    expect(seen.size).toBe(empty.length);
  });

  it('a row, and the whole board: never an accepted cell, never a filled one', () => {
    const row = target(6, 'row', 8, 'I6');
    const rng = createRng(2);
    for (let k = 0; k < 100; k++) {
      const cell = chooseWrongTap(grid, row, rng)!;
      expect(ROWS[8]!.cells).toContain(cell);
      expect(grid[cell]).toBe(0);
      expect(cell).not.toBe(parseCellName('I6'));
    }
    const board = boardTarget(9, ['C1', 'D5', 'F7', 'G3']);
    for (let k = 0; k < 100; k++) {
      const cell = chooseWrongTap(grid, board, rng)!;
      expect(grid[cell]).toBe(0);
      expect(board.accept).not.toContain(cell);
    }
  });

  it('null when the scope has no other empty cell', () => {
    const full = grid.slice();
    for (const c of BOXES[4]!.cells) if (c !== parseCellName('D5')) full[c] = 1;
    expect(chooseWrongTap(full, target(9, 'box', 4, 'D5'), createRng(3))).toBeNull();
  });

  it('comes 30–80% into the search', () => {
    expect(BOT_MISS_AT).toEqual({ min: 0.3, max: 0.8 });
  });
});
