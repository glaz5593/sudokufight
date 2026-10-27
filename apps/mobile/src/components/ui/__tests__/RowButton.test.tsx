import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { I18nManager, StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { color, size, tokens } from '../../../theme';
import { RowButton } from '../RowButton';
import { directionProblems, hostStyles } from '../testing/layout';

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

const again = { icon: 'refresh', title: 'עוד סיבוב', subtitle: 'מדורג · 2 שחקנים · רגיל' } as const;

describe('RowButton', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('shows icon, title, subtitle and the forward chevron, and presses', async () => {
    const onPress = jest.fn();
    await render(<RowButton {...again} onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'עוד סיבוב, מדורג · 2 שחקנים · רגיל' });
    expect(screen.getByText('עוד סיבוב')).toHaveStyle({ color: color.text });
    expect(screen.getByText('מדורג · 2 שחקנים · רגיל')).toHaveStyle({ color: color.textMuted });
    expect(screen.getByTestId('icon-refresh', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('icon-chevronForward', { includeHiddenElements: true })).toBeOnTheScreen();
    // 64 high, or taller in a script with taller lines (localization plan 0ט).
    expect(styleOf(button)).toMatchObject({ minHeight: size.listRow, borderColor: color.border });
    expect(styleOf(button).height).toBeUndefined();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('works without a subtitle', async () => {
    await render(<RowButton icon="history" title="היסטוריה" />);
    expect(screen.getByRole('button', { name: 'היסטוריה' })).toBeOnTheScreen();
  });

  it('when disabled: dimmed and does not press', async () => {
    const onPress = jest.fn();
    await render(<RowButton {...again} disabled onPress={onPress} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(styleOf(button).opacity).toBe(tokens.opacity.disabled);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('when loading: a spinner replaces the chevron, busy, presses ignored', async () => {
    const onPress = jest.fn();
    await render(<RowButton {...again} loading onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'עוד סיבוב, מדורג · 2 שחקנים · רגיל, טוען' });
    expect(button).toBeBusy();
    expect(
      screen.queryByTestId('icon-chevronForward', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
    await userEvent.setup().press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows the selected chip state in gold', async () => {
    await render(<RowButton {...again} selected />);
    expect(screen.getByRole('button')).toBeSelected();
    expect(styleOf(screen.getByRole('button')).borderColor).toBe(color.accent);
    expect(screen.getByText('עוד סיבוב')).toHaveStyle({ color: color.accent });
  });

  it('lays out as a plain row that React Native mirrors, the same in RTL and LTR', async () => {
    const layouts: unknown[] = [];
    for (const rtl of [true, false]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      await render(<RowButton {...again} />);
      expect(styleOf(screen.getByRole('button')).flexDirection).toBe('row');
      expect(directionProblems(screen.container)).toEqual([]);
      layouts.push(hostStyles(screen.container));
      await screen.unmount();
    }
    expect(layouts[0]).toEqual(layouts[1]);
  });

  it('mirrors only the chevron, so it points forward in both languages', async () => {
    jest.replaceProperty(I18nManager, 'isRTL', false);
    await render(<RowButton {...again} />);
    expect(screen.getByTestId('icon-chevronForward', { includeHiddenElements: true })).toHaveStyle({
      transform: [{ scaleX: -1 }],
    });
  });
});
