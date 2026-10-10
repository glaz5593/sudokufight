import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import i18n from '../../../../i18n';
import { useSettings } from '../../../../state/settings';
import { CardMenu, CardMenuTrigger, LONG_PRESS_MS } from '../CardMenu';
import { POPOVER } from '../model';

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

/** Hebrew: the opponent's card on the left of the 750-wide test window. */
const THEIR_CARD = { x: 16, y: 56, width: 159, height: 160 };

async function frames(ms: number, frame = 20) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
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

describe('CardMenuTrigger (spec §8: the opponent card’s menu; components.md §17.9)', () => {
  function card(onInterfere = jest.fn()) {
    return (
      <>
        <Text>NinaVolt · 39.5</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="הפרעה"
          onPress={onInterfere}
          testID="bolt"
        />
      </>
    );
  }

  it('a long press on the card opens its menu; its own buttons keep their taps', async () => {
    const onOpen = jest.fn();
    const onInterfere = jest.fn();
    await render(
      <CardMenuTrigger name="NinaVolt" muted={false} onOpen={onOpen}>
        {card(onInterfere)}
      </CardMenuTrigger>,
    );
    const trigger = screen.getByTestId('card-menu-trigger');
    expect(trigger.props.delayLongPress ?? LONG_PRESS_MS).toBe(LONG_PRESS_MS);
    await fireEvent(trigger, 'longPress');
    expect(onOpen).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'הפרעה' }));
    expect(onInterfere).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not group the card for screen readers, and gives them a button of their own', async () => {
    const onOpen = jest.fn();
    await render(
      <CardMenuTrigger name="NinaVolt" muted={false} onOpen={onOpen}>
        {card()}
      </CardMenuTrigger>,
    );
    expect(screen.getByTestId('card-menu-trigger').props.accessible).toBe(false);
    expect(screen.getByRole('button', { name: 'הפרעה' })).toBeOnTheScreen();
    const sr = screen.getByRole('button', { name: 'תפריט הכרטיס של NinaVolt' });
    expect(sr.props.accessibilityHint).toBe('משם אפשר להשתיק את התגובות של NinaVolt');
    await fireEvent.press(sr);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('tells screen readers when the player is muted; in English too', async () => {
    await render(
      <CardMenuTrigger name="NinaVolt" muted onOpen={jest.fn()}>
        {card()}
      </CardMenuTrigger>,
    );
    expect(screen.getByRole('button', { name: 'תפריט הכרטיס של NinaVolt' }).props.accessibilityHint).toBe(
      'התגובות של NinaVolt מושתקות. משם אפשר לבטל את ההשתקה',
    );
    await act(async () => void (await i18n.changeLanguage('en')));
    expect(screen.getByRole('button', { name: "NinaVolt's card menu" })).toBeOnTheScreen();
  });

  it('is only the card when there is no menu (my own card)', async () => {
    await render(
      <CardMenuTrigger name="אני" muted={false} onOpen={jest.fn()} disabled>
        {card()}
      </CardMenuTrigger>,
    );
    expect(screen.queryByTestId('card-menu-trigger')).toBeNull();
    expect(screen.queryByTestId('card-menu-trigger-a11y', hidden)).toBeNull();
    expect(screen.getByText('NinaVolt · 39.5')).toBeOnTheScreen();
  });
});

describe('CardMenu', () => {
  function show(muted: boolean, visible = true) {
    const onToggleMute = jest.fn();
    const onClose = jest.fn();
    const ui = (open: boolean, isMuted: boolean) => (
      <CardMenu
        visible={open}
        anchor={THEIR_CARD}
        name="NinaVolt"
        muted={isMuted}
        onToggleMute={onToggleMute}
        onClose={onClose}
      />
    );
    return {
      onToggleMute,
      onClose,
      rendered: render(ui(visible, muted)),
      rerender: (open: boolean, isMuted = muted) => screen.rerender(ui(open, isMuted)),
    };
  }

  it('shows nothing while closed', async () => {
    await show(false, false).rendered;
    expect(screen.queryByTestId('card-menu', hidden)).toBeNull();
  });

  it('one item, "השתק תגובות": mutes, says so to screen readers and closes', async () => {
    const { onToggleMute, onClose, rendered } = show(false);
    await rendered;
    expect(screen.getByLabelText('התפריט של NinaVolt')).toBeOnTheScreen();
    expect(screen.getByText('השתק תגובות')).toBeOnTheScreen();
    const item = screen.getByRole('menuitem', { name: 'השתק את התגובות של NinaVolt' });
    expect(screen.getByTestId('icon-reactionsMuted', hidden)).toBeTruthy();
    await fireEvent.press(item);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('התגובות של NinaVolt מושתקות');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('once muted: "בטל השתקה"', async () => {
    const { onToggleMute, rendered } = show(true);
    await rendered;
    expect(screen.getByText('בטל השתקה')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-reactions', hidden)).toBeTruthy();
    await fireEvent.press(screen.getByRole('menuitem', { name: 'בטל את השתקת התגובות של NinaVolt' }));
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('התגובות של NinaVolt חוזרות');
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await show(false).rendered;
    expect(screen.getByText('Mute reactions')).toBeOnTheScreen();
    expect(screen.getByRole('menuitem', { name: "Mute NinaVolt's reactions" })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Close the menu' })).toBeOnTheScreen();
    await screen.rerender(
      <CardMenu
        visible
        anchor={THEIR_CARD}
        name="NinaVolt"
        muted
        onToggleMute={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('Unmute reactions')).toBeOnTheScreen();
  });

  it('an outside tap closes it without a change', async () => {
    const { onToggleMute, onClose, rendered } = show(false);
    await rendered;
    await fireEvent.press(screen.getByRole('button', { name: 'סגירת התפריט' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onToggleMute).not.toHaveBeenCalled();
  });

  it('hangs under the card from its outer edge, the arrow on the avatar', async () => {
    await show(false).rendered;
    expect(styleOf(screen.getByTestId('card-menu'))).toMatchObject({
      top: 56 + 160 + POPOVER.below + POPOVER.arrow / 2,
      left: 16,
    });
    expect(styleOf(screen.getByTestId('card-menu-arrow', hidden)).left).toBe(
      POPOVER.radius + POPOVER.arrow / 2 - POPOVER.arrow / 2,
    );
  });

  it('pops in and fades out; with reduced motion only fades', async () => {
    const { rerender, rendered } = show(false);
    await rendered;
    expect(screen.getByTestId('card-menu')).toHaveAnimatedStyle({ transform: [{ scale: 0.6 }] });
    await frames(1_400);
    expect(screen.getByTestId('card-menu')).toHaveAnimatedStyle({ opacity: 1, transform: [{ scale: 1 }] });
    await rerender(false);
    await frames(200);
    expect(screen.queryByTestId('card-menu', hidden)).toBeNull();

    await act(async () => useSettings.setState({ reduceMotion: 'on' }));
    await rerender(true);
    expect(screen.getByTestId('card-menu')).toHaveAnimatedStyle({ opacity: 0, transform: [{ scale: 1 }] });
    await frames(200);
    expect(screen.getByTestId('card-menu')).toHaveAnimatedStyle({ opacity: 1, transform: [{ scale: 1 }] });
  });
});
