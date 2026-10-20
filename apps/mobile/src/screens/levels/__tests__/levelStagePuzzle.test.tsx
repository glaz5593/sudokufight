// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
// The gesture handler's Jest mocks, before anything loads it (the puzzle's board drags).
import 'react-native-gesture-handler/jestSetup';

import { type AppLevel, attemptLevel, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';
import { fireEvent, renderRouter } from 'expo-router/testing-library';
import { Pressable, Text, View } from 'react-native';

import {
  ATTEMPT_READ_MS,
  LevelPlayFlow,
  type LevelPlayingProps,
  LevelStage,
  readRunAttempt,
} from '../../../../app/levels/play';
import { levelRulesNow } from '../../../config/testing';
import i18n from '../../../i18n';
import { firstLevelOf } from '../../../levels/__tests__/helpers/levelsOf';
import type { AppStateSource, LevelSessionDeps } from '../../../levels/levelSession';
import { track } from '../../../services/analytics';
import { useSettings } from '../../../state/settings';
import { useTutorials } from '../HowToPlay';
import type { ReadyViewProps } from '../ReadyView';

/**
 * The stage route and the puzzle (levels-ui.md §4.6, §2.4, §10 "levelStage.test.tsx"; UI-3): a puzzle stage
 * plays on its own screen (PuzzleLevelScreen), never the game screen or the tap screen; [D76] the attempt's
 * number is read once, before "מוכן?", and the same number reaches "מוכן?" (the attempt's board) and the
 * session; a read that fails, or that does not answer in time, is attempt 1 for both.
 */

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
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
// "מוכן?" as a stand-in that keeps what it was given (the real one is UI-2's, with its own tests).
const mockReady: ReadyViewProps[] = [];
jest.mock('../ReadyView', () => {
  const { Pressable: P } = jest.requireActual<typeof import('react-native')>('react-native');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    ReadyView: (props: ReadyViewProps) => {
      mockReady.push(props);
      return createElement(P, { testID: 'level-ready', onPress: props.onDone });
    },
  };
});

const PUZZLE = firstLevelOf('puzzle');
const BOX = firstLevelOf('fillBox');
const idleApp: AppStateSource = { addEventListener: () => ({ remove: () => undefined }) };

beforeEach(async () => {
  jest.useFakeTimers();
  mockReady.length = 0;
  jest.mocked(track).mockClear();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useTutorials.setState({ seen: { fillBox: true, puzzle: true } });
});
afterEach(() => {
  jest.useRealTimers();
});

function stageDeps(over: Partial<LevelSessionDeps> = {}): LevelSessionDeps {
  const clock = new ManualClock(1_000_000);
  return {
    clock,
    scheduler: new ManualScheduler(clock),
    appState: idleApp,
    finish: async () => null,
    track: jest.fn(),
    bestStarsOf: () => 0,
    ...over,
  };
}

describe('LevelStage: the puzzle’s own screen', () => {
  it('a puzzle stage plays on PuzzleLevelScreen, not the game screen, not the tap screen', async () => {
    await render(
      <LevelStage
        level={PUZZLE}
        quick={false}
        onFinished={jest.fn()}
        onLeave={jest.fn()}
        deps={stageDeps({ attemptOf: async () => 1 })}
      />,
    );
    await act(async () => undefined);
    expect(screen.getByTestId('puzzle-level')).toBeOnTheScreen();
    expect(screen.getByTestId('puzzle-board')).toBeOnTheScreen();
    expect(screen.queryByTestId('level-game')).toBeNull();
    expect(screen.queryByTestId('tap-level')).toBeNull();
  });

  it('[D76] the session plays the attempt the run read before "מוכן?"', async () => {
    const tracked = jest.fn();
    await render(
      <LevelStage
        level={PUZZLE}
        quick={false}
        attempt={Promise.resolve(3)}
        onFinished={jest.fn()}
        onLeave={jest.fn()}
        deps={stageDeps({ track: tracked })}
      />,
    );
    await act(async () => undefined);
    expect(tracked).toHaveBeenCalledWith('level_start', expect.objectContaining({ attempt: 3 }));
  });
});

describe('readRunAttempt: the attempt, read once for the run', () => {
  it('a valid answer as it is; a bad value, an error or a throw: attempt 1', async () => {
    await expect(readRunAttempt('L001', async () => 4)).resolves.toBe(4);
    await expect(readRunAttempt('L001', async () => 0)).resolves.toBe(1);
    await expect(readRunAttempt('L001', async () => 2.5)).resolves.toBe(1);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(readRunAttempt('L001', () => Promise.reject(new Error('db')))).resolves.toBe(1);
    await expect(
      readRunAttempt('L001', () => {
        throw new Error('db');
      }),
    ).resolves.toBe(1);
    warn.mockRestore();
  });

  it('no answer within ATTEMPT_READ_MS: attempt 1 (a late answer changes nothing)', async () => {
    let answer: (n: number) => void = () => undefined;
    const read = readRunAttempt('L001', () => new Promise<number>((resolve) => (answer = resolve)));
    let got: number | null = null;
    void read.then((n) => (got = n));
    await act(async () => void jest.advanceTimersByTime(ATTEMPT_READ_MS - 1));
    expect(got).toBeNull();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(got).toBe(1);
    answer(5);
    await expect(read).resolves.toBe(1);
  });
});

describe('[D76] the run reads the attempt once: "מוכן?" and the session agree', () => {
  const given: Promise<number>[] = [];
  function FakeStage({ level, attempt }: LevelPlayingProps) {
    if (attempt) given.push(attempt);
    return (
      <View testID="fake-stage">
        <Text>{level.id}</Text>
        <Pressable testID="fake-stage-x" />
      </View>
    );
  }
  beforeEach(() => {
    given.length = 0;
  });

  async function run(attemptOf: (id: string, rev: number) => Promise<number>, level: AppLevel = BOX) {
    await renderRouter(
      { 'levels/play': () => <LevelPlayFlow Playing={FakeStage} attemptOf={attemptOf} /> },
      { initialUrl: `/levels/play?id=${level.id}` },
    );
    await act(async () => undefined);
  }

  it('attempt 2: "מוכן?" gets the attempt’s board (null while it is read), the stage the same number, one read', async () => {
    const attemptOf = jest.fn(async () => 2);
    await run(attemptOf);
    expect(mockReady[0]!.played).toBeNull();
    const played = mockReady.at(-1)!.played!;
    expect(played).toEqual(attemptLevel(BOX, 2, levelRulesNow()));
    expect(played.board.solution).not.toBe(BOX.board.solution);
    await fireEvent.press(screen.getByTestId('level-ready'));
    expect(screen.getByTestId('fake-stage')).toBeOnTheScreen();
    expect(given.length).toBeGreaterThan(0);
    await expect(given.at(-1)).resolves.toBe(2);
    expect(attemptOf).toHaveBeenCalledTimes(1);
    // At the level's rev: a rebuilt level numbers its attempts from 1 again [D73, D63].
    expect(attemptOf).toHaveBeenCalledWith(BOX.id, BOX.rev);
  });

  it('a read that fails: attempt 1 for both ("מוכן?" shows the stored board)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await run(() => Promise.reject(new Error('levels.db')));
    expect(mockReady.at(-1)!.played).toBe(BOX);
    await fireEvent.press(screen.getByTestId('level-ready'));
    await expect(given.at(-1)).resolves.toBe(1);
    warn.mockRestore();
  });
});
