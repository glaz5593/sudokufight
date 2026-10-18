import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, size, tokens } from '../../../theme';
import { boardModel, type KeypadModel, type KeyState } from '../boardModel';
import { CancelSelection } from '../CancelSelection';
import { demoBoard, DemoGame } from '../demo';
import { fingersOnKeys, Keypad, type KeypadGuard, type TouchId } from '../Keypad';

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

describe('Keypad: "מקלדת מתערבלת", the keys out of order [D47]', () => {
  const ORDER = [9, 1, 8, 2, 7, 3, 6, 4, 5] as const;
  const W = 358;
  const PITCH = (W + size.keypadGap) / 9;
  const guardOf = (over: Partial<KeypadGuard> = {}): KeypadGuard => ({
    fingers: jest.fn(),
    settled: () => true,
    refused: jest.fn(),
    reduce: false,
    moveMs: 200,
    fadeMs: 200,
    ...over,
  });
  const place = (digit: number) => screen.getByTestId(`key-${digit}-place`);
  const frames = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

  beforeEach(async () => {
    jest.useFakeTimers();
    await i18n.changeLanguage('he');
  });
  afterEach(() => jest.useRealTimers());

  it('stands each key in its slot of the order, sliding there in 200 ms; the row stays LTR', async () => {
    const guard = guardOf();
    const onDigit = jest.fn();
    const { rerender } = await render(
      <Keypad model={keypad(ARMED)} onDigit={onDigit} width={W} guard={guard} />,
    );
    expect(place(9)).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateX: 0 }] });
    await rerender(<Keypad model={keypad(ARMED)} onDigit={onDigit} width={W} order={ORDER} guard={guard} />);
    await frames(100);
    const halfway = (place(9) as unknown as { props: { jestAnimatedStyle?: { value: ViewStyle } } }).props
      .jestAnimatedStyle?.value.transform as { translateX: number }[];
    expect(halfway[0]!.translateX).toBeLessThan(0);
    expect(halfway[0]!.translateX).toBeGreaterThan(-8 * PITCH);
    await frames(200);
    // 9 stands at the left end, 8 slots left of its own place; 1 one slot to the right of its own.
    expect(place(9)).toHaveAnimatedStyle({ transform: [{ translateX: -8 * PITCH }] });
    expect(place(1)).toHaveAnimatedStyle({ transform: [{ translateX: PITCH }] });
    expect(place(5)).toHaveAnimatedStyle({ transform: [{ translateX: 4 * PITCH }] });
    expect(styleOf(screen.getByTestId('keypad'))).toMatchObject({ direction: 'ltr', flexDirection: 'row' });
    // Back to 1–9 when it ends.
    await rerender(<Keypad model={keypad(ARMED)} onDigit={onDigit} width={W} order={null} guard={guard} />);
    await frames(300);
    expect(place(9)).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
  });

  it('every key enters the digit printed on it, wherever it stands, and keeps its own count and state', async () => {
    const onDigit = jest.fn();
    const states: KeyState[] = [
      'armed',
      'complete',
      'armed',
      'tried',
      'armed',
      'armed',
      'armed',
      'armed',
      'armed',
    ];
    await render(
      <Keypad model={keypad(states)} onDigit={onDigit} width={W} order={ORDER} guard={guardOf()} />,
    );
    await frames(300);
    for (const digit of [9, 1, 5]) {
      const key = screen.getByTestId(`key-${digit}`);
      await fireEvent(key, 'pressIn');
      await fireEvent.press(key);
      await fireEvent(key, 'pressOut');
    }
    expect(onDigit.mock.calls).toEqual([[9], [1], [5]]);
    expect(screen.getByTestId('key-2')).toBeDisabled();
    expect(screen.getByTestId('key-2-count')).toHaveTextContent('0');
    expect(screen.getByTestId('key-4')).toBeDisabled();
    expect(screen.getByTestId('key-9-count')).toHaveTextContent('1');
  });

  it('a press that starts while the keys are still moving does not count: refused, never entered', async () => {
    const onDigit = jest.fn();
    let settled = false;
    const guard = guardOf({ settled: () => settled });
    await render(<Keypad model={keypad(ARMED)} onDigit={onDigit} width={W} order={ORDER} guard={guard} />);
    const key = screen.getByTestId('key-3');
    await fireEvent(key, 'pressIn');
    settled = true; // settled by the time the finger lifts: the press still started too early
    await fireEvent.press(key);
    expect(onDigit).not.toHaveBeenCalled();
    expect(guard.refused).toHaveBeenCalledWith(3);
    await fireEvent(key, 'pressIn');
    await fireEvent.press(key);
    expect(onDigit).toHaveBeenCalledWith(3);
  });

  /** A raw touch event's lists, by finger id (iOS adds `targetTouches`: the fingers on the view it was sent to). */
  const touch = (changed: number[], active: number[], target?: number[]) => ({
    nativeEvent: {
      changedTouches: changed.map((identifier) => ({ identifier })),
      touches: active.map((identifier) => ({ identifier })),
      ...(target ? { targetTouches: target.map((identifier) => ({ identifier })) } : {}),
    },
  });

  it('tells the guard how many fingers are on the keys: down on the row, and up (or cancelled)', async () => {
    const guard = guardOf();
    await render(<Keypad model={keypad(ARMED)} onDigit={jest.fn()} width={W} order={ORDER} guard={guard} />);
    const row = screen.getByTestId('keypad');
    await fireEvent(row, 'touchStart', touch([1], [1]));
    await fireEvent(row, 'touchStart', touch([2], [1, 2]));
    await fireEvent(row, 'touchEnd', touch([1], [2]));
    await fireEvent(row, 'touchCancel', touch([2], []));
    expect((guard.fingers as jest.Mock).mock.calls).toEqual([[1], [2], [1], [0]]);
  });

  it('iOS: two fingers that land on two keys in one frame are two, not four, and both lifts free the keys', async () => {
    // iOS sends one event with both fingers in changedTouches, once to each key, and both copies bubble up here.
    const guard = guardOf();
    await render(<Keypad model={keypad(ARMED)} onDigit={jest.fn()} width={W} order={ORDER} guard={guard} />);
    await fireEvent(screen.getByTestId('key-3'), 'touchStart', touch([7, 8], [7, 8], [7]));
    await fireEvent(screen.getByTestId('key-6'), 'touchStart', touch([7, 8], [7, 8], [8]));
    await fireEvent(screen.getByTestId('key-3'), 'touchEnd', touch([7], [8], [7]));
    await fireEvent(screen.getByTestId('key-6'), 'touchEnd', touch([8], [], [8]));
    expect((guard.fingers as jest.Mock).mock.calls).toEqual([[1], [2], [1], [0]]);
  });

  it('iOS: a finger that lands on the board in the same frame as one on a key is not on the keys', async () => {
    // The row sees only the key's copy (changedTouches holds both); the board finger's lift never comes here.
    const guard = guardOf();
    await render(<Keypad model={keypad(ARMED)} onDigit={jest.fn()} width={W} order={ORDER} guard={guard} />);
    await fireEvent(screen.getByTestId('key-3'), 'touchStart', touch([7, 8], [7, 8], [7]));
    await fireEvent(screen.getByTestId('key-3'), 'touchEnd', touch([7], [8], [7]));
    expect((guard.fingers as jest.Mock).mock.calls).toEqual([[1], [0]]);
  });

  it('a finger whose lift the row never heard is dropped at the next event: no phantom finger', () => {
    const none: ReadonlySet<TouchId> = new Set();
    // Android: no targetTouches, one finger per event.
    const two = fingersOnKeys(fingersOnKeys(none, 'start', touch([1], [1]).nativeEvent), 'start', {
      changedTouches: [{ identifier: 2 }],
      touches: [{ identifier: 1 }, { identifier: 2 }],
    });
    expect([...two]).toEqual([1, 2]);
    // 1 lifted somewhere the row never heard: it is not among the active touches any more.
    expect([...fingersOnKeys(two, 'start', touch([3], [2, 3]).nativeEvent)]).toEqual([2, 3]);
    // A copy that comes twice is still one finger.
    const once = fingersOnKeys(none, 'start', touch([5], [5], [5]).nativeEvent);
    expect([...fingersOnKeys(once, 'start', touch([5], [5], [5]).nativeEvent)]).toEqual([5]);
  });

  it('with reduced motion: the keys fade out and back in at their new places, no sliding', async () => {
    const guard = guardOf({ reduce: true });
    const { rerender } = await render(
      <Keypad model={keypad(ARMED)} onDigit={jest.fn()} width={W} guard={guard} />,
    );
    await rerender(
      <Keypad model={keypad(ARMED)} onDigit={jest.fn()} width={W} order={ORDER} guard={guard} />,
    );
    await frames(50);
    const midway = (place(9) as unknown as { props: { jestAnimatedStyle?: { value: ViewStyle } } }).props
      .jestAnimatedStyle?.value;
    expect(midway?.opacity as number).toBeLessThan(1);
    expect(midway?.transform).toEqual([{ translateX: 0 }]);
    await frames(250);
    expect(place(9)).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateX: -8 * PITCH }] });
  });

  it('with the phone’s own Reduce Motion on: the keys still move only while faded out, never in sight', async () => {
    // The app's setting defaults to 'system', so this is the usual case of the reduced variant.
    // (ReducedMotionConfig warns that it overrides the system setting: that is the point here.)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const guard = guardOf({ reduce: true });
      const { rerender, unmount } = await render(
        <>
          <ReducedMotionConfig mode={ReduceMotion.Always} />
          <Keypad model={keypad(ARMED)} onDigit={jest.fn()} width={W} guard={guard} />
        </>,
      );
      await rerender(
        <>
          <ReducedMotionConfig mode={ReduceMotion.Always} />
          <Keypad model={keypad(ARMED)} onDigit={jest.fn()} width={W} order={ORDER} guard={guard} />
        </>,
      );
      await frames(50);
      const midway = (place(9) as unknown as { props: { jestAnimatedStyle?: { value: ViewStyle } } }).props
        .jestAnimatedStyle?.value;
      expect(midway?.opacity as number).toBeLessThan(1);
      expect(midway?.transform).toEqual([{ translateX: 0 }]);
      await frames(250);
      expect(place(9)).toHaveAnimatedStyle({ opacity: 1, transform: [{ translateX: -8 * PITCH }] });
      // The system setting goes back to what it was (ReducedMotionConfig's cleanup).
      await unmount();
    } finally {
      warn.mockRestore();
    }
  });
});
