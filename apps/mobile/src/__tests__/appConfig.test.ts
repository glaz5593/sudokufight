import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

import appConfig, {
  AD_ID_PERMISSION,
  type AppConfigEnv,
  assertStoreBuildHasFirebase,
  assertStoreBuildHasServer,
  isStoreBuild,
  resolveAppConfig,
  STORE_PROFILES,
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

  it('stage 14: Analytics without advertising ids (no IDFA on iOS, no AD_ID permission on Android)', () => {
    const config = resolveAppConfig(
      { ...BASE, android: { blockedPermissions: ['android.permission.RECORD_AUDIO'] } },
      { ...NO_ENV, googleServicesJson: ANDROID_FILE, googleServiceInfoPlist: IOS_FILE },
      easFilesOnly,
    );
    expect(config.plugins).toContainEqual([
      '@react-native-firebase/analytics',
      { ios: { withoutAdIdSupport: true } },
    ]);
    expect(config.android?.blockedPermissions).toEqual([
      'android.permission.RECORD_AUDIO',
      'com.google.android.gms.permission.AD_ID',
    ]);
    expect(AD_ID_PERMISSION).toBe('com.google.android.gms.permission.AD_ID');
    // Without Firebase there is no Analytics library, and nothing to block.
    expect(resolve().android?.blockedPermissions).toBeUndefined();
  });

  it('firebase.json keeps collection off until a release build turns it on, and every ad feature off', () => {
    const json = JSON.parse(readFileSync(join(__dirname, '..', '..', 'firebase.json'), 'utf8')) as {
      'react-native': Record<string, unknown>;
    };
    expect(json['react-native']).toEqual({
      analytics_auto_collection_enabled: false,
      google_analytics_adid_collection_enabled: false,
      google_analytics_ssaid_collection_enabled: false,
      google_analytics_automatic_screen_reporting_enabled: false,
      google_analytics_registration_with_ad_network_enabled: false,
      analytics_default_allow_ad_storage: false,
      analytics_default_allow_ad_user_data: false,
      analytics_default_allow_ad_personalization_signals: false,
    });
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
  const server = { host: 'sudoku-fight-prod.fly.dev', secure: 'true' };
  const production = { easBuild: 'true', profile: 'production', server };

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

  it('the production profile is the store profile the guards cover', () => {
    expect(STORE_PROFILES).toEqual(['production']);
    expect(isStoreBuild({ easBuild: 'true', profile: 'production', platform: 'ios' })).toBe(true);
    expect(isStoreBuild({ easBuild: 'true', profile: 'preview', platform: 'ios' })).toBe(false);
    expect(isStoreBuild({ easBuild: undefined, profile: 'production', platform: 'ios' })).toBe(false);
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

describe('a store build reaches a real game server (stage 14)', () => {
  const build = { easBuild: 'true', profile: 'production', platform: 'android' };

  it('fails on localhost, a LAN address, a placeholder, no host, or no TLS, naming the setting', () => {
    for (const host of [
      undefined,
      '',
      'localhost',
      '127.0.0.1',
      '192.168.1.20',
      '10.0.2.2',
      'CHANGE-ME.fly.dev',
    ])
      expect(() => assertStoreBuildHasServer(build, { host, secure: 'true' })).toThrow(
        /EXPO_PUBLIC_SERVER_HOST.*eas\.json/,
      );
    expect(() =>
      assertStoreBuildHasServer(build, { host: 'sudoku-fight-prod.fly.dev', secure: 'false' }),
    ).toThrow(/EXPO_PUBLIC_SERVER_SECURE/);
    expect(() =>
      assertStoreBuildHasServer(build, { host: 'sudoku-fight-prod.fly.dev', secure: 'true' }),
    ).not.toThrow();
  });

  it('development and preview builds, and anything off EAS, may point anywhere', () => {
    for (const profile of ['development', 'preview'])
      expect(() =>
        assertStoreBuildHasServer({ ...build, profile }, { host: 'localhost', secure: 'false' }),
      ).not.toThrow();
    expect(() =>
      assertStoreBuildHasServer({ ...build, easBuild: undefined }, { host: 'localhost' }),
    ).not.toThrow();
  });
});

describe('eas.json (stage 14)', () => {
  interface Profile {
    developmentClient?: boolean;
    distribution?: string;
    environment?: string;
    autoIncrement?: boolean;
    android?: { buildType?: string };
    env?: Record<string, string>;
  }
  const eas = JSON.parse(readFileSync(join(__dirname, '..', '..', 'eas.json'), 'utf8')) as {
    cli: { appVersionSource: string };
    build: Record<string, Profile>;
    submit: { production: { android?: { track?: string; releaseStatus?: string } } };
  };
  const text = readFileSync(join(__dirname, '..', '..', 'eas.json'), 'utf8');

  it('development, preview (an APK for internal testing) and production (an App Bundle for the stores)', () => {
    expect(Object.keys(eas.build).sort()).toEqual(['development', 'preview', 'production']);
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.development).toMatchObject({ developmentClient: true, distribution: 'internal' });
    expect(eas.build.preview).toMatchObject({ distribution: 'internal', android: { buildType: 'apk' } });
    expect(eas.build.production).toMatchObject({
      autoIncrement: true,
      android: { buildType: 'app-bundle' },
    });
    for (const [name, profile] of Object.entries(eas.build))
      expect({ name, environment: profile.environment }).toEqual({ name, environment: name });
    expect(STORE_PROFILES.every((p) => p in eas.build)).toBe(true);
  });

  it("each built profile's server is one the app can reach, and production passes the store guard", () => {
    for (const name of ['preview', 'production']) {
      const env = eas.build[name]!.env!;
      expect({ name, port: env.EXPO_PUBLIC_SERVER_PORT, secure: env.EXPO_PUBLIC_SERVER_SECURE }).toEqual({
        name,
        port: '443',
        secure: 'true',
      });
    }
    const prod = eas.build.production!.env!;
    expect(prod.EXPO_PUBLIC_SERVER_HOST).not.toBe(eas.build.preview!.env!.EXPO_PUBLIC_SERVER_HOST);
    expect(() =>
      resolveAppConfig(
        BASE,
        {
          ...NO_ENV,
          easBuild: 'true',
          profile: 'production',
          platform: 'android',
          googleServicesJson: ANDROID_FILE,
          server: { host: prod.EXPO_PUBLIC_SERVER_HOST, secure: prod.EXPO_PUBLIC_SERVER_SECURE },
        },
        easFilesOnly,
      ),
    ).not.toThrow();
  });

  it('first uploads go to Play as drafts on the internal track; no credentials in the repo', () => {
    expect(eas.submit.production.android).toEqual({ track: 'internal', releaseStatus: 'draft' });
    // EAS keeps the signing keys and the store keys on its servers (CLAUDE.md: never a keystore from elsewhere).
    for (const key of [
      'credentialsSource',
      'serviceAccountKeyPath',
      'keystore',
      'password',
      'ascApiKey',
      'p8',
    ])
      expect({ key, inEasJson: text.includes(key) }).toEqual({ key, inEasJson: false });
  });
});

describe('app.json for the stores (stage 14)', () => {
  const app = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')) as {
    expo: ExpoConfig;
  };

  it('iOS export compliance: standard encryption only (HTTPS, WSS), so no question on every upload', () => {
    // ITSAppUsesNonExemptEncryption = NO (docs/store/LISTING-APPLE.md §6). Adding encryption of our own (not
    // the system's TLS) would make this false, and the answer in App Store Connect with it.
    expect(app.expo.ios?.config?.usesNonExemptEncryption).toBe(false);
  });
});
