import {
  bankSummary,
  buildBank,
  checkPuzzle,
  fitBankGivens,
  mergeIntoBank,
  parsePuzzleCsv,
  type PuzzleRecord,
  puzzleId,
} from './bank';
import { bankRows } from '../testing/fixtures';
import { filledCount, parseGrid } from './board';
import { DEFAULT_GIVENS, digitCounts } from './givens';
import { gradePuzzle } from './grade';

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

describe('fitBankGivens: the givens range per game type (§5.2, §20) [D43]', () => {
  const csv = (from: number, to: number): PuzzleRecord[] =>
    buildBank(bankRows().slice(from, to), 'csv').puzzles;

  it('fills a puzzle short of givens: new givens, id, grade and count, the old id in baseId', () => {
    const [p] = csv(0, 1);
    const { puzzles, report } = fitBankGivens([p!]);
    const q = puzzles[0]!;
    expect(q.id).toBe(puzzleId(q.givens));
    expect(q.id).not.toBe(p!.id);
    expect(q.baseId).toBe(p!.id);
    expect(q.givensCount).toBe(filledCount(parseGrid(q.givens)));
    expect(q.givensCount).toBeGreaterThanOrEqual(DEFAULT_GIVENS.fast!.min);
    expect(q.givensCount).toBeLessThanOrEqual(DEFAULT_GIVENS.fast!.max);
    const grade = gradePuzzle(parseGrid(q.givens));
    expect(q).toMatchObject({
      solution: p!.solution,
      gameType: 'fast',
      difficulty: grade.difficulty,
      techniques: grade.techniques,
      source: p!.source,
      pool: p!.pool,
    });
    expect(q.difficulty).toBe('fast');
    // The original givens are all still there.
    for (let i = 0; i < 81; i++) if (p!.givens[i] !== '0') expect(q.givens[i]).toBe(p!.givens[i]);
    expect(report.byKey['offline/fast']).toMatchObject({ before: 1, filled: 1, inRange: 0, after: 1 });
    expect(report.byKey['offline/fast'].givens.min).toBe(q.givensCount);
    expect(report.dropped).toEqual([]);
    // A second fit leaves it as it is: the same object, and baseId still points at the first puzzle.
    const again = fitBankGivens(puzzles);
    expect(again.puzzles[0]).toBe(q);
    expect(again.report.byKey['offline/fast']).toMatchObject({ inRange: 1, filled: 0 });
  });

  it('is deterministic and does not depend on the order or on the other puzzles; refitting changes nothing', () => {
    const input = csv(0, 8);
    const a = fitBankGivens(input).puzzles;
    expect(fitBankGivens(input).puzzles).toEqual(a);
    const reversed = fitBankGivens([...input].reverse()).puzzles;
    expect(reversed).toEqual([...a].reverse());
    expect(fitBankGivens(input.slice(3, 4)).puzzles).toEqual([a[3]]);
    // Same order as the input.
    expect(a.map((p) => p.baseId)).toEqual(input.map((p) => p.id));
    const again = fitBankGivens(a);
    expect(again.puzzles).toEqual(a);
    again.puzzles.forEach((p, k) => expect(p).toBe(a[k]));
    // Another salt, other givens.
    expect(fitBankGivens(input, { salt: 1 }).puzzles[0]!.givens).not.toBe(a[0]!.givens);
  });

  it('leaves hard puzzles exactly as they are (Moshe, 2026-10-15)', () => {
    const [a] = csv(0, 1);
    const hard: PuzzleRecord = { ...a!, gameType: 'hard', difficulty: 'hard', pool: 'ranked' };
    const { puzzles, report } = fitBankGivens([hard]);
    expect(puzzles[0]).toBe(hard);
    expect(report.byKey['ranked/hard']).toMatchObject({ before: 1, noRange: 1, filled: 0, after: 1 });
    expect(report.dropped).toEqual([]);
  });

  it('the first CSV rows: 45–50 givens, fast, every digit shown, one solution', () => {
    for (const p of fitBankGivens(csv(0, 3)).puzzles) {
      expect(p.givensCount).toBeGreaterThanOrEqual(45);
      expect(p.givensCount).toBeLessThanOrEqual(50);
      expect(p.gameType).toBe('fast');
      expect(p.difficulty).toBe('fast');
      expect(digitCounts(parseGrid(p.givens)).every((n) => n > 0)).toBe(true);
      expect(checkPuzzle(p.givens, p.solution)).toEqual({ ok: true, givens: p.givens, solution: p.solution });
    }
  });

  it('leaves out and lists what cannot fit, and drops a puzzle that fits onto one already kept', () => {
    const [a, b, c] = csv(0, 3);
    // A fast board filled to 45–50 is too full for "normal" (35–40).
    const filled = fitBankGivens([b!]).puzzles[0]!;
    const tooMany = { ...filled, id: b!.id, gameType: 'normal' as const, pool: 'ranked' as const };
    const { puzzles, report } = fitBankGivens([a!, tooMany, c!, a!]);
    expect(puzzles.map((p) => p.baseId)).toEqual([a!.id, c!.id]);
    expect(report.dropped).toEqual([
      { id: b!.id, pool: 'ranked', gameType: 'normal', reason: 'tooMany' },
      { id: a!.id, pool: 'offline', gameType: 'fast', reason: 'duplicate' },
    ]);
    expect(report.byKey['ranked/normal']).toMatchObject({ before: 1, tooMany: 1, after: 0 });
    expect(report.byKey['offline/fast']).toMatchObject({ before: 3, filled: 2, duplicates: 1, after: 2 });

    // A grade no fill can keep: one empty cell is always a naked single, never a "normal" board.
    const lost = fitBankGivens([{ ...a!, gameType: 'normal', difficulty: 'normal' }], {
      rules: { ...DEFAULT_GIVENS, normal: { min: 80, max: 80 } },
      attempts: 1,
    });
    expect(lost.puzzles).toEqual([]);
    expect(lost.report.dropped).toEqual([
      { id: a!.id, pool: 'offline', gameType: 'normal', reason: 'gradeLost' },
    ]);
    expect(lost.report.byKey['offline/normal']).toMatchObject({ before: 1, gradeLost: 1, after: 0 });
  });
});
