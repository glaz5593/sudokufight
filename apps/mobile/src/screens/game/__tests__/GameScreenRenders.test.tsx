import { cellName, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Profiler, type ProfilerOnRenderCallback } from 'react';

import { puzzleById } from '../../../game/offlinePool';
import { type PracticeSession, startPractice } from '../../../game/session';
import { emptyCellsOf, smallPool } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { GameScreen } from '../GameScreen';
import { type Duel, duel } from '../testing/duel';

/**
 * Re-renders of the game screen while a lock counts down (work plan stage 13, "ביצועים"; spec §22: 55 fps).
 * The countdowns re-read the time 4 times a second (TICK_MS); each tick may redraw only what shows the time,
 * never the 81 cells or the 9 keys. React's Profiler counts the screen's commits; the board's labels, read once
 * per render of a cell, a key and the board, count those renders.
 *
 * The bounds are what the memoisation gives, with some room: a regression (a new prop that changes every
 * render, an inline callback into a memoised cell) multiplies them.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));
// Each label is computed once per render of its component: they count the renders.
jest.mock('../../../components/board/labels', () => {
  const actual = jest.requireActual<typeof import('../../../components/board/labels')>(
    '../../../components/board/labels',
  );
  return {
    ...actual,
    cellLabel: jest.fn(actual.cellLabel),
    keyLabel: jest.fn(actual.keyLabel),
    boardLabel: jest.fn(actual.boardLabel),
  };
});
const labels = jest.requireMock<{ cellLabel: jest.Mock; keyLabel: jest.Mock; boardLabel: jest.Mock }>(
  '../../../components/board/labels',
);

interface Counts {
  commits: number;
  cells: number;
  keys: number;
  boards: number;
}

let commits = 0;
const onRender: ProfilerOnRenderCallback = () => {
  commits += 1;
};
const counts = (): Counts => ({
  commits,
  cells: labels.cellLabel.mock.calls.length,
  keys: labels.keyLabel.mock.calls.length,
  boards: labels.boardLabel.mock.calls.length,
});
const reset = () => {
  commits = 0;
  labels.cellLabel.mockClear();
  labels.keyLabel.mockClear();
  labels.boardLabel.mockClear();
};

/** `ms` of a game in 50 ms frames: the game clock and the phone's timers move together, as on a phone. */
async function play(scheduler: ManualScheduler, ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      scheduler.advance(frame);
      jest.advanceTimersByTime(frame);
    });
  }
}

const press = async (testID: string) => fireEvent.press(screen.getByTestId(testID));

let practice: PracticeSession | null = null;
let game: Duel | null = null;

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  reset();
});

afterEach(() => {
  practice?.close();
  practice = null;
  game?.session.close();
  game = null;
  jest.useRealTimers();
});

/** Five seconds of my lock counting down (8 s in a fast game): 20 ticks, five whole seconds on the pill. */
const FIVE_SECONDS = 5_000;

describe('GameScreen renders while a lock counts down (spec §22)', () => {
  it('solo: each tick redraws the screen, but only my locked cell and none of the keys', async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const scheduler = new ManualScheduler(clock);
    practice = await startPractice(
      { gameType: 'fast' },
      { repo: null, clock, scheduler, pool: smallPool(1), seed: 7, track: () => undefined },
    );
    const [a] = emptyCellsOf(puzzleById(practice.puzzleId)!);
    await render(
      <Profiler id="game" onRender={onRender}>
        <GameScreen session={practice} onEnded={jest.fn()} />
      </Profiler>,
    );
    await press(`cell-${cellName(a!)}`);
    await play(scheduler, 100);
    reset();

    await play(scheduler, FIVE_SECONDS);
    const c = counts();
    // The numbers, for docs/PERF.md (`npx jest GameScreenRenders --selectProjects mobile --verbose=false`).
    console.log('[renders] solo, 5 s of a lock', c);
    // 20 ticks of 250 ms: one commit each (before stage 13 too).
    expect(c.commits).toBeLessThanOrEqual(22);
    // The locked cell's pill changes 5 times; the other 80 cells never redraw.
    expect(c.cells).toBeLessThanOrEqual(6);
    // The keypad doesn't change while the lock counts down (before stage 13: 9 keys × 20 ticks = 180).
    expect(c.keys).toBe(0);
    // The board redraws only with its locked cell (before stage 13: every tick, 20).
    expect(c.boards).toBeLessThanOrEqual(6);
  });

  it('against a bot: both locks count down, the cells and keys still stay put', async () => {
    game = duel();
    await render(
      <Profiler id="game" onRender={onRender}>
        <GameScreen session={game.session} onEnded={jest.fn()} />
      </Profiler>,
    );
    const [a, b] = game.cells;
    await press(`cell-${cellName(a!)}`);
    await act(async () => game!.bot.select(b!));
    await play(game.scheduler, 100);
    reset();

    await play(game.scheduler, FIVE_SECONDS);
    const c = counts();
    console.log('[renders] duel, 5 s of two locks', c);
    expect(c.commits).toBeLessThanOrEqual(22);
    // Two locked cells, each redrawn when its whole seconds change.
    expect(c.cells).toBeLessThanOrEqual(12);
    expect(c.keys).toBe(0);
    // At most once per locked cell's change (the two may change on different ticks).
    expect(c.boards).toBeLessThanOrEqual(12);
  });
});
