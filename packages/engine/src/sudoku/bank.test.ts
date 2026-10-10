import { bankSummary, buildBank, checkPuzzle, mergeIntoBank, parsePuzzleCsv, puzzleId } from './bank';
import { bankRows } from '../testing/fixtures';

const PUZZLE = '004300209005009001070060043006002087190007400050083000600000105003508690042910300';
const SOLUTION = '864371259325849761971265843436192587198657432257483916689734125713528694542916378';

describe('checkPuzzle (§20)', () => {
  it('accepts a valid puzzle and normalises dots to zeros', () => {
    expect(checkPuzzle(PUZZLE.replace(/0/g, '.'), SOLUTION)).toEqual({
      ok: true,
      givens: PUZZLE,
      solution: SOLUTION,
    });
  });

  it('names what is wrong', () => {
    expect(checkPuzzle(PUZZLE.slice(1), SOLUTION)).toEqual({ ok: false, reason: 'format' });
    expect(checkPuzzle(PUZZLE, SOLUTION.replace(/^86/, '68'))).toEqual({ ok: false, reason: 'badSolution' });
    expect(checkPuzzle(PUZZLE.replace(/^0/, '1'), SOLUTION)).toEqual({ ok: false, reason: 'mismatch' });
    const sparse = '8' + '0'.repeat(80);
    expect(checkPuzzle(sparse, SOLUTION)).toEqual({ ok: false, reason: 'notUnique' });
  });

  it('rejects a "solution" that is not a valid grid', () => {
    expect(checkPuzzle('1'.repeat(81), '1'.repeat(81))).toEqual({ ok: false, reason: 'badSolution' });
  });
});

describe('puzzleId', () => {
  it('is stable and distinct across the bank', () => {
    expect(puzzleId(PUZZLE)).toBe(puzzleId(PUZZLE));
    expect(puzzleId(PUZZLE)).toMatch(/^[0-9a-f]{16}$/);
    const ids = new Set(bankRows().map((r) => puzzleId(r.puzzle)));
    expect(ids.size).toBe(690);
  });
});

describe('parsePuzzleCsv', () => {
  it('skips a header and blank lines, handles CRLF, quotes and other separators', () => {
    const text = `puzzle,solution\r\n${PUZZLE},${SOLUTION}\r\n\r\n"${PUZZLE}";"${SOLUTION}"\n${PUZZLE}\t${SOLUTION}`;
    expect(parsePuzzleCsv(text)).toEqual([
      { line: 2, puzzle: PUZZLE, solution: SOLUTION },
      { line: 4, puzzle: PUZZLE, solution: SOLUTION },
      { line: 5, puzzle: PUZZLE, solution: SOLUTION },
    ]);
  });

  it('keeps the first row when it is data', () => {
    expect(parsePuzzleCsv(`${PUZZLE},${SOLUTION}`)).toHaveLength(1);
  });
});

describe('buildBank', () => {
  it('validates, grades and reports the 690 puzzles', () => {
    const { puzzles, report } = buildBank(bankRows(), 'sudoku-bank-690');
    expect(report.rows).toBe(690);
    expect(report.rejected).toEqual([]);
    expect(report.accepted + report.duplicates + report.excluded).toBe(690);
    expect(puzzles).toHaveLength(report.accepted);
    expect(report.byGameType.fast + report.byGameType.normal + report.byGameType.hard).toBe(report.accepted);
    expect(report.givens.min).toBeGreaterThanOrEqual(30);
    expect(report.givens.max).toBeLessThanOrEqual(36);
    const p = puzzles[0]!;
    expect(p).toMatchObject({
      givens: PUZZLE,
      solution: SOLUTION,
      source: 'sudoku-bank-690',
      pool: 'offline',
      givensCount: [...PUZZLE].filter((c) => c !== '0').length,
    });
    // The work plan's expected report for this bank: 690 fast, 0 normal, 0 hard.
    expect(report.byGameType).toEqual({ fast: 690, normal: 0, hard: 0 });
    expect(p.id).toBe(puzzleId(PUZZLE));
  });

  it('drops duplicates and lists rejected lines', () => {
    const { puzzles, report } = buildBank(
      [
        { line: 1, puzzle: PUZZLE, solution: SOLUTION },
        { line: 2, puzzle: PUZZLE, solution: SOLUTION },
        { line: 3, puzzle: 'bad', solution: SOLUTION },
      ],
      'test',
    );
    expect(puzzles).toHaveLength(1);
    expect(report).toMatchObject({ accepted: 1, duplicates: 1, rejected: [{ line: 3, reason: 'format' }] });
  });

  it('counts puzzles the rules leave out', () => {
    const { report } = buildBank([{ line: 1, puzzle: PUZZLE, solution: SOLUTION }], 'test', {
      grading: { levels: [], beyondAs: null },
    });
    expect(report).toMatchObject({ accepted: 0, excluded: 1 });
    expect(report.givens).toEqual({ min: 0, max: 0, avg: 0 });
  });
});

describe('bank file helpers', () => {
  it('merges new puzzles by id and counts each pool per game type', () => {
    const { puzzles } = buildBank(bankRows().slice(0, 3), 'a');
    const ranked = buildBank(bankRows().slice(2, 5), 'b', { pool: 'ranked' }).puzzles;
    const merged = mergeIntoBank(puzzles, ranked);
    expect(merged.added).toBe(2); // row 3 is already there
    expect(bankSummary(merged.puzzles)).toEqual({
      offline: { fast: 3, normal: 0, hard: 0 },
      ranked: { fast: 2, normal: 0, hard: 0 },
    });
  });
});
