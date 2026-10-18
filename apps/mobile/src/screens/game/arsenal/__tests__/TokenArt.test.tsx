import type { InterferenceKind } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';

import { useSettings } from '../../../../state/settings';
import { TokenArt } from '../TokenArt';

/** [D47] The previews of the three kinds of 2026-10-17, and the still bolt of a kind this app doesn't know. */

const hidden = { includeHiddenElements: true };
const frames = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const motionOf = () => {
  const part = screen.getByTestId('token-art-motion', hidden);
  return JSON.stringify(part.props.jestAnimatedStyle?.value ?? part.props.style);
};

beforeEach(() => {
  jest.useFakeTimers();
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('TokenArt: the new kinds [D47]', () => {
  it.each(['scramble', 'ink', 'keypad'] as const)('%s loops on its own clock', async (kind) => {
    await render(<TokenArt kind={kind} size={40} />);
    expect(screen.getByTestId(`token-art-${kind}`, hidden)).toBeTruthy();
    await frames(150);
    const early = motionOf();
    await frames(500);
    expect(motionOf()).not.toEqual(early);
  });

  it.each(['scramble', 'ink', 'keypad'] as const)('%s, still: one fixed frame', async (kind) => {
    await render(<TokenArt kind={kind} size={40} still />);
    await frames(150);
    const early = motionOf();
    await frames(1200);
    expect(motionOf()).toEqual(early);
  });

  it('the scramble’s still frame is the reduced effect’s "?"', async () => {
    await render(<TokenArt kind="scramble" size={40} still />);
    expect(screen.getAllByText('?', hidden).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('8', hidden)).toBeNull();
  });

  it('the keypad’s keys keep their digits wherever they stand', async () => {
    await render(<TokenArt kind="keypad" size={40} />);
    for (const digit of ['1', '2', '3']) expect(screen.getByText(digit, hidden)).toBeTruthy();
  });

  it('a kind this app does not know: a still bolt, decorative', async () => {
    await render(<TokenArt kind={'dragons' as InterferenceKind} size={40} />);
    expect(screen.getByTestId('token-art-unknown', hidden)).toBeTruthy();
    expect(screen.queryByTestId('token-art-dragons')).toBeNull(); // hidden from screen readers
    expect(screen.getByTestId('token-art-dragons', hidden)).toBeTruthy();
  });
});
