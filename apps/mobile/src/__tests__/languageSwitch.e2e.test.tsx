// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import Storage from 'expo-sqlite/kv-store';
import * as Updates from 'expo-updates';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { I18nManager, Text } from 'react-native';

import RootLayout from '../../app/_layout';
import Index from '../../app/index';
import SettingsRoute from '../../app/settings';
import { setAuthDeps } from '../auth/authStore';
import { installSignedInPlayer } from '../auth/testing/testAuth';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { useSettings } from '../state/settings';

/**
 * Work plan stage 13, "השלמת מסך ההגדרות: החלפת שפה (עם reload)", end to end through the root layout, with the
 * language picker of localization plan 0י: Settings → the language field → its sheet ("שפת המכשיר", עברית,
 * English) → "English" asks first (the app restarts for it, D104); "ביטול" changes nothing; the confirm saves
 * the language as the player's choice (on disk before the restart), switches i18next, forces LTR and reloads the
 * app (expo-updates). The next run starts in English, LTR, without another restart; and back to Hebrew, RTL.
 * "שפת המכשיר" on an English phone is English: from Hebrew it asks, restarts, and is saved as 'system'.
 */

const mockApp: { db: SqlJsDb | null } = { db: null };

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockApp.db }));
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
type NativeMocks = typeof import('../screens/home/testing/nativeMocks');
jest.mock(
  'expo-audio',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoAudio,
);
jest.mock(
  'expo-haptics',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoHaptics,
);

jest.setTimeout(60_000);

const ROUTES = {
  _layout: RootLayout,
  index: Index,
  settings: SettingsRoute,
  modes: () => <Text>modes</Text>,
};

/** What was on disk when the app asked to restart. */
let savedAtReload: string[] = [];
const reload = jest.mocked(Updates.reloadAsync);
const savedLanguage = () =>
  (JSON.parse(Storage.getItemSync('settings') ?? '{}') as { state?: { language?: string } }).state?.language;

/** Opens the language sheet from its field (named "שפה: עברית", "Language: English", …) and taps a language. */
async function pick(field: string, language: string) {
  await fireEvent.press(screen.getByRole('button', { name: field }));
  await fireEvent.press(await screen.findByRole('radio', { name: language }));
}

/** A run of the app on a phone whose layout direction is `rtl`, opened on Settings. */
async function launch(rtl: boolean) {
  jest.replaceProperty(I18nManager, 'isRTL', rtl);
  const app = renderRouter(ROUTES, { initialUrl: '/settings' });
  const rendered = await app;
  await waitFor(() => expect(screen.getByTestId('setting-language')).toBeOnTheScreen());
  await waitFor(() => expect(screen.queryByTestId('splash')).toBeNull());
  return rendered;
}

beforeAll(async () => {
  mockApp.db = await memoryDb();
});

beforeEach(async () => {
  await installSignedInPlayer();
  await i18n.changeLanguage('he');
  useSettings.setState({
    language: 'he',
    languageSource: 'app',
    appLocalesSeen: null,
    systemLocaleSeen: null,
    reduceMotion: 'on',
    sound: true,
    haptics: true,
  });
  savedAtReload = [];
  reload.mockReset().mockImplementation(async () => {
    savedAtReload.push(savedLanguage() ?? '');
  });
  jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
  jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
});

afterEach(() => {
  setAuthDeps(null);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('switching the language (work plan stage 13)', () => {
  it('asks first; "ביטול" keeps Hebrew and nothing restarts', async () => {
    await launch(true);
    expect(reload).not.toHaveBeenCalled();

    await pick('שפה: עברית', 'English');
    expect(await screen.findByText('להחליף את השפה ל־English?')).toBeOnTheScreen();
    expect(screen.getByTestId('language-confirm')).toBeOnTheScreen();
    expect(
      screen.getByText('האפליקציה תופעל מחדש, כדי שכל המסכים יוצגו בכיוון של השפה החדשה.'),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'ביטול' }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(useSettings.getState().language).toBe('he');
    expect(screen.getByRole('button', { name: 'שפה: עברית' })).toBeOnTheScreen();
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('the confirm saves English, forces LTR and restarts; the next run is English without a restart', async () => {
    const first = await launch(true);
    await pick('שפה: עברית', 'English');
    await fireEvent.press(await screen.findByRole('button', { name: 'החלפה והפעלה מחדש' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(useSettings.getState()).toMatchObject({ language: 'en', languageSource: 'app' });
    expect(i18n.language).toBe('en');
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    // Saved before the restart: the next run reads English.
    expect(savedAtReload).toEqual(['en']);

    // The restart: a new run, the layout now LTR, the settings read from disk.
    await first.unmount();
    reload.mockClear();
    jest.mocked(I18nManager.forceRTL).mockClear();
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().language).toBe('en');

    await launch(false);
    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Language: English' }));
    expect(await screen.findByRole('radio', { name: 'English' })).toHaveProp('accessibilityState', {
      checked: true,
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    // And back to Hebrew: the prompt in English, then RTL and a restart.
    await pick('Language: English', 'עברית');
    expect(await screen.findByText('Switch the language to עברית?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Switch and restart' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(savedAtReload).toEqual(['en', 'he']);
  });
  it('"שפת המכשיר" on an English phone: asks, restarts in English, and is saved as following the phone', async () => {
    await launch(true);
    await pick('שפה: עברית', 'שפת המכשיר');
    expect(await screen.findByText('לעבור לשפת המכשיר?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'החלפה והפעלה מחדש' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(useSettings.getState()).toMatchObject({ language: 'system', languageSource: 'app' });
    expect(i18n.language).toBe('en');
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(savedAtReload).toEqual(['system']);
  });
});
