// First, before anything of the app loads: the globals the phone's JS engine (Hermes) lacks are taken away.
import { onHermes } from '../testing/asOnHermes';
// Then: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { cellName, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import Storage from 'expo-sqlite/kv-store';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

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
import { installSignedInPlayer } from '../auth/testing/testAuth';
import { scoreText } from '../components/player';
import { useGameStore } from '../game/gameStore';
import { puzzleById } from '../game/offlinePool';
import type { PracticeDeps, PracticeSession } from '../game/session';
import { openPracticeStorage } from '../game/storage';
import { freeCellFor, solvedBy } from '../game/testing/botPractice';
import { answerIn } from '../game/testing/practice';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { PRACTICE_QUEUE_KEY } from '../progress/practiceQueue';
import { track } from '../services/analytics';
import { PluralRules } from '../services/pluralRules';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';

/**
 * Bug 9 (the first APK, Samsung S22): "I tapped 'yes' to end the practice against a bot and got a black screen":
 * the app went down as the practice ended. This plays that path through the app's real routes, the root layout
 * included, with the globals Hermes lacks taken away (testing/hermesGlobals.ts): Home → "שחק" → "אימון מול בוט"
 * → "מהיר" → Pip → the game (the bot plays, I play) → "סיום אימון" on my card → "כן, לסיים" → the results of a
 * 2-player game (the bot's row, its winner's face) → "משחק חדש". The game is saved in a real SQLite database
 * (sql.js), the practice XP goes to the queue, and game_end is tracked. Nothing may throw out of the taps (a throw
 * in a press handler is a fatal error in a release build), nothing is reported to Crashlytics, and nothing loads
 * the online code.
 */

type MockGameState = import('../game/gameStore').GameStoreState;
const mockApp: { db: SqlJsDb | null; session: Omit<PracticeDeps, 'repo'> } = { db: null, session: {} };

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
// The online code (what crashed "מצא יריב" before services/hermesPolyfills.ts): noted if anything loads it.
jest.mock('@colyseus/sdk', () => {
  ((globalThis as { netLoaded?: string[] }).netLoaded ??= []).push('@colyseus/sdk');
  return jest.requireActual('@colyseus/sdk');
});
jest.mock('@colyseus/schema', () => {
  ((globalThis as { netLoaded?: string[] }).netLoaded ??= []).push('@colyseus/schema');
  return jest.requireActual('@colyseus/schema');
});
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockApp.db }));
// The app's game store, made on first use, so its practices run on this test's manual clock (the phone's own
// deps otherwise: the practice database, and the XP queue at the end).
jest.mock('../game/gameStore', () => {
  const actual = jest.requireActual<typeof import('../game/gameStore')>('../game/gameStore');
  let store: ReturnType<typeof actual.createGameStore> | null = null;
  const current = () =>
    (store ??= actual.createGameStore({
      ...actual.defaultGameStoreDeps,
      session: { ...actual.defaultGameStoreDeps.session, ...mockApp.session },
    }));
  const hook = (<U,>(selector: (state: MockGameState) => U) =>
    current()(selector)) as typeof actual.useGameStore;
  return {
    ...actual,
    useGameStore: Object.assign(hook, {
      getState: () => current().getState(),
      getInitialState: () => current().getInitialState(),
      setState: ((...args: Parameters<typeof actual.useGameStore.setState>) =>
        current().setState(...args)) as typeof actual.useGameStore.setState,
      subscribe: (listener: Parameters<typeof actual.useGameStore.subscribe>[0]) =>
        current().subscribe(listener),
    }),
  };
});
type NativeMocks = typeof import('../screens/home/testing/nativeMocks');
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});
jest.mock(
  'expo-audio',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoAudio,
);
jest.mock(
  'expo-haptics',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoHaptics,
);

jest.setTimeout(120_000);

const ROUTES = {
  _layout: RootLayout,
  index: Index,
  modes: ModesRoute,
  'game-type': GameTypeRoute,
  'bot-select': BotSelectRoute,
  game: GameRoute,
  'results/[id]': ResultsRoute,
  leaderboard: LeaderboardRoute,
  history: HistoryRoute,
  achievements: AchievementsRoute,
};

const START = 1_760_000_000_000;
const THINK_MS = 1_200;
const BOT = 'bot-1';
const clock = new ManualClock(START);
const scheduler = new ManualScheduler(clock);
const saveErrors: unknown[] = [];
const { recordError } = jest
  .requireMock<{ crashReporter: () => { recordError: jest.Mock } }>('../services/crashlytics')
  .crashReporter();

/** A moment passes: the game's clock (and the bot on it) and the phone's timers move on. */
async function pause(ms = THINK_MS) {
  await act(async () => {
    scheduler.advance(ms);
    jest.advanceTimersByTime(ms);
  });
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

beforeAll(async () => {
  mockApp.db = await memoryDb();
  mockApp.session = {
    clock,
    scheduler,
    seed: 1,
    onError: (what, error) => saveErrors.push([what, error]),
  };
  await installSignedInPlayer();
});

afterAll(() => {
  jest.useRealTimers();
  onHermes.restore();
});

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'off', sound: true, haptics: true });
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null, botLevel: null });
});

it('runs without the globals Hermes lacks (the app’s own stand-ins only)', () => {
  expect(onHermes.nodeGlobalsLeft()).toEqual([]);
  // Not Node's: the app's own, which the phone always runs on (services/pluralRules.ts).
  expect(Intl.PluralRules).toBe(PluralRules);
  expect((Intl as { DisplayNames?: unknown }).DisplayNames).toBeUndefined();
  expect((globalThis as { structuredClone?: unknown }).structuredClone).toBeUndefined();
  // services/hermesPolyfills.ts, first in app/_layout.tsx.
  expect(typeof FinalizationRegistry).toBe('function');
});

it('"סיום אימון" → "כן, לסיים" against a bot: the game ends, game_end is tracked, the results show', async () => {
  const app = renderRouter(ROUTES, { initialUrl: '/' });
  await app;
  await screen.findByTestId('home-scroll');

  // Home → "שחק" → "אימון מול בוט" → "מהיר" → the bot selection → Pip → the game.
  await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
  await press('mode-bot');
  await press('type-fast');
  await fireEvent.press(screen.getByRole('button', { name: 'בחירת יריב' }));
  await fireEvent.press(screen.getByRole('radio', { name: /Pip/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'יאללה, למשחק' }));
  await waitFor(() => expect(app.getPathname()).toBe('/game'));
  await screen.findByTestId('duel-hud');
  const session: PracticeSession = useGameStore.getState().session!;
  const puzzle = puzzleById(session.puzzleId)!;
  expect(session).toMatchObject({ mode: 'bot', botLevel: 1 });

  // A bit of a game: the bot fills a cell, and so do I.
  for (let i = 0; i < 120 && solvedBy(session.events, BOT).length === 0; i++) await pause(500);
  expect(solvedBy(session.events, BOT).length).toBeGreaterThan(0);
  const cell = freeCellFor(session.getView(), clock.now())!;
  await fireEvent.press(screen.getByTestId(`cell-${cellName(cell)}`));
  await fireEvent.press(screen.getByTestId(`key-${answerIn(puzzle, cell)}`));
  await pause();
  expect(solvedBy(session.events, 'me')).toEqual([cell]);

  // "סיום אימון" on my card, then "כן, לסיים": the tap itself must not throw (a throw in a press handler is a
  // fatal error on the phone: the black screen).
  await fireEvent.press(within(screen.getByTestId('card-me')).getByTestId('surrender'));
  expect(await screen.findByTestId('end-practice-confirm')).toBeOnTheScreen();
  await expect(fireEvent.press(screen.getByTestId('end-practice-confirm'))).resolves.not.toThrow();
  // Over at once; the game stays on screen while the dialog slides away, then the results replace it.
  expect(app.getPathname()).toBe('/game');

  // The game is over (I surrendered: the bot wins), and the end is tracked.
  const result = session.getView().result!;
  expect(session.getView().status).toBe('over');
  expect(result.ranking.find((r) => r.playerId === BOT)?.place).toBe(1);
  const me = result.ranking.find((r) => r.playerId === 'me')!;
  expect(track).toHaveBeenCalledWith('game_end', {
    mode: 'bot',
    result: 'loss',
    score: me.score,
    mistakes: me.mistakes,
    durationSec: Math.round(result.durationMs / 1000),
  });

  // The results replace the game: a 2-player practice's, with the bot's row and the reason.
  await waitFor(() => expect(app.getPathname()).toBe(`/results/${session.id}`));
  expect(await screen.findByRole('header', { name: 'הפסד' })).toBeOnTheScreen();
  expect(screen.getByTestId('results-score')).toHaveTextContent(scoreText(me.score));
  expect(screen.getByTestId('results-end')).toHaveTextContent(/סיימת את האימון לפני שהלוח התמלא/);
  expect(screen.getByTestId(`results-opponent-${BOT}`)).toHaveProp(
    'accessibilityLabel',
    expect.stringMatching(/^Pip · /),
  );
  expect(screen.getByTestId('results-unrated')).toHaveTextContent('אימון: אין שינוי בדירוג');

  // The results' whole sequence plays (the sections land, the bot laughs and idles as the winner, the sound).
  for (let i = 0; i < 10; i++) await pause(1_000);
  expect(screen.getByTestId('results')).toBeOnTheScreen();
  expect(screen.queryByTestId('error-screen')).toBeNull();

  // Saved as finished [D25]; nothing went wrong on the way, and nothing was reported as a crash.
  const repo = await openPracticeStorage();
  expect(await repo.getGame(session.id)).toMatchObject({ status: 'finished', mode: 'bot', outcome: 'loss' });
  expect(saveErrors).toEqual([]);
  expect(recordError).not.toHaveBeenCalled();
  // Its XP waits in the queue for the server [D41] (no connection under Jest).
  const queued = JSON.parse((await Storage.getItem(PRACTICE_QUEUE_KEY)) ?? '[]') as {
    result: { id: string; mode: string; outcome: string };
  }[];
  expect(queued.map((q) => q.result)).toEqual([
    expect.objectContaining({ id: session.id, mode: 'bot', outcome: 'loss' }),
  ]);

  // "משחק חדש": the flow ends, and the game type of a bot practice opens again, "מהיר" chosen.
  await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
  await waitFor(() => expect(app.getPathname()).toBe('/game-type'));
  expect(app.getSearchParams()).toEqual({ gameType: 'fast', mode: 'bot' });
  expect(useGameStore.getState().session).toBeNull();
  // From the game to its end, its results and "משחק חדש", nothing loaded the online code.
  expect((globalThis as { netLoaded?: string[] }).netLoaded ?? []).toEqual([]);
});
