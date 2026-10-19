import { type AppLevel, isLevelId, LEVEL_KINDS } from '@sudoku-fight/engine';

/**
 * The levels shipped in the app (plan §5.3, §5.6) load on first use, never at the app's start (spec §22;
 * startupGraph.test.ts checks that no start file reaches them): importing levelsData reads nothing, the first
 * lookup reads the file once and checks its shape once.
 */

type LevelsData = typeof import('../levelsData');

const GRID = '0'.repeat(80) + '1';
const SOLUTION = '1'.repeat(81);

const entry = (id: string, chapter: number, over: Record<string, unknown> = {}) => ({
  id,
  rev: 1,
  chapter,
  slot: 1,
  kind: 'find',
  boss: false,
  seed: 1,
  gameType: 'fast',
  board: { grid: GRID, solution: SOLUTION },
  timeLimitMs: 30000,
  targets: { target: { digit: 1, scope: { kind: 'board' }, cell: null, accept: [80], tier: 'single' } },
  stars: { by: 'timeMs', three: 5000, two: 10000, one: 20000 },
  ...over,
});

/** levelsData over a mocked levels.json; `read` counts how often the file is loaded. */
function withFile(file: unknown[], test: (data: LevelsData, read: jest.Mock) => void): void {
  jest.isolateModules(() => {
    const read = jest.fn();
    jest.doMock('../data/levels.json', () => {
      read();
      return file;
    });
    test(jest.requireActual<LevelsData>('../levelsData'), read);
  });
}

afterEach(() => jest.dontMock('../data/levels.json'));

describe('levels.json loads on first use', () => {
  it('importing levelsData reads nothing; the first lookup reads the file once', () => {
    withFile([entry('L011', 2), entry('L001', 1), entry('L002', 1, { kind: 'fillBox' })], (data, read) => {
      expect(read).not.toHaveBeenCalled();
      expect(data.levelById('L002')?.kind).toBe('fillBox');
      expect(data.levelById('L404')).toBeUndefined();
      expect(data.levelsOfChapter(1).map((l) => l.id)).toEqual(['L001', 'L002']);
      expect(data.levelsOfChapter(2).map((l) => l.id)).toEqual(['L011']);
      expect(data.levelsOfChapter(3)).toEqual([]);
      expect(data.allLevels().map((l) => l.id)).toEqual(['L001', 'L002', 'L011']);
      expect(data.levelCount()).toBe(3);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  it('a broken file fails loudly on first use, naming the level (a build mistake)', () => {
    withFile([entry('L001', 1), entry('L002', 1, { kind: 'dance' }), entry('x', 1)], (data) => {
      expect(() => data.levelById('L001')).toThrow(/L002: kind dance; id x/);
    });
    withFile([entry('L001', 1, { board: { grid: '0', solution: SOLUTION } })], (data) => {
      expect(() => data.allLevels()).toThrow(/L001: board/);
    });
  });
});

describe('the shipped levels.json', () => {
  it('passes the shape check: level ids, known kinds, boards of 81, a time limit and a star rule', () => {
    jest.isolateModules(() => {
      const data = jest.requireActual<LevelsData>('../levelsData');
      const all: readonly AppLevel[] = data.allLevels();
      expect(all.length).toBeGreaterThan(0);
      expect(new Set(all.map((l) => l.id)).size).toBe(all.length);
      for (const level of all) {
        expect(data.levelShapeProblem(level)).toBeNull();
        expect(isLevelId(level.id)).toBe(true);
        expect(LEVEL_KINDS).toContain(level.kind);
        expect(data.levelById(level.id)).toBe(level);
      }
    });
  });
});
