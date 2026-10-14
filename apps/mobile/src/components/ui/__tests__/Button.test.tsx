import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { I18nManager, StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, size, tokens } from '../../../theme';
import { Button, LARGE_TEXT_SCALE } from '../Button';
import { directionProblems, hostStyles, PHONE, setWindow } from '../testing/layout';

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

describe('Button', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
  });

  it('renders the skewed gold primary with its label and presses', async () => {
    const onPress = jest.fn();
    await render(<Button label="שחק" size="hero" onPress={onPress} testID="play" />);
    const button = screen.getByRole('button', { name: 'שחק' });
    expect(button).toBeEnabled();
    expect(styleOf(button).height).toBe(size.ctaHero);
    // The hard shadow is a sibling view in accentShadow, 4 dp lower, skewed like the face.
    const shadow = screen.getByTestId('play-shadow');
    expect(styleOf(shadow)).toMatchObject({
      backgroundColor: color.accentShadow,
      top: tokens.elevation.cta.offsetY,
    });
    expect(styleOf(shadow).transform).toEqual([{ skewX: `${tokens.effects.skewXDeg}deg` }]);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['hero', size.ctaHero],
    ['lg', size.buttonLg],
    ['md', size.buttonMd],
    ['modal', size.buttonModal],
  ] as const)('primary %s is %i high', async (name, height) => {
    await render(<Button label="שחק" size={name} />);
    expect(styleOf(screen.getByRole('button'))).toMatchObject({ height });
  });

  describe('wrapLabel: a second line only at large system text sizes', () => {
    it.each([1, 1.1, LARGE_TEXT_SCALE - 0.01])(
      'at fontScale %d the label keeps to one line',
      async (fontScale) => {
        const restore = setWindow({ ...PHONE, fontScale });
        try {
          await render(<Button label="צור משתמש והיכנס לזירה" size="md" wrapLabel testID="go" />);
          expect(screen.getByTestId('go-label')).toHaveProp('numberOfLines', 1);
          expect(styleOf(screen.getByRole('button'))).toMatchObject({ height: size.buttonMd });
          expect(styleOf(screen.getByTestId('go-shadow'))).toMatchObject({ height: size.buttonMd });
        } finally {
          await restore();
        }
      },
    );

    it.each([LARGE_TEXT_SCALE, 1.5, 2])(
      'at fontScale %d it may wrap, and the button grows',
      async (fontScale) => {
        const restore = setWindow({ ...PHONE, fontScale });
        try {
          await render(<Button label="צור משתמש והיכנס לזירה" size="md" wrapLabel testID="go" />);
          const label = screen.getByTestId('go-label');
          expect(label).toHaveProp('numberOfLines', 2);
          expect(styleOf(label).flexShrink).toBe(1);
          const button = styleOf(screen.getByRole('button'));
          expect(button.height).toBeUndefined();
          expect(button.minHeight).toBe(size.buttonMd);
          // The shadow follows the face's height, 4 dp lower.
          expect(styleOf(screen.getByTestId('go-shadow'))).toMatchObject({
            top: tokens.elevation.cta.offsetY,
            bottom: -tokens.elevation.cta.offsetY,
          });
        } finally {
          await restore();
        }
      },
    );

    it('without it, a label stays on one line at any size, as before', async () => {
      const restore = setWindow({ ...PHONE, fontScale: 2 });
      try {
        await render(<Button label="שחק" size="hero" testID="play" />);
        expect(screen.getByTestId('play-label')).toHaveProp('numberOfLines', 1);
        expect(styleOf(screen.getByRole('button'))).toMatchObject({ height: size.ctaHero });
      } finally {
        await restore();
      }
    });
  });

  it('presses down and back with and without reduced motion', async () => {
    jest.useFakeTimers();
    try {
      for (const reduceMotion of ['off', 'on'] as const) {
        useSettings.setState({ reduceMotion });
        await render(<Button label="שחק" />);
        const button = screen.getByRole('button');
        await fireEvent(button, 'pressIn');
        await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.tapFeedbackMin));
        await fireEvent(button, 'pressOut');
        await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.tapFeedbackMax));
        expect(button).toBeOnTheScreen();
        await screen.unmount();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('when disabled: dimmed, no shadow, no press', async () => {
    const onPress = jest.fn();
    await render(<Button label="שחק" disabled onPress={onPress} testID="play" />);
    const button = screen.getByRole('button', { name: 'שחק' });
    expect(button).toBeDisabled();
    expect(styleOf(button).opacity).toBe(tokens.opacity.disabled);
    expect(screen.queryByTestId('play-shadow')).not.toBeOnTheScreen();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('when loading: busy, says so, and ignores presses', async () => {
    const onPress = jest.fn();
    await render(<Button label="שחק" loading onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'שחק, טוען' });
    expect(button).toBeBusy();
    await userEvent.setup().press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<Button label="Play" loading />);
    expect(screen.getByRole('button', { name: 'Play, loading' })).toBeBusy();
  });

  it('draws the secondary outline, flat, with a leading icon', async () => {
    const onPress = jest.fn();
    await render(
      <Button label="נסה שוב" variant="secondary" size="modal" icon="refresh" onPress={onPress} />,
    );
    const button = screen.getByRole('button', { name: 'נסה שוב' });
    expect(styleOf(button)).toMatchObject({ height: size.buttonModal, borderColor: color.border });
    expect(styleOf(button).transform).toBeUndefined();
    expect(screen.getByTestId('icon-refresh', { includeHiddenElements: true })).toBeOnTheScreen();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('marks a selected secondary chip', async () => {
    await render(<Button label="רגיל" variant="secondary" selected />);
    const button = screen.getByRole('button', { name: 'רגיל' });
    expect(button).toBeSelected();
    expect(styleOf(button).borderColor).toBe(color.accent);
  });

  it('draws the danger outline in red, never gold', async () => {
    const onPress = jest.fn();
    await render(<Button label="כן, להיכנע" variant="danger" size="lg" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'כן, להיכנע' });
    expect(styleOf(button)).toMatchObject({
      height: size.buttonLg,
      backgroundColor: color.dangerSubtle,
      borderColor: color.dangerBorder,
    });
    expect(screen.getByText('כן, להיכנע')).toHaveStyle({ color: color.danger });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws the ghost text button 44 high, with a spinner while loading', async () => {
    const onPress = jest.fn();
    await render(<Button label="ביטול בחירה" variant="ghost" icon="cancel" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'ביטול בחירה' });
    expect(styleOf(button).height).toBe(size.buttonGhost);
    expect(screen.getByText('ביטול בחירה')).toHaveStyle({ color: color.textMuted });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);

    await screen.rerender(<Button label="ביטול בחירה" variant="ghost" icon="cancel" disabled loading />);
    expect(screen.getByRole('button', { name: 'ביטול בחירה, טוען' })).toBeDisabled();
  });

  it('lets the caller override the spoken label', async () => {
    await render(<Button label="הכל" variant="ghost" accessibilityLabel="כל המשחקים האחרונים" />);
    expect(screen.getByRole('button', { name: 'כל המשחקים האחרונים' })).toBeOnTheScreen();
  });

  it('does not hard-code a direction: the same layout in RTL and LTR', async () => {
    const layouts: unknown[] = [];
    for (const rtl of [true, false]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      await render(
        <>
          <Button label="שחק" icon="bolt" />
          <Button label="נסה שוב" variant="secondary" icon="refresh" />
          <Button label="הכל" variant="ghost" />
          <Button label="כן, להיכנע" variant="danger" />
        </>,
      );
      expect(directionProblems(screen.container)).toEqual([]);
      layouts.push(hostStyles(screen.container));
      await screen.unmount();
    }
    expect(layouts[0]).toEqual(layouts[1]);
  });
});
