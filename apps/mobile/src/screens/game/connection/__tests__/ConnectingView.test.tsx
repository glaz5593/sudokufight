import { fireEvent, render, screen } from '@testing-library/react-native';

import { color } from '../../../../theme';
import { ConnectingView } from '../ConnectingView';
import type { ConnectingStep } from '../connectionModel';
import { type Setup, setUp, styleOf, wait } from '../testing/setup';

let env: Setup;
afterEach(() => env.restore());

describe('ConnectingView (Hebrew)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it.each<[ConnectingStep, number, string]>([
    ['server', 1, 'מתחבר לשרת המשחק…'],
    ['room', 2, 'נכנס לחדר…'],
    ['sync', 3, 'מסנכרן ניקוד וטיימרים…'],
  ])('shows the %s step as step %i of 3', async (step, n, text) => {
    await render(<ConnectingView model={{ kind: 'connecting', step }} />);
    expect(screen.getByText('בכניסה למשחק')).toBeOnTheScreen();
    expect(screen.getByTestId('connecting-step')).toHaveTextContent(text);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAccessibleName(`טעינת המשחק, שלב ${n} מתוך 3`);
    expect(bar).toHaveAccessibilityValue({ min: 1, max: 3, now: n, text });
  });

  it('marks the steps done, current and to come', async () => {
    await render(<ConnectingView model={{ kind: 'connecting', step: 'room' }} />);
    expect(styleOf(screen.getByTestId('connecting-mark-server'))).toMatchObject({
      backgroundColor: color.textMuted,
    });
    expect(styleOf(screen.getByTestId('connecting-mark-room'))).toMatchObject({
      backgroundColor: color.accent,
    });
    expect(styleOf(screen.getByTestId('connecting-mark-sync'))).toMatchObject({
      backgroundColor: color.border,
    });
  });

  it('announces each step', async () => {
    const { rerender } = await render(<ConnectingView model={{ kind: 'connecting', step: 'server' }} />);
    await rerender(<ConnectingView model={{ kind: 'connecting', step: 'room' }} />);
    expect(env.announced()).toEqual(['מתחבר לשרת המשחק…', 'נכנס לחדר…']);
  });

  it('cancels when it can', async () => {
    const { unmount } = await render(<ConnectingView model={{ kind: 'connecting', step: 'server' }} />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    await unmount();
    const onCancel = jest.fn();
    await render(<ConnectingView model={{ kind: 'connecting', step: 'server' }} onCancel={onCancel} />);
    await fireEvent.press(screen.getByRole('button', { name: 'ביטול' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ticks the new step in, without a scale under reduced motion', async () => {
    env.restore();
    env = await setUp('he', 'on');
    const { rerender } = await render(<ConnectingView model={{ kind: 'connecting', step: 'server' }} />);
    await rerender(<ConnectingView model={{ kind: 'connecting', step: 'sync' }} />);
    await wait(20);
    expect(screen.getByTestId('connecting-step')).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  });
});

describe('ConnectingView (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it in English', async () => {
    await render(<ConnectingView model={{ kind: 'connecting', step: 'sync' }} onCancel={jest.fn()} />);
    expect(screen.getByText('Entering the game')).toBeOnTheScreen();
    expect(screen.getByTestId('connecting-step')).toHaveTextContent('Syncing scores and timers…');
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Loading the game, step 3 of 3');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
  });
});
