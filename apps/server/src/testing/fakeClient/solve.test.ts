import { defaultRules, type GameConfig, initialState } from '@sudoku-fight/engine';

import { PUZZLE } from '../game';
import { solveGivens, withSolution } from './solve';

describe('solveGivens', () => {
  it('works out the solution from the givens alone', () => {
    expect(solveGivens(PUZZLE.givens)).toEqual({ solution: PUZZLE.solution, unique: true });
  });

  it('says when a puzzle has more than one solution', () => {
    const r = solveGivens('0'.repeat(81));
    expect(r.unique).toBe(false);
    expect(r.solution).toMatch(/^[1-9]{81}$/);
  });

  it('throws for givens that break the rules', () => {
    expect(() => solveGivens(`11${'0'.repeat(79)}`)).toThrow('no solution');
  });
});

describe('withSolution', () => {
  const config: GameConfig = {
    id: 'g',
    mode: 'ranked',
    gameType: 'fast',
    puzzle: { ...PUZZLE, solution: '' },
    players: [{ id: 'ana' }, { id: 'ben' }],
    rules: defaultRules('ranked', 'fast'),
  };

  it('puts the solution into a copy of the state, and leaves the state alone', () => {
    const state = initialState(config, 0);
    const known = withSolution(state, PUZZLE.solution);
    expect(known.config.puzzle.solution).toBe(PUZZLE.solution);
    expect(state.config.puzzle.solution).toBe('');
    expect({ ...known, config: state.config }).toEqual(state);
    expect(withSolution(known, PUZZLE.solution)).toBe(known);
  });
});
