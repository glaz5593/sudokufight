import { act, render } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import Storage from 'expo-sqlite/kv-store';
import * as Updates from 'expo-updates';
import { AppState, type AppStateStatus, I18nManager } from 'react-native';

import { I18N_CONFIG } from '../../config/i18n';
import { setAppLocales } from '../../services/appLocale';
import { DIRECTION_RESTART_KEY } from '../../services/restart';
import { languagePrefs, useSettings } from '../../state/settings';
import i18n from '../index';
import { type LanguagePrefs, readSystemLanguage, type SystemLanguageReport } from '../languageRules';
import {
  chooseLanguage,
  predictLanguage,
  syncLanguageWithSystem,
  useLanguageLifecycle,
} from '../languageSync';

/**
 * The language at work (localization plan 0א; D102–D104, 6.1 #16): the direction at launch, a restart on every
 * change while running (D104), the system's word on every return to the foreground (a language chosen in the
 * system settings wins; "שפת המכשיר" follows the phone), and the picker's choice written to Android 13+'s
 * per-app languages, where our own write never counts as the player's.
 */

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));
jest.mock('../../services/appLocale', () => ({
  getAppLocales: jest.fn(() => null),
  setAppLocales: jest.fn(),
  isAppLocaleSupported: jest.fn(() => false),
}));
jest.mock('../languageRules', () => {
  const actual = jest.requireActual<typeof import('../languageRules')>('../languageRules');
  return { ...actual, readSystemLanguage: jest.fn(actual.readSystemLanguage) };
});

const reload = jest.mocked(Updates.reloadAsync);
const system = jest.mocked(readSystemLanguage);
const writeAppLocales = jest.mocked(setAppLocales);
const phone = (tag: string) =>
  jest.mocked(getLocales).mockReturnValue([{ languageTag: tag }] as unknown as ReturnType<typeof getLocales>);

let foreground: ((state: AppStateStatus) => void)[] = [];

function Probe() {
  useLanguageLifecycle();
  return null;
}

/** A run of the app whose layout is `rtl`, with these settings. */
async function launch(rtl: boolean, settings: Partial<LanguagePrefs>) {
  jest.replaceProperty(I18nManager, 'isRTL', rtl);
  useSettings.setState({
    languageSource: 'app',
    appLocalesSeen: null,
    systemLocaleSeen: null,
    ...settings,
  });
  await i18n.changeLanguage(syncLanguageWithSystem());
  return render(<Probe />);
}

/** Back from another app (the system settings). */
const comeBack = () => act(async () => foreground.forEach((listener) => listener('active')));

beforeEach(() => {
  phone('en-US');
  reload.mockReset().mockResolvedValue(undefined as never);
  writeAppLocales.mockClear();
  Storage.setItemSync(DIRECTION_RESTART_KEY, '');
  foreground = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'change') foreground.push(listener as (state: AppStateStatus) => void);
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
  jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  system.mockImplementation(
    jest.requireActual<typeof import('../languageRules')>('../languageRules').readSystemLanguage,
  );
});

describe('at launch', () => {
  it('the right direction: nothing restarts', async () => {
    await launch(false, { language: 'en' });
    expect(i18n.language).toBe('en');
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a direction React Native did not start with restarts once; still wrong after it, not again', async () => {
    const first = await launch(false, { language: 'he' });
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
    await first.unmount();
    // The next run came up LTR again (iOS can reset it): no second restart in a row.
    await launch(false, { language: 'he' });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('a change while running (D104)', () => {
  it('restarts, also when the direction stays', async () => {
    await launch(false, { language: 'en' });
    await act(async () => useSettings.getState().setLanguage('en-XA'));
    expect(i18n.language).toBe('en-XA');
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('with restartOnEveryChange off, only a direction flip restarts', async () => {
    jest.replaceProperty(I18N_CONFIG, 'restartOnEveryChange', false);
    await launch(false, { language: 'en' });
    await act(async () => useSettings.getState().setLanguage('en-XA'));
    expect(i18n.language).toBe('en-XA');
    expect(reload).not.toHaveBeenCalled();
    await act(async () => useSettings.getState().setLanguage('he'));
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a direction that did not take (the guard) still restarts for the new language (D104)', async () => {
    // Hebrew came up LTR after a restart for it: the guard gave up on RTL.
    Storage.setItemSync(DIRECTION_RESTART_KEY, 'rtl!');
    await launch(false, { language: 'en' });
    await act(async () => useSettings.getState().setLanguage('he'));
    expect(i18n.language).toBe('he');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a setting that keeps the language ("עברית" while "שפת המכשיר" is Hebrew) restarts nothing', async () => {
    phone('he-IL');
    await launch(true, { language: 'system' });
    expect(i18n.language).toBe('he');
    await act(async () => useSettings.getState().setLanguage('he'));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('back to the foreground: the system settings win (doc 5.5)', () => {
  it('iOS: another language chosen for the app in the system settings replaces a choice in the app', async () => {
    await launch(false, { language: 'en', systemLocaleSeen: 'en-US' });
    phone('he-IL');
    await comeBack();
    expect(useSettings.getState()).toMatchObject({
      language: 'system',
      languageSource: 'system',
      systemLocaleSeen: 'he-IL',
    });
    expect(i18n.language).toBe('he');
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('"שפת המכשיר" follows the phone', async () => {
    await launch(false, { language: 'system' });
    expect(i18n.language).toBe('en');
    phone('he-IL');
    await comeBack();
    expect(i18n.language).toBe('he');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('nothing changed: nothing restarts', async () => {
    await launch(false, { language: 'en', systemLocaleSeen: 'en-US' });
    await comeBack();
    expect(useSettings.getState().language).toBe('en');
    expect(reload).not.toHaveBeenCalled();
  });
});

/** Android 13+ with our module (D103): the per-app languages are `tags`. */
const android13 = (tags: string[], device: 'he' | 'en' = 'en') =>
  system.mockReturnValue({
    appLocales: tags,
    device,
    systemLocale: null,
    compare: false,
  } satisfies SystemLanguageReport);

describe('Android 13+: the picker and the system settings are one (D103)', () => {
  it('a choice in the app is written to the system, and that write is not taken for the player’s', async () => {
    android13(['he'], 'he');
    await launch(true, { language: 'he', appLocalesSeen: 'he' });
    await act(async () => chooseLanguage('en'));
    expect(writeAppLocales).toHaveBeenCalledWith(['en']);
    expect(languagePrefs()).toMatchObject({ language: 'en', languageSource: 'app', appLocalesSeen: 'en' });
    expect(reload).toHaveBeenCalledTimes(1);
    // The system now reports our write: no change, the choice stays the app's.
    android13(['en'], 'en');
    expect(syncLanguageWithSystem()).toBe('en');
    expect(languagePrefs()).toMatchObject({ language: 'en', languageSource: 'app' });
  });

  it('"שפת המכשיר" clears them; its language shows only after a restart, so it restarts', async () => {
    android13(['en'], 'en');
    await launch(false, { language: 'en', appLocalesSeen: 'en' });
    expect(predictLanguage('system')).toBeNull();
    await act(async () => chooseLanguage('system'));
    expect(writeAppLocales).toHaveBeenCalledWith([]);
    expect(languagePrefs()).toMatchObject({ language: 'system', appLocalesSeen: '' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the first look writes a choice made before 1.1.0 to the system', () => {
    android13([], 'en');
    useSettings.setState({ language: 'he', languageSource: 'migrated', appLocalesSeen: null });
    expect(syncLanguageWithSystem()).toBe('he');
    expect(writeAppLocales).toHaveBeenCalledWith(['he']);
    expect(languagePrefs().appLocalesSeen).toBe('he');
  });
});

describe('iOS and Android below 13', () => {
  it('a choice in the app is not written anywhere but the settings', async () => {
    await launch(false, { language: 'en' });
    await act(async () => chooseLanguage('he'));
    expect(writeAppLocales).not.toHaveBeenCalled();
    expect(languagePrefs()).toMatchObject({ language: 'he', languageSource: 'app' });
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
