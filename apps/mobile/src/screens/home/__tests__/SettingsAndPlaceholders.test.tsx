// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { ENGINE_VERSION } from '@sudoku-fight/engine';
import Storage from 'expo-sqlite/kv-store';
import { act, fireEvent, screen } from 'expo-router/testing-library';

import { ltr } from '../../../components/player';
import { directionProblems } from '../../../components/ui/testing/layout';
import { practiceStorageOrNull } from '../../../game/storage';
import i18n from '../../../i18n';
import { haptics as hapticsService } from '../../../services/haptics';
import { useSettings } from '../../../state/settings';
import { useTestingSwitches } from '../../../state/testingSwitches';
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

  it('changes the language once the restart is confirmed (the root layout then restarts the app)', async () => {
    await renderApp('/settings');
    expect(screen.getByText('החלפת שפה מפעילה מחדש את האפליקציה.')).toBeTruthy();
    // The picker (localization plan 0י): a field, then a sheet with "שפת המכשיר" and this build's languages.
    await fireEvent.press(screen.getByRole('button', { name: 'שפה: עברית' }));
    expect((await screen.findAllByRole('radio', { name: /^(שפת המכשיר|עברית|English)$/ })).length).toBe(3);
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(useSettings.getState().language).toBe('he');
    expect(await screen.findByText('להחליף את השפה ל־English?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'החלפה והפעלה מחדש' }));
    expect(useSettings.getState().language).toBe('en');
  });

  it('shows the version, then the build, the server and the engine (Moshe: "I can see it in the app")', async () => {
    const version = { version: '1.0.1', build: 'a1b2c3d', server: 'staging' };
    await renderApp('/settings', { settings: () => <SettingsScreen version={version} /> });
    expect(screen.getByTestId('app-version-version')).toHaveTextContent(`גרסה ${ltr('1.0.1')}`);
    expect(screen.getByTestId('app-version-details')).toHaveTextContent(
      ltr(`build a1b2c3d · staging · מנוע ${ENGINE_VERSION}`),
    );
    expect(screen.getByTestId('app-version')).toHaveProp(
      'accessibilityLabel',
      `גרסה ${ltr('1.0.1')}, build a1b2c3d · staging · מנוע ${ENGINE_VERSION}`,
    );
  });

  it('a build that did not say its commit (Metro, EAS) shows the server alone', async () => {
    const version = { version: '1.0.0', build: null, server: 'production' };
    await renderApp('/settings', { settings: () => <SettingsScreen version={version} /> });
    expect(screen.getByTestId('app-version-details')).toHaveTextContent(
      ltr(`production · מנוע ${ENGINE_VERSION}`),
    );
  });

  it('no version known: no lines', async () => {
    await renderApp('/settings', { settings: () => <SettingsScreen version={null} /> });
    expect(screen.queryByTestId('app-version')).toBeNull();
  });

  it('a staging build: "בדיקה" with the chain switch and "פתח את כל השלבים", kept on the phone', async () => {
    useTestingSwitches.setState({ chainPenalty: false, unlockAllLevels: false });
    try {
      const staging = { server: 'staging', dev: false };
      await renderApp('/settings', { settings: () => <SettingsScreen build={staging} /> });
      expect(screen.getByTestId('settings-testing')).toBeTruthy();
      expect(screen.getByText('רק בגרסת הבדיקה (staging). בגרסה לחנות אין את זה.')).toBeTruthy();
      const chain = screen.getByRole('switch', { name: 'שרשרת: ניחוש עולה 5 ש׳' });
      expect(chain).toHaveProp('accessibilityState', { checked: false });
      await fireEvent.press(chain);
      expect(useTestingSwitches.getState().chainPenalty).toBe(true);
      expect(screen.getByRole('switch', { name: 'שרשרת: ניחוש עולה 5 ש׳' })).toHaveProp(
        'accessibilityState',
        {
          checked: true,
        },
      );
      await fireEvent.press(screen.getByRole('switch', { name: 'פתח את כל השלבים (בדיקה)' }));
      expect(useTestingSwitches.getState().unlockAllLevels).toBe(true);
      // Kept on the phone, apart from the player's settings.
      expect(JSON.parse(Storage.getItemSync('testing-switches')!)).toMatchObject({
        state: { chainPenalty: true, unlockAllLevels: true },
      });
      expect(Storage.getItemSync('settings') ?? '').not.toContain('chainPenalty');
    } finally {
      await act(async () => useTestingSwitches.setState({ chainPenalty: false, unlockAllLevels: false }));
    }
  });

  it('a production build never shows "בדיקה" (a development build pointed at production neither)', async () => {
    for (const build of [
      { server: 'production', dev: false },
      { server: 'production', dev: true },
    ]) {
      await renderApp('/settings', { settings: () => <SettingsScreen build={build} /> });
      expect(screen.queryByTestId('settings-testing')).toBeNull();
      expect(screen.queryByRole('switch', { name: 'שרשרת: ניחוש עולה 5 ש׳' })).toBeNull();
      await screen.unmount();
    }
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
    await fireEvent.press(screen.getByRole('button', { name: 'Language: עברית' }));
    expect(await screen.findByRole('radio', { name: 'Device language' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'עברית' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'English' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    // A development build (not on production) has the testing switches too.
    expect(screen.getByRole('switch', { name: 'Chain: a guess costs 5 s' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Unlock all stages (testing)' })).toBeTruthy();
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
