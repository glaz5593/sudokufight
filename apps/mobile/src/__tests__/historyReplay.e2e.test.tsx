// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import {
  candidates,
  type CellIndex,
  cellName,
  DEFAULT_GRADING,
  type Digit,
  explain,
  type Explanation,
  formatExplanation,
  type GameEvent,
  type GameState,
  gradePuzzle,
  type Grid,
  isPlacement,
  ManualClock,
  ManualScheduler,
  parseGrid,
  PEERS,
  type PlayerId,
  replay,
  unitsOf,
} from '@sudoku-fight/engine';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { router } from 'expo-router';
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
import ReplayRoute from '../../app/replay/[id]';
import ResultsRoute from '../../app/results/[id]';
import SettingsRoute from '../../app/settings';
import { installSignedInPlayer } from '../auth/testing/testAuth';
import { ltr } from '../components/player';
import { useGameStore } from '../game/gameStore';
import { type OfflinePuzzle, puzzleById } from '../game/offlinePool';
import type { PracticeDeps, PracticeSession } from '../game/session';
import { openPracticeStorage } from '../game/storage';
import { freeCellFor } from '../game/testing/botPractice';
import { answerIn, emptyCellsOf } from '../game/testing/practice';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { elapse, FakeTable, ME, OPP } from '../net/testing/fakeServer';
import type { HistoryApi } from '../screens/history/historyApi';
import { track } from '../services/analytics';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';

/**
 * Work plan stages 9–11 end to end, through the app's real routes (the root layout included), on a real SQLite
 * practice database (sql.js in place of expo-sqlite), with the games on a manual clock:
 *
 * 1. A solo practice and a practice against Pip, each played to the end (one mistake in each).
 * 2. The history tab: both under "הכל" and "אימון", and "מדורג" empty (a server with no ranked games) → the bot
 *    game's card → its replay: every step forward and back, "שלב N מתוך M", an explanation for both players at
 *    every step, and the last step's board is the final board.
 *    The explanations are checked against the engine on its own, not against the replay model: for every move
 *    the test rebuilds the board before it from the saved log, and the card must show the engine's explanation
 *    of that board, for the solution's digit; every step of that explanation is then checked by hand (a naked
 *    single has that one candidate, a hidden single that one place in its unit, an elimination never removes
 *    the solution's digit), and every technique is one the grader knows.
 * 3. After an app restart: Home → the bot game's results → "צפייה חוזרת" opens the same replay.
 * 4. A four-player online game (the fake game server around the real engine) played to the end through the game
 *    screen: the results show the podium and the 4th place.
 */

/** What lives across app runs: the phone's database. What a run makes anew is keyed by `run`. */
const mockApp: {
  db: SqlJsDb | null;
  run: number;
  session: Omit<PracticeDeps, 'repo'>;
  saveErrors: unknown[];
  /** The game server's history routes, as the app sees them. */
  ranked: (HistoryApi & { calls: string[] }) | null;
} = { db: null, run: 0, session: {}, saveErrors: [], ranked: null };

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
// The real storage module, loaded afresh in every run.
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
// The app's stores, new in every run. The game store's practices (and their bots) run on the run's clock.
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
// The history and the replay as wired in the app (the phone's database), with the game server's history routes
// in memory instead of fetch.
type MockWiring = typeof import('../screens/history/appWiring');
jest.mock('../screens/history/appWiring', () => {
  const actual = jest.requireActual<MockWiring>('../screens/history/appWiring');
  return {
    signedInHistoryApi: () => mockApp.ranked,
    appHistoryDeps: () => ({ ...actual.appHistoryDeps(), ranked: mockApp.ranked }),
    appReplayDeps: () => ({ ...actual.appReplayDeps(), ranked: mockApp.ranked }),
  } satisfies MockWiring;
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

jest.setTimeout(300_000);

/** Every route of the app but the development tools (/dev/*) and the account screens. */
const ROUTES = {
  _layout: RootLayout,
  index: Index,
  modes: ModesRoute,
  'game-type': GameTypeRoute,
  'bot-select': BotSelectRoute,
  game: GameRoute,
  'results/[id]': ResultsRoute,
  'replay/[id]': ReplayRoute,
  settings: SettingsRoute,
  leaderboard: LeaderboardRoute,
  history: HistoryRoute,
  achievements: AchievementsRoute,
};

const SEED = 1;
const THINK_MS = 1_200;
const HOUR = 3_600_000;
const START = 1_760_000_000_000;
const BOT = 'bot-1';
const hidden = { includeHiddenElements: true };

interface Run {
  clock: ManualClock;
  scheduler: ManualScheduler;
  pathname(): string;
  searchParams(): Record<string, string | string[]>;
  kill(): Promise<void>;
}

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

async function pause(run: Run, ms = THINK_MS) {
  await act(async () => {
    run.scheduler.advance(ms);
    jest.advanceTimersByTime(ms);
  });
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

async function place(run: Run, cell: CellIndex, digit: Digit) {
  await press(`cell-${cellName(cell)}`);
  await press(`key-${digit}`);
  await pause(run);
}

/** A digit that is wrong in `cell` and still has a key to press (not all nine of it on the board). */
function wrongDigit(puzzle: Pick<OfflinePuzzle, 'givens' | 'solution'>, cell: CellIndex): Digit {
  const right = answerIn(puzzle, cell);
  for (let d = 1; d <= 9; d++) {
    const onBoard = [...puzzle.givens].filter((c) => c === String(d)).length;
    if (d !== right && onBoard < 9) return d as Digit;
  }
  throw new Error('no wrong digit to press');
}

async function gameOpened(run: Run): Promise<{ session: PracticeSession; puzzle: OfflinePuzzle }> {
  await waitFor(() => expect(run.pathname()).toBe('/game'));
  await screen.findByTestId('game');
  const session = useGameStore.getState().session!;
  return { session, puzzle: puzzleById(session.puzzleId)! };
}

/** The cards of the history list, in order. */
const cardIds = () =>
  screen
    .getAllByRole('button')
    .map((b) => b.props.testID as string | undefined)
    .filter((id): id is string => !!id && id.startsWith('history-card-'));

/** A cell of the replay's board as its label says it: the digit, or 0 when empty. */
function digitShown(cell: CellIndex): number {
  const board = screen.getByTestId('replay-board');
  const label = within(board).getByTestId(`cell-${cellName(cell)}`).props.accessibilityLabel as string;
  const content = label.split(', ')[1]!;
  return /^[1-9]$/.test(content) ? Number(content) : 0;
}

// ---------------------------------------------------------------------------------------------------------
// The oracle: the replay worked out from the saved log by the engine alone

/** Spec §13.1: one step per action (and the start). */
function isAction(e: GameEvent): boolean {
  switch (e.type) {
    case 'cellLocked':
    case 'placedCorrect':
    case 'placedWrong':
    case 'interference':
    case 'playerDisconnected':
    case 'playerReconnected':
    case 'playerSurrendered':
    case 'playerAbandoned':
      return true;
    case 'cellReleased':
      return e.reason === 'cancel' || e.reason === 'timeout';
    default:
      return false;
  }
}

/** The moves an explanation is about (spec §13.2: the cell the player chose). */
const isMove = (
  e: GameEvent,
): e is Extract<GameEvent, { type: 'cellLocked' | 'placedCorrect' | 'placedWrong' }> =>
  e.type === 'cellLocked' || e.type === 'placedCorrect' || e.type === 'placedWrong';

const cellOf = (e: GameEvent): CellIndex | null =>
  'cell' in e && typeof e.cell === 'number' ? e.cell : null;

/**
 * Checks an explanation step by step, by hand: each placement is forced by the candidates left at that point
 * (a naked single has one candidate; a hidden single one place in its unit) and is the solution's digit; each
 * elimination removes only digits the solution does not have there. The chain ends by placing the cell.
 */
function checkExplanation(grid: Grid, cell: CellIndex, solution: Grid, expl: Explanation): void {
  expect(expl).toMatchObject({ cell, digit: solution[cell], resolved: true });
  const known: readonly string[] = DEFAULT_GRADING.levels.flatMap((l) => l.techniques);
  expect(expl.technique === 'chain' || known.includes(expl.technique)).toBe(true);
  const board = [...grid];
  const cand = board.map((_, i) => new Set<number>(candidates(board, i)));
  const put = (c: CellIndex, d: Digit) => {
    expect(solution[c]).toBe(d);
    board[c] = d;
    cand[c]!.clear();
    for (const p of PEERS[c]!) cand[p]!.delete(d);
  };
  for (const step of expl.steps) {
    expect(known).toContain(step.technique);
    switch (step.technique) {
      case 'nakedSingle':
        expect([...cand[step.cell]!]).toEqual([step.digit]);
        put(step.cell, step.digit);
        break;
      case 'hiddenSingle': {
        const unit = unitsOf(step.cell).find(
          (u) => u.kind === step.unit.kind && u.index === step.unit.index,
        )!;
        expect(unit.cells.filter((c) => board[c] === 0 && cand[c]!.has(step.digit))).toEqual([step.cell]);
        put(step.cell, step.digit);
        break;
      }
      case 'pointing':
      case 'claiming':
        for (const c of step.removed) {
          expect(solution[c]).not.toBe(step.digit);
          cand[c]!.delete(step.digit);
        }
        break;
      case 'nakedPair':
      case 'hiddenPair':
        for (const r of step.removed)
          for (const d of r.digits) {
            expect(solution[r.cell]).not.toBe(d);
            cand[r.cell]!.delete(d);
          }
        break;
    }
  }
  const last = expl.steps[expl.steps.length - 1]!;
  expect(isPlacement(last) && last.cell === cell && last.digit === solution[cell]).toBe(true);
}

interface Oracle {
  events: GameEvent[];
  states: GameState[];
  solution: Grid;
  /** Index in `events` of each step's action; -1 for the start. */
  actions: number[];
  players: PlayerId[];
  /** The explanation of the move at events[i], worked out (and checked) once. */
  explained(i: number): { text: string; cell: CellIndex; digit: Digit };
}

function oracleOf(events: GameEvent[], puzzle: OfflinePuzzle, players: PlayerId[]): Oracle {
  const states = replay(events);
  const solution = parseGrid(puzzle.solution);
  // The puzzle is what its game type says (the grader's verdict), so every board after it is too.
  expect(gradePuzzle(parseGrid(puzzle.givens)).difficulty).toBe(puzzle.gameType);
  const actions = [-1, ...events.flatMap((e, i) => (isAction(e) ? [i] : []))];
  const cache = new Map<number, { text: string; cell: CellIndex; digit: Digit }>();
  return {
    events,
    states,
    solution,
    actions,
    players,
    explained(i) {
      const hit = cache.get(i);
      if (hit) return hit;
      const cell = cellOf(events[i]!)!;
      // The board just before the move (spec §13.2), whatever the player then did.
      const before = states[i - 1]!.grid;
      expect(before[cell]).toBe(0);
      expect(gradePuzzle(before).difficulty).toBe(puzzle.gameType);
      const expl = explain(before, cell, solution);
      checkExplanation(before, cell, solution, expl);
      const made = { text: formatExplanation(expl, 'he'), cell, digit: expl.digit };
      cache.set(i, made);
      return made;
    },
  };
}

/** The screen at step `n` (1-based) against the oracle: the counter, the board, every player's explanation. */
function checkStep(o: Oracle, n: number): number {
  const total = o.actions.length;
  expect(screen.getByTestId('replay-counter')).toHaveTextContent(`שלב ${n} מתוך ${total}`);
  const at = o.actions[n - 1]!;
  const grid = o.states[Math.max(0, at)]!.grid;
  if (at >= 0) {
    const cell = cellOf(o.events[at]!);
    if (cell !== null) expect(digitShown(cell)).toBe(grid[cell]);
  }
  let explained = 0;
  for (const p of o.players) {
    let subject = -1;
    for (let i = 0; i <= at; i++) {
      const e = o.events[i]!;
      if (isMove(e) && e.playerId === p) subject = i;
    }
    const card = `replay-explain-${p}`;
    expect(screen.getByTestId(card, hidden)).toBeOnTheScreen();
    if (subject < 0) {
      expect(screen.queryByTestId(`${card}-text`, hidden)).toBeNull();
      continue;
    }
    const want = o.explained(subject);
    expect(screen.getByTestId(`${card}-move`, hidden)).toHaveTextContent(
      ltr(`${cellName(want.cell)} → ${want.digit}`),
    );
    expect(screen.getByTestId(`${card}-text`, hidden)).toHaveTextContent(want.text);
    explained++;
  }
  return explained;
}

// ---------------------------------------------------------------------------------------------------------

beforeAll(async () => {
  mockApp.db = await memoryDb();
  await installSignedInPlayer();
  const { fakeHistoryApi } = jest.requireActual<typeof import('../screens/replay/testing/sources')>(
    '../screens/replay/testing/sources',
  );
  // The game server knows no ranked game of this player.
  mockApp.ranked = fakeHistoryApi([]);
});

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'on', sound: true, haptics: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('history and replay, end to end (work plan stages 9–11)', () => {
  const played: { solo: string; bot: string; botPuzzle: OfflinePuzzle | null } = {
    solo: '',
    bot: '',
    botPuzzle: null,
  };
  let botSteps = 0;
  let secondNarration = '';

  beforeAll(() => {
    useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null, botLevel: null });
  });

  it('a solo practice and a practice against Pip, each played to the end with one mistake', async () => {
    const run = await launch(START);

    // Solo, "מהיר": a wrong digit first, then the whole board.
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    await press('mode-solo');
    await press('type-fast');
    await fireEvent.press(screen.getByRole('button', { name: 'התחל אימון' }));
    const solo = await gameOpened(run);
    const [first, ...rest] = emptyCellsOf(solo.puzzle) as [CellIndex, ...CellIndex[]];
    await place(run, first, wrongDigit(solo.puzzle, first));
    await place(run, first, answerIn(solo.puzzle, first));
    for (const cell of rest) await place(run, cell, answerIn(solo.puzzle, cell));
    await waitFor(() => expect(run.pathname()).toBe(`/results/${solo.session.id}`));
    played.solo = solo.session.id;
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    await waitFor(() => expect(run.pathname()).toBe('/'));

    // Against Pip, "מהיר": my first move is wrong; then the free cells, until the board is full.
    await pause(run, 10 * 60_000);
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    await press('mode-bot');
    await press('type-fast');
    await fireEvent.press(screen.getByRole('button', { name: 'בחירת יריב' }));
    await fireEvent.press(screen.getByRole('radio', { name: /Pip/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'יאללה, למשחק' }));
    const bot = await gameOpened(run);
    expect(bot.session).toMatchObject({ mode: 'bot', gameType: 'fast' });
    let wrongDone = false;
    let moves = 0;
    while (bot.session.getView().status !== 'over') {
      const cell = freeCellFor(bot.session.getView(), run.clock.now());
      if (cell === null) {
        await pause(run);
        continue;
      }
      await place(run, cell, wrongDone ? answerIn(bot.puzzle, cell) : wrongDigit(bot.puzzle, cell));
      // A human's pace: a fast board has only 31–36 empty cells (45–50 givens), and Pip thinks 15–25 s.
      await pause(run);
      wrongDone = true;
      if (++moves > 200) throw new Error('the game does not end');
    }
    await waitFor(() => expect(run.pathname()).toBe(`/results/${bot.session.id}`));
    played.bot = bot.session.id;
    played.botPuzzle = bot.puzzle;
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    await waitFor(() => expect(run.pathname()).toBe('/'));
    expect(mockApp.saveErrors).toEqual([]);
    await run.kill();
  });

  it('History: both under "הכל" and "אימון", "מדורג" empty; the bot game’s replay, step by step, explained', async () => {
    const run = await launch(START + HOUR);
    await press('nav-history');
    await waitFor(() => expect(run.pathname()).toBe('/history'));
    await waitFor(() =>
      expect(cardIds()).toEqual([`history-card-${played.bot}`, `history-card-${played.solo}`]),
    );
    expect(mockApp.ranked!.calls).toContain('games:');

    await press('history-filter-practice');
    await waitFor(() =>
      expect(cardIds()).toEqual([`history-card-${played.bot}`, `history-card-${played.solo}`]),
    );
    expect(screen.getByTestId('history-note-practice')).toBeOnTheScreen();
    await press('history-filter-ranked');
    expect(await screen.findByTestId('history-empty')).toBeOnTheScreen();
    expect(cardIds()).toEqual([]);
    await press('history-filter-all');
    await waitFor(() => expect(cardIds()).toHaveLength(2));

    // The bot game's card opens its replay, from the phone's log.
    await press(`history-card-${played.bot}`);
    await waitFor(() => expect(run.pathname()).toBe(`/replay/${played.bot}`));
    expect(run.searchParams()).toMatchObject({ source: 'practice' });
    await screen.findByTestId('replay-counter');
    // Spec §22.
    expect(track).toHaveBeenCalledWith('replay_open', { mode: 'bot' });

    const repo = await openPracticeStorage();
    const events = await repo.loadEvents(played.bot);
    const o = oracleOf(events, played.botPuzzle!, [ME, BOT]);
    const total = o.actions.length;
    // At least a choice and a placement for every empty cell, the start, and my mistake's two steps.
    expect(total).toBeGreaterThanOrEqual(2 * emptyCellsOf(played.botPuzzle!).length + 3);
    expect(o.events.some((e) => e.type === 'placedWrong' && e.playerId === ME)).toBe(true);
    expect(o.events.some((e) => e.type === 'placedCorrect' && e.playerId === BOT)).toBe(true);
    botSteps = total;

    // The start: the givens, and no explanation yet.
    expect(screen.getByTestId('replay-prev')).toBeDisabled();
    expect(screen.getByTestId('replay-narration')).toHaveTextContent('המשחק מתחיל');
    const givens = parseGrid(played.botPuzzle!.givens);
    for (let cell = 0; cell < 81; cell++) expect(digitShown(cell)).toBe(givens[cell]);

    // Forward through every step.
    let both = 0;
    for (let n = 1; n <= total; n++) {
      if (checkStep(o, n) === 2) both++;
      if (n === 2) secondNarration = String(screen.getByTestId('replay-narration').props.children);
      if (n < total) await press('replay-next');
    }
    // An explanation for both players at most steps (each from their first move on).
    expect(both).toBeGreaterThan(total / 2);
    expect(screen.getByTestId('replay-next')).toBeDisabled();
    expect(screen.getByTestId('replay-narration')).toHaveTextContent(/המשחק נגמר/);
    // The last step's board is the final board: the solution, everywhere.
    const final = o.states[o.states.length - 1]!;
    expect(final.status).toBe('over');
    for (let cell = 0; cell < 81; cell++) expect(digitShown(cell)).toBe(final.grid[cell]);
    expect(final.grid).toEqual(o.solution);

    // And back, every step, to the start.
    for (let n = total; n >= 1; n--) {
      checkStep(o, n);
      if (n > 1) await press('replay-prev');
    }
    expect(screen.getByTestId('replay-prev')).toBeDisabled();
    await run.kill();
  });

  it('after a restart: the bot game’s results → "צפייה חוזרת" opens the same replay', async () => {
    const run = await launch(START + 2 * HOUR);
    await fireEvent.press(await screen.findByTestId(`recent-${played.bot}`));
    await waitFor(() => expect(run.pathname()).toBe(`/results/${played.bot}`));
    await fireEvent.press(await screen.findByRole('button', { name: 'צפייה חוזרת' }));
    await waitFor(() => expect(run.pathname()).toBe(`/replay/${played.bot}`));
    expect(run.searchParams()).toMatchObject({ source: 'practice' });
    expect(await screen.findByTestId('replay-counter')).toHaveTextContent(`שלב 1 מתוך ${botSteps}`);
    await press('replay-next');
    expect(screen.getByTestId('replay-narration')).toHaveTextContent(secondNarration);
    await run.kill();
  });
});

describe('a four-player online game through the fake server (work plan stages 10–11)', () => {
  const PLAYERS = [
    { id: ME, name: 'Moshe', rating: 1287, ratedGames: 12 },
    { id: OPP, name: 'NinaVolt', rating: 1305, ratedGames: 12 },
    { id: 'p3', name: 'Ziv', rating: 1250, ratedGames: 12 },
    { id: 'p4', name: 'Lea', rating: 1190, ratedGames: 12 },
  ];

  /** The fake server's clock, its network and the phone's timers move on together. */
  async function pass(table: FakeTable, ms: number, step = 50) {
    for (let done = 0; done < ms; done += step) {
      const d = Math.min(step, ms - done);
      await act(async () => {
        await elapse(table, d, Math.min(10, d));
        jest.advanceTimersByTime(d);
      });
    }
  }

  it('is played to the full board on the game screen, and the results show the podium and the 4th place', async () => {
    const run = await launch(START + 3 * HOUR);
    const table = new FakeTable({ players: PLAYERS });
    const online = useGameStore
      .getState()
      .startOnline({ kind: 'create', options: { gameType: 'fast', playerCount: 4 } }, () => table.host);
    await act(async () => {
      router.push('/game');
      await online.ready;
      table.lobby(PLAYERS.map(({ id, name }) => ({ id, name })));
      await elapse(table, 50);
      table.startGame();
    });
    await pass(table, 400);
    await waitFor(() => expect(run.pathname()).toBe('/game'));
    await screen.findByTestId('game');
    expect(online.getView().players.map((p) => p.id)).toEqual(PLAYERS.map((p) => p.id));

    // Round after round: me on the screen (two cells), then each of the others at the server (one cell).
    const game = table.game!;
    const puzzle = game.state.config.puzzle;
    const order: PlayerId[] = [ME, OPP, ME, 'p3', 'p4'];
    let turn = 0;
    while (game.state.status === 'running') {
      const cell = game.state.grid.findIndex(
        (d, i) => d === 0 && !game.state.locks.some((l) => l.cell === i),
      );
      if (cell < 0) throw new Error('no free cell');
      const who = order[turn++ % order.length]!;
      const digit = answerIn(puzzle, cell);
      if (who === ME) {
        await press(`cell-${cellName(cell)}`);
        await pass(table, 100);
        await press(`key-${digit}`);
      } else {
        await act(async () => {
          expect(game.act(who, { type: 'select', cell }).rejected).toBeNull();
          expect(game.act(who, { type: 'place', cell, digit }).rejected).toBeNull();
        });
      }
      await pass(table, 150);
      if (turn > 400) throw new Error('the game does not end');
    }
    const result = game.state.result!;
    expect(result.reason).toBe('boardComplete');
    expect(result.ranking).toHaveLength(4);

    await pass(table, 3_000);
    await waitFor(() => expect(run.pathname()).toBe('/results/online-1'));
    expect(await screen.findByTestId('results-ranking')).toBeOnTheScreen();
    const [a, b, c, d] = result.ranking;
    for (const r of [a!, b!, c!])
      expect(screen.getByTestId(`results-podium-${r.place}-${r.playerId}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`results-ranking-${d!.place}-${d!.playerId}`)).toBeOnTheScreen();
    // Me as "אני", once, wherever I finished; my rating change is the engine's.
    expect(screen.getAllByLabelText(/^מקום \d: אני · /)).toHaveLength(1);
    const mine = result.ratingChanges.find((r) => r.playerId === ME)!;
    expect(screen.getByTestId('results-rating')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`מ־${Math.round(mine.before)} ל־${Math.round(mine.after)}`),
    );
    expect(screen.queryByTestId('results-opponents')).toBeNull();
    await act(async () => {
      useGameStore.getState().clear();
    });
    await run.kill();
  });
});
