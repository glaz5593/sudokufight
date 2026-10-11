// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { fireEvent, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import LicensesRoute from '../../../../app/licenses';
import { httpBaseUrl } from '../../../config/server';
import { practiceStorageOrNull } from '../../../game/storage';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { renderApp } from '../../home/testing/homeTesting';

/**
 * Work plan stage 14 (spec §23): Settings → "מידע ומשפטי": the privacy policy and the terms of use open in
 * the browser, from the game server, in the app's language; "רישיונות" opens the licenses screen.
 */

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock(
  '../../../game/storage',
  () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').practiceStorage,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);

let openURL: jest.SpyInstance;

beforeEach(async () => {
  jest.useRealTimers();
  jest.mocked(practiceStorageOrNull).mockImplementation(async () => null);
  useSettings.setState({ sound: true, haptics: true, reduceMotion: 'system', language: 'he' });
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await i18n.changeLanguage('he');
});

afterEach(() => {
  openURL.mockRestore();
  jest.useRealTimers();
});

describe('settings: about and legal', () => {
  it('opens the privacy policy and the terms of use from the game server, in Hebrew', async () => {
    await renderApp('/settings');
    expect(screen.getByRole('header', { name: 'מידע ומשפטי' })).toBeTruthy();
    const privacy = screen.getByRole('button', { name: 'מדיניות פרטיות' });
    expect(privacy).toHaveProp('accessibilityHint', 'נפתח בדפדפן');
    await fireEvent.press(privacy);
    expect(openURL).toHaveBeenLastCalledWith(`${httpBaseUrl()}/legal/privacy?lang=he`);
    await fireEvent.press(screen.getByRole('button', { name: 'תנאי שימוש' }));
    expect(openURL).toHaveBeenLastCalledWith(`${httpBaseUrl()}/legal/terms?lang=he`);
  });

  it('in English, the English pages', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/settings');
    await fireEvent.press(screen.getByRole('button', { name: 'Privacy policy' }));
    expect(openURL).toHaveBeenLastCalledWith(`${httpBaseUrl()}/legal/privacy?lang=en`);
    await fireEvent.press(screen.getByRole('button', { name: 'Terms of use' }));
    expect(openURL).toHaveBeenLastCalledWith(`${httpBaseUrl()}/legal/terms?lang=en`);
  });

  it('a failure to open the browser is not an error', async () => {
    openURL.mockRejectedValue(new Error('no browser'));
    await renderApp('/settings');
    await fireEvent.press(screen.getByRole('button', { name: 'מדיניות פרטיות' }));
    expect(openURL).toHaveBeenCalledTimes(1);
  });

  it('"רישיונות" opens the licenses screen, and back returns to the settings', async () => {
    const app = await renderApp('/settings', { licenses: LicensesRoute });
    await fireEvent.press(screen.getByRole('button', { name: 'רישיונות' }));
    expect(app.pathname()).toBe('/licenses');
    expect(screen.getByRole('header', { name: 'רישיונות' })).toBeTruthy();
    expect(screen.getByTestId('font-Rubik')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    expect(app.pathname()).toBe('/settings');
  });
});
