import 'react-native-reanimated';

import {
  type AppLevel,
  attemptLevel,
  boxOf,
  cellName,
  drawBotPlan,
  findBotRng,
  type LevelSpecOf,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { gameEndConfig } from '../../../config/gameEnd';
import { LEVEL_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import {
  type AppStateSource,
  type LevelSession,
  type LevelSessionDeps,
  startLevel,
} from '../../../levels/levelSession';
import { levelById } from '../../../levels/levelsData';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { levelEndDelayMs } from '../levelChrome';
import { ANSWER_HOLD_MS, TapLevelScreen } from '../TapLevelScreen';

/**
 * The tap stages' screen (dev-plan §2ח, §3.1; Lv-Find, Lv-Race): no keypad; find's big digit and "הקש איפה ה־7
 * חייב להיות" under the board; the race's task line; a wrong tap's red X and "‎+5 ש׳"; a right one's digit falling
 * into its cell (in place under Reduced Motion) and the result after the hold, in the route; the X and Android
 * back asking "לצאת מהשלב?" and quitting; the race's 3 s freeze; the bot's "מחפש…" and 😂; and [D65] the freeze
 * while the app is away, its 3-2-1 over the covered board, the same time left after it.
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

const hidden = { includeHiddenElements: true };
const L001 = levelById('L001') as LevelSpecOf<'find'>; // the 7 in box 8
const L012 = levelById('L012') as LevelSpecOf<'findDuel'>; // the race against Pip

function fakeAppState() {
  let listener: ((state: string) => void) | null = null;
  const source: AppStateSource = {
    addEventListener: (_type, l) => {
      listener = l;
      return { remove: () => (listener = null) };
    },
  };
  return { source, set: (state: string) => act(async () => listener?.(state)) };
}

interface Shown {
  session: LevelSession;
  scheduler: ManualScheduler;
  app: ReturnType<typeof fakeAppState>;
  onOver: jest.Mock;
  onLeave: jest.Mock;
}

let shown: Shown | null = null;
let backs: jest.SpyInstance;

async function show(level: AppLevel, over: Partial<LevelSessionDeps> = {}): Promise<Shown> {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const app = fakeAppState();
  const session = await startLevel(
    level,
    {},
    {
      clock,
      scheduler,
      appState: app.source,
      finish: async () => null,
      track: jest.fn(),
      attemptOf: async () => 1,
      bestStarsOf: () => 0,
      ...over,
    },
  );
  const onOver = jest.fn();
  const onLeave = jest.fn();
  await render(<TapLevelScreen session={session} onOver={onOver} onLeave={onLeave} />);
  shown = { session, scheduler, app, onOver, onLeave };
  return shown;
}

/** The stage's clock and the phone's timers move on together. */
async function wait(s: Shown, ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      s.scheduler.advance(Math.min(step, ms - t));
      jest.advanceTimersByTime(Math.min(step, ms - t));
    });
  }
}

const tap = (index: number) => fireEvent.press(screen.getByTestId(`cell-${cellName(index)}`));
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID, hidden));

/** An empty cell of a box that is not the target. */
function wrongIn(level: AppLevel, box: number, accept: readonly number[]): number {
  for (let i = 0; i < 81; i++)
    if (boxOf(i) === box && level.board.grid[i] === '0' && !accept.includes(i)) return i;
  throw new Error('no wrong cell');
}

async function pressBack() {
  const handlers = backs.mock.calls
    .filter(([event]) => event === 'hardwareBackPress')
    .map(([, handler]) => handler as () => boolean | null | undefined)
    .reverse();
  await act(async () => {
    for (const handler of handlers) if (handler()) return;
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  backs = jest.spyOn(BackHandler, 'addEventListener');
});
afterEach(() => {
  shown?.session.close();
  shown = null;
  backs.mockRestore();
  jest.useRealTimers();
});

describe('find (kind 1)', () => {
  const target = L001.targets.target;
  const answer = target.accept[0]!;
  const wrong = wrongIn(L001, 7, target.accept);

  it('no keypad; under the board the big digit and "הקש איפה ה־7 חייב להיות"', async () => {
    await show(L001);
    expect(screen.queryByTestId('key-1')).toBeNull();
    expect(screen.queryByTestId('keypad')).toBeNull();
    expect(screen.getByTestId('find-digit', hidden)).toHaveTextContent('7');
    expect(screen.getByTestId('find-tap', hidden)).toHaveTextContent('הקש איפה ה־7 חייב להיות');
    expect(screen.getByTestId('stage-title')).toHaveTextContent('שלב 1');
    // The area is framed, the rest of the board dimmed, every 7 a chip; the board reads LTR.
    expect(screen.getByTestId('region-frame-focus', hidden)).toBeTruthy();
    expect(screen.getByTestId(`cell-${cellName(answer)}`)).toHaveProp(
      'accessibilityHint',
      'הקשה על המשבצת היא המהלך',
    );
    expect(screen.getAllByTestId('cell-target', hidden).length).toBeGreaterThan(0);
  });

  it('a wrong tap: the red X and "⁦+5⁩ ש׳"', async () => {
    const s = await show(L001);
    await tap(wrong);
    expect(screen.getByTestId('cell-flash-miss-cross', hidden)).toBeTruthy();
    expect(screen.getByTestId('penalty-chip', hidden)).toHaveTextContent('⁦+5⁩ ש׳');
    expect(s.session.levelView()!.penaltyMs).toBe(5000);
  });

  it('a right tap: the digit falls into the cell, and the result comes after the hold, in the route', async () => {
    const s = await show(L001);
    await wait(s, 2000);
    await tap(answer);
    expect(screen.getByTestId('digit-drop', hidden)).toBeTruthy();
    expect(s.session.over).toMatchObject({ reason: 'targetReached' });
    await wait(s, levelEndDelayMs('boardComplete', false) - 100);
    expect(s.onOver).not.toHaveBeenCalled();
    await wait(s, 200);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });

  it('a right tap under Reduced Motion: the digit appears in place, nothing falls', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const s = await show(L001);
    await tap(answer);
    expect(screen.queryByTestId('digit-drop', hidden)).toBeNull();
    expect(screen.getByTestId(`cell-${cellName(answer)}`)).toHaveTextContent('7');
    await wait(s, levelEndDelayMs('boardComplete', true) + 50);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });

  it('time runs out: the answer shows, held a moment before the result', async () => {
    const s = await show(L001);
    await wait(s, L001.timeLimitMs - 500, 500);
    expect(s.session.over).toBeNull();
    await wait(s, 500);
    expect(s.session.over).toMatchObject({ reason: 'timeUp' });
    expect(screen.getByTestId('answer-frame-gold', hidden)).toBeTruthy();
    await wait(s, ANSWER_HOLD_MS - 200);
    expect(s.onOver).not.toHaveBeenCalled();
    await wait(s, 300);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });

  it('the X: "לצאת מהשלב?", and "יציאה" quits, the result once the dialog is gone', async () => {
    const s = await show(L001);
    await fireEvent.press(screen.getByTestId('stage-exit'));
    await wait(s, motion.duration.sheetIn + 50);
    expect(screen.getByText('לצאת מהשלב?')).toBeOnTheScreen();
    expect(screen.getByText('תקבל 0 כוכבים, והשלב הבא ייפתח.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('level-exit-confirm'));
    expect(s.session.over).toMatchObject({ reason: 'quit', stars: 0 });
    await wait(s, motion.duration.sheetOut + 300);
    expect(s.onOver).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('לצאת מהשלב?')).toBeNull();
  });

  it('the result does not come (levels.db stuck): a way on after the watchdog; "לבית" and back leave the stage', async () => {
    const s = await show(L001);
    await tap(answer);
    await wait(s, levelEndDelayMs('boardComplete', false) + 100);
    expect(s.onOver).toHaveBeenCalledTimes(1);
    await wait(s, gameEndConfig.resultsWatchdogMs - 200);
    expect(screen.queryByTestId('results-fallback')).toBeNull();
    await wait(s, 200);
    expect(screen.getByTestId('results-fallback')).toBeOnTheScreen();
    // "לתוצאות" asks for the result again (and watches it again).
    await fireEvent.press(screen.getByTestId('results-fallback-results'));
    expect(s.onOver).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('results-fallback')).toBeNull();
    await wait(s, gameEndConfig.resultsWatchdogMs);
    await fireEvent.press(screen.getByTestId('results-fallback-home'));
    expect(s.onLeave).toHaveBeenCalledTimes(1);
    await pressBack();
    expect(s.onLeave).toHaveBeenCalledTimes(2);
  });

  it('Android back asks the same, and "המשך לשחק" keeps the stage going', async () => {
    const s = await show(L001);
    await pressBack();
    await wait(s, motion.duration.sheetIn + 50);
    expect(screen.getByText('לצאת מהשלב?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('level-exit-cancel'));
    await wait(s, motion.duration.sheetOut + 100);
    expect(s.session.over).toBeNull();
    await pressBack();
    await wait(s, motion.duration.sheetIn + 50);
    await fireEvent.press(screen.getByTestId('level-exit-confirm'));
    expect(s.session.over).toMatchObject({ reason: 'quit' });
  });
});

describe('the race (kind 2)', () => {
  const spots = L012.targets.spots;
  const wrong = wrongIn(L012, 0, spots[0]!.accept);

  it('the task line names the spot, its digit and its box: "מקום 4 מתוך 5 · מצא את ה־5 בריבוע 9"', async () => {
    const s = await show(L012);
    expect(screen.getByTestId('race-task')).toHaveTextContent('מקום 1 מתוך 5 · מצא את ה־6 בריבוע 1');
    for (const spot of spots.slice(0, 3)) {
      await wait(s, 100);
      await tap(spot.accept[0]!);
    }
    expect(screen.getByTestId('race-task')).toHaveTextContent('מקום 4 מתוך 5 · מצא את ה־5 בריבוע 9');
    expect(screen.getByTestId('race-me-spots')).toHaveTextContent('3');
    expect(screen.getByTestId('race-left')).toHaveTextContent('עוד 30 ש׳');
    expect(screen.queryByTestId('key-1')).toBeNull();
  });

  it('a wrong tap freezes my taps for 3 s: the right cell is refused meanwhile', async () => {
    const s = await show(L012);
    await tap(wrong);
    expect(screen.getByTestId('board-freeze')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'מוקפא, 3 שניות');
    await wait(s, 1000);
    await tap(spots[0]!.accept[0]!);
    expect(s.session.getView().level!.find!.spots[0]).toEqual({ state: 'open' });
    await wait(s, 2100);
    expect(screen.queryByTestId('board-freeze')).toBeNull();
    await tap(spots[0]!.accept[0]!);
    expect(s.session.getView().level!.find!.spots[0]).toMatchObject({ state: 'won', playerId: 'me' });
  });

  it('the bot’s card says "מחפש…", and 😂 after my wrong tap when its plan says so', async () => {
    // An attempt whose bot reacts on the first spot (its plan is drawn from the stage and the attempt).
    const attempt = Array.from({ length: 200 }, (_, k) => k + 1).find((a) => {
      const played = attemptLevel(L012, a);
      return drawBotPlan(played, findBotRng(played, a))[0]!.react;
    })!;
    expect(attempt).toBeDefined();
    const s = await show(L012, { attemptOf: async () => attempt });
    expect(screen.getByTestId('race-bot-searching')).toHaveTextContent('מחפש…');
    const first = (s.session.played as LevelSpecOf<'findDuel'>).targets.spots[0]!;
    const box = first.scope.kind === 'box' ? first.scope.index : 0;
    await tap(wrongIn(s.session.played, box, first.accept));
    expect(screen.queryByTestId('race-bot-reaction')).toBeNull();
    await wait(s, 1100);
    expect(screen.getByTestId('race-bot-reaction')).toHaveTextContent('😂');
  });

  it('my card in P1 with ●, the bot’s in P2 with ▲', async () => {
    await show(L012);
    expect(screen.getAllByTestId('glyph-circle', hidden).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('glyph-triangle', hidden).length).toBeGreaterThan(0);
    expect(screen.getByTestId('race-bot-who')).toHaveProp(
      'accessibilityLabel',
      'Pip, בוט רמה 1, טירון, 0 מקומות',
    );
  });

  it('no reactions button (D62); LEVEL_UI.reactions brings it back', async () => {
    await show(L012);
    expect(LEVEL_UI.reactions).toBe(false);
    expect(screen.queryByTestId('race-reactions')).toBeNull();
    expect(screen.queryByTestId('reaction-picker')).toBeNull();
    shown!.session.close();
    await screen.unmount();

    LEVEL_UI.reactions = true;
    try {
      const s = await show(L012);
      await fireEvent.press(screen.getByTestId('race-reactions'));
      await wait(s, 400);
      await press('reaction-picker-0');
      // The tap engine took it (with the switch on it lists the reactions): its cooldown started.
      expect(s.session.getView().reactionReadyAt).toBeGreaterThan(0);
    } finally {
      LEVEL_UI.reactions = false;
    }
  });
});

describe('[D65] the app away mid-stage', () => {
  it('freezes once; back, "3, 2, 1" over the covered board, then the stage goes on with the same time left', async () => {
    const s = await show(L001);
    const pause = jest.spyOn(s.session.host, 'pause');
    const resume = jest.spyOn(s.session.host, 'resume');
    await wait(s, 3000);
    const before = screen.getByTestId('find-elapsed', hidden).props.children;
    await s.app.set('background');
    await s.app.set('inactive');
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('resume-countdown')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'המשחק עצור');
    // The board is covered: hidden from screen readers too.
    expect(screen.getByTestId('tap-level-content', hidden)).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    await wait(s, 60_000, 1000);
    await s.app.set('active');
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
    await wait(s, 1000);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('2');
    await wait(s, 1000);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('1');
    expect(resume).not.toHaveBeenCalled();
    await wait(s, LEVEL_UI.resumeCountdownMs - 2000);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('resume-countdown')).toBeNull();
    expect(screen.getByTestId('find-elapsed', hidden).props.children).toBe(before);
    expect(s.session.levelView()!.elapsedMs).toBe(3000);
  });

  it('Reduced Motion: the number just changes (nothing animated)', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const s = await show(L001);
    await s.app.set('background');
    await s.app.set('active');
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
    expect(screen.queryByTestId('resume-countdown-number-animated')).toBeNull();
    await wait(s, 1000);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('2');
  });

  it('LEVEL_UI.backgroundPause off: no freeze, no cover', async () => {
    const s = await show(L001, { settings: { ...LEVEL_UI, backgroundPause: false } });
    const pause = jest.spyOn(s.session.host, 'pause');
    await s.app.set('background');
    expect(pause).not.toHaveBeenCalled();
    expect(screen.queryByTestId('resume-countdown')).toBeNull();
    expect(s.session.getView().status).toBe('running');
  });
});
