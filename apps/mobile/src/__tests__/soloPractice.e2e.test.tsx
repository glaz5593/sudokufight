// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import {
  type CellIndex,
  cellName,
  type Digit,
  formatScoreLine,
  type GameEvent,
  ManualClock,
  ManualScheduler,
  replay,
} from '@sudoku-fight/engine';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { StoreApi, UseBoundStore } from 'zustand';

import RootLayout from '../../app/_layout';
import AchievementsRoute from '../../app/achievements';
import GameRoute from '../../app/game';
import GameTypeRoute from '../../app/game-type';
import HistoryRoute from '../../app/history';
import Index from '../../app/index';
import LeaderboardRoute from '../../app/leaderboard';
import ModesRoute from '../../app/modes';
import ResultsRoute from '../../app/results/[id]';
import SettingsRoute from '../../app/settings';
import { installSignedInPlayer } from '../auth/testing/testAuth';
import { ltr, scoreText } from '../components/player';
import { useGameStore } from '../game/gameStore';
import { type OfflinePuzzle, puzzleById } from '../game/offlinePool';
import type { PracticeDeps, PracticeSession } from '../game/session';
import { openPracticeStorage } from '../game/storage';
import { answerIn, emptyCellsOf } from '../game/testing/practice';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { track } from '../services/analytics';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';

/**
 * Work plan stage 4, end to end: solo practice through the app's real routes (the root layout included), on a
 * real SQLite practice database (sql.js in place of expo-sqlite), with the game on a manual clock.
 *
 * Home → "שחק" → the modes → "אימון לבד" → "מהיר" → the game: the whole board, tapped cell by cell, with one
 * wrong digit → the results → "לבית" → the recent list. Then app restarts: everything in memory is new (the
 * stores, the storage module that opens the database once per run), the database is the same [D25].
 *
 * The test reads the solution from the offline pool by the session's puzzle id, to know which key to press;
 * the screens never see it.
 */

/** What lives across app runs: the phone's database. What a run makes anew is keyed by `run`. */
const mockApp: {
  db: SqlJsDb | null;
  run: number;
  session: Omit<PracticeDeps, 'repo'>;
  saveErrors: unknown[];
} = { db: null, run: 0, session: {}, saveErrors: [] };

/** A value made once per app run: the first use in a run makes it. */
function mockPerRun<T>(make: () => T): () => T {
  let made: { run: number; value: T } | null = null;
  return () => {
    if (made?.run !== mockApp.run) made = { run: mockApp.run, value: make() };
    return made.value;
  };
}

/** A Zustand store hook that is a new store in every app run (the app's module singletons, restarted). */
function mockStorePerRun<S>(make: () => UseBoundStore<StoreApi<S>>): UseBoundStore<StoreApi<S>> {
  const current = mockPerRun(make);
  const hook = (<U,>(selector?: (state: S) => U) =>
    current()(selector ?? ((s: S) => s as unknown as U))) as UseBoundStore<StoreApi<S>>;
  return Object.assign(hook, {
    getState: () => current().getState(),
    getInitialState: () => current().getInitialState(),
    setState: ((...args: Parameters<StoreApi<S>['setState']>) =>
      current().setState(...args)) as StoreApi<S>['setState'],
    subscribe: (listener: Parameters<StoreApi<S>['subscribe']>[0]) => current().subscribe(listener),
  });
}

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
// The phone's practice.db: one sql.js database for every run.
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockApp.db }));
// The real storage module, loaded afresh in every run: it opens the database once per run and marks the games the
// last run left playing as interrupted.
type MockStorage = typeof import('../game/storage');
jest.mock('../game/storage', () => {
  const current = mockPerRun(() => {
    let mod!: MockStorage;
    jest.isolateModules(() => {
      mod = jest.requireActual<MockStorage>('../game/storage');
    });
    return mod;
  });
  return {
    PRACTICE_DB_NAME: 'practice.db',
    openPracticeStorage: () => current().openPracticeStorage(),
    practiceStorageOrNull: () => current().practiceStorageOrNull(),
  };
});
// The app's stores, new in every run. The game store's sessions run on the run's manual clock.
jest.mock('../game/gameStore', () => {
  const actual = jest.requireActual<typeof import('../game/gameStore')>('../game/gameStore');
  return {
    ...actual,
    useGameStore: mockStorePerRun(() =>
      actual.createGameStore({ ...actual.defaultGameStoreDeps, session: mockApp.session }),
    ),
  };
});
jest.mock('../state/practiceHistory', () => {
  const actual = jest.requireActual<typeof import('../state/practiceHistory')>('../state/practiceHistory');
  return { ...actual, usePracticeHistory: mockStorePerRun(() => actual.createPracticeHistory()) };
});
jest.mock('../screens/home/practiceStats', () => {
  const actual = jest.requireActual<typeof import('../screens/home/practiceStats')>(
    '../screens/home/practiceStats',
  );
  return { ...actual, usePracticeStats: mockStorePerRun(() => actual.createPracticeStats()) };
});
type NativeMocks = typeof import('../screens/home/testing/nativeMocks');
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
jest.mock(
  'expo-audio',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoAudio,
);
jest.mock(
  'expo-haptics',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoHaptics,
);

jest.setTimeout(120_000);

/** Every route of the app but the development tools (/dev/*). */
const ROUTES = {
  _layout: RootLayout,
  index: Index,
  modes: ModesRoute,
  'game-type': GameTypeRoute,
  game: GameRoute,
  'results/[id]': ResultsRoute,
  settings: SettingsRoute,
  leaderboard: LeaderboardRoute,
  history: HistoryRoute,
  achievements: AchievementsRoute,
};

/** One seed for every practice: the second practice can differ from the first only by the history (spec §20). */
const SEED = 1;
/** How long the player looks at the board between taps (the game's lock lasts 8 s in "מהיר"). */
const THINK_MS = 1_200;
const HOUR = 3_600_000;

interface Run {
  clock: ManualClock;
  scheduler: ManualScheduler;
  pathname(): string;
  /** The app goes away: unmounted, with nothing closed or saved on the way out (the process is killed). */
  kill(): Promise<void>;
}

/** Starts the app (a new run: new stores, a new storage module; the same database) on Home, at `at`. */
async function launch(at: number): Promise<Run> {
  mockApp.run += 1;
  const clock = new ManualClock(at);
  const scheduler = new ManualScheduler(clock);
  mockApp.session = {
    clock,
    scheduler,
    seed: SEED,
    onError: (what, error) => mockApp.saveErrors.push([what, error]),
  };
  const app = renderRouter(ROUTES, { initialUrl: '/' });
  const rendered = await app;
  await screen.findByTestId('home-scroll');
  return {
    clock,
    scheduler,
    pathname: () => app.getPathname(),
    kill: () => rendered.unmount(),
  };
}

/** The player waits a moment: the game's clock and the phone's timers (flights, counts, countdowns) move on. */
async function pause(run: Run, ms = THINK_MS) {
  await act(async () => {
    run.scheduler.advance(ms);
    jest.advanceTimersByTime(ms);
  });
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

/** A tap on a cell, then a key, then a moment to look at the result. */
async function place(run: Run, cell: CellIndex, digit: Digit) {
  await press(`cell-${cellName(cell)}`);
  await press(`key-${digit}`);
  await pause(run);
}

/** A digit that is wrong in `cell` and still has a key to press (not all nine of it on the board). */
function wrongDigit(puzzle: OfflinePuzzle, cell: CellIndex): Digit {
  const right = answerIn(puzzle, cell);
  for (let d = 1; d <= 9; d++) {
    const onBoard = [...puzzle.givens].filter((c) => c === String(d)).length;
    if (d !== right && onBoard < 9) return d as Digit;
  }
  throw new Error('no wrong digit to press');
}

/** The session the game screen plays, once Home → … → "התחל אימון" (or "עוד סיבוב") opened it. */
async function gameOpened(run: Run): Promise<{ session: PracticeSession; puzzle: OfflinePuzzle }> {
  await waitFor(() => expect(run.pathname()).toBe('/game'));
  await screen.findByTestId('game');
  const session = useGameStore.getState().session!;
  return { session, puzzle: puzzleById(session.puzzleId)! };
}

const recentRow = (id: string) => screen.findByTestId(`recent-${id}`);

/** What the results screen says about a game: compared before and after a restart. */
function resultsShown() {
  return {
    title: screen.getByTestId('results-title').props.children as string,
    score: screen.getByTestId('results-score').props.children as string,
    end: screen.getByTestId('results-end').props.children as string,
    best: screen.getByTestId('results-best').props.accessibilityLabel as string,
    stats: ['time', 'mistakes', 'correct', 'think'].map(
      (k) => screen.getByTestId(`results-stat-${k}`).props.accessibilityLabel as string,
    ),
  };
}

const placedPoints = (events: readonly GameEvent[]) =>
  events.flatMap((e) => (e.type === 'placedCorrect' ? [e.points] : []));

beforeAll(async () => {
  mockApp.db = await memoryDb();
  // Stage 8: the app opens on Home for a signed-in player with a profile only (registration is required,
  // D24 not approved): this phone's player registered earlier (development sign-in, in-memory server).
  await installSignedInPlayer();
});

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'off', sound: true, haptics: true });
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('solo practice, end to end (work plan stage 4)', () => {
  // The three tests run in order on one database, as one phone's story: play, restart, a game cut short.
  let first: { id: string; puzzleId: string; results: ReturnType<typeof resultsShown>; score: number };

  it('Home → modes → "אימון לבד" → "מהיר" → the whole board with one mistake → results → Home lists it', async () => {
    const run = await launch(1_760_000_000_000);
    expect(await screen.findByTestId('recent-empty')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    expect(run.pathname()).toBe('/modes');
    await press('mode-solo');
    expect(run.pathname()).toBe('/game-type');
    await press('type-fast');
    expect(screen.getByTestId('type-fast')).toHaveProp('accessibilityState', { checked: true });
    await fireEvent.press(screen.getByRole('button', { name: 'התחל אימון' }));

    const { session, puzzle } = await gameOpened(run);
    expect(session).toMatchObject({ mode: 'solo', gameType: 'fast' });
    expect(screen.getByTestId('solo-hud-title', { includeHiddenElements: true })).toHaveTextContent(
      'אימון לבד · מהיר',
    );

    // The first empty cell: a wrong digit first. It stays small and red, costs 1, and the cell is free again.
    const empty = emptyCellsOf(puzzle);
    const [a, ...rest] = empty as [CellIndex, ...CellIndex[]];
    await place(run, a, wrongDigit(puzzle, a));
    expect(within(screen.getByTestId(`cell-${cellName(a)}`)).getByTestId('cell-wrong')).toBeOnTheScreen();
    expect(screen.getByTestId('solo-hud-summary')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining('טעות אחת'),
    );
    expect(session.getView().players[0]!.score).toBe(-1);

    // Then the right digits, cell by cell, to the last one.
    await place(run, a, answerIn(puzzle, a));
    for (const cell of rest) await place(run, cell, answerIn(puzzle, cell));

    // A full board holds its last flash, then the results replace the game.
    await waitFor(() => expect(run.pathname()).toBe(`/results/${session.id}`));
    const view = session.getView();
    expect(view.status).toBe('over');
    expect(view.result?.reason).toBe('boardComplete');
    const me = view.result!.ranking[0]!;
    // The score is the sum of the moves' points, less the one penalty (spec §6.4, §6.5).
    const points = placedPoints(session.events);
    expect(points).toHaveLength(empty.length);
    expect(me).toMatchObject({ score: points.reduce((s, p) => s + p, 0) - 1, mistakes: 1 });

    expect(await screen.findByRole('header', { name: 'הלוח הושלם!' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-score')).toHaveTextContent(scoreText(me.score));
    expect(screen.getByLabelText('טעויות: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText(`מהלכים נכונים: ${empty.length}`)).toBeOnTheScreen();
    // The move of the game: the best points of the log, with the engine's calculation line.
    const best = view.result!.stats[0]!.bestMove!;
    expect(best.points).toBe(Math.max(...points));
    expect(screen.getByTestId('results-best-line')).toHaveTextContent(ltr(formatScoreLine(best.breakdown)));
    expect(screen.getByTestId('results-best')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`${best.digit} ב־${ltr(cellName(best.cell))}`),
    );
    expect(track).toHaveBeenCalledWith('game_start', { mode: 'solo', type: 'fast', players: 1 });
    expect(track).toHaveBeenCalledWith('game_end', {
      mode: 'solo',
      result: 'completed',
      score: me.score,
      mistakes: 1,
      durationSec: Math.round(view.result!.durationMs / 1000),
    });
    first = { id: session.id, puzzleId: session.puzzleId, results: resultsShown(), score: me.score };

    // "לבית": the game's flow ends, and the recent list has it.
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    await waitFor(() => expect(run.pathname()).toBe('/'));
    expect(useGameStore.getState().session).toBeNull();
    expect(await recentRow(session.id)).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(
        new RegExp(`^אימון לבד · מהיר, הושלם, ${literal(scoreText(me.score))} נקודות?, 1 טעות, `),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('stat-games')).toHaveTextContent('1משחק'));
    expect(mockApp.saveErrors).toEqual([]);
    await run.kill();
  });

  it('the saved log is the full game [D25]: it replays through the engine to the saved score', async () => {
    const repo = await openPracticeStorage();
    const saved = (await repo.getGame(first.id))!;
    expect(saved).toMatchObject({
      status: 'finished',
      endReason: 'boardComplete',
      score: first.score,
      mistakes: 1,
    });

    const events = await repo.loadEvents(first.id);
    expect(events[0]).toMatchObject({ type: 'gameCreated' });
    // The solution is in the log, for the replay of stage 11.
    expect(events[0]!.type === 'gameCreated' && events[0]!.config.puzzle.solution).toBe(
      puzzleById(first.puzzleId)!.solution,
    );
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => events[0]!.seq + i));
    expect(events.filter((e) => e.type === 'placedWrong')).toHaveLength(1);

    const end = replay(events).at(-1)!;
    expect(end.status).toBe('over');
    expect(end.players[0]).toMatchObject({ score: saved.score, mistakes: 1, correct: saved.correct });
    expect(end.result).toEqual(saved.result);
  });

  it('after a restart: the game is still listed with the same results; a new practice gets another puzzle', async () => {
    const run = await launch(1_760_000_000_000 + HOUR);
    await fireEvent.press(await recentRow(first.id));
    await waitFor(() => expect(run.pathname()).toBe(`/results/${first.id}`));
    await screen.findByTestId('results-score');
    expect(resultsShown()).toEqual(first.results);

    // "משחק חדש": the game type again, "מהיר" chosen. The same seed, but the puzzle just played is in the
    // history (spec §20), so another one comes.
    await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
    await waitFor(() => expect(run.pathname()).toBe('/game-type'));
    expect(await screen.findByTestId('type-fast')).toHaveProp('accessibilityState', { checked: true });
    await fireEvent.press(screen.getByRole('button', { name: 'התחל אימון' }));
    const { session, puzzle } = await gameOpened(run);
    expect(session.gameType).toBe('fast');
    expect(session.puzzleId).not.toBe(first.puzzleId);

    // A move, then the app is killed mid-game: nothing is closed, the row stays "playing" on disk.
    const cell = emptyCellsOf(puzzle)[0]!;
    await place(run, cell, answerIn(puzzle, cell));
    const points = session.getView().players[0]!.score;
    expect(points).toBeGreaterThan(0);
    await session.flush();
    expect((await (await openPracticeStorage()).getGame(session.id))?.status).toBe('playing');
    await run.kill();

    // The next run opens the database and marks it interrupted; Home lists it, and its results come from the log.
    const next = await launch(1_760_000_000_000 + 2 * HOUR);
    expect(await screen.findByTestId(`interrupted-${session.id}`)).toHaveTextContent('הופסק');
    expect(screen.getByTestId(`recent-${first.id}`)).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('stat-games')).toHaveTextContent('2משחקים'));
    await fireEvent.press(screen.getByTestId(`recent-${session.id}`));
    await waitFor(() => expect(next.pathname()).toBe(`/results/${session.id}`));
    expect(await screen.findByRole('header', { name: 'האימון נקטע' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-score')).toHaveTextContent(scoreText(points));
    expect(screen.getByLabelText('מהלכים נכונים: 1')).toBeOnTheScreen();
    expect((await (await openPracticeStorage()).getGame(session.id))?.status).toBe('interrupted');
    expect(mockApp.saveErrors).toEqual([]);
    await next.kill();
  });
});

/** A string as a literal piece of a RegExp. */
function literal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
