import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, I18nManager, StyleSheet, Text } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { dragClosesSheet, Sheet } from '../Sheet';
import { directionProblems, hostStyles } from '../testing/layout';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const arsenal = (visible: boolean, onClose = jest.fn()) => (
  <Sheet
    visible={visible}
    onClose={onClose}
    title="ארסנל ההפרעות"
    subtitle="יעד: NinaVolt"
    accessibilityLabel="ארסנל ההפרעות"
    scrimLabel="סגירת הארסנל וחזרה ללוח"
    enter="tray"
    testID="sheet"
  >
    <Text>תוכן</Text>
  </Sheet>
);

describe('Sheet', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('`fill`: takes its full height (85%) for a list to fill; otherwise it fits its content up to that', async () => {
    const sheetStyle = (label: string) => StyleSheet.flatten(screen.getByLabelText(label).props.style);
    await render(arsenal(true));
    expect(sheetStyle('ארסנל ההפרעות')).toMatchObject({ maxHeight: '85%' });
    expect(sheetStyle('ארסנל ההפרעות').height).toBeUndefined();
    await screen.unmount();
    await render(
      <Sheet visible onClose={jest.fn()} title="בחר מדינה" fill>
        <Text>רשימה</Text>
      </Sheet>,
    );
    expect(sheetStyle('בחר מדינה')).toMatchObject({ height: '85%', maxHeight: '85%' });
  });

  it('renders nothing while closed', async () => {
    await render(arsenal(false));
    expect(screen.queryByText('ארסנל ההפרעות')).not.toBeOnTheScreen();
  });

  it('shows the handle, header, subtitle and content as a labelled dialog', async () => {
    await render(arsenal(true));
    expect(screen.getByRole('header', { name: 'ארסנל ההפרעות' })).toBeOnTheScreen();
    expect(screen.getByText('יעד: NinaVolt')).toBeOnTheScreen();
    expect(screen.getByText('תוכן')).toBeOnTheScreen();
    const dialog = screen.getByLabelText('ארסנל ההפרעות');
    expect(dialog).toHaveProp('role', 'dialog');
    expect(screen.getByTestId('sheet-overlay')).toHaveProp('accessibilityViewIsModal', true);
  });

  it('closes from the close button, the scrim, Android back and the escape gesture', async () => {
    const onClose = jest.fn();
    await render(arsenal(true, onClose));
    await fireEvent.press(screen.getByRole('button', { name: 'סגירה' }));
    await fireEvent.press(screen.getByRole('button', { name: 'סגירת הארסנל וחזרה ללוח' }));
    await fireEvent(screen.getByTestId('sheet'), 'requestClose');
    await fireEvent(screen.getByLabelText('ארסנל ההפרעות'), 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('hides the scrim from screen readers when it has no label', async () => {
    await render(
      <Sheet visible onClose={jest.fn()} title="תפריט" testID="menu">
        <Text>א</Text>
      </Sheet>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('menu-scrim', { includeHiddenElements: true })).not.toBeVisible();
  });

  it('moves screen-reader focus to the title when shown', async () => {
    const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await render(arsenal(true));
    await fireEvent(screen.getByTestId('sheet'), 'show');
    expect(send).toHaveBeenCalledWith(expect.anything(), 'focus');
  });

  it.each(['off', 'on'] as const)(
    'slides (or fades) out, then unmounts (reduce motion %s)',
    async (reduceMotion) => {
      useSettings.setState({ reduceMotion });
      await render(arsenal(true));
      await act(async () => void jest.advanceTimersByTime(motion.duration.sheetIn));
      await screen.rerender(arsenal(false));
      expect(screen.getByText('תוכן')).toBeOnTheScreen();
      await act(
        async () => void jest.advanceTimersByTime(motion.duration.sheetOut + motion.duration.tapFeedbackMax),
      );
      expect(screen.queryByText('תוכן')).not.toBeOnTheScreen();
    },
  );

  it.each([
    ['full motion', 'off', motion.duration.sheetOut],
    ['reduced motion', 'on', motion.duration.reducedFade],
  ] as const)(
    'says once that it has left the screen (onExited), after its exit (%s)',
    async (_name, reduceMotion, outMs) => {
      useSettings.setState({ reduceMotion });
      const onExited = jest.fn();
      const sheet = (visible: boolean) => (
        <Sheet visible={visible} onClose={jest.fn()} title="דיווח" onExited={onExited} testID="sheet">
          <Text>תוכן</Text>
        </Sheet>
      );
      await render(sheet(true));
      await act(async () => void jest.advanceTimersByTime(motion.duration.sheetIn));
      expect(onExited).not.toHaveBeenCalled();
      await screen.rerender(sheet(false));
      await act(async () => void jest.advanceTimersByTime(outMs - 50));
      expect(onExited).not.toHaveBeenCalled();
      await act(async () => void jest.advanceTimersByTime(50 + motion.duration.tapFeedbackMax));
      expect(screen.queryByText('תוכן')).not.toBeOnTheScreen();
      expect(onExited).toHaveBeenCalledTimes(1);
      await act(async () => void jest.advanceTimersByTime(1000));
      expect(onExited).toHaveBeenCalledTimes(1);
    },
  );

  it('reopens if shown again during its exit', async () => {
    await render(arsenal(true));
    await screen.rerender(arsenal(false));
    await screen.rerender(arsenal(true));
    await act(async () => void jest.advanceTimersByTime(motion.duration.sheetOut * 2));
    expect(screen.getByText('תוכן')).toBeOnTheScreen();
  });

  it('closes on a drag past a quarter of its height, or a fast fling', () => {
    expect(dragClosesSheet(101, 0, 400)).toBe(true);
    expect(dragClosesSheet(99, 0, 400)).toBe(false);
    expect(dragClosesSheet(20, 1.5, 400)).toBe(true);
    expect(dragClosesSheet(-200, -3, 400)).toBe(false);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(arsenal(true));
    expect(screen.getByRole('button', { name: 'Close' })).toBeOnTheScreen();
  });

  it('does not hard-code a direction', async () => {
    const layouts: unknown[] = [];
    for (const rtl of [true, false]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      await render(arsenal(true));
      expect(directionProblems(screen.container)).toEqual([]);
      layouts.push(hostStyles(screen.container));
      await screen.unmount();
    }
    expect(layouts[0]).toEqual(layouts[1]);
  });
});
