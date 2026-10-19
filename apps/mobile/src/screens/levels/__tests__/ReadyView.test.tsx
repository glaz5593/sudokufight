import 'react-native-reanimated';

import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LEVEL_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import { levelById } from '../../../levels/levelsData';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { ReadyView } from '../ReadyView';

/**
 * "מוכן?" (components.md §19.8; D56): the kind, the goal and the star scale, no board, for LEVEL_UI.readyMs (2 s),
 * then the stage starts; a fade only (200 ms under Reduced Motion, the same 2 s). It stands still while the app
 * is in the background (D65) and goes on from where it was.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const L001 = levelById('L001')!;
const L020 = levelById('L020')!;

const show = (node: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('ReadyView', () => {
  it('waits 2000 ms (LEVEL_UI.readyMs), then the stage starts', async () => {
    expect(LEVEL_UI.readyMs).toBe(2000);
    const onDone = jest.fn();
    await show(<ReadyView level={L001} onDone={onDone} />);
    await act(async () => void jest.advanceTimersByTime(1999));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reads LEVEL_UI.readyMs: another length, another wait', async () => {
    jest.replaceProperty(LEVEL_UI, 'readyMs', 500);
    const onDone = jest.fn();
    await show(<ReadyView level={L001} onDone={onDone} />);
    await act(async () => void jest.advanceTimersByTime(499));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('says the kind, the goal and the scale, with no board', async () => {
    await show(<ReadyView level={L001} onDone={jest.fn()} />);
    expect(screen.getByTestId('level-ready-content')).toHaveProp(
      'accessibilityLabel',
      'מוכן? שלב 1, איפה ה־7?. מציאה אחת. השלב נגמר ב־20 ש׳.',
    );
    expect(screen.getByText('מוכן?')).toBeTruthy();
    expect(screen.getByTestId('level-ready-scale-3')).toHaveProp('accessibilityLabel', '3 כוכבים: עד 5 ש׳');
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('a boss says so (the crown and "בוס")', async () => {
    await show(<ReadyView level={L020} onDone={jest.fn()} />);
    expect(screen.getByTestId('boss-badge', { includeHiddenElements: true })).toHaveTextContent('בוס');
  });

  it('fades in and out only; under Reduced Motion the fades are 200 ms, and it still lasts 2 s', async () => {
    const onDone = jest.fn();
    await show(<ReadyView level={L001} onDone={onDone} />);
    const content = screen.getByTestId('level-ready-content');
    expect(content).toHaveAnimatedStyle({ opacity: 0 });
    await act(async () => void jest.advanceTimersByTime(300));
    expect(content).toHaveAnimatedStyle({ opacity: 1 });
    expect(content).not.toHaveAnimatedStyle({ transform: expect.anything() });
    await screen.unmount();

    useSettings.setState({ reduceMotion: 'on' });
    await show(<ReadyView level={L001} onDone={onDone} />);
    await act(async () => void jest.advanceTimersByTime(250));
    expect(screen.getByTestId('level-ready-content')).toHaveAnimatedStyle({ opacity: 1 });
    await act(async () => void jest.advanceTimersByTime(1749));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('paused (the app in the background): the 2 s stand still, then go on from where they were', async () => {
    const onDone = jest.fn();
    const view = await show(<ReadyView level={L001} onDone={onDone} />);
    await act(async () => void jest.advanceTimersByTime(1500));
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ReadyView level={L001} onDone={onDone} paused />
      </SafeAreaProvider>,
    );
    await act(async () => void jest.advanceTimersByTime(10_000));
    expect(onDone).not.toHaveBeenCalled();
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ReadyView level={L001} onDone={onDone} />
      </SafeAreaProvider>,
    );
    await act(async () => void jest.advanceTimersByTime(499));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('paused: the fades stand still too, so the intro is still there after the trip away, never a blank', async () => {
    const onDone = jest.fn();
    const at = (paused: boolean) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <ReadyView level={L001} onDone={onDone} paused={paused} />
      </SafeAreaProvider>
    );
    const view = await render(at(false));
    await act(async () => void jest.advanceTimersByTime(500));
    const content = () => screen.getByTestId('level-ready-content');
    expect(content()).toHaveAnimatedStyle({ opacity: 1 });
    await view.rerender(at(true));
    await act(async () => void jest.advanceTimersByTime(10_000));
    expect(content()).toHaveAnimatedStyle({ opacity: 1 });
    await view.rerender(at(false));
    await act(async () => void jest.advanceTimersByTime(100));
    expect(content()).toHaveAnimatedStyle({ opacity: 1 });
    // 1500 ms were left: full until the last fade (240 ms), then out as the stage starts.
    await act(async () => void jest.advanceTimersByTime(1500 - 100 - motion.duration.stateChange - 20));
    expect(content()).toHaveAnimatedStyle({ opacity: 1 });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(motion.duration.stateChange + 20));
    expect(content()).toHaveAnimatedStyle({ opacity: 0 });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
