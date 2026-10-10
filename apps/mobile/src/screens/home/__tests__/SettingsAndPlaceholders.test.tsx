// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { ENGINE_VERSION } from '@sudoku-fight/engine';
import { fireEvent, screen } from 'expo-router/testing-library';

import { directionProblems } from '../../../components/ui/testing/layout';
import { practiceStorageOrNull } from '../../../game/storage';
import i18n from '../../../i18n';
import { haptics as hapticsService } from '../../../services/haptics';
import { useSettings } from '../../../state/settings';
import { PlaceholderScreen } from '../PlaceholderScreen';
import { SettingsScreen } from '../SettingsScreen';
import { renderApp } from '../testing/homeTesting';

type Mocks = typeof import('../testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../game/storage', () => jest.requireActual<Mocks>('../testing/nativeMocks').practiceStorage);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoHaptics);

const haptics = jest.requireMock<{ selectionAsync: jest.Mock }>('expo-haptics');

beforeEach(async () => {
  jest.useRealTimers();
  jest.mocked(practiceStorageOrNull).mockImplementation(async () => null);
  useSettings.setState({ sound: true, haptics: true, reduceMotion: 'system', language: 'he' });
  haptics.selectionAsync.mockClear();
  await i18n.changeLanguage('he');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('settings (spec §4.1)', () => {
  it('switches sound and haptics in the persisted store', async () => {
    await renderApp('/settings');
    expect(screen.getByRole('header', { name: 'הגדרות' })).toBeTruthy();
    const sound = screen.getByRole('switch', { name: 'צליל' });
    expect(sound).toHaveProp('accessibilityState', { checked: true });

    await fireEvent.press(sound);
    expect(useSettings.getState().sound).toBe(false);
    expect(screen.getByRole('switch', { name: 'צליל' })).toHaveProp('accessibilityState', { checked: false });

    await fireEvent.press(screen.getByRole('switch', { name: 'רטט' }));
    expect(useSettings.getState().haptics).toBe(false);
    // The toggle cue follows the new setting: turning haptics off is not felt, turning them on is. (The reset
    // lifts the service's 80 ms gap after the sound switch's tick.)
    await Promise.resolve();
    hapticsService.reset();
    haptics.selectionAsync.mockClear();
    await fireEvent.press(screen.getByRole('switch', { name: 'רטט' }));
    expect(useSettings.getState().haptics).toBe(true);
    await Promise.resolve();
    expect(haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(directionProblems(screen.getByTestId('setting-sound'))).toEqual([]);
  });

  it('chooses reduced motion: like the device, on or off', async () => {
    await renderApp('/settings');
    const group = screen.getByTestId('setting-motion');
    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(screen.getByRole('radio', { name: 'כמו במכשיר' })).toHaveProp('accessibilityState', {
      checked: true,
    });
    await fireEvent.press(screen.getByRole('radio', { name: 'מופעלת' }));
    expect(useSettings.getState().reduceMotion).toBe('on');
    await fireEvent.press(screen.getByRole('radio', { name: 'כבויה' }));
    expect(useSettings.getState().reduceMotion).toBe('off');
    expect(screen.getByRole('radio', { name: 'כבויה' })).toHaveProp('accessibilityState', { checked: true });
  });

  it('changes the language (the root layout then restarts the app for the new direction)', async () => {
    await renderApp('/settings');
    expect(screen.getByText('החלפת שפה מפעילה מחדש את האפליקציה.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(useSettings.getState().language).toBe('en');
  });

  it('shows the app and engine versions', async () => {
    await renderApp('/settings', { settings: () => <SettingsScreen version="1.2.3" /> });
    expect(screen.getByTestId('app-version')).toHaveTextContent(`גרסה 1.2.3 · מנוע ${ENGINE_VERSION}`);
  });

  it('goes back to where it was opened from', async () => {
    const app = await renderApp('/');
    await fireEvent.press(screen.getByRole('button', { name: 'הגדרות' }));
    expect(app.pathname()).toBe('/settings');
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    expect(app.pathname()).toBe('/');
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/settings');
    expect(screen.getByRole('header', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Sound' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Haptics' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Like the device' })).toBeTruthy();
    // Each language is named in itself.
    expect(screen.getByRole('radio', { name: 'עברית' })).toBeTruthy();
  });
});

describe('the stage-12 tabs (routes)', () => {
  it('/leaderboard: its title and the navigation with its tab on; signed out, it says so', async () => {
    await renderApp('/leaderboard');
    expect(screen.getByTestId('leaderboard')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'טבלת מובילים' })).toBeTruthy();
    expect(await screen.findByText('צריך להתחבר כדי לראות את זה')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'טבלת מובילים', selected: true })).toBeTruthy();
  });

  it('/achievements: progress, "בקרוב" for the achievements, and the navigation with its tab on', async () => {
    await renderApp('/achievements');
    expect(screen.getByTestId('progress')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'הישגים והתקדמות' })).toBeTruthy();
    expect(screen.getByText('בקרוב')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'הישגים' })).toHaveProp('accessibilityState', { selected: true });
  });

  it('the placeholder of a tab still to come: a title, "בקרוב" and the navigation', async () => {
    await renderApp('/history', { history: () => <PlaceholderScreen tab="history" /> });
    expect(screen.getByTestId('placeholder-history')).toBeTruthy();
    expect(screen.getByText('בקרוב')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'היסטוריה' })).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('speak English too', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/leaderboard');
    expect(screen.getByRole('header', { name: 'Leaderboard' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Friends' })).toBeTruthy();
  });
});
