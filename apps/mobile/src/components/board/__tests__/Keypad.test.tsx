import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, size, tokens } from '../../../theme';
import { boardModel, type KeypadModel, type KeyState } from '../boardModel';
import { CancelSelection } from '../CancelSelection';
import { demoBoard, DemoGame } from '../demo';
import { Keypad } from '../Keypad';

type Styled = { props: { style?: unknown } };
const styleOf = (el: Styled) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;
/** The key's face: the animated view inside the pressable. */
const faceOf = (digit: number) => screen.getByTestId(`key-${digit}`).children[0] as unknown as Styled;

const keypad = (states: KeyState[], enabled = true): KeypadModel => ({
  enabled,
  keys: states.map((state, k) => ({
    digit: (k + 1) as KeypadModel['keys'][number]['digit'],
    remaining: state === 'complete' ? 0 : 9 - k,
    state,
    disabled: state !== 'armed',
  })),
});
const ARMED: KeyState[] = Array(9).fill('armed');

describe('Keypad', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
  });

  it('has nine keys 1–9 from left to right, each with what is left, always LTR', async () => {
    await render(<Keypad model={keypad(ARMED)} onDigit={jest.fn()} />);
    const row = screen.getByTestId('keypad');
    expect(styleOf(row)).toMatchObject({ direction: 'ltr', flexDirection: 'row', gap: size.keypadGap });
    const keys = within(row).getAllByRole('button');
    expect(keys.map((k) => k.props.testID)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `key-${d}`));
    expect(keys[4]).toHaveTextContent('55');
    expect(screen.getByRole('button', { name: 'ספרה 5 · נותרו 5' })).toBeEnabled();
  });

  it('armed: a press places the digit', async () => {
    const onDigit = jest.fn();
    await render(<Keypad model={keypad(ARMED)} onDigit={onDigit} />);
    await fireEvent.press(screen.getByTestId('key-7'));
    expect(onDigit).toHaveBeenCalledWith(7);
    expect(styleOf(faceOf(7))).toMatchObject({
      backgroundColor: color.keypad.keyBg,
      borderColor: color.keypad.keyBorder,
      borderRadius: tokens.radius.key,
    });
    expect(styleOf(screen.getByTestId('key-7-digit'))).toMatchObject({ color: color.keypad.keyText });
    expect(styleOf(screen.getByTestId('key-7-count'))).toMatchObject({ color: color.keypad.keyCount });
  });

  it('pressed: the key goes down 3 dp, then springs back', async () => {
    jest.useFakeTimers();
    try {
      await render(<Keypad model={keypad(ARMED)} onDigit={jest.fn()} />);
      const key = screen.getByTestId('key-3');
      await fireEvent(key, 'pressIn');
      await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.tapFeedbackMax));
      expect(faceOf(3)).toHaveAnimatedStyle({
        transform: [{ translateY: tokens.elevation.keyPressed.translateY }],
      });
      await fireEvent(key, 'pressOut');
      await act(async () => void jest.advanceTimersByTime(1000));
      expect(faceOf(3)).toHaveAnimatedStyle({ transform: [{ translateY: 0 }] });
    } finally {
      jest.useRealTimers();
    }
  });

  it('idle (no lock): the row dims, keys read as disabled, and a tap nudges instead of placing', async () => {
    const onDigit = jest.fn();
    const onIdlePress = jest.fn();
    await render(
      <Keypad model={keypad(Array(9).fill('idle'), false)} onDigit={onDigit} onIdlePress={onIdlePress} />,
    );
    expect(screen.getByTestId('keypad')).toHaveAnimatedStyle({ opacity: tokens.opacity.keypadIdle });
    const key = screen.getByRole('button', { name: 'ספרה 5, נשארו 5, קודם בוחרים משבצת' });
    expect(key.props.accessibilityState).toMatchObject({ disabled: true });
    expect(styleOf(faceOf(5)).borderColor).toBe(color.keypad.keyBorderIdle);
    await fireEvent.press(key);
    expect(onIdlePress).toHaveBeenCalledWith(5);
    expect(onDigit).not.toHaveBeenCalled();
  });

  it('idle without a nudge handler: the keys are simply disabled', async () => {
    const onDigit = jest.fn();
    await render(<Keypad model={keypad(Array(9).fill('idle'), false)} onDigit={onDigit} />);
    expect(screen.getByTestId('key-5')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('key-5'));
    expect(onDigit).not.toHaveBeenCalled();
  });

  it('a complete digit: faded to .3, count 0, disabled', async () => {
    const onDigit = jest.fn();
    const states: KeyState[] = [...ARMED];
    states[5] = 'complete';
    await render(<Keypad model={keypad(states)} onDigit={onDigit} />);
    const key = screen.getByRole('button', { name: 'ספרה 6, נשארו 0' });
    expect(key).toBeDisabled();
    expect(key).toHaveTextContent('60');
    expect(styleOf(faceOf(6)).opacity).toBe(tokens.opacity.keyExhausted);
    await fireEvent.press(key);
    expect(onDigit).not.toHaveBeenCalled();
  });

  it('a digit tried wrongly in my cell [D12]: red, struck through, .55, disabled', async () => {
    const onDigit = jest.fn();
    const states: KeyState[] = [...ARMED];
    states[4] = 'tried';
    await render(<Keypad model={keypad(states)} onDigit={onDigit} />);
    const key = screen.getByRole('button', { name: 'ספרה 5 · כבר נוסתה במשבצת הזו' });
    expect(key).toBeDisabled();
    expect(styleOf(faceOf(5)).opacity).toBe(tokens.opacity.keypadIdle);
    expect(styleOf(screen.getByTestId('key-5-digit'))).toMatchObject({
      color: color.danger,
      textDecorationLine: 'line-through',
    });
    await fireEvent.press(key);
    expect(onDigit).not.toHaveBeenCalled();
  });

  it('draws the keypad of a real game: armed with a tried digit, then idle', async () => {
    const { view, mySeat, now } = demoBoard();
    await render(<Keypad model={boardModel(view, mySeat, now).keypad} onDigit={jest.fn()} />);
    expect(screen.getAllByRole('button', { name: /כבר נוסתה/ })).toHaveLength(1);
    const fresh = new DemoGame();
    await render(<Keypad model={boardModel(fresh.view('moshe'), 0, 0).keypad} onDigit={jest.fn()} />);
    expect(screen.getAllByRole('button', { name: /קודם בוחרים משבצת/ })).toHaveLength(9);
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await render(<Keypad model={keypad(ARMED)} onDigit={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Digit 1 · 9 left' })).toBeOnTheScreen();
  });
});

describe('CancelSelection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('while I hold a lock: names the cell and lets go of it', async () => {
    const onPress = jest.fn();
    await render(<CancelSelection cell="F8" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'ביטול בחירה, F8' });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('ביטול בחירה');
    expect(screen.getByTestId('icon-cancel', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(styleOf(button)).toMatchObject({ height: size.buttonGhost, flexDirection: 'row' });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('without a lock: dimmed and disabled', async () => {
    const onPress = jest.fn();
    await render(<CancelSelection cell={null} onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'ביטול בחירה' });
    expect(button).toBeDisabled();
    expect(styleOf(button).opacity).toBe(tokens.opacity.disabled);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await render(<CancelSelection cell="F8" onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel selection, F8' })).toHaveTextContent(
      'Cancel selection',
    );
  });
});
