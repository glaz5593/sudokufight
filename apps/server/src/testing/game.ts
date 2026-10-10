import type { Digit, GameType } from '@sudoku-fight/engine';

import type { GamePuzzle, PuzzleSource } from '../game/puzzles';
import type { GameRoomLog } from '../rooms/GameRoom';

/** A real puzzle of the bank (the one the protocol tests use). */
export const PUZZLE: GamePuzzle = {
  id: 'test-puzzle',
  givens: '004300209005009001070060043006002087190007400050083000600000105003508690042910300',
  solution: '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
};

/** The same solution with four cells left (A1, B5, E5, I9): a game that can be finished in four moves. */
export const NEARLY_DONE: GamePuzzle = {
  id: 'nearly-done',
  givens: [...PUZZLE.solution].map((d, i) => ([0, 13, 40, 80].includes(i) ? '0' : d)).join(''),
  solution: PUZZLE.solution,
};

/** 'normal' games get NEARLY_DONE, the others PUZZLE. */
export const testPuzzles: PuzzleSource = {
  pick: (gameType: GameType) => (gameType === 'normal' ? NEARLY_DONE : PUZZLE),
};

/** The empty cells of a puzzle, in order. */
export const emptyCells = (puzzle: GamePuzzle): number[] =>
  [...puzzle.givens].flatMap((d, i) => (d === '0' ? [i] : []));

export const digitAt = (puzzle: GamePuzzle, cell: number): Digit => Number(puzzle.solution[cell]) as Digit;

/** A wrong digit for the cell (and not one of its givens' conflicts: just not the answer). */
export const wrongDigitAt = (puzzle: GamePuzzle, cell: number): Digit =>
  ((digitAt(puzzle, cell) % 9) + 1) as Digit;

/** A log that keeps its lines instead of printing them. */
export interface QuietLog extends GameRoomLog {
  lines: string[];
  errors: unknown[];
}

export function quietLog(): QuietLog {
  const lines: string[] = [];
  const errors: unknown[] = [];
  return {
    lines,
    errors,
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m, e) => {
      lines.push(m);
      errors.push(e);
    },
  };
}
