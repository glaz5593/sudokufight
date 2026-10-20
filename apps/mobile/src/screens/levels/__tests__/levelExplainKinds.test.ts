import {
  type AppLevel,
  type AppLevelOf,
  type Digit,
  DIGITS,
  explain,
  type GameView,
  ManualClock,
  ManualScheduler,
  puzzleExplainSteps,
} from '@sudoku-fight/engine';

import i18n from '../../../i18n';
import { type LevelSession, startLevel } from '../../../levels/levelSession';
import { levelById } from '../../../levels/levelsData';
import { levelWhy } from '../levelExplain';

/**
 * "למה?" of 1.0.3's kinds (levels-ui.md §6, levels-content.md §4.6, §5.2): fill the row and fill the column go
 * the fill box's one way (fillRegionOf [D69]): my first wrong digit in the region and why, in the region's frame;
 * the puzzle says the engine's puzzleExplainSteps, step by step, each with its reason (this file only words it).
 * The stages are made from L002's board until the levels' rebuild brings the new kinds.
 */

jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('@sudoku-fight/engine', () => {
  const actual = jest.requireActual('@sudoku-fight/engine');
  return {
    ...actual,
    explain: jest.fn(actual.explain),
    puzzleExplainSteps: jest.fn(actual.puzzleExplainSteps),
  };
});

const LRI = '⁦';
const PDI = '⁩';

const sessions: LevelSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
  jest.mocked(explain).mockClear();
});

async function sessionOf(level: AppLevel) {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const session = await startLevel(
    level,
    {},
    {
      clock,
      scheduler,
      appState: null,
      finish: async () => null,
      track: jest.fn(),
      attemptOf: async () => 1,
      kindOrdinalOf: () => 1,
      // A made-up stage id is no stage of the data: its analytics props cannot be had (and need not be).
      onError: () => {},
    },
  );
  sessions.push(session);
  return session;
}

/** L002's solved board with `cells` emptied, as a fill stage of `kind` on those cells. */
function fillStage(kind: 'fillRow' | 'fillCol', index: number, cells: number[]): AppLevel {
  const base = levelById('L002')!;
  const solution = base.board.solution;
  const grid = [...solution].map((d, i) => (cells.includes(i) ? '0' : d)).join('');
  const targets = kind === 'fillRow' ? { row: index, cells } : { col: index, cells };
  return {
    ...base,
    id: `T-${kind}`,
    kind,
    boss: false,
    bot: null,
    board: { ...base.board, grid, solution },
    targets,
  } as unknown as AppLevel;
}

/** A wrong digit for `cell` that the keypad still offers. */
function wrongFor(session: LevelSession, cell: number): Digit {
  const view = session.getView();
  const right = Number(session.played.board.solution[cell]);
  return DIGITS.find((d) => d !== right && view.keypad.remaining[d - 1]! > 0)!;
}

describe.each([
  ['fillRow', 4, [36, 40, 44], 'row'],
  ['fillCol', 2, [2, 38, 74], 'col'],
] as const)('%s', (kind, index, cells, unit) => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('my first wrong digit in the region: why it was wrong, and why the right one holds, in its frame', async () => {
    const level = fillStage(kind, index, [...cells]);
    const session = await sessionOf(level);
    const cell = cells[1];
    const digit = wrongFor(session, cell);
    session.host.select(cell);
    session.host.place(cell, digit);
    const why = levelWhy(session.played, { view: session.getView(), wrongTaps: [] }, 'he')!;
    expect(why.split('\n')[0]).toMatch(new RegExp(`^הטעות שלך: ${digit} ב־${LRI}[A-I][1-9]${PDI}\\. \\S`));
    expect(why.split('\n').length).toBeGreaterThanOrEqual(2);
    // The engine explains in the row's or the column's frame, not a box's.
    expect(jest.mocked(explain)).toHaveBeenCalledWith(
      expect.any(Array),
      cell,
      expect.any(Array),
      expect.objectContaining({ unit: { kind: unit, index } }),
    );
  });

  it('no mistake: the region’s first missing cell', async () => {
    const level = fillStage(kind, index, [...cells]);
    const session = await sessionOf(level);
    const why = levelWhy(session.played, { view: session.getView(), wrongTaps: [] }, 'en');
    expect(why).toMatch(/\S/);
    expect(jest.mocked(explain)).toHaveBeenCalledWith(
      expect.any(Array),
      cells[0],
      expect.any(Array),
      expect.objectContaining({ unit: { kind: unit, index } }),
    );
  });
});

describe('the puzzle', () => {
  const base = levelById('L002')!;
  const puzzle = {
    ...base,
    id: 'T-puzzle',
    kind: 'puzzle',
    bot: null,
    board: { grid: base.board.solution, solution: base.board.solution },
    targets: { start: [4, 1, 2, 3, 8, 5, 6, 7, 0], fixed: [1, 2, 3, 5, 6, 7], lockOnCorrect: false },
  } as unknown as AppLevelOf<'puzzle'>;
  // The puzzle's "למה?" reads no board of the end: the engine's steps come from the level.
  const view = { me: 'me', players: [], grid: [], wrong: [] } as unknown as GameView;

  it('the engine’s steps, numbered, each with its reason; places said 1–9', () => {
    jest.mocked(puzzleExplainSteps).mockReturnValueOnce([
      { place: 4, from: 0, reason: 'onlyBoxForPlace' },
      { place: 0, from: 8, reason: 'onlyPlaceForBox' },
    ]);
    expect(levelWhy(puzzle, { view, wrongTaps: [] }, 'he')).toBe(
      [
        'צעד 1: למקום 5 מתאים רק הריבוע שהתחיל במקום 1: כל ריבוע אחר היה שם ספרה פעמיים בשורה או בעמודה.',
        'צעד 2: הריבוע שהתחיל במקום 9 מתאים רק למקום 1: בכל מקום אחר הוא היה שם ספרה פעמיים בשורה או בעמודה.',
      ].join('\n'),
    );
    expect(jest.mocked(puzzleExplainSteps)).toHaveBeenCalledWith(puzzle);
  });

  it('in English', () => {
    jest.mocked(puzzleExplainSteps).mockReturnValueOnce([{ place: 4, from: 0, reason: 'onlyBoxForPlace' }]);
    expect(levelWhy(puzzle, { view, wrongTaps: [] }, 'en')).toBe(
      'Step 1: Only the box that started at place 1 fits place 5: any other would repeat a digit in a row or a column.',
    );
  });

  it('no step, or an engine that cannot explain: no "למה?" (never a crash)', () => {
    jest.mocked(puzzleExplainSteps).mockReturnValueOnce([]);
    expect(levelWhy(puzzle, { view, wrongTaps: [] }, 'he')).toBeNull();
    jest.mocked(puzzleExplainSteps).mockImplementationOnce(() => {
      throw new Error('not implemented yet');
    });
    expect(levelWhy(puzzle, { view, wrongTaps: [] }, 'he')).toBeNull();
  });
});
