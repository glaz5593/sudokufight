import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

import appConfig, {
  type AppConfigEnv,
  assertStoreBuildHasFirebase,
  resolveAppConfig,
} from '../../app.config';

/**
 * app.config.ts (work plan stage 8): Firebase only when its config files are there, `extra.firebase` saying
 * so at run time (chooseProvider.ts picks the sign-in from it), and no store build that would ship the
 * development sign-in. The files' existence is the test's (`exists`), so the result does not depend on
 * whether apps/mobile/config/firebase/ has them on this machine.
 */

const BASE: ExpoConfig = { name: 'Sudoku Fight', slug: 'sudoku-fight', extra: { supportsRTL: true } };
const NO_ENV: AppConfigEnv = {
  googleServicesJson: undefined,
  googleServiceInfoPlist: undefined,
  easBuild: undefined,
  profile: undefined,
  platform: undefined,
};
const ANDROID_FILE = '/eas/files/google-services.json';
const IOS_FILE = '/eas/files/GoogleService-Info.plist';
/** Only the EAS file variables' paths exist (no local files). */
const easFilesOnly = (path: string) => path === ANDROID_FILE || path === IOS_FILE;
const resolve = (env: Partial<AppConfigEnv> = {}) =>
  resolveAppConfig(BASE, { ...NO_ENV, ...env }, easFilesOnly);

describe('app.config.ts and Firebase', () => {
  it('without the files: no Firebase plugins, extra.firebase says so', () => {
    const config = resolve();
    expect(config.extra).toEqual({ supportsRTL: true, firebase: { android: false, ios: false } });
    expect(JSON.stringify(config.plugins ?? [])).not.toContain('react-native-firebase');
  });

  it('with the EAS file variables: the plugins, static frameworks on iOS, and extra.firebase true', () => {
    const config = resolve({ googleServicesJson: ANDROID_FILE, googleServiceInfoPlist: IOS_FILE });
    expect(config.extra).toMatchObject({ firebase: { android: true, ios: true } });
    expect(config.android?.googleServicesFile).toBe(ANDROID_FILE);
    expect(config.ios?.googleServicesFile).toBe(IOS_FILE);
    expect(config.plugins).toEqual(
      expect.arrayContaining([
        ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
        '@react-native-firebase/app',
        '@react-native-firebase/auth',
        '@react-native-firebase/crashlytics',
      ]),
    );
  });

  it('the local files in config/firebase/ count too; a variable that points nowhere does not', () => {
    const local = (path: string) => path.replace(/\\/g, '/').endsWith('config/firebase/google-services.json');
    const config = resolveAppConfig(BASE, { ...NO_ENV, googleServicesJson: '/nowhere.json' }, local);
    expect(config.extra).toMatchObject({ firebase: { android: true, ios: false } });
    expect(config.android?.googleServicesFile).toBe('./config/firebase/google-services.json');
  });

  it('the default export reads this machine: Firebase exactly when the local files are there', () => {
    const dir = join(__dirname, '..', '..', 'config', 'firebase');
    const config = appConfig({ config: BASE } as Parameters<typeof appConfig>[0]);
    expect(config.extra).toMatchObject({
      firebase: {
        android:
          existsSync(join(dir, 'google-services.json')) || existsSync(process.env.GOOGLE_SERVICES_JSON ?? ''),
        ios:
          existsSync(join(dir, 'GoogleService-Info.plist')) ||
          existsSync(process.env.GOOGLE_SERVICE_INFO_PLIST ?? ''),
      },
    });
  });
});

describe('a store build never ships the development sign-in', () => {
  const production = { easBuild: 'true', profile: 'production' };

  it("EAS's production profile without Firebase for its platform fails, naming what to upload", () => {
    expect(() => resolve({ ...production, platform: 'android' })).toThrow(
      /GOOGLE_SERVICES_JSON.*eas env:create --type file/,
    );
    expect(
      resolve({ ...production, platform: 'android', googleServicesJson: ANDROID_FILE }).extra,
    ).toMatchObject({
      firebase: { android: true, ios: false },
    });
    expect(() => resolve({ ...production, platform: 'ios', googleServicesJson: ANDROID_FILE })).toThrow(
      /GOOGLE_SERVICE_INFO_PLIST/,
    );
  });

  it('development and preview builds, local runs and `expo export` go on without Firebase', () => {
    const none = { android: false, ios: false };
    for (const profile of ['development', 'preview']) {
      expect(() =>
        assertStoreBuildHasFirebase({ easBuild: 'true', profile, platform: 'android' }, none),
      ).not.toThrow();
    }
    // Not on EAS's servers (a local `eas build` reads the config too; the file variables live on EAS).
    expect(() =>
      assertStoreBuildHasFirebase({ easBuild: undefined, profile: 'production', platform: 'ios' }, none),
    ).not.toThrow();
    // No platform said: both are needed.
    expect(() =>
      assertStoreBuildHasFirebase({ ...production, platform: undefined }, { android: true, ios: false }),
    ).toThrow(/for ios/);
  });
});
