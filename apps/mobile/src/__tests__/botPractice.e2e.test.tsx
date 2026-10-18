// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import {
  type CellIndex,
  cellName,
  type Digit,
  ManualClock,
  ManualScheduler,
  replay,
} from '@sudoku-fight/engine';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { StoreApi, UseBoundStore } from 'zustand';

import RootLayout from '../../app/_layout';
import AchievementsRoute from '../../app/achievements';
import BotSelectRoute from '../../app/bot-select';
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
import { type Outcome, outcomeOf } from '../game/outcome';
import type { PracticeDeps, PracticeSession } from '../game/session';
import { openPracticeStorage } from '../game/storage';
import { freeCellFor, solvedBy } from '../game/testing/botPractice';
import { answerIn } from '../game/testing/practice';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { track } from '../services/analytics';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';

/**
 * Work plan stage 5, end to end: a practice against the engine's bot through the app's real routes (the root
 * layout included), on a real SQLite practice database (sql.js in place of expo-sqlite), with the game and the
 * bot on a manual clock.
 *
 * Home → "שחק" → the modes → "אימון מול בוט" → "מהיר" → the bot selection → Pip → the game: the bot locks and
 * fills cells as time goes by, while the test plays the other cells, tap by tap, to the full board → the results
 * (won or lost, as the engine ranked it, with the bot's row) → "לבית" → the recent list. Then an app restart:
 * everything in memory is new, the database is the same [D25], and the game is still there.
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
// The app's stores, new in every run. The game store's sessions (and their bots) run on the run's manual clock.
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
  'bot-select': BotSelectRoute,
  game: GameRoute,
  'results/[id]': ResultsRoute,
  settings: SettingsRoute,
  leaderboard: LeaderboardRoute,
  history: HistoryRoute,
  achievements: AchievementsRoute,
};

const SEED = 1;
/** How long the player looks at the board between taps (the game's lock lasts 8 s in "מהיר"). */
const THINK_MS = 1_200;
const HOUR = 3_600_000;
const START = 1_760_000_000_000;
const BOT = 'bot-1';

interface Run {
  clock: ManualClock;
  scheduler: ManualScheduler;
  pathname(): string;
  searchParams(): Record<string, string | string[]>;
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
    searchParams: () => app.getSearchParams(),
    kill: () => rendered.unmount(),
  };
}

/** The player waits a moment: the game's clock (and the bot on it) and the phone's timers move on. */
async function pause(run: Run, ms = THINK_MS) {
  await act(async () => {
    run.scheduler.advance(ms);
    jest.advanceTimersByTime(ms);
  });
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const cellLabel = (cell: CellIndex) =>
  screen.getByTestId(`cell-${cellName(cell)}`).props.accessibilityLabel as string;

/** A tap on a cell, then a key, then a moment to look at the result. */
async function place(run: Run, cell: CellIndex, digit: Digit) {
  await press(`cell-${cellName(cell)}`);
  await press(`key-${digit}`);
  await pause(run);
}

/** The session the game screen plays, once the bot selection's start (or "עוד סיבוב") opened it. */
async function gameOpened(run: Run): Promise<{ session: PracticeSession; puzzle: OfflinePuzzle }> {
  await waitFor(() => expect(run.pathname()).toBe('/game'));
  await screen.findByTestId('game');
  const session = useGameStore.getState().session!;
  return { session, puzzle: puzzleById(session.puzzleId)! };
}

/** Waits (in game time) until `ok` holds; fails after `maxMs`. */
async function until(run: Run, ok: () => boolean, maxMs = 60_000, step = 500) {
  const end = run.clock.now() + maxMs;
  while (!ok()) {
    if (run.clock.now() >= end) throw new Error('waited too long');
    await pause(run, step);
  }
}

const OUTCOME_HE: Record<Outcome, { headline: string; recent: string }> = {
  win: { headline: 'ניצחון!', recent: 'ניצחון' },
  loss: { headline: 'הפסד', recent: 'הפסד' },
  tie: { headline: 'תיקו', recent: 'תיקו' },
};

/** What the results screen says about the game: compared before and after a restart. */
function resultsShown() {
  return {
    title: screen.getByTestId('results-title').props.children as string,
    score: screen.getByTestId('results-score').props.children as string,
    opponent: screen.getByTestId(`results-opponent-${BOT}`).props.accessibilityLabel as string,
    opponentScore: screen.getByTestId(`results-opponent-${BOT}-score`).props.children as string,
  };
}

beforeAll(async () => {
  mockApp.db = await memoryDb();
  // Stage 8: the app opens on Home for a signed-in player with a profile only (registration is required,
  // D24 not approved): this phone's player registered earlier (development sign-in, in-memory server).
  await installSignedInPlayer();
});

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'off', sound: true, haptics: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('practice against a bot, end to end (work plan stage 5)', () => {
  let first: {
    id: string;
    outcome: Outcome;
    score: number;
    results: ReturnType<typeof resultsShown>;
    recentLabel: string;
  };

  beforeAll(() => {
    useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null, botLevel: null });
  });

  it('Home → modes → "אימון מול בוט" → "מהיר" → Pip → a full board shared with the bot → results → Home lists it', async () => {
    const run = await launch(START);
    expect(await screen.findByTestId('recent-empty')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    expect(run.pathname()).toBe('/modes');
    await press('mode-bot');
    expect(run.pathname()).toBe('/game-type');
    expect(run.searchParams()).toEqual({ mode: 'bot' });
    await press('type-fast');
    await fireEvent.press(screen.getByRole('button', { name: 'בחירת יריב' }));
    expect(run.pathname()).toBe('/bot-select');
    expect(run.searchParams()).toEqual({ gameType: 'fast' });

    await fireEvent.press(screen.getByRole('radio', { name: /Pip/ }));
    expect(screen.getByTestId('bot-1')).toHaveProp('accessibilityState', { checked: true });
    await fireEvent.press(screen.getByRole('button', { name: 'יאללה, למשחק' }));

    const { session, puzzle } = await gameOpened(run);
    expect(session).toMatchObject({ mode: 'bot', gameType: 'fast', botLevel: 1 });
    expect(screen.getByTestId('duel-hud')).toBeOnTheScreen();
    expect(track).toHaveBeenCalledWith('game_start', { mode: 'bot', type: 'fast', players: 2 });

    // The bot thinks, then locks a cell: the board shows whose it is.
    const botLock = () => session.getView().players[1]!.lock;
    await until(run, () => botLock() !== null);
    const locked = botLock()!.cell;
    expect(cellLabel(locked)).toContain('נעולה על ידי Pip');
    // And fills it, on its own.
    await until(run, () => solvedBy(session.events, BOT).length > 0);
    const filled = solvedBy(session.events, BOT)[0]!;
    expect(cellLabel(filled)).toContain('נפתרה על ידי Pip');

    // Now me: the first free cell each time (not one the bot holds), until the board is full.
    let mine = 0;
    while (session.getView().status !== 'over') {
      const cell = freeCellFor(session.getView(), run.clock.now());
      if (cell === null) {
        await pause(run);
        continue;
      }
      await place(run, cell, answerIn(puzzle, cell));
      // A human's pace: a fast board has only 31–36 empty cells (45–50 givens), and Pip thinks 15–25 s.
      await pause(run);
      mine++;
      if (mine > 200) throw new Error('the game does not end');
    }
    expect(solvedBy(session.events, 'me').length).toBeGreaterThan(10);
    expect(solvedBy(session.events, BOT).length).toBeGreaterThan(1);

    // A full board holds its last flash, then the results replace the game.
    await waitFor(() => expect(run.pathname()).toBe(`/results/${session.id}`));
    const result = session.getView().result!;
    expect(result.reason).toBe('boardComplete');
    const outcome = outcomeOf(result, 'me')!;
    const me = result.ranking.find((r) => r.playerId === 'me')!;
    const bot = result.ranking.find((r) => r.playerId === BOT)!;
    expect(me.score).not.toBe(bot.score);
    expect(outcome).toBe(me.score > bot.score ? 'win' : 'loss');

    expect(await screen.findByRole('header', { name: OUTCOME_HE[outcome].headline })).toBeOnTheScreen();
    expect(screen.getByTestId('results-score')).toHaveTextContent(scoreText(me.score));
    expect(screen.getByTestId('results-end')).toHaveTextContent(/הלוח התמלא/);
    const opponents = screen.getByTestId('results-opponents');
    expect(within(opponents).getByTestId(`results-opponent-${BOT}`)).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Pip · /),
    );
    expect(screen.getByTestId(`results-opponent-${BOT}-score`)).toHaveTextContent(scoreText(bot.score));
    expect(screen.getByTestId('results-unrated')).toHaveTextContent('אימון: אין שינוי בדירוג');
    expect(track).toHaveBeenCalledWith('game_end', {
      mode: 'bot',
      result: outcome,
      score: me.score,
      mistakes: me.mistakes,
      durationSec: Math.round(result.durationMs / 1000),
    });
    const results = resultsShown();

    // "לבית": the game's flow ends, and the recent list has it, with the bot and the result.
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    await waitFor(() => expect(run.pathname()).toBe('/'));
    expect(useGameStore.getState().session).toBeNull();
    const row = await screen.findByTestId(`recent-${session.id}`);
    expect(row).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(
        new RegExp(
          `^אימון מול בוט · מהיר, ${OUTCOME_HE[outcome].recent} מול ${ltr('Pip')}, ${literal(scoreText(me.score))} נקוד`,
        ),
      ),
    );
    expect(
      within(row).getByTestId(outcome === 'win' ? 'result-win' : 'result-loss', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
    // The card's numbers: one decided game.
    await waitFor(() => expect(screen.getByTestId('stat-games')).toHaveTextContent('1משחק'));
    await waitFor(() =>
      expect(screen.getByTestId('stat-wins')).toHaveTextContent(
        `${ltr(outcome === 'win' ? '100%' : '0%')}ניצחונות`,
      ),
    );
    expect(screen.getByTestId('stat-streak')).toHaveTextContent(`${outcome === 'win' ? 1 : 0}רצף`);
    // "עוד סיבוב" now repeats this: fast, against Pip.
    expect(screen.getByTestId('play-again')).toHaveProp(
      'accessibilityLabel',
      `עוד סיבוב, אימון מול בוט · מהיר · ${ltr('Pip')}`,
    );
    expect(mockApp.saveErrors).toEqual([]);

    first = {
      id: session.id,
      outcome,
      score: me.score,
      results,
      recentLabel: row.props.accessibilityLabel as string,
    };
    await run.kill();
  });

  it('the saved log is the whole game, the bot’s moves included [D25]: it replays to the saved result', async () => {
    const repo = await openPracticeStorage();
    const saved = (await repo.getGame(first.id))!;
    expect(saved).toMatchObject({
      status: 'finished',
      mode: 'bot',
      outcome: first.outcome,
      score: first.score,
      opponents: [{ id: BOT, name: 'Pip', isBot: true }],
    });
    const events = await repo.loadEvents(first.id);
    expect(solvedBy(events, BOT).length).toBeGreaterThan(1);
    const end = replay(events).at(-1)!;
    expect(end.status).toBe('over');
    expect(end.result).toEqual(saved.result);
  });

  it('after a restart: still listed with its result; the results are the same; "משחק חדש" leads back to Pip', async () => {
    const run = await launch(START + HOUR);
    const row = await screen.findByTestId(`recent-${first.id}`);
    expect(row).toHaveProp('accessibilityLabel', first.recentLabel);
    await waitFor(() => expect(screen.getByTestId('stat-games')).toHaveTextContent('1משחק'));

    await fireEvent.press(row);
    await waitFor(() => expect(run.pathname()).toBe(`/results/${first.id}`));
    await screen.findByTestId('results-score');
    expect(resultsShown()).toEqual(first.results);

    // "משחק חדש": the game type of a bot practice, "מהיר" chosen, and then the bot selection on Pip.
    await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
    await waitFor(() => expect(run.pathname()).toBe('/game-type'));
    expect(run.searchParams()).toEqual({ gameType: 'fast', mode: 'bot' });
    expect(await screen.findByTestId('type-fast')).toHaveProp('accessibilityState', { checked: true });
    await fireEvent.press(screen.getByRole('button', { name: 'בחירת יריב' }));
    await waitFor(() => expect(run.pathname()).toBe('/bot-select'));
    expect(screen.getByTestId('bot-1')).toHaveProp('accessibilityState', { checked: true });
    expect(mockApp.saveErrors).toEqual([]);
    await run.kill();
  });
});

/** A string as a literal piece of a RegExp. */
function literal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
