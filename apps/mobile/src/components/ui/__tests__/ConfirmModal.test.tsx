import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, I18nManager, StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color } from '../../../theme';
import { motion } from '../../../theme/motion';
import { ConfirmModal, type ConfirmModalProps } from '../ConfirmModal';
import { directionProblems, hostStyles } from '../testing/layout';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

/** The surrender confirmation of spec §6.6. */
const surrender = (props: Partial<ConfirmModalProps> = {}) => (
  <ConfirmModal
    visible
    tone="danger"
    icon="surrender"
    chip="כניעה"
    title="אתה בטוח שאתה רוצה להיכנע?"
    body="המשחק ייחשב כהפסד"
    confirmLabel="כן, להיכנע"
    footnote="המשחק ממשיך ברקע"
    accessibilityLabel="אישור כניעה"
    onConfirm={jest.fn()}
    onCancel={jest.fn()}
    testID="surrender"
    {...props}
  />
);

describe('ConfirmModal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing while closed', async () => {
    await render(surrender({ visible: false }));
    expect(screen.queryByText('אתה בטוח שאתה רוצה להיכנע?')).not.toBeOnTheScreen();
  });

  it('shows the surrender question as a labelled dialog', async () => {
    await render(surrender());
    expect(screen.getByRole('header', { name: 'אתה בטוח שאתה רוצה להיכנע?' })).toBeOnTheScreen();
    expect(screen.getByText('המשחק ייחשב כהפסד')).toBeOnTheScreen();
    expect(screen.getByText('כניעה')).toHaveStyle({ color: color.danger });
    expect(screen.getByText('המשחק ממשיך ברקע')).toBeOnTheScreen();
    expect(screen.getByLabelText('אישור כניעה')).toHaveProp('role', 'dialog');
    expect(screen.getByTestId('surrender-overlay')).toHaveProp('accessibilityViewIsModal', true);
  });

  it('makes "ביטול" the prominent gold button and the confirm a red outline (spec §6.6)', async () => {
    await render(surrender());
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveAccessibleName('ביטול');
    expect(second).toHaveAccessibleName('כן, להיכנע');
    // Gold primary: it has the hard shadow; and it is wider.
    expect(screen.getByTestId('surrender-cancel-shadow')).toBeOnTheScreen();
    expect(screen.queryByTestId('surrender-confirm-shadow')).not.toBeOnTheScreen();
    expect(styleOf(first!).flex).toBeGreaterThan(styleOf(second!).flex ?? 0);
    expect(styleOf(second!)).toMatchObject({ borderColor: color.dangerBorder });
  });

  it('confirms only from the confirm button; everything else cancels', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(surrender({ onConfirm, onCancel }));
    await fireEvent.press(screen.getByRole('button', { name: 'כן, להיכנע' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'ביטול' }));
    await fireEvent.press(screen.getByTestId('surrender-scrim', { includeHiddenElements: true }));
    await fireEvent(screen.getByTestId('surrender'), 'requestClose');
    await fireEvent(screen.getByLabelText('אישור כניעה'), 'accessibilityEscape');
    expect(onCancel).toHaveBeenCalledTimes(4);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('starts screen-reader focus on the safe action', async () => {
    const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await render(surrender());
    await fireEvent(screen.getByTestId('surrender'), 'show');
    expect(send).toHaveBeenCalledWith(expect.anything(), 'focus');
  });

  it('shows a busy confirm while the action runs', async () => {
    await render(surrender({ confirmLoading: true }));
    expect(screen.getByRole('button', { name: 'כן, להיכנע, טוען' })).toBeBusy();
  });

  it('as a centred neutral dialog, the confirm is the primary and comes first', async () => {
    const onConfirm = jest.fn();
    await render(
      <ConfirmModal
        visible
        placement="center"
        icon="wifiOff"
        title="אין חיבור לאינטרנט"
        body="אפשר להמשיך באימון"
        confirmLabel="עבור לאימון"
        cancelLabel="נסה שוב"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
        testID="offline"
      />,
    );
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveAccessibleName('עבור לאימון');
    expect(second).toHaveAccessibleName('נסה שוב');
    expect(screen.getByTestId('offline-confirm-shadow')).toBeOnTheScreen();
    expect(styleOf(first!).flex).toBeGreaterThan(styleOf(second!).flex ?? 0);
    await fireEvent.press(first!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('labels the cancel "ביטול" by default, and in English', async () => {
    await render(surrender());
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeOnTheScreen();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await screen.rerender(surrender({ confirmLabel: 'Yes, surrender' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
  });

  it.each([
    ['bottom', 'off'],
    ['bottom', 'on'],
    ['center', 'off'],
    ['center', 'on'],
  ] as const)(
    '%s placement animates out and unmounts (reduce motion %s)',
    async (placement, reduceMotion) => {
      useSettings.setState({ reduceMotion });
      await render(surrender({ placement }));
      await act(async () => void jest.advanceTimersByTime(motion.duration.sheetIn));
      await screen.rerender(surrender({ placement, visible: false }));
      expect(screen.getByText('המשחק ייחשב כהפסד')).toBeOnTheScreen();
      await act(
        async () => void jest.advanceTimersByTime(motion.duration.sheetOut + motion.duration.tapFeedbackMax),
      );
      expect(screen.queryByText('המשחק ייחשב כהפסד')).not.toBeOnTheScreen();
    },
  );

  it('does not hard-code a direction', async () => {
    for (const placement of ['bottom', 'center'] as const) {
      const layouts: unknown[] = [];
      for (const rtl of [true, false]) {
        jest.replaceProperty(I18nManager, 'isRTL', rtl);
        await render(surrender({ placement }));
        expect(directionProblems(screen.container)).toEqual([]);
        layouts.push(hostStyles(screen.container));
        await screen.unmount();
      }
      expect(layouts[0]).toEqual(layouts[1]);
    }
  });
});
