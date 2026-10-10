import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { AccessibilityInfo, BackHandler, StyleSheet, type ViewStyle } from 'react-native';

import { NOW, twoPlayerView } from '../../../../components/player/__fixtures__/gameView';
import i18n from '../../../../i18n';
import { useSettings } from '../../../../state/settings';
import { tokens } from '../../../../theme';
import { pickerModel, type PickerItem, pickerWidth, POPOVER } from '../model';
import { IN_MS, OUT_MS, POP_FROM, REDUCED_IN_MS } from '../Popover';
import { ReactionPicker } from '../ReactionPicker';

jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../../services/feedback');

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

/** Hebrew: my card on the right of a 750-wide test window (React Native's Jest window). */
const MY_CARD = { x: 575, y: 56, width: 159, height: 160 };
const READY = pickerModel(twoPlayerView(), NOW).items;
const COOLING = pickerModel(twoPlayerView({ reactionReadyAt: NOW + 1_500 }), NOW).items;

async function frames(ms: number, frame = 20) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}

function show(props: { visible?: boolean; items?: readonly PickerItem[] } = {}) {
  const onPick = jest.fn();
  const onClose = jest.fn();
  const ui = (visible: boolean, items: readonly PickerItem[]) => (
    <ReactionPicker visible={visible} anchor={MY_CARD} items={items} onPick={onPick} onClose={onClose} />
  );
  const items = props.items ?? READY;
  return {
    onPick,
    onClose,
    rendered: render(ui(props.visible ?? true, items)),
    rerender: async (visible: boolean, next = items) => screen.rerender(ui(visible, next)),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ReactionPicker (spec §8, components.md §8.2)', () => {
  it('shows nothing while closed', async () => {
    await show({ visible: false }).rendered;
    expect(screen.queryByTestId('reaction-picker', hidden)).toBeNull();
  });

  it('a group "תגובות" of the six reactions, each a 44 dp button named in Hebrew', async () => {
    await show().rendered;
    expect(screen.getByLabelText('תגובות')).toBeOnTheScreen();
    const names = ['צחוק', 'בהלה', 'קול', 'פספוס', 'אש', 'עיניים'];
    const buttons = names.map((n) => screen.getByRole('button', { name: `תגובה: ${n}` }));
    expect(buttons).toHaveLength(6);
    expect(screen.getByTestId('reaction-picker-0')).toHaveTextContent('😂');
    expect(screen.getByTestId('reaction-picker-5')).toHaveTextContent('👀');
    for (const b of buttons) {
      expect(b).toBeEnabled();
      expect(styleOf(b)).toMatchObject({ width: 44, height: 44 });
    }
  });

  it('names them in English too', async () => {
    await i18n.changeLanguage('en');
    await show().rendered;
    expect(screen.getByLabelText('Reactions')).toBeOnTheScreen();
    for (const n of ['laugh', 'scream', 'cool', 'facepalm', 'fire', 'eyes'])
      expect(screen.getByRole('button', { name: `Reaction: ${n}` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Close reactions' })).toBeOnTheScreen();
  });

  it('a future emoji without a name is read with its emoji', async () => {
    await show({ items: [{ emoji: '🎉', nameKey: null, disabled: false }] }).rendered;
    expect(screen.getByRole('button', { name: 'תגובה 🎉' })).toBeOnTheScreen();
  });

  it('a pick plays the send haptic, sends the emoji and closes', async () => {
    const { onPick, onClose, rendered } = show();
    await rendered;
    await fireEvent.press(screen.getByRole('button', { name: 'תגובה: אש' }));
    expect(feedback.cue).toHaveBeenCalledWith('reactSend');
    expect(onPick).toHaveBeenCalledWith('🔥');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(feedback.cue.mock.invocationCallOrder[0]).toBeLessThan(onPick.mock.invocationCallOrder[0]!);
  });

  it('during the 2 s cooldown every emoji is disabled, at .5, and says why [D19]', async () => {
    const { onPick, rendered } = show({ items: COOLING });
    await rendered;
    const laugh = screen.getByRole('button', { name: 'תגובה: צחוק' });
    expect(laugh).toBeDisabled();
    expect(laugh.props.accessibilityHint).toBe('אפשר לשלוח תגובה נוספת בעוד רגע');
    expect(styleOf(laugh).opacity).toBe(tokens.opacity.inactivePlayer);
    await fireEvent.press(laugh);
    expect(onPick).not.toHaveBeenCalled();
    expect(feedback.cue).not.toHaveBeenCalled();
  });

  it('an outside tap closes it, as do Android back and the escape gesture', async () => {
    const back = jest.spyOn(BackHandler, 'addEventListener');
    const { onClose, onPick, rendered } = show();
    await rendered;
    await fireEvent.press(screen.getByRole('button', { name: 'סגירת התגובות' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByLabelText('תגובות'), 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(2);
    // Back is the picker's while it is open: it closes it, and the screen's own handler doesn't run.
    const [event, handler] = back.mock.calls.at(-1)!;
    expect(event).toBe('hardwareBackPress');
    expect((handler as () => boolean | null | undefined)()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onPick).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('moves screen readers to the first emoji as it opens', async () => {
    await show().rendered;
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), 'focus');
  });

  it('hangs under my card, from its outer edge, with the arrow on the reactions button', async () => {
    await show().rendered;
    const popover = screen.getByTestId('reaction-picker');
    const window = 750;
    expect(styleOf(popover)).toMatchObject({
      top: 56 + 160 + POPOVER.below + POPOVER.arrow / 2,
      right: window - (575 + 159),
      width: pickerWidth(6),
    });
    // The button's centre is 22 dp in from the card's inner (left) edge: 137 dp from its right edge.
    expect(styleOf(screen.getByTestId('reaction-picker-arrow', hidden))).toMatchObject({
      right: 159 - 22 - POPOVER.arrow / 2,
      top: -POPOVER.arrow / 2,
    });
  });

  it('pops open from 0.6 with the emoji staggered, and fades out in 120 ms when closed', async () => {
    const { rerender, rendered } = show();
    await rendered;
    const popover = () => screen.getByTestId('reaction-picker');
    const scaleOf = (i: number) => {
      const face = screen.getByTestId(`reaction-picker-${i}-face`, hidden);
      return (getAnimatedStyle(face).transform as { scale: number }[])[0]!.scale;
    };
    expect(popover()).toHaveAnimatedStyle({ transform: [{ scale: POP_FROM }] });
    // 40 ms apart: the first emoji is well on its way while the last one has not started.
    await frames(100);
    expect(scaleOf(0)).toBeGreaterThan(scaleOf(5));
    expect(scaleOf(5)).toBe(POP_FROM);
    await frames(IN_MS + 1_200);
    expect(popover()).toHaveAnimatedStyle({ opacity: 1, transform: [{ scale: 1 }] });
    expect(scaleOf(5)).toBe(1);
    await rerender(false);
    await frames(OUT_MS - 40);
    // Still fading out (already gone for screen readers).
    expect(screen.getByTestId('reaction-picker', hidden)).toBeTruthy();
    expect(screen.queryByTestId('reaction-picker')).toBeNull();
    await frames(120);
    expect(screen.queryByTestId('reaction-picker', hidden)).toBeNull();
  });

  it('with reduced motion fades in over 140 ms, without any scale', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await show().rendered;
    const popover = screen.getByTestId('reaction-picker');
    expect(popover).toHaveAnimatedStyle({ opacity: 0, transform: [{ scale: 1 }] });
    // No stagger either: every emoji is there at once, with the fade.
    for (let i = 0; i < 6; i++)
      expect(screen.getByTestId(`reaction-picker-${i}-face`, hidden)).toHaveAnimatedStyle({
        transform: [{ scale: 1 }],
      });
    await frames(REDUCED_IN_MS + 20);
    expect(screen.getByTestId('reaction-picker')).toHaveAnimatedStyle({
      opacity: 1,
      transform: [{ scale: 1 }],
    });
  });
});
