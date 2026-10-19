import 'react-native-reanimated';

import { type AppLevel, cellName, type Digit, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { LevelStage } from '../../../../app/levels/play';
import { gameEndConfig } from '../../../config/gameEnd';
import i18n from '../../../i18n';
import type { AppStateSource, LevelSessionDeps } from '../../../levels/levelSession';
import { levelById } from '../../../levels/levelsData';
import { useSettings } from '../../../state/settings';
import { levelEndDelayMs } from '../levelChrome';

/**
 * The route's `playing` phase (app/levels/play.tsx LevelStage) when levels.db does not answer: never a screen
 * with no way out. A digit stage's result that does not come: the game screen's watchdog fallback, whose "לבית"
 * and Android back leave the stage (onLeave, to the map). A start that does not come: the blank, then a way out.
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

const L002 = levelById('L002')!; // fill box 8 (4 missing cells)
const never = <T,>() => new Promise<T>(() => undefined);
const idleApp: AppStateSource = { addEventListener: () => ({ remove: () => undefined }) };

let backs: jest.SpyInstance;

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  backs = jest.spyOn(BackHandler, 'addEventListener');
});
afterEach(() => {
  backs.mockRestore();
  jest.useRealTimers();
});

async function show(level: AppLevel, over: Partial<LevelSessionDeps> = {}) {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const onFinished = jest.fn();
  const onLeave = jest.fn();
  const deps: LevelSessionDeps = {
    clock,
    scheduler,
    appState: idleApp,
    // levels.db that does not answer: the end is never stored, so the result never comes.
    finish: never,
    track: jest.fn(),
    attemptOf: async () => 1,
    bestStarsOf: () => 0,
    ...over,
  };
  await render(
    <LevelStage level={level} quick={false} onFinished={onFinished} onLeave={onLeave} deps={deps} />,
  );
  await act(async () => undefined);
  const wait = async (ms: number, step = 50) => {
    for (let t = 0; t < ms; t += step) {
      await act(async () => {
        scheduler.advance(Math.min(step, ms - t));
        jest.advanceTimersByTime(Math.min(step, ms - t));
      });
    }
  };
  return { onFinished, onLeave, wait };
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

describe('LevelStage: a way out when levels.db does not answer', () => {
  it('a digit stage’s result does not come: the watchdog’s "לבית" and Android back leave the stage', async () => {
    if (L002.kind !== 'fillBox') throw new Error('L002 is a fill-box');
    const s = await show(L002);
    for (const cell of L002.targets.cells) {
      await fireEvent.press(screen.getByTestId(`cell-${cellName(cell)}`));
      await fireEvent.press(screen.getByTestId(`key-${Number(L002.board.solution[cell]) as Digit}`));
      await s.wait(200);
    }
    await s.wait(levelEndDelayMs('boardComplete', false) + gameEndConfig.resultsWatchdogMs + 200);
    expect(screen.getByTestId('results-fallback')).toBeOnTheScreen();
    expect(s.onFinished).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('results-fallback-home'));
    expect(s.onLeave).toHaveBeenCalledTimes(1);
    await pressBack();
    expect(s.onLeave).toHaveBeenCalledTimes(2);
  });

  it('a start that does not come: the blank, then after the watchdog a way out to the map', async () => {
    const s = await show(L002, { attemptOf: never });
    expect(screen.getByTestId('level-stage-starting')).toBeOnTheScreen();
    await s.wait(gameEndConfig.resultsWatchdogMs - 100);
    expect(screen.getByTestId('level-stage-starting')).toBeOnTheScreen();
    await s.wait(200);
    expect(screen.queryByTestId('level-stage-starting')).toBeNull();
    await fireEvent.press(screen.getByTestId('flow-fallback-home'));
    expect(s.onLeave).toHaveBeenCalledTimes(1);
    await pressBack();
    expect(s.onLeave).toHaveBeenCalledTimes(2);
  });
});
