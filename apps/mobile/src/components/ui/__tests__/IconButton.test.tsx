import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { I18nManager, StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { color, size, tokens } from '../../../theme';
import { IconButton } from '../IconButton';
import { directionProblems, hostStyles } from '../testing/layout';

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

describe('IconButton', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('is a 44×44 outlined button named by its label', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="settings" accessibilityLabel="הגדרות" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'הגדרות' });
    expect(styleOf(button)).toMatchObject({
      width: size.iconButton,
      height: size.iconButton,
      borderColor: color.border,
      borderWidth: tokens.border.hairline,
    });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws the icon at 20 in a card and 22 in a header', async () => {
    await render(
      <>
        <IconButton icon="surrender" accessibilityLabel="כניעה" />
        <IconButton icon="settings" accessibilityLabel="הגדרות" iconSize="header" />
      </>,
    );
    expect(screen.getByTestId('icon-surrender', { includeHiddenElements: true })).toHaveProp(
      'width',
      size.icon.card,
    );
    expect(screen.getByTestId('icon-settings', { includeHiddenElements: true })).toHaveProp(
      'width',
      size.icon.header,
    );
  });

  it('shows the open state of the reactions picker', async () => {
    await render(<IconButton icon="reactions" accessibilityLabel="תגובות" expanded />);
    const button = screen.getByRole('button', { name: 'תגובות' });
    expect(button).toBeExpanded();
    expect(styleOf(button)).toMatchObject({ backgroundColor: color.surface2, borderColor: color.textMuted });
  });

  it('only reports expanded when it controls something', async () => {
    await render(<IconButton icon="settings" accessibilityLabel="הגדרות" />);
    const button = screen.getByRole('button');
    expect(button).not.toBeExpanded();
    expect(button).not.toBeCollapsed();
  });

  it('when disabled: dimmed and does not press', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="reactions" accessibilityLabel="תגובות" disabled onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'תגובות' });
    expect(button).toBeDisabled();
    expect(styleOf(button).opacity).toBe(tokens.opacity.disabled);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('when loading: busy, says so, and ignores presses', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="settings" accessibilityLabel="הגדרות" loading onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'הגדרות, טוען' });
    expect(button).toBeBusy();
    expect(screen.queryByTestId('icon-settings', { includeHiddenElements: true })).not.toBeOnTheScreen();
    await userEvent.setup().press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not hard-code a direction', async () => {
    const layouts: unknown[] = [];
    for (const rtl of [true, false]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      await render(<IconButton icon="close" accessibilityLabel="סגירה" />);
      expect(directionProblems(screen.container)).toEqual([]);
      layouts.push(hostStyles(screen.container));
      await screen.unmount();
    }
    expect(layouts[0]).toEqual(layouts[1]);
  });
});
