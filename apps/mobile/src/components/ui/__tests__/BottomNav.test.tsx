import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { I18nManager, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '../../../i18n';
import { color, size } from '../../../theme';
import { BottomNav, NAV_TABS } from '../BottomNav';
import { directionProblems, hostStyles } from '../testing/layout';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

const metrics = (bottom: number) => ({
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom, left: 0, right: 0 },
});

describe('BottomNav', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('is a labelled tab list with the four tabs in order', async () => {
    await render(<BottomNav active="home" onSelect={jest.fn()} />);
    // The list itself is not one accessibility element (that would hide its tabs on iOS), so it is found by
    // its label, and its role is checked as a prop.
    const list = screen.getByLabelText('ניווט ראשי');
    expect(list).toHaveProp('accessibilityRole', 'tablist');
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      'בית',
      'טבלת מובילים',
      'היסטוריה',
      'הישגים',
    ]);
    expect(NAV_TABS.map((t) => t.key)).toEqual(['home', 'leaderboard', 'history', 'achievements']);
  });

  it.each(NAV_TABS.map((t) => t.key))('marks %s as the selected tab, in gold', async (key) => {
    await render(<BottomNav active={key} onSelect={jest.fn()} testID="nav" />);
    for (const tab of NAV_TABS) {
      const el = screen.getByTestId(`nav-${tab.key}`);
      if (tab.key === key) {
        expect(el).toBeSelected();
        expect(within(el).getByText(/./)).toHaveStyle({ color: color.nav.active });
      } else {
        expect(el).not.toBeSelected();
        expect(within(el).getByText(/./)).toHaveStyle({ color: color.nav.inactive });
      }
    }
  });

  it('reports the pressed tab', async () => {
    const onSelect = jest.fn();
    await render(<BottomNav active="home" onSelect={onSelect} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'היסטוריה' }));
    expect(onSelect).toHaveBeenCalledWith('history');
  });

  it('is 64 high plus the real bottom safe area', async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics(34)}>
        <BottomNav active="home" onSelect={jest.fn()} />
      </SafeAreaProvider>,
    );
    expect(styleOf(screen.getByLabelText('ניווט ראשי'))).toMatchObject({
      height: size.navBar - size.navBarBottomInset + 34,
      paddingBottom: 34,
    });
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<BottomNav active="leaderboard" onSelect={jest.fn()} />);
    expect(screen.getByLabelText('Main navigation')).toHaveProp('accessibilityRole', 'tablist');
    expect(screen.getByRole('tab', { name: 'Leaderboard' })).toBeSelected();
  });

  it('is a plain row (mirrored by React Native), the same in RTL and LTR', async () => {
    const layouts: unknown[] = [];
    for (const rtl of [true, false]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      await render(<BottomNav active="home" onSelect={jest.fn()} />);
      expect(styleOf(screen.getByLabelText('ניווט ראשי')).flexDirection).toBe('row');
      expect(directionProblems(screen.container)).toEqual([]);
      layouts.push(hostStyles(screen.container));
      await screen.unmount();
    }
    expect(layouts[0]).toEqual(layouts[1]);
  });
});
