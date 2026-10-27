import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APP_LOCALE_MODULE,
  type AppLocaleNative,
  createAppLocale,
  deviceModule,
  getAppLocales,
  isAppLocaleSupported,
  setAppLocales,
} from '../appLocale';

/**
 * services/appLocale.ts (localization plan 0א and 0יא, D103): Android's per-app language through our native
 * module, null and no-ops wherever it can't be reached, and never an error.
 */

/** A native module like modules/app-locale's on Android 13+, holding the app's languages. */
function fakeNative(initial: string[] = []) {
  let locales = initial;
  const native = {
    isSupported: jest.fn(() => true),
    getApplicationLocales: jest.fn((): string[] | null => locales),
    setApplicationLocales: jest.fn((tags: string[]) => {
      locales = tags;
      return true;
    }),
  } satisfies AppLocaleNative;
  return native;
}

describe('without the native module (Jest, iOS, a build from before it)', () => {
  it('is unsupported: null, and writing does nothing and throws nothing', () => {
    expect(isAppLocaleSupported()).toBe(false);
    expect(getAppLocales()).toBeNull();
    expect(() => setAppLocales(['he'])).not.toThrow();
    expect(getAppLocales()).toBeNull();
  });

  it('on Android too, when the binary has no such module (an APK from before it)', () => {
    // Expo's real lookup, which finds no "AppLocale" here.
    expect(deviceModule('android')).toBeNull();
    const api = createAppLocale(() => deviceModule('android'));
    expect(api.isAppLocaleSupported()).toBe(false);
    expect(api.getAppLocales()).toBeNull();
    expect(() => api.setAppLocales(['he'])).not.toThrow();
  });

  it('on Android the module is asked for by its name; on iOS never (it is Android only)', () => {
    const native = fakeNative(['he']);
    const lookup = jest.fn((_name: string) => native);
    expect(deviceModule('android', lookup)).toBe(native);
    expect(lookup.mock.calls).toEqual([[APP_LOCALE_MODULE]]);
    lookup.mockClear();
    expect(deviceModule('ios', lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a module that is not there, or fails to load, is the same', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const load of [
      () => null,
      () => {
        throw new Error('no such module');
      },
    ]) {
      const api = createAppLocale(load);
      expect(api.isAppLocaleSupported()).toBe(false);
      expect(api.getAppLocales()).toBeNull();
      expect(() => api.setAppLocales([])).not.toThrow();
    }
    // Only the module that failed to load is worth a word (in development).
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('Android 13 and up (the system\'s "App languages")', () => {
  it("reads the system's choice, preferred first; [] when the app follows the system", () => {
    const native = fakeNative(['he', 'en']);
    const api = createAppLocale(() => native);
    expect(api.isAppLocaleSupported()).toBe(true);
    expect(api.getAppLocales()).toEqual(['he', 'en']);
    expect(createAppLocale(() => fakeNative([])).getAppLocales()).toEqual([]);
  });

  it('writes the choice; [] clears it ("device language")', () => {
    const native = fakeNative();
    const api = createAppLocale(() => native);
    api.setAppLocales(['ar']);
    expect(native.setApplicationLocales).toHaveBeenLastCalledWith(['ar']);
    expect(api.getAppLocales()).toEqual(['ar']);
    api.setAppLocales([]);
    expect(native.setApplicationLocales).toHaveBeenLastCalledWith([]);
    expect(api.getAppLocales()).toEqual([]);
  });

  it('drops empty tags both ways', () => {
    const native = fakeNative(['he', '', ' ']);
    const api = createAppLocale(() => native);
    expect(api.getAppLocales()).toEqual(['he']);
    api.setAppLocales([' pt-BR ', '']);
    expect(native.setApplicationLocales).toHaveBeenLastCalledWith(['pt-BR']);
  });

  it('loads the module and asks whether it is supported once', () => {
    const native = fakeNative(['en']);
    const load = jest.fn(() => native);
    const api = createAppLocale(load);
    api.getAppLocales();
    api.setAppLocales(['he']);
    api.isAppLocaleSupported();
    expect(load).toHaveBeenCalledTimes(1);
    expect(native.isSupported).toHaveBeenCalledTimes(1);
  });
});

describe('below Android 13, or when a call fails', () => {
  it('below 13 (the module says unsupported): null, and nothing is written', () => {
    const native = { ...fakeNative(['he']), isSupported: jest.fn(() => false) };
    const api = createAppLocale(() => native);
    expect(api.isAppLocaleSupported()).toBe(false);
    expect(api.getAppLocales()).toBeNull();
    api.setAppLocales(['he']);
    expect(native.getApplicationLocales).not.toHaveBeenCalled();
    expect(native.setApplicationLocales).not.toHaveBeenCalled();
  });

  it('a native error never reaches the app', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const native = fakeNative();
    native.getApplicationLocales.mockImplementation(() => {
      throw new Error('binder died');
    });
    native.setApplicationLocales.mockImplementation(() => {
      throw new Error('binder died');
    });
    const api = createAppLocale(() => native);
    expect(api.getAppLocales()).toBeNull();
    expect(() => api.setAppLocales(['he'])).not.toThrow();

    const broken = {
      ...fakeNative(),
      isSupported: jest.fn((): boolean => {
        throw new Error('old build');
      }),
    };
    expect(createAppLocale(() => broken).isAppLocaleSupported()).toBe(false);
    warn.mockRestore();
  });

  it('an answer that is not a list of tags counts as none', () => {
    const native = fakeNative();
    native.getApplicationLocales.mockReturnValue(null);
    expect(createAppLocale(() => native).getAppLocales()).toBeNull();
    native.getApplicationLocales.mockReturnValue('he' as unknown as string[]);
    expect(createAppLocale(() => native).getAppLocales()).toBeNull();
  });
});

describe('the native module (modules/app-locale)', () => {
  const MODULE = join(__dirname, '..', '..', '..', 'modules', 'app-locale');
  const config = JSON.parse(readFileSync(join(MODULE, 'expo-module.config.json'), 'utf8')) as {
    platforms: string[];
    android: { modules: string[] };
  };

  it("is Android's only, and its class is where the config says (autolinked from apps/mobile/modules)", () => {
    expect(config.platforms).toEqual(['android']);
    expect(config.android.modules).toHaveLength(1);
    const className = config.android.modules[0]!;
    const source = join(MODULE, 'android', 'src', 'main', 'java', ...className.split('.')) + '.kt';
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(MODULE, 'android', 'build.gradle'))).toBe(true);
  });

  it('answers to the name the JS asks for, with the functions it calls, each guarded for Android 13', () => {
    const className = config.android.modules[0]!;
    const kotlin = readFileSync(
      join(MODULE, 'android', 'src', 'main', 'java', ...className.split('.')) + '.kt',
      'utf8',
    );
    expect(kotlin).toContain(`Name("${APP_LOCALE_MODULE}")`);
    const functions = [...kotlin.matchAll(/Function\("(\w+)"\)/g)].map((m) => m[1]);
    expect(functions.sort()).toEqual(
      (
        ['getApplicationLocales', 'isSupported', 'setApplicationLocales'] satisfies (keyof AppLocaleNative)[]
      ).sort(),
    );
    // Each function that touches LocaleManager answers null or false below Android 13 (API 33, TIRAMISU),
    // and every helper that reaches LocaleManager is marked for 33, so Android Lint (NewApi) sees the guard.
    const TIRAMISU = 'Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU';
    expect(kotlin).toContain(`if (${TIRAMISU}) readLocales() else null`);
    expect(kotlin).toContain(`if (${TIRAMISU}) writeLocales(tags) else false`);
    const helpers = [...kotlin.matchAll(/(@RequiresApi\([^)]*\)\s*)?private fun (\w+)/g)];
    expect(helpers.map((m) => m[2]).sort()).toEqual(['localeManager', 'readLocales', 'writeLocales']);
    for (const helper of helpers) expect(helper[1]).toContain('Build.VERSION_CODES.TIRAMISU');
    expect(kotlin).toContain('LocaleList.getEmptyLocaleList()');
  });
});
