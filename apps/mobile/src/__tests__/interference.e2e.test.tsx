// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import {
  type CellIndex,
  cellName,
  type Digit,
  type GameEvent,
  type InterferenceKind,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { DeviceEventEmitter, Dimensions, StyleSheet, View } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
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
import { scoreText, signedText } from '../components/player';
import { useGameStore } from '../game/gameStore';
import { type OfflinePuzzle, puzzleById } from '../game/offlinePool';
import type { PracticeDeps, PracticeSession } from '../game/session';
import { freeCellFor } from '../game/testing/botPractice';
import { answerIn } from '../game/testing/practice';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { dropZoneOf, isolate } from '../screens/game/arsenal';
import type { Point, Rect } from '../screens/game/geometry';
import { isolateName } from '../screens/game/hit';
import { reactionCue } from '../screens/game/model';
import { track } from '../services/analytics';
import { cue } from '../services/feedback';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';

/**
 * Work plan stage 6, end to end: interferences and reactions in a practice against the engine's bot, through the
 * app's real routes (the root layout included), on a real SQLite practice database (sql.js in place of
 * expo-sqlite), with the game and the bot on a manual clock. The bot is Overlord (level 5): it interferes
 * whenever it can pay and laughs at my mistakes (spec §9), so the test can wait for it.
 *
 * - ⚡ on Overlord's card opens the arsenal; a token goes only by dragging it onto that card (spec §7.3, D18):
 *   a tap or a screen reader's activate explains, a drop anywhere else cancels, a drop on the card launches.
 *   The engine takes it: Overlord's card shows the hit and its stopped lock, and my score pays the cost.
 * - Overlord hits me: the effect covers the whole screen [D35] with its banner until the view's deadline, and
 *   is gone exactly then; with reduced motion it is a static cover for the same 5 s (spec §22).
 * - My reaction rises from my card; once I mute Overlord, its reactions are not shown (spec §8, D19).
 *
 * Jest has no layout: the one view the arsenal measures in the window (the view around Overlord's card) says
 * where the card is, as a 390-wide phone in Hebrew would. The finger's events are the gesture handler's own.
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

// ---- where things are in the window (Jest has no layout) ----

/** Overlord's card as Dir-C-Game places it in Hebrew: at the left, under the status bar. */
const CARD: Rect = { x: 16, y: 56, width: 159, height: 160 };
const ZONE = dropZoneOf(CARD);
const INSIDE: Point = { x: ZONE.x + ZONE.width / 2, y: ZONE.y + ZONE.height / 2 };
/** Over the board, far from the card. */
const OUTSIDE: Point = { x: 300, y: 520 };
/** Where the finger first touches a token, low in the tray. */
const TOKEN_AT: Point = { x: 195, y: 1150 };

type MeasureInWindow = (done: (x: number, y: number, width: number, height: number) => void) => void;

beforeAll(async () => {
  mockApp.db = await memoryDb();
  // Stage 8: the app opens on Home for a signed-in player with a profile only (registration is required,
  // D24 not approved): this phone's player registered earlier (development sign-in, in-memory server).
  await installSignedInPlayer();
  // The view around the opponent's card (DuelHud) answers where it is; the rest of Jest's views stay silent.
  const views = (View as unknown as { prototype: { measureInWindow: MeasureInWindow } }).prototype;
  jest.spyOn(views, 'measureInWindow').mockImplementation(function (
    this: { props?: { testID?: string } },
    done,
  ) {
    if (this.props?.testID === 'duel-hud-theirs') done(CARD.x, CARD.y, CARD.width, CARD.height);
  });
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

/** Only the phone's timers move (animations, the live region): no game time passes. */
const step = (ms = 16) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/** The phone's timers in frames, so what each step starts (an exit, a count) gets to run too. */
async function frames(ms: number, frame = 100) {
  for (let t = 0; t < ms; t += frame) await step(frame);
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

// ---- the finger on a token (the events the gesture handler's native side sends) ----

function finger(kind: InterferenceKind) {
  const { handlerTag } = getByGestureTestId(`arsenal-drag-${kind}`);
  let state: State = State.UNDETERMINED;
  const at = (p: Point) => ({
    handlerTag,
    numberOfPointers: 1,
    x: 54,
    y: 68,
    absoluteX: p.x,
    absoluteY: p.y,
    translationX: p.x - TOKEN_AT.x,
    translationY: p.y - TOKEN_AT.y,
    velocityX: 0,
    velocityY: 0,
  });
  const become = (next: State, p: Point) => {
    DeviceEventEmitter.emit('onGestureHandlerStateChange', { ...at(p), state: next, oldState: state });
    state = next;
  };
  return {
    down: async () => {
      await act(async () => {
        become(State.BEGAN, TOKEN_AT);
        become(State.ACTIVE, { x: TOKEN_AT.x, y: TOKEN_AT.y - 12 });
      });
      await step();
    },
    move: async (p: Point) => {
      await act(async () => {
        DeviceEventEmitter.emit('onGestureHandlerEvent', { ...at(p), state: State.ACTIVE });
      });
      await step();
    },
    up: async (p: Point) => {
      await act(async () => become(State.END, p));
      await step();
    },
  };
}

/** A token dragged from its slot to `to`, and let go there. */
async function dragTo(kind: InterferenceKind, to: Point) {
  const f = finger(kind);
  await f.down();
  await f.move({ x: (TOKEN_AT.x + to.x) / 2, y: (TOKEN_AT.y + to.y) / 2 });
  await f.move(to);
  await f.up(to);
}

/** A plain tap on a token. */
async function tap(kind: InterferenceKind) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(`arsenal-tap-${kind}`), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);
  });
  await step();
}

const KIND_HE: Record<InterferenceKind, string> = { fireworks: 'זיקוקים', cats: 'חתולים', warp: 'עיוות' };
const HIT_CUE: Record<InterferenceKind, string> = {
  fireworks: 'hitFireworks',
  cats: 'hitCats',
  warp: 'hitWarp',
};

// ---------------------------------------------------------------------------------------------------------

describe('interferences against a bot, end to end (work plan stage 6)', () => {
  it('⚡ opens the arsenal on Overlord’s card; only a drag onto that card launches; Overlord shows the hit, I pay', async () => {
    const run = await launch(START);
    const { session, puzzle } = await playOverlord(run);
    const sent = () => eventsOf(session, 'interference').filter((e) => e.fromId === ME);
    const myScore = () => playerOf(session, ME).score;

    // No points yet: ⚡ says what is missing (D10) and opens nothing.
    expect(screen.getByRole('button', { name: `הפרעה ל־${BOT_NAME} · חסרות 2 נק׳` })).toBeOnTheScreen();
    await press('interfere');
    expect(screen.queryByTestId('arsenal-sheet')).toBeNull();
    expect(screen.getByText('אין מספיק נקודות להפרעה הבאה (2 נק׳)')).toBeOnTheScreen();
    await frames(4_500); // the error toast holds 4 s, then leaves
    expect(screen.queryByText('אין מספיק נקודות להפרעה הבאה (2 נק׳)')).toBeNull();

    // I earn my points; then Overlord is on a cell (its lock timer is what a hit stops, D11).
    await play(session, puzzle, true);
    await until(run, () => myScore() >= 2);
    await until(
      run,
      () => playerOf(session, BOT).lock?.expiresAt != null && playerOf(session, BOT).hitBy === null,
    );
    const before = myScore();

    await press('interfere');
    await step(400);
    expect(screen.getByTestId('arsenal-sheet')).toBeOnTheScreen();
    expect(screen.getByText(`גרור אל הכרטיס של ${isolate(BOT_NAME)} כדי לשגר`)).toBeOnTheScreen();
    // The card it was opened from is the one drop zone (behind the modal tray).
    expect(
      within(screen.getByTestId('duel-hud-theirs', hidden)).getByTestId('drop-zone', hidden),
    ).toBeTruthy();

    // There is no way to launch by tapping (D18): a tap explains, and so does a screen reader's activate.
    await tap('fireworks');
    expect(screen.getByTestId('arsenal-bubble-fireworks')).toHaveTextContent(
      `גרור אל ${isolate(BOT_NAME)} — הקשה לא משגרת`,
    );
    await fireEvent(screen.getByTestId('arsenal-token-cats'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(screen.getByTestId('arsenal-bubble-cats')).toBeOnTheScreen();
    expect(sent()).toEqual([]);

    // Dropped anywhere else (here, over the board): nothing goes, nothing is paid, the tray stays.
    await dragTo('warp', OUTSIDE);
    await step(1000);
    expect(sent()).toEqual([]);
    expect(myScore()).toBe(before);
    expect(screen.getByTestId('arsenal-sheet')).toBeOnTheScreen();

    // Dropped on Overlord's card: the engine takes it, and I pay the cost from my score.
    await dragTo('fireworks', INSIDE);
    expect(sent()).toEqual([
      expect.objectContaining({ fromId: ME, targetId: BOT, kind: 'fireworks', cost: 2 }),
    ]);
    expect(myScore()).toBe(before - 2);
    expect(playerOf(session, BOT).hitBy).toMatchObject({ fromId: ME, kind: 'fireworks' });
    await step(1000);
    expect(screen.queryByTestId('arsenal-sheet')).toBeNull();

    // What I see (spec §7.4): "זיקוקים ← Overlord", and the 2 points leaving my score.
    expect(screen.getByText(`זיקוקים ← ${isolate(BOT_NAME)}`)).toBeOnTheScreen();
    expect(screen.getByTestId('card-me-delta', hidden)).toHaveTextContent(signedText(-2));
    expect(screen.getByTestId('card-me-score', hidden)).toHaveTextContent(scoreText(before - 2));
    expect(track).toHaveBeenCalledWith('interference_sent', { kind: 'fireworks', cost: 2 });
    expect(cues()).toEqual(expect.arrayContaining(['arsenalOpen', 'tokenLift', 'dropZoneEnter', 'launch']));

    // Overlord's card: the hit tag with its seconds, its lock stopped; ⚡ waits until it can take another.
    const theirs = within(screen.getByTestId('card-opponent'));
    expect(theirs.getByTestId('hit-chip', hidden)).toHaveTextContent('5');
    expect(screen.getByTestId('card-opponent-summary')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/מושהה .*תחת הפרעה, 5 שניות/),
    );
    expect(playerOf(session, BOT).lock?.expiresAt).toBeNull();
    expect(
      screen.getByRole('button', { name: `הפרעה ל־${BOT_NAME} לא זמינה, כבר תחת הפרעה` }),
    ).toBeDisabled();
    // The effect itself is Overlord's, not on my screen.
    expect(playerOf(session, ME).hitBy).toBeNull();
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();

    // Its 5 s pass: the tag goes, and the card no longer says it.
    const endsAt = sent()[0]!.endsAt;
    await pause(run, endsAt - run.clock.now());
    expect(theirs.queryByTestId('hit-chip', hidden)).toBeNull();
    expect(screen.getByTestId('card-opponent-summary')).not.toHaveProp(
      'accessibilityLabel',
      expect.stringContaining('תחת הפרעה'),
    );
  });

  it('Overlord hits me: the effect covers the whole screen [D35] with its banner, play goes on, and it is gone exactly at its end', async () => {
    const run = await launch(START + HOUR);
    const { session, puzzle } = await playOverlord(run);
    const hits = () => eventsOf(session, 'interference').filter((e) => e.targetId === ME);

    // Overlord is aggressive (spec §9): as soon as its points pay for one, it sends it.
    await until(run, () => hits().length > 0);
    const hit = hits()[0]!;
    const { kind, endsAt } = hit;
    expect(playerOf(session, ME).hitBy).toMatchObject({ fromId: BOT, kind, expiresAt: endsAt });

    // The whole screen, as the original spec says ("על המסך"), until the proposal [D35] is approved.
    const { width, height } = Dimensions.get('window');
    const region = screen.getByTestId('hit-layer-region', hidden);
    expect(StyleSheet.flatten(region.props.style)).toMatchObject({ left: 0, top: 0, width, height });
    expect(within(region).getByTestId(`hit-${kind}`, hidden)).toBeOnTheScreen();
    expect(within(region).queryByTestId(`hit-${kind}-still`, hidden)).toBeNull();
    // The banner: who sent what, what it cost them, and the seconds left; a screen reader hears it too.
    const banner = screen.getByTestId('hit-layer-banner', hidden);
    expect(banner).toHaveProp(
      'accessibilityLabel',
      `${isolateName(BOT_NAME)} שלח/ה לך ${KIND_HE[kind]}! זה עלה ${hit.cost} נק׳ · המשחק ממשיך, נותרו 5 שניות`,
    );
    await step(1600);
    expect(screen.getByTestId('game-live')).toHaveTextContent(
      `${isolateName(BOT_NAME)} שלח/ה לך ${KIND_HE[kind]}! נותרו 5 שניות, הטיימר שלך עצור`,
      { exact: false },
    );
    // Its cue once (the game screen does not play it again).
    expect(cues().filter((c) => c === HIT_CUE[kind])).toHaveLength(1);

    // The game goes on under it (spec §7.2): I take a cell, and its timer stands still while the hit lasts.
    const cell = await play(session, puzzle, true);
    expect(screen.getByTestId(`cell-${cellName(cell)}`)).toHaveProp(
      'accessibilityLabel',
      `${cellName(cell)}, ${answerIn(puzzle, cell)}, נפתרה על ידיך`,
    );
    const next = freeCellFor(session.getView(), run.clock.now())!;
    await press(`cell-${cellName(next)}`);
    expect(screen.getByLabelText(`המשבצת שלך ${cellName(next)}, הטיימר עצור`)).toBeOnTheScreen();

    // Still there a moment before its end; gone exactly at it, and said.
    await pause(run, endsAt - 1 - run.clock.now());
    expect(screen.getByTestId('hit-layer-region', hidden)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('hit-layer-region', hidden)).getByTestId(`hit-${kind}`, hidden),
    ).toBeTruthy();
    await pause(run, 1);
    expect(playerOf(session, ME).hitBy).toBeNull();
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
    expect(screen.queryByTestId('hit-layer-banner', hidden)).toBeNull();
    await step(1600);
    expect(screen.getByTestId('game-live')).toHaveTextContent('ההפרעה נגמרה, הטיימר שלך ממשיך', {
      exact: false,
    });
  });

  it('with reduced motion an interference on me is a static cover of the same area for the same 5 s (spec §22)', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const run = await launch(START + 2 * HOUR);
    const { session } = await playOverlord(run);
    const hits = () => eventsOf(session, 'interference').filter((e) => e.targetId === ME);

    await until(run, () => hits().length > 0);
    const { kind, endsAt } = hits()[0]!;
    const { width, height } = Dimensions.get('window');
    const region = () => screen.getByTestId('hit-layer-region', hidden);
    expect(StyleSheet.flatten(region().props.style)).toMatchObject({ left: 0, top: 0, width, height });
    expect(within(region()).getByTestId(`hit-${kind}-still`, hidden)).toBeOnTheScreen();
    expect(within(region()).queryByTestId(`hit-${kind}`, hidden)).toBeNull();

    // The same cover all along, until a moment before its end; then nothing.
    await pause(run, endsAt - 1 - run.clock.now());
    expect(within(region()).getByTestId(`hit-${kind}-still`, hidden)).toBeOnTheScreen();
    await pause(run, 1);
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
    // Only the start cue: no rumble with reduced motion (motion.md §7).
    expect(cues().filter((c) => c === HIT_CUE[kind])).toHaveLength(1);
    expect(cues()).not.toContain('hitBurst');
    expect(cues()).not.toContain('hitPulse');
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
