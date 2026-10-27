// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { act, fireEvent, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { directionProblems } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { registerPseudoLanguages } from '../../../i18n/pseudoLanguages';
import { useSettings } from '../../../state/settings';
import { SettingsScreen } from '../SettingsScreen';
import { renderApp } from '../testing/homeTesting';

/**
 * Settings → "בדיקה", the localization part (plan 0יג): "שפה מדומה" (ללא, en-XA, ar-XB), chosen the way
 * the language picker chooses (it asks, since the app restarts, D104), and "ריבוי ומספרים", the plural check
 * screen. In development and staging builds only; a production build never shows them.
 */

type Mocks = typeof import('../testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../game/storage', () => jest.requireActual<Mocks>('../testing/nativeMocks').practiceStorage);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoHaptics);

registerPseudoLanguages();

const STAGING = { server: 'staging', dev: false };
const settings = (build = STAGING) => ({
  settings: () => <SettingsScreen build={build} version={null} />,
  'dev/plurals': () => <Text testID="stub-plurals">plurals</Text>,
});

/** A dialog's way in and out is over. */
const settle = () => act(async () => void jest.advanceTimersByTime(1000));

beforeEach(async () => {
  useSettings.setState({ language: 'he', languageSource: 'app', reduceMotion: 'on' });
  await i18n.changeLanguage('he');
});

afterAll(async () => {
  useSettings.setState({ language: 'he', languageSource: 'app' });
  await i18n.changeLanguage('he');
});

describe('Settings → בדיקה: the pseudo languages (plan 0יג)', () => {
  it('a staging build: "שפה מדומה" with none, en-XA and ar-XB, and "ריבוי ומספרים"', async () => {
    await renderApp('/settings', settings());
    expect(screen.getByTestId('settings-pseudo')).toBeOnTheScreen();
    expect(screen.getByText('שפה מדומה')).toBeOnTheScreen();
    expect(screen.getByTestId('setting-pseudo')).toHaveProp('accessibilityLabel', 'שפה מדומה');
    expect(['ללא', 'en-XA', 'ar-XB'].map((name) => screen.getByRole('radio', { name }))).toHaveLength(3);
    // Hebrew is an explicit choice here: none of the three is checked.
    for (const name of ['ללא', 'en-XA', 'ar-XB'])
      expect(screen.getByRole('radio', { name })).toHaveProp('accessibilityState', { checked: false });
    expect(screen.getByRole('button', { name: 'ריבוי ומספרים' })).toBeOnTheScreen();
    expect(directionProblems(screen.getByTestId('settings-pseudo'))).toEqual([]);
  });

  it('a production build never shows them (a development build pointed at production neither)', async () => {
    for (const build of [
      { server: 'production', dev: false },
      { server: 'production', dev: true },
    ]) {
      await renderApp('/settings', settings(build));
      expect(screen.queryByTestId('settings-pseudo')).toBeNull();
      expect(screen.queryByRole('button', { name: 'ריבוי ומספרים' })).toBeNull();
      await screen.unmount();
    }
  });

  it('en-XA asks first, as the language picker does; the confirm saves it as the app’s choice', async () => {
    await renderApp('/settings', settings());
    await fireEvent.press(screen.getByRole('radio', { name: 'en-XA' }));
    expect(useSettings.getState().language).toBe('he');
    await settle();
    expect(screen.getByText('להחליף את השפה ל־en-XA?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'החלפה והפעלה מחדש' }));
    expect(useSettings.getState()).toMatchObject({ language: 'en-XA', languageSource: 'app' });
    await settle();
    expect(screen.getByRole('radio', { name: 'en-XA' })).toHaveProp('accessibilityState', { checked: true });
  });

  it('"ביטול" changes nothing', async () => {
    await renderApp('/settings', settings());
    await fireEvent.press(screen.getByRole('radio', { name: 'ar-XB' }));
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'ביטול' }));
    await settle();
    expect(useSettings.getState().language).toBe('he');
  });

  it('"ריבוי ומספרים" opens the plural check screen', async () => {
    const app = await renderApp('/settings', settings());
    await fireEvent.press(screen.getByRole('button', { name: 'ריבוי ומספרים' }));
    expect(app.pathname()).toBe('/dev/plurals');
    expect(screen.getByTestId('stub-plurals')).toBeOnTheScreen();
  });
});
