// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import {
  type CellIndex,
  cellName,
  type Digit,
  type GameEvent,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
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
import { installSignedInPlayer } from '../auth/testing/testAuth';
import { useGameStore } from '../game/gameStore';
import { type OfflinePuzzle, puzzleById } from '../game/offlinePool';
import type { PracticeDeps, PracticeSession } from '../game/session';
import { freeCellFor } from '../game/testing/botPractice';
import { answerIn } from '../game/testing/practice';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { reactionCue } from '../screens/game/model';
import { track } from '../services/analytics';
import { cue } from '../services/feedback';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';

/**
 * Work plan stage 6, end to end: a practice against the engine's bot, through the app's real routes (the root
 * layout included), on a real SQLite practice database (sql.js in place of expo-sqlite), with the game and the
 * bot on a manual clock. The bot is Overlord (level 5), the most aggressive one, and laughs at my mistakes
 * (spec §9), so the test can wait for it.
 *
 * - No interferences against a bot I know is a bot, either way [D44] (Moshe 2026-10-17): no "הפרעה" on
 *   Overlord's card, and Overlord never sends one, however long it can pay for it. The whole interference flow
 *   (two taps, the hit on me) is end to end in a ranked game instead: interferenceRanked.e2e.test.tsx.
 * - My reaction rises from my card; once I mute Overlord, its reactions are not shown (spec §8, D19).
 */

const mockApp: { db: SqlJsDb | null; run: number; session: Omit<PracticeDeps, 'repo'> } = {
  db: null,
  run: 0,
  session: {},
};

/** A Zustand store hook that is a new store in every app run (each test starts the app anew). */
function mockStorePerRun<S>(make: () => UseBoundStore<StoreApi<S>>): UseBoundStore<StoreApi<S>> {
  let made: { run: number; store: UseBoundStore<StoreApi<S>> } | null = null;
  const current = () => {
    if (made?.run !== mockApp.run) made = { run: mockApp.run, store: make() };
    return made.store;
  };
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
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockApp.db }));
// The game store's sessions (and their bots) run on the run's manual clock.
jest.mock('../game/gameStore', () => {
  const actual = jest.requireActual<typeof import('../game/gameStore')>('../game/gameStore');
  return {
    ...actual,
    useGameStore: mockStorePerRun(() =>
      actual.createGameStore({ ...actual.defaultGameStoreDeps, session: mockApp.session }),
    ),
  };
});
type NativeMocks = typeof import('../screens/home/testing/nativeMocks');
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
// What the player hears and feels, recorded (the sounds themselves are expo-audio's, mocked below).
jest.mock('../services/feedback', () => ({
  ...jest.requireActual<object>('../services/feedback'),
  cue: jest.fn(),
}));
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

const SEED = 6;
const HOUR = 3_600_000;
const START = 1_760_000_000_000;
const ME = 'me';
const BOT = 'bot-5';
const BOT_NAME = 'Overlord';
const hidden = { includeHiddenElements: true };

const cues = (): string[] => jest.mocked(cue).mock.calls.map((c) => String(c[0]));

beforeAll(async () => {
  mockApp.db = await memoryDb();
  // Stage 8: the app opens on Home for a signed-in player with a profile only (registration is required,
  // D24 not approved): this phone's player registered earlier (development sign-in, in-memory server).
  await installSignedInPlayer();
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null, botLevel: null });
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'off', sound: true, haptics: true });
});

afterEach(() => {
  jest.useRealTimers();
});

// ---- the app ----

interface Run {
  clock: ManualClock;
  scheduler: ManualScheduler;
  pathname(): string;
}

/** Starts the app (new stores, the same database) on Home, at `at`. */
async function launch(at: number): Promise<Run> {
  mockApp.run += 1;
  const clock = new ManualClock(at);
  const scheduler = new ManualScheduler(clock);
  mockApp.session = { clock, scheduler, seed: SEED + mockApp.run };
  const app = renderRouter(ROUTES, { initialUrl: '/' });
  await app;
  await screen.findByTestId('home-scroll');
  return { clock, scheduler, pathname: () => app.getPathname() };
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

/** Home → "שחק" → "אימון מול בוט" → "מהיר" → Overlord → the game. */
async function playOverlord(run: Run): Promise<{ session: PracticeSession; puzzle: OfflinePuzzle }> {
  await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
  await press('mode-bot');
  await press('type-fast');
  await fireEvent.press(screen.getByRole('button', { name: 'בחירת יריב' }));
  await fireEvent.press(screen.getByRole('radio', { name: new RegExp(BOT_NAME) }));
  await fireEvent.press(screen.getByRole('button', { name: 'יאללה, למשחק' }));
  await waitFor(() => expect(run.pathname()).toBe('/game'));
  await screen.findByTestId('game');
  const session = useGameStore.getState().session!;
  expect(session).toMatchObject({ mode: 'bot', botLevel: 5 });
  return { session, puzzle: puzzleById(session.puzzleId)! };
}

/** The game's clock (and the bot on it) and the phone's timers move on. */
async function pause(run: Run, ms: number) {
  await act(async () => {
    run.scheduler.advance(ms);
    jest.advanceTimersByTime(ms);
  });
}

/** Waits (in game time) until `ok` holds; fails after `maxMs`. */
async function until(run: Run, ok: () => boolean, maxMs = 60_000, every = 100) {
  const end = run.clock.now() + maxMs;
  while (!ok()) {
    if (run.clock.now() >= end) throw new Error('waited too long');
    await pause(run, every);
  }
}

const playerOf = (session: PracticeSession, id: string) =>
  session.getView().players.find((p) => p.id === id)!;
const eventsOf = <T extends GameEvent['type']>(session: PracticeSession, type: T) =>
  session.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** I take the first free cell and enter a digit: its answer, or a wrong one the keypad offers. */
async function play(session: PracticeSession, puzzle: OfflinePuzzle, right: boolean): Promise<CellIndex> {
  const cell = freeCellFor(session.getView(), session.clock.now());
  if (cell === null) throw new Error('no free cell');
  await press(`cell-${cellName(cell)}`);
  const answer = answerIn(puzzle, cell);
  const keypad = session.getView().keypad;
  const digit = right
    ? answer
    : ([1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]).find(
        (d) => d !== answer && (keypad.remaining[d - 1] ?? 0) > 0 && !keypad.disabled.includes(d),
      )!;
  await press(`key-${digit}`);
  return cell;
}

// ---------------------------------------------------------------------------------------------------------

describe('no interferences against a bot [D44]', () => {
  it('no "הפרעה" on Overlord’s card, however many points I have, and Overlord never sends one', async () => {
    const run = await launch(START);
    // The level's words on the way in no longer promise interferences (BotSelect).
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    await press('mode-bot');
    await press('type-fast');
    await fireEvent.press(screen.getByRole('button', { name: 'בחירת יריב' }));
    expect(screen.getByText('מהיר, מדויק, ובלי רחמים')).toBeOnTheScreen();
    expect(screen.queryByText(/מפריע/)).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: new RegExp(BOT_NAME) }));
    await fireEvent.press(screen.getByRole('button', { name: 'יאללה, למשחק' }));
    await waitFor(() => expect(run.pathname()).toBe('/game'));
    await screen.findByTestId('game');
    const session = useGameStore.getState().session!;
    expect(session).toMatchObject({ mode: 'bot', botLevel: 5 });
    const puzzle = puzzleById(session.puzzleId)!;

    expect(session.getView().rules.interferences).toBe(false);
    expect(session.getView().interference).toBeNull();
    expect(screen.queryByTestId('interfere')).toBeNull();

    // I earn points, and Overlord earns its own: it would have hit me by now in a game with interferences.
    await play(session, puzzle, true);
    await play(session, puzzle, true);
    await until(run, () => playerOf(session, BOT).score >= 8);
    await pause(run, 20_000);
    expect(playerOf(session, ME).score).toBeGreaterThan(0);
    expect(eventsOf(session, 'interference')).toEqual([]);
    expect(playerOf(session, ME).hitBy).toBeNull();
    expect(screen.queryByTestId('interfere')).toBeNull();
    expect(screen.queryByLabelText(/^הפרעה ל־/)).toBeNull();
    expect(screen.queryByTestId('arsenal-sheet')).toBeNull();
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
    expect(cues()).not.toContain('arsenalOpen');
    expect(cues().filter((c) => c.startsWith('hit'))).toEqual([]);
  });
});

describe('reactions against a bot, end to end (work plan stage 6)', () => {
  it('my reaction rises from my card; once I mute Overlord its reactions stop showing (spec §8, D19)', async () => {
    const run = await launch(START + 3 * HOUR);
    const { session, puzzle } = await playOverlord(run);
    const fromBot = () => eventsOf(session, 'reaction').filter((e) => e.playerId === BOT);
    const floats = () =>
      screen.queryAllByTestId(/^reaction-\d+$/, hidden).map((f) => f.props.testID as string);

    // My card's button opens the picker; a pick sends it (host.react) and it rises from my card.
    await fireEvent.press(screen.getByRole('button', { name: 'תגובות' }));
    expect(screen.getByTestId('reaction-picker')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'תגובה: צחוק' }));
    const mine = eventsOf(session, 'reaction').at(-1)!;
    expect(mine).toMatchObject({ playerId: ME, emoji: '😂' });
    expect(screen.getByTestId(`reaction-${mine.seq}`, hidden)).toHaveTextContent('😂');
    expect(track).toHaveBeenCalledWith('reaction_sent', { emoji: '😂' });
    expect(cues()).toContain('reactSend');
    // One every 2 s [D19]: the button rests.
    expect(screen.getByRole('button', { name: 'תגובות' })).toBeDisabled();

    /** My mistakes until Overlord reacts (it laughs at them, spec §9); its reaction comes 0.6–1.6 s later. */
    async function mistakesUntilItReacts() {
      const count = fromBot().length;
      for (let tries = 0; tries < 8 && fromBot().length === count; tries++) {
        await play(session, puzzle, false);
        const end = run.clock.now() + 2_500;
        while (fromBot().length === count && run.clock.now() < end) await pause(run, 100);
      }
      expect(fromBot().length).toBeGreaterThan(count);
      return fromBot().at(-1)!;
    }

    // Not muted: Overlord's reaction rises from its card, with its sound.
    const first = await mistakesUntilItReacts();
    expect(floats()).toContain(`reaction-${first.seq}`);
    expect(cues()).toContain(reactionCue(first.emoji));

    // A long press on its card opens the card's menu: "השתק תגובות".
    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    expect(screen.getByTestId('card-menu')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('card-menu-mute'));
    // The float of a muted player goes at once, even mid-air.
    expect(floats()).not.toContain(`reaction-${first.seq}`);

    // Muted: Overlord still reacts in the game, but nothing shows or sounds here.
    jest.mocked(cue).mockClear();
    const muted = await mistakesUntilItReacts();
    expect(floats()).not.toContain(`reaction-${muted.seq}`);
    expect(cues()).not.toContain(reactionCue(muted.emoji));
  });
});
