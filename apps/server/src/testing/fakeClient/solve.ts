import { countSolutions, type GameState, gridToString, parseGrid } from '@sudoku-fight/engine';

/**
 * The fake client never receives the solution of a running game (spec §21): it works it out from the givens
 * with the engine's solver, as a person would with a pencil.
 */

export interface SolvedPuzzle {
  /** 81 digits. */
  solution: string;
  /** Exactly one solution (bank puzzles always have one; with two, the server's may differ from ours). */
  unique: boolean;
}

export function solveGivens(givens: string): SolvedPuzzle {
  const found: string[] = [];
  const count = countSolutions(parseGrid(givens), 2, (s) => found.push(gridToString(s)));
  if (count === 0 || found[0] === undefined) throw new Error('The puzzle has no solution');
  return { solution: found[0], unique: count === 1 };
}

/** The state with the solution in its config: what the engine's bot helpers read (chooseDigit). */
export function withSolution(state: GameState, solution: string): GameState {
  if (state.config.puzzle.solution === solution) return state;
  const config = state.config;
  return { ...state, config: { ...config, puzzle: { ...config.puzzle, solution } } };
}
