import 'react-native-reanimated';

import {
  type AppLevel,
  cellName,
  type Digit,
  DIGITS,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ResumeCountdown } from '../../../components/board/ResumeCountdown';
import i18n from '../../../i18n';
import { type AppStateSource, type LevelSession, startLevel } from '../../../levels/levelSession';
import { levelById } from '../../../levels/levelsData';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { GameScreen } from '../../game/GameScreen';
import { levelChrome, levelEndDelayMs } from '../levelChrome';
import type { LevelsT } from '../levelWording';

/**
 * The game screen with a stage's chrome (dev-plan §2ח, §3.1): kinds 3–4 play on GameScreen with their own HUD
 * (BoxHud, DuelLevelHud), the box framed and the rest of the board taking no tap, no lock strip with locks that
 * have no timer, "לצאת מהשלב?" for the end dialog, and the stage's end (onOver) in place of the results route
 * (onEnded, never called). Without the prop the screen is the game's: its own suites (soloPractice, botPractice,
 * botPracticeEnd, ranked, GameScreen*) run unchanged.
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
const L002 = levelById('L002')!; // fill box 8 (4 missing cells)
const L021 = levelById('L021')!; // the duel against Pip

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
  onEnded: jest.Mock;
}

let shown: Shown | null = null;

/** The screen as the stage's route draws it: GameScreen with the chrome, its cover from the session. */
async function show(level: AppLevel): Promise<Shown> {
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
    },
  );
  const onOver = jest.fn();
  const onEnded = jest.fn();
  const t = i18n.getFixedT(i18n.language, 'levels') as LevelsT;
  const draw = () => {
    const covered = session.pause.kind === 'none' ? null : session.pause;
    const chrome = levelChrome(session.played, t, {
      onOver,
      cover: <ResumeCountdown state={covered} />,
      covered: covered !== null,
    })!;
    return <GameScreen session={session} onEnded={onEnded} level={chrome} />;
  };
  const view = await render(draw());
  session.onPause(() => void view.rerender(draw()));
  shown = { session, scheduler, app, onOver, onEnded };
  return shown;
}

async function wait(s: Shown, ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      s.scheduler.advance(Math.min(step, ms - t));
      jest.advanceTimersByTime(Math.min(step, ms - t));
    });
  }
}

const right = (level: AppLevel, cell: number) => Number(level.board.solution[cell]) as Digit;

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  shown?.session.close();
  shown = null;
  jest.useRealTimers();
});

describe('fill the box on the game screen', () => {
  if (L002.kind !== 'fillBox') throw new Error('L002 is a fill-box');
  const { cells } = L002.targets;

  it('its HUD, no lock strip, the box framed; only its missing cells take a tap', async () => {
    const s = await show(L002);
    expect(screen.getByTestId('box-hud')).toBeTruthy();
    expect(screen.queryByTestId('lock-strip')).toBeNull();
    expect(screen.queryByTestId('card-me')).toBeNull();
    expect(screen.getByTestId('region-frame-gold', hidden)).toBeTruthy();
    // Only the box's missing cells take a tap (the rest of a fill-box board is given); one locks, no seconds.
    const interactive = s.session
      .getView()
      .grid.flatMap((d, i) => (d === 0 ? [i] : []))
      .filter((i) => !screen.getByTestId(`cell-${cellName(i)}`).props.accessibilityState?.disabled);
    expect(interactive).toEqual([...cells].sort((a, b) => a - b));
    await fireEvent.press(screen.getByTestId(`cell-${cellName(cells[0]!)}`));
    expect(s.session.getView().players[0]!.lock?.cell).toBe(cells[0]);
    expect(screen.queryByTestId('cell-pill', hidden)).toBeNull();
    expect(screen.getByTestId('keypad')).toBeTruthy();
  });

  it('filled: the stage’s end after its hold, through onOver, never the results route', async () => {
    const s = await show(L002);
    for (const cell of cells) {
      await fireEvent.press(screen.getByTestId(`cell-${cellName(cell)}`));
      await fireEvent.press(screen.getByTestId(`key-${right(L002, cell)}`));
      await wait(s, 200);
    }
    // The box filled is the board complete: the engine's either end reads 'completed'.
    expect((await s.session.result).outcome).toMatchObject({ reason: 'completed', stars: 3 });
    await wait(s, levelEndDelayMs('boardComplete', false) + 100);
    expect(s.onOver).toHaveBeenCalledTimes(1);
    expect(s.onEnded).not.toHaveBeenCalled();
  });

  it('a wrong digit: "טעות ⁦+5⁩ ש׳" in the HUD', async () => {
    const s = await show(L002);
    const cell = cells[0]!;
    await fireEvent.press(screen.getByTestId(`cell-${cellName(cell)}`));
    const wrong = DIGITS.find(
      (d) => d !== right(L002, cell) && s.session.getView().keypad.remaining[d - 1]! > 0,
    )!;
    await fireEvent.press(screen.getByTestId(`key-${wrong}`));
    expect(screen.getByTestId('box-mistakes')).toHaveTextContent('טעות ⁦+5⁩ ש׳');
  });

  it('the X: "לצאת מהשלב?"; "יציאה" ends it with 0 stars, and onOver once the dialog is gone', async () => {
    const s = await show(L002);
    await fireEvent.press(screen.getByTestId('stage-exit'));
    await wait(s, motion.duration.sheetIn + 50);
    expect(screen.getByText('לצאת מהשלב?')).toBeOnTheScreen();
    expect(screen.queryByTestId('end-practice')).toBeNull();
    await fireEvent.press(screen.getByTestId('level-exit-confirm'));
    expect(s.onOver).not.toHaveBeenCalled();
    await wait(s, motion.duration.sheetOut + 400);
    expect(s.onOver).toHaveBeenCalledTimes(1);
    expect(s.onEnded).not.toHaveBeenCalled();
    expect((await s.session.result).outcome).toMatchObject({ reason: 'quit', stars: 0 });
  });

  it('[D65] away: the board covered and frozen; back, 3-2-1, then the box goes on', async () => {
    const s = await show(L002);
    await wait(s, 2000);
    await s.app.set('background');
    expect(screen.getByTestId('resume-countdown')).toBeTruthy();
    expect(s.session.getView().status).toBe('paused');
    // Under the cover the screen is hidden from screen readers too.
    expect(screen.getByTestId('game-content', hidden)).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    await s.app.set('active');
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
    await wait(s, 3000);
    expect(screen.queryByTestId('resume-countdown')).toBeNull();
    expect(s.session.getView().status).toBe('running');
    expect(s.session.levelView()!.elapsedMs).toBe(2000);
  });
});

describe('the duel on the game screen', () => {
  it('its HUD with the race to 30 and the lead meter; the lock strip stays (the bot is an opponent)', async () => {
    await show(L021);
    expect(screen.getByTestId('duel-hud')).toBeTruthy();
    expect(screen.getByTestId('race-to-30', hidden)).toBeTruthy();
    expect(screen.getByTestId('lock-strip')).toBeTruthy();
    expect(screen.queryByTestId('lead-bar')).toBeNull();
    // No interference button (D49), no reactions (D62).
    expect(screen.queryByTestId('interfere')).toBeNull();
    expect(screen.queryByTestId('duel-reactions')).toBeNull();
  });

  it('time runs out: the stage’s end through onOver', async () => {
    const s = await show(L021);
    await wait(s, L021.timeLimitMs + levelEndDelayMs('timeUp', false) + 200, 250);
    expect(s.session.over).toMatchObject({ reason: 'timeUp' });
    expect(s.onOver).toHaveBeenCalledTimes(1);
    expect(s.onEnded).not.toHaveBeenCalled();
  });
});
