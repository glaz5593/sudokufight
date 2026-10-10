import { createRng } from '../util/random';
import { agreesWith, isSolvedGrid } from './board';
import { explain } from './explain';
import { formatExplanation } from './explainText';
import { generatePuzzle, generateSolvedGrid } from './generate';
import { gradePuzzle } from './grade';
import { hasUniqueSolution } from './solver';

describe('generator (§20, option 2)', () => {
  it('makes valid solved grids, the same for the same seed', () => {
    const a = generateSolvedGrid(createRng(5));
    expect(isSolvedGrid(a)).toBe(true);
    expect(generateSolvedGrid(createRng(5))).toEqual(a);
    expect(generateSolvedGrid(createRng(6))).not.toEqual(a);
  });

  it.each(['fast', 'normal', 'hard'] as const)(
    'makes a unique "%s" puzzle that the grader agrees with',
    (target) => {
      const p = generatePuzzle(createRng(11), target, { attempts: 40 });
      expect(p).not.toBeNull();
      const { givens, solution, difficulty } = p!;
      expect(difficulty).toBe(target);
      expect(hasUniqueSolution(givens)).toBe(true);
      expect(agreesWith(givens, solution)).toBe(true);
      const grade = gradePuzzle(givens);
      expect(grade.difficulty).toBe(target);
      if (target === 'normal') expect(grade.techniques).toContain('hiddenSingle');
      if (target === 'hard')
        expect(
          grade.techniques.some((t) => ['pointing', 'claiming', 'nakedPair', 'hiddenPair'].includes(t)),
        ).toBe(true);
    },
  );

  it('explains a hard puzzle with chains of 2 steps or more, including box-line or pair steps', () => {
    const p = generatePuzzle(createRng(11), 'hard', { attempts: 40 })!;
    const texts: string[] = [];
    let longest = 0;
    for (let cell = 0; cell < 81; cell++) {
      if (p.givens[cell]) continue;
      const e = explain(p.givens, cell, p.solution);
      expect(e.digit).toBe(p.solution[cell]);
      if (e.technique === 'chain') longest = Math.max(longest, e.steps.length);
      if (e.resolved) texts.push(formatExplanation(e, 'he'));
    }
    expect(longest).toBeGreaterThanOrEqual(2);
    expect(texts.some((t) => /נמחק/.test(t))).toBe(true);
  });

  it('returns null when the target cannot be reached', () => {
    // With 70 givens kept nothing gets past "fast".
    expect(generatePuzzle(createRng(1), 'hard', { attempts: 2, minGivens: 70 })).toBeNull();
  });
});
