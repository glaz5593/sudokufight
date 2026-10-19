import { BOXES, filledCount } from '../../sudoku/board';
import { generatePuzzle } from '../../sudoku/generate';
import { gradePuzzle } from '../../sudoku/grade';
import { hasUniqueSolution } from '../../sudoku/solver';
import { createRng } from '../../util/random';
import { fitBoard, makeBoard } from './boards';

/* The builder's boards (dev-plan §2ד): a generated puzzle filled up to the chapter's givens. */

describe('makeBoard', () => {
  it.each([
    ['fast', 48],
    ['normal', 37],
    ['hard', 27],
  ] as const)(
    'a %s puzzle with exactly %i givens and one solution, keeping its grade when asked',
    (type, total) => {
      const board = makeBoard(createRng(7), { type, total, keepGrade: true })!;
      expect(filledCount(board.givens)).toBe(total);
      expect(hasUniqueSolution(board.givens)).toBe(true);
      expect(gradePuzzle(board.givens).gameType).toBe(type);
    },
  );

  it('is deterministic per seed', () => {
    const a = makeBoard(createRng(3), { type: 'normal', total: 38 });
    const b = makeBoard(createRng(3), { type: 'normal', total: 38 });
    const c = makeBoard(createRng(4), { type: 'normal', total: 38 });
    expect(a).toEqual(b);
    expect(a!.givens).not.toEqual(c!.givens);
  });
});

describe('fitBoard', () => {
  const p = generatePuzzle(createRng(11), 'fast')!;

  it('fills up to the total from the solution, never in the cells kept empty', () => {
    const keep = new Set(BOXES[4]!.cells.filter((c) => p.givens[c] === 0));
    const out = fitBoard(p.givens, p.solution, { total: 50, keepEmpty: keep }, createRng(1))!;
    expect(filledCount(out)).toBe(50);
    expect([...keep].every((c) => out[c] === 0)).toBe(true);
    expect(out.every((v, i) => v === 0 || v === p.solution[i])).toBe(true);
  });

  it('refuses a board that already has more givens, or a kept cell that holds one', () => {
    expect(fitBoard(p.givens, p.solution, { total: filledCount(p.givens) - 1 }, createRng(1))).toBeNull();
    const given = p.givens.findIndex((v) => v !== 0);
    expect(
      fitBoard(p.givens, p.solution, { total: 50, keepEmpty: new Set([given]) }, createRng(1)),
    ).toBeNull();
  });
});
