import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { DS_SECTIONS } from '../components/dev';
import i18n from '../i18n';
import { DesignSystemScreen } from '../screens/DesignSystemScreen';
import { useSettings } from '../state/settings';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

// The whole design system renders twice in some tests: about 2.5 s alone, near 5 s under the full parallel run.
jest.setTimeout(30_000);

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

/** The cell buttons of a board, in the order they are laid out (row A from the left, box by box). */
const cellOrder = () =>
  within(screen.getByTestId('ds-board'))
    .getAllByRole('button')
    .map((b) => String(b.props.testID));

describe('DesignSystemScreen (/dev/design-system)', () => {
  beforeEach(() => {
    useSettings.setState({ reduceMotion: 'off', language: 'he' });
  });

  it.each([
    ['he', 'מערכת עיצוב', 'לוח'],
    ['en', 'Design system', 'Board'],
  ] as const)(
    'renders every section in %s, with the board and keypad left to right',
    async (lng, title, board) => {
      await i18n.changeLanguage(lng);
      await render(<DesignSystemScreen onClose={jest.fn()} />);

      expect(screen.getAllByRole('header', { name: title }).length).toBeGreaterThan(0);
      for (const { key } of DS_SECTIONS) expect(screen.getByTestId(`section-${key}`)).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: board })).toBeOnTheScreen();

      // The board, its wrapper and the keypads are LTR whatever the language (CLAUDE.md, spec §22).
      const grid = screen.getByTestId('ds-board');
      expect(styleOf(grid).direction).toBe('ltr');
      expect(styleOf(grid.parent!).direction).toBe('ltr');
      for (const id of ['ds-keypad', 'keypad-armed', 'keypad-idle'])
        expect(styleOf(screen.getByTestId(id)).direction).toBe('ltr');
      expect(within(grid).getAllByRole('button')).toHaveLength(81);
    },
  );

  it('lays the board out identically in Hebrew and English', async () => {
    await i18n.changeLanguage('he');
    const view = await render(<DesignSystemScreen />);
    const he = cellOrder();
    await view.unmount();
    await i18n.changeLanguage('en');
    await render(<DesignSystemScreen />);
    expect(cellOrder()).toEqual(he);
    expect(he.slice(0, 3)).toEqual(['cell-A1', 'cell-A2', 'cell-A3']);
  });

  it('switches the language and reduced motion from the header', async () => {
    await i18n.changeLanguage('he');
    await render(<DesignSystemScreen />);
    await fireEvent(screen.getByTestId('switch-language'), 'valueChange', true);
    expect(useSettings.getState().language).toBe('en');
    await fireEvent(screen.getByTestId('switch-reduce-motion'), 'valueChange', true);
    expect(useSettings.getState().reduceMotion).toBe('on');
    expect(screen.getByTestId('switch-reduce-motion').props.value).toBe(true);
    await fireEvent(screen.getByTestId('switch-reduce-motion'), 'valueChange', false);
    expect(useSettings.getState().reduceMotion).toBe('off');
  });

  it('closes through the route, and only offers close when it can', async () => {
    await i18n.changeLanguage('he');
    const onClose = jest.fn();
    const view = await render(<DesignSystemScreen onClose={onClose} />);
    await fireEvent.press(screen.getByRole('button', { name: 'סגירה' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
    await render(<DesignSystemScreen />);
    expect(screen.queryByRole('button', { name: 'סגירה' })).toBeNull();
  });

  it('jumps to a section from the index', async () => {
    await i18n.changeLanguage('he');
    await render(<DesignSystemScreen />);
    for (const { key } of DS_SECTIONS) expect(screen.getByTestId(`jump-${key}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'מעבר אל לוח' }));
  });
});
