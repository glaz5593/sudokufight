import { cellName, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Profiler, type ProfilerOnRenderCallback } from 'react';

import { puzzleById } from '../../../game/offlinePool';
import { type PracticeSession, startPractice } from '../../../game/session';
import { answerIn, emptyCellsOf, smallPool } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { renderCount, resetRenderCounts } from '../../../testing/renderCount';
import { GameScreen } from '../GameScreen';
import { MOVE_TIMELINE } from '../model';
import { type Duel, duel } from '../testing/duel';
import { type Group, group } from '../testing/group';

/**
 * Re-renders of the game screen (work plan stage 13, "ביצועים"; spec §22: 55 fps), counted by React's Profiler
 * (the screen's commits) and by the components themselves (their renders):
 *
 * - While a lock counts down, the screen re-reads the time 4 times a second (TICK_MS): one commit each. Each
 *   tick may redraw only what shows the time, and only when its whole seconds change: never the 81 cells or the
 *   9 keys; the players' cards, the timer rings and my lock's strip once a second at most (the arcs and the bar
 *   drain on the UI thread).
 * - A score counts up for 650 ms on the UI thread (motion.md §6): no render per step of the count.
 *
 * The bounds are what the memoisation gives, with some room: a regression (a new prop that changes every
 * render, an inline callback into a memoised cell, a count driven by setState) multiplies them. The numbers
 * before and after are in docs/PERF.md.
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
// The components that show time or count: each render counted (a memo component keeps its comparison).
jest.mock('../../../components/player/TimerRing', () => {
  const actual = jest.requireActual<typeof import('../../../components/player/TimerRing')>(
    '../../../components/player/TimerRing',
  );
  const { counted } = jest.requireActual<typeof import('../../../testing/renderCount')>(
    '../../../testing/renderCount',
  );
  return { ...actual, TimerRing: counted('TimerRing', actual.TimerRing) };
});
jest.mock('../../../components/player/LockStrip', () => {
  const actual = jest.requireActual<typeof import('../../../components/player/LockStrip')>(
    '../../../components/player/LockStrip',
  );
  const { counted } = jest.requireActual<typeof import('../../../testing/renderCount')>(
    '../../../testing/renderCount',
  );
  return { ...actual, LockStrip: counted('LockStrip', actual.LockStrip) };
});
jest.mock('../../../components/player/Score', () => {
  const actual = jest.requireActual<typeof import('../../../components/player/Score')>(
    '../../../components/player/Score',
  );
  const { counted } = jest.requireActual<typeof import('../../../testing/renderCount')>(
    '../../../testing/renderCount',
  );
  return { ...actual, ScoreNumber: counted('ScoreNumber', actual.ScoreNumber) };
});

interface Counts {
  commits: number;
  cells: number;
  keys: number;
  boards: number;
  rings: number;
  strips: number;
  /** ScoreNumber's renders: one per render of a player's card (or of the solo HUD). */
  scores: number;
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
  rings: renderCount('TimerRing'),
  strips: renderCount('LockStrip'),
  scores: renderCount('ScoreNumber'),
});
const reset = () => {
  commits = 0;
  labels.cellLabel.mockClear();
  labels.keyLabel.mockClear();
  labels.boardLabel.mockClear();
  resetRenderCounts();
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
let table: Group | null = null;

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
  table?.session.close();
  table = null;
  jest.useRealTimers();
});

/** A solo practice on a manual clock, on the screen, with the Profiler around it. */
async function solo() {
  const clock = new ManualClock(1_700_000_000_000);
  const scheduler = new ManualScheduler(clock);
  practice = await startPractice(
    { gameType: 'fast' },
    { repo: null, clock, scheduler, pool: smallPool(1), seed: 7, track: () => undefined },
  );
  const puzzle = puzzleById(practice.puzzleId)!;
  await render(
    <Profiler id="game" onRender={onRender}>
      <GameScreen session={practice} onEnded={jest.fn()} />
    </Profiler>,
  );
  return { session: practice, scheduler, puzzle, cells: emptyCellsOf(puzzle) };
}

/** Five seconds of my lock counting down (8 s in a fast game): 20 ticks, five whole seconds on the pill. */
const FIVE_SECONDS = 5_000;
/** A count-up (motion.md `score.count`), with a frame to spare. */
const COUNT_MS = 650 + 50;
/** The screen's ticks in that time (250 ms each): each one is a commit of its own. */
const COUNT_TICKS = Math.ceil(COUNT_MS / 250);

describe('GameScreen renders while a lock counts down (spec §22)', () => {
  it('solo: each tick redraws the screen, but only my locked cell and none of the keys', async () => {
    const { scheduler, cells } = await solo();
    await press(`cell-${cellName(cells[0]!)}`);
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
    // My strip: "7 שניות" changes 5 times; its bar drains on the UI thread (before: every tick, 20).
    expect(c.strips).toBeLessThanOrEqual(6);
    // My card (its score) redraws with the clock's whole seconds, not on every tick (before: 20).
    expect(c.scores).toBeLessThanOrEqual(6);
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
    // The bot's ring on its card has no seconds in it: it drains on the UI thread, with no render at all
    // (before: every tick, 20).
    expect(c.rings).toBeLessThanOrEqual(1);
    expect(c.strips).toBeLessThanOrEqual(6);
    // Each card redraws when its lock's whole seconds change, not on every tick (before: 2 × 20 = 40).
    expect(c.scores).toBeLessThanOrEqual(12);
  });

  it('3 players: the compact rings redraw their seconds once a second', async () => {
    table = group({ count: 3 });
    await render(
      <Profiler id="game" onRender={onRender}>
        <GameScreen session={table.session} onEnded={jest.fn()} />
      </Profiler>,
    );
    const [a, b] = table.cells;
    const [pip, biscuit] = table.players.slice(1);
    await act(async () => {
      table!.as(pip!.id).select(a!);
      table!.as(biscuit!.id).select(b!);
    });
    await play(table.scheduler, 100);
    reset();

    await play(table.scheduler, FIVE_SECONDS);
    const c = counts();
    console.log('[renders] 3 players, 5 s of two locks', c);
    expect(c.commits).toBeLessThanOrEqual(22);
    expect(c.keys).toBe(0);
    // Two rings, each with its seconds inside: 5 changes each (before: 2 rings × 20 ticks = 40).
    expect(c.rings).toBeLessThanOrEqual(12);
    // The two locking cards once a second, mine not at all (before: 3 cards × 20 ticks = 60).
    expect(c.scores).toBeLessThanOrEqual(12);
  });
});

describe('GameScreen renders while a score counts up (motion.md §6)', () => {
  it('solo: my score counts on the UI thread, with no render per step', async () => {
    const { session, scheduler, puzzle, cells } = await solo();
    const a = cells[0]!;
    await press(`cell-${cellName(a)}`);
    await press(`key-${answerIn(puzzle, a)}`);
    const points = session.getView().players[0]!.score;
    expect(points).toBeGreaterThanOrEqual(2);
    // The chip lands (R + 660): the card takes the new score and starts counting.
    await play(scheduler, MOVE_TIMELINE.gain.landAt + 50);
    reset();

    await play(scheduler, COUNT_MS);
    const c = counts();
    console.log(`[renders] solo, a count-up of ${points}`, c);
    // The ticks only (before: a commit for each half point the count showed, 2 × points more).
    expect(c.commits).toBeLessThanOrEqual(COUNT_TICKS + 1);
    // At most a whole second of the clock on my card (before: a render per step of the count, 10).
    expect(c.scores).toBeLessThanOrEqual(2);
    // The solved cell once, as its flash is cleared (FLASH_CLEAR_MS); the keys never.
    expect(c.cells).toBeLessThanOrEqual(1);
    expect(c.keys).toBe(0);
  });

  it("against a bot: the bot's score counts on its card the same way", async () => {
    game = duel();
    await render(
      <Profiler id="game" onRender={onRender}>
        <GameScreen session={game.session} onEnded={jest.fn()} />
      </Profiler>,
    );
    await act(async () => game!.bot.solve(game!.cells[0]!));
    const points = game.host.getView().players[1]!.score;
    expect(points).toBeGreaterThanOrEqual(2);
    await play(game.scheduler, MOVE_TIMELINE.gain.landAt + 50);
    reset();

    await play(game.scheduler, COUNT_MS);
    const c = counts();
    console.log(`[renders] duel, the bot's count-up of ${points}`, c);
    expect(c.commits).toBeLessThanOrEqual(COUNT_TICKS + 1);
    // Never per step of the count (before: 13); the cards redraw only when what they show changes.
    expect(c.scores).toBeLessThanOrEqual(2);
  });
});
