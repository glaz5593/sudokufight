import { parseGrid } from './board';
import { DEFAULT_GRADING, gradePuzzle } from './grade';
import { bankRows, gridFrom } from '../testing/fixtures';

describe('gradePuzzle (§5.2, §20)', () => {
  const grades = bankRows().map((r) => gradePuzzle(parseGrid(r.puzzle)));

  it('files every puzzle of the bank under a game type', () => {
    for (const g of grades) expect(['fast', 'normal', 'hard']).toContain(g.gameType);
  });

  it('calls a puzzle fast only when naked singles alone solve it', () => {
    for (const g of grades) {
      if (g.difficulty === 'fast') expect(g.techniques).toEqual(['nakedSingle']);
      if (g.difficulty === 'normal') expect(g.techniques).toContain('hiddenSingle');
      if (g.difficulty === 'hard')
        expect(g.techniques.some((t) => !['nakedSingle', 'hiddenSingle'].includes(t))).toBe(true);
    }
  });

  it('is mostly "fast", as the spec expects of this bank', () => {
    const fast = grades.filter((g) => g.difficulty === 'fast').length;
    expect(fast / grades.length).toBeGreaterThan(0.5);
  });

  it('leaves a puzzle beyond our techniques out of every game type (work plan, stage 1)', () => {
    // An empty board: no technique applies.
    const empty = new Array<number>(81).fill(0);
    expect(gradePuzzle(empty)).toMatchObject({ difficulty: 'beyond', gameType: null, steps: 0 });
    expect(gradePuzzle(empty, { ...DEFAULT_GRADING, beyondAs: 'hard' }).gameType).toBe('hard');
  });

  it('follows custom levels', () => {
    // A board one naked single away from solved is "fast"; with no techniques allowed for fast it is "normal".
    const g = parseGrid('864371259325849761971265843436192587198657432257483916689734125713528694542916378');
    g[0] = 0;
    expect(gradePuzzle(g).difficulty).toBe('fast');
    const custom = {
      levels: [
        { level: 'fast' as const, techniques: [] },
        { level: 'normal' as const, techniques: ['nakedSingle' as const] },
      ],
      beyondAs: null,
    };
    expect(gradePuzzle(g, custom).difficulty).toBe('normal');
    expect(gradePuzzle(gridFrom({}), custom).gameType).toBeNull();
  });
});
