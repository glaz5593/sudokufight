import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

import { FRIENDS_APP_SCHEME, roomLinkPath } from '@sudoku-fight/protocol';

import { appJsonFiles, resolveServer, serverEnv } from '../../scripts/lib/build-apk.mjs';
import appConfig, {
  AD_ID_PERMISSION,
  allowsCleartext,
  APP_SCHEME,
  type AppConfigEnv,
  assertStoreBuildHasFirebase,
  assertStoreBuildHasServer,
  assertStoreBuildWithoutDebugKey,
  GOOGLE_SIGN_IN_PLUGIN,
  isLocalApk,
  isStoreBuild,
  LOCAL_BUILD_PLUGINS,
  readGoogleSignIn,
  resolveAppConfig,
  ROOM_LINK_PATH_PREFIX,
  roomLinkHostOf,
  STORE_PROFILES,
  TEMPLATE_DEBUG_KEY_SHA1,
} from '../../app.config';

/**
 * app.config.ts (work plan stage 8): Firebase only when its config files are there, `extra.firebase` saying
 * so at run time (chooseProvider.ts picks the sign-in from it), and no store build that would ship the
 * development sign-in. The files' existence is the test's (`exists`), so the result does not depend on
 * whether apps/mobile/config/firebase/ has them on this machine.
 */

const BASE: ExpoConfig = { name: 'Sudoku Fight', slug: 'sudoku-fight', extra: { eas: { projectId: 'p' } } };
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
    expect(config.extra).toEqual({
      eas: { projectId: 'p' },
      firebase: { android: false, ios: false },
      googleSignIn: { android: false, ios: false, webClientId: null },
    });
    expect(JSON.stringify(config.plugins ?? [])).not.toContain('react-native-firebase');
    expect(JSON.stringify(config.plugins ?? [])).not.toContain('google-signin');
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

describe('"Continue with Google" (Moshe, 14.10.2026): the plugin and the web client id', () => {
  const PACKAGE = 'com.mosheg.sudokufight';
  const WEB = '111122223333-webclientabc123.apps.googleusercontent.com';
  /** google-services.json's shape (made-up values; the real file never enters the repo). */
  const servicesJson = ({
    pkg = PACKAGE,
    web = WEB as string | null,
    androidClients = 2,
    webInOtherPlatforms = false,
    hashes = [] as string[],
  } = {}) => ({
    project_info: { project_id: 'sudoku-fight-test' },
    client: [
      {
        client_info: { android_client_info: { package_name: 'com.example.other' } },
        oauth_client: [{ client_id: '999-otherweb.apps.googleusercontent.com', client_type: 3 }],
      },
      {
        client_info: { android_client_info: { package_name: pkg } },
        oauth_client: [
          ...Array.from({ length: androidClients }, (_, i) => ({
            client_id: `111122223333-androidclient${i}.apps.googleusercontent.com`,
            client_type: 1,
            android_info: { package_name: pkg, certificate_hash: hashes[i] ?? 'a'.repeat(40) },
          })),
          ...(web && !webInOtherPlatforms ? [{ client_id: web, client_type: 3 }] : []),
        ],
        api_key: [{ current_key: 'AIza-test-key' }],
        services: {
          appinvite_service: {
            other_platform_oauth_client:
              web && webInOtherPlatforms ? [{ client_id: web, client_type: 3 }] : [],
          },
        },
      },
    ],
  });
  const BASE_APP: ExpoConfig = { ...BASE, android: { package: PACKAGE } };
  const withFile = (json: unknown) =>
    resolveAppConfig(BASE_APP, { ...NO_ENV, googleServicesJson: ANDROID_FILE }, easFilesOnly, (path) =>
      path === ANDROID_FILE ? json : null,
    );

  it("reads the web client and the package's Android clients from google-services.json, nothing else", () => {
    expect(readGoogleSignIn(servicesJson(), PACKAGE)).toEqual({
      webClientId: WEB,
      androidClients: 2,
      debugKey: false,
    });
    // Firebase sometimes lists the web client only under the invite service.
    expect(readGoogleSignIn(servicesJson({ webInOtherPlatforms: true }), PACKAGE).webClientId).toBe(WEB);
    // Another app's clients don't count.
    expect(readGoogleSignIn(servicesJson(), 'com.example.nothere')).toEqual({
      webClientId: null,
      androidClients: 0,
      debugKey: false,
    });
    expect(readGoogleSignIn(servicesJson({ web: 'not a client id' }), PACKAGE).webClientId).toBeNull();
    expect(readGoogleSignIn(servicesJson({ web: null }), PACKAGE).webClientId).toBeNull();
    for (const junk of [null, 'text', [], { client: 'x' }, { client: [null, 3] }])
      expect(readGoogleSignIn(junk, PACKAGE)).toEqual({
        webClientId: null,
        androidClients: 0,
        debugKey: false,
      });
    expect(readGoogleSignIn(servicesJson(), undefined).webClientId).toBeNull();
  });

  it('with the Android Firebase file: the plugin after the Firebase ones, and Google on for Android', () => {
    const config = withFile(servicesJson());
    expect(GOOGLE_SIGN_IN_PLUGIN).toBe('@react-native-google-signin/google-signin');
    const plugins = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins).toContain(GOOGLE_SIGN_IN_PLUGIN);
    expect(plugins.indexOf(GOOGLE_SIGN_IN_PLUGIN)).toBeGreaterThan(
      plugins.indexOf('@react-native-firebase/auth'),
    );
    expect(config.extra).toMatchObject({ googleSignIn: { android: true, ios: false, webClientId: WEB } });
  });

  it('no SHA-1 in Firebase yet (no Android client), or no web client: no Google button (it could only fail)', () => {
    expect(withFile(servicesJson({ androidClients: 0 })).extra).toMatchObject({
      googleSignIn: { android: false, webClientId: WEB },
    });
    expect(withFile(servicesJson({ web: null })).extra).toMatchObject({
      googleSignIn: { android: false, webClientId: null },
    });
    // A file that can't be read: Firebase still builds, without Google.
    const unreadable = withFile(null);
    expect(unreadable.extra).toMatchObject({ firebase: { android: true }, googleSignIn: { android: false } });
    expect(unreadable.plugins).toContain(GOOGLE_SIGN_IN_PLUGIN);
  });

  it('only with the Android file: an iOS-only Firebase build has no Google plugin (iOS comes later)', () => {
    const config = resolveAppConfig(
      BASE_APP,
      { ...NO_ENV, googleServiceInfoPlist: IOS_FILE },
      easFilesOnly,
      () => servicesJson(),
    );
    expect(config.extra).toMatchObject({
      firebase: { android: false, ios: true },
      googleSignIn: { android: false },
    });
    expect(config.plugins).not.toContain(GOOGLE_SIGN_IN_PLUGIN);
    expect(config.plugins).toContain('@react-native-firebase/auth');
  });

  it("this machine's google-services.json, if any: Google exactly when it has the clients", () => {
    const local = join(__dirname, '..', '..', 'config', 'firebase', 'google-services.json');
    const app = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')) as {
      expo: ExpoConfig;
    };
    const config = appConfig({ config: app.expo } as Parameters<typeof appConfig>[0]);
    const extra = config.extra as { googleSignIn: { android: boolean; webClientId: string | null } };
    const fromEnv = process.env.GOOGLE_SERVICES_JSON ?? '';
    if (!existsSync(local) && !existsSync(fromEnv)) {
      expect(extra.googleSignIn).toEqual({ android: false, ios: false, webClientId: null });
      return;
    }
    // Only compared, never printed.
    const file = existsSync(fromEnv) ? fromEnv : local;
    const setup = readGoogleSignIn(JSON.parse(readFileSync(file, 'utf8')), app.expo.android?.package);
    expect(extra.googleSignIn.webClientId === setup.webClientId).toBe(true);
    const env = { ...NO_ENV, easBuild: process.env.EAS_BUILD, localApk: process.env.SF_LOCAL_APK };
    const keyListed = isLocalApk(env) ? setup.debugKey : setup.androidClients > 0;
    expect(extra.googleSignIn.android).toBe(setup.webClientId !== null && keyListed);
    expect(config.plugins).toContain(GOOGLE_SIGN_IN_PLUGIN);
  });

  describe("React Native's public template debug key (it signs `npm run apk`)", () => {
    const DEBUG_COLONS = '5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25';
    const withDebugKey = servicesJson({ hashes: [TEMPLATE_DEBUG_KEY_SHA1] });
    const easKeyOnly = servicesJson({ androidClients: 1 });
    const googleOn = (json: unknown, env: Partial<AppConfigEnv>) =>
      (
        resolveAppConfig(
          BASE_APP,
          { ...NO_ENV, googleServicesJson: ANDROID_FILE, ...env },
          easFilesOnly,
          (path) => (path === ANDROID_FILE ? json : null),
        ).extra as { googleSignIn: { android: boolean } }
      ).googleSignIn.android;

    it("is the keystore's known fingerprint, found among the package's Android clients in any spelling", () => {
      expect(DEBUG_COLONS.replace(/:/g, '').toLowerCase()).toBe(TEMPLATE_DEBUG_KEY_SHA1);
      expect(readGoogleSignIn(withDebugKey, PACKAGE)).toMatchObject({ androidClients: 2, debugKey: true });
      expect(readGoogleSignIn(servicesJson({ hashes: [DEBUG_COLONS] }), PACKAGE).debugKey).toBe(true);
      expect(readGoogleSignIn(easKeyOnly, PACKAGE).debugKey).toBe(false);
      // Another package's client with that key doesn't count.
      expect(
        readGoogleSignIn(
          servicesJson({ pkg: 'com.example.other', hashes: [TEMPLATE_DEBUG_KEY_SHA1] }),
          PACKAGE,
        ),
      ).toMatchObject({ debugKey: false });
    });

    it('an APK of `npm run apk` shows Google only while Firebase lists that key (else it could only fail)', () => {
      expect(googleOn(withDebugKey, { localApk: '1' })).toBe(true);
      // The debug key's SHA-1 removed from Firebase: the EAS key alone can't sign this APK in.
      expect(googleOn(easKeyOnly, { localApk: '1' })).toBe(false);
      // Other builds can't tell their key in the file: any Android client.
      expect(googleOn(easKeyOnly, {})).toBe(true);
      expect(googleOn(easKeyOnly, { easBuild: 'true', profile: 'preview', platform: 'android' })).toBe(true);
      // Never on EAS's servers, even if the variable leaked there.
      expect(isLocalApk({ ...NO_ENV, localApk: '1', easBuild: 'true' })).toBe(false);
      expect(googleOn(easKeyOnly, { localApk: '1', easBuild: 'true', profile: 'preview' })).toBe(true);
    });

    it('an Android store build fails while the file lists it, saying how to remove it', () => {
      const store = {
        easBuild: 'true',
        profile: 'production',
        platform: 'android',
        server: { host: 'sudoku-fight-prod.fly.dev', secure: 'true' },
      };
      expect(() => googleOn(withDebugKey, store)).toThrow(
        /public debug key.*5e8f16062ea3cd2c4a0d547876baa6f38cabf625.*Remove that fingerprint in Firebase.*--force/s,
      );
      expect(googleOn(easKeyOnly, store)).toBe(true);
      // Preview builds, builds on this PC and iOS builds go on (the APKs for test phones keep it).
      const setup = readGoogleSignIn(withDebugKey, PACKAGE);
      for (const build of [
        { easBuild: 'true', profile: 'preview', platform: 'android' },
        { easBuild: undefined, profile: 'production', platform: 'android' },
        { easBuild: 'true', profile: 'production', platform: 'ios' },
      ])
        expect(() => assertStoreBuildWithoutDebugKey(build, setup)).not.toThrow();
      // No platform said: Android is one of them.
      expect(() =>
        assertStoreBuildWithoutDebugKey(
          { easBuild: 'true', profile: 'production', platform: undefined },
          setup,
        ),
      ).toThrow(/public debug key/);
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

describe('languages in the native projects (localization plan 0יא; D103, D118)', () => {
  const APP_JSON = readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8');
  const app = JSON.parse(APP_JSON) as { expo: ExpoConfig };
  const LOCALES_PLUGIN = './plugins/withAppLocales.js';
  const LANGUAGES_FILE = './src/i18n/enabled-languages.json';
  type Plugin = NonNullable<ExpoConfig['plugins']>[number];
  const entry = (plugins: ExpoConfig['plugins'], name: string): Plugin | undefined =>
    (plugins ?? []).find((p) => (Array.isArray(p) ? p[0] : p) === name);
  const optionsOf = (plugin: Plugin | undefined): unknown =>
    Array.isArray(plugin) ? (plugin[1] as unknown) : undefined;

  it("our plugin writes the system's list of languages from the app's one list (enabled-languages.json)", () => {
    expect(optionsOf(entry(app.expo.plugins, LOCALES_PLUGIN))).toEqual({ languagesFile: LANGUAGES_FILE });
    expect(existsSync(join(__dirname, '..', '..', LOCALES_PLUGIN))).toBe(true);
    expect(existsSync(join(__dirname, '..', '..', LANGUAGES_FILE))).toBe(true);
  });

  it('adding a language regenerates the android folder: `npm run apk` hashes the list (appJsonFiles)', () => {
    expect(appJsonFiles(APP_JSON)).toEqual(expect.arrayContaining([LOCALES_PLUGIN, LANGUAGES_FILE]));
  });

  it('expo-localization filters no resources and sets no direction: no supportedLocales, no supportsRTL', () => {
    // supportedLocales would add resourceConfigurations to build.gradle, which may drop the libraries'
    // values-iw, values-zh-rCN, values-pt… (plan 0יא). supportsRTL makes its iOS module force the device's
    // direction at every launch, against applyDirection: a restart loop when the app's language runs the
    // other way (plan 0יא, risk 6). The plugin reads `extra` too, so neither may be there either.
    expect(optionsOf(entry(app.expo.plugins, 'expo-localization'))).toEqual({
      allowDynamicLocaleChangesAndroid: true,
    });
    for (const key of ['supportsRTL', 'forcesRTL', 'supportedLocales'])
      expect({ key, inExtra: key in (app.expo.extra ?? {}) }).toEqual({ key, inExtra: false });
  });

  it('every build gets the plugin: EAS builds and builds on this PC, with or without Firebase', () => {
    const builds: Partial<AppConfigEnv>[] = [
      {},
      { googleServicesJson: ANDROID_FILE },
      { easBuild: 'true', profile: 'preview', platform: 'android' },
      { easBuild: 'true', profile: 'preview', platform: 'android', googleServicesJson: ANDROID_FILE },
    ];
    for (const env of builds) {
      const config = resolveAppConfig(app.expo, { ...NO_ENV, ...env }, easFilesOnly);
      expect(optionsOf(entry(config.plugins, LOCALES_PLUGIN))).toEqual({ languagesFile: LANGUAGES_FILE });
    }
  });
});

describe('builds on this PC (npm run apk, docs/BUILD-APK.md)', () => {
  const EAS_PREVIEW = { easBuild: 'true', profile: 'preview', platform: 'android' };
  const buildProperties = (config: ExpoConfig) =>
    (config.plugins ?? []).filter((p) => Array.isArray(p) && p[0] === 'expo-build-properties');

  it("every Android library gets this PC's NDK; EAS builds keep their config as it was", () => {
    expect(resolve().plugins).toEqual([...LOCAL_BUILD_PLUGINS]);
    expect(resolve({ googleServicesJson: ANDROID_FILE }).plugins).toEqual(
      expect.arrayContaining([...LOCAL_BUILD_PLUGINS]),
    );
    expect(resolve(EAS_PREVIEW).plugins).toBeUndefined();
    expect(resolve({ ...EAS_PREVIEW, googleServicesJson: ANDROID_FILE }).plugins).not.toEqual(
      expect.arrayContaining([...LOCAL_BUILD_PLUGINS]),
    );
    for (const path of LOCAL_BUILD_PLUGINS) expect(existsSync(join(__dirname, '..', '..', path))).toBe(true);
  });

  it('the plugin adds its blocks to android/build.gradle and android/app/build.gradle, once', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require('../../plugins/with-local-native-build.js') as {
      addRootBlock: (contents: string) => string;
      addAppBlock: (contents: string) => string;
    };
    const windows = 'System.getProperty("os.name").toLowerCase().contains("windows")';
    const jobs = '"-DCMAKE_JOB_POOLS=compile=2", "-DCMAKE_JOB_POOL_COMPILE=compile"';

    // The libraries: registered before the root plugins, which configure the app early.
    const plugins = 'apply plugin: "expo-root-project"\napply plugin: "com.facebook.react.rootproject"\n';
    const root = plugin.addRootBlock(`allprojects {}\n\n${plugins}`);
    expect(root.startsWith('allprojects {}\n\n// @generated begin sudoku-fight local-native-build')).toBe(
      true,
    );
    expect(root.endsWith(plugins)).toBe(true);
    expect(root).toContain('subproject.plugins.withId("com.android.library")');
    expect(root).toContain('subproject.android.ndkVersion = rootProject.ext.ndkVersion');
    expect(root).toContain(windows);
    expect(root).toContain(`subproject.android.defaultConfig.externalNativeBuild.cmake.arguments(${jobs})`);
    expect(plugin.addRootBlock(root)).toBe(root);
    // Without the root plugins' line (a future template): at the end.
    expect(plugin.addRootBlock('allprojects {}\n')).toMatch(/^allprojects \{\}\n\n\/\/ @generated begin/);

    // The app: a short C++ folder, 2 compilers and 2 Metro workers, on Windows.
    const app = "apply plugin: 'com.google.gms.google-services'\n";
    const appGradle = plugin.addAppBlock(app);
    expect(appGradle.startsWith(app)).toBe(true);
    expect(appGradle).toContain(windows);
    expect(appGradle).toContain('new File(System.getProperty("user.home"), ".sudoku-fight/cxx")');
    expect(appGradle).toContain(`android.defaultConfig.externalNativeBuild.cmake.arguments(${jobs})`);
    expect(appGradle).toContain('extraPackagerArgs = ["--max-workers", "2"]');
    expect(plugin.addAppBlock(appGradle)).toBe(appGradle);
  });

  it('--server local (SF_ALLOW_CLEARTEXT=1) allows plain ws:// on Android, never on EAS', () => {
    expect(allowsCleartext({ ...NO_ENV, allowCleartext: '1' })).toBe(true);
    expect(allowsCleartext({ ...NO_ENV, allowCleartext: 'true' })).toBe(false);
    expect(allowsCleartext({ ...NO_ENV })).toBe(false);
    expect(allowsCleartext({ ...NO_ENV, ...EAS_PREVIEW, allowCleartext: '1' })).toBe(false);

    const cleartext = { android: { usesCleartextTraffic: true } };
    expect(buildProperties(resolve({ allowCleartext: '1' }))).toEqual([['expo-build-properties', cleartext]]);
    expect(
      buildProperties(
        resolve({ allowCleartext: '1', googleServicesJson: ANDROID_FILE, googleServiceInfoPlist: IOS_FILE }),
      ),
    ).toEqual([['expo-build-properties', { ios: { useFrameworks: 'static' }, ...cleartext }]]);
    expect(buildProperties(resolve())).toEqual([]);
    expect(
      buildProperties(resolve({ ...EAS_PREVIEW, allowCleartext: '1', googleServicesJson: ANDROID_FILE })),
    ).toEqual([['expo-build-properties', { ios: { useFrameworks: 'static' } }]]);
  });
});

describe('room links open the app (1.0.4, friends-room.md §6.1–§6.3, D87)', () => {
  const STAGING = { host: 'sudoku-fight-staging.fly.dev', secure: 'true', port: '443' };
  const eas = JSON.parse(readFileSync(join(__dirname, '..', '..', 'eas.json'), 'utf8')) as {
    build: Record<string, { env?: Record<string, string> }>;
  };
  const app = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')) as {
    expo: ExpoConfig;
  };
  const serverOf = (env: Record<string, string>) => ({
    host: env.EXPO_PUBLIC_SERVER_HOST,
    secure: env.EXPO_PUBLIC_SERVER_SECURE,
    port: env.EXPO_PUBLIC_SERVER_PORT,
  });

  it('over TLS: an App Links filter for https://<server>/r/, verified, and the iOS associated domain', () => {
    const config = resolve({ server: STAGING });
    expect(config.android?.intentFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'sudoku-fight-staging.fly.dev', pathPrefix: '/r/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
    expect(config.ios?.associatedDomains).toEqual(['applinks:sudoku-fight-staging.fly.dev']);
  });

  it("each built profile opens its own server's links: staging the preview APK's, production the store's", () => {
    for (const name of ['preview', 'production']) {
      const server = serverOf(eas.build[name]!.env!);
      const config = resolveAppConfig(BASE, { ...NO_ENV, server }, easFilesOnly);
      const [filter] = config.android?.intentFilters ?? [];
      expect({ name, host: filter?.data, verify: filter?.autoVerify }).toEqual({
        name,
        host: [{ scheme: 'https', host: server.host, pathPrefix: '/r/' }],
        verify: true,
      });
    }
    // The development build names no server: no room links (the app's own scheme still works).
    expect(eas.build.development!.env).toBeUndefined();
    expect(resolve().android?.intentFilters).toBeUndefined();
    expect(resolve().ios?.associatedDomains).toBeUndefined();
  });

  it('`npm run apk -- --server local` (plain http, port 2567): the filter, never autoVerify, no iOS domain', () => {
    const local = resolveServer(
      'local',
      {},
      { 'Wi-Fi': [{ address: '192.168.1.20', family: 'IPv4', internal: false }] },
    );
    if (local.kind !== 'server') throw new Error(local.error);
    const env = serverEnv(local.server);
    const config = resolve({
      server: {
        host: env.EXPO_PUBLIC_SERVER_HOST,
        secure: env.EXPO_PUBLIC_SERVER_SECURE,
        port: env.EXPO_PUBLIC_SERVER_PORT,
      },
    });
    expect(config.android?.intentFilters).toEqual([
      {
        action: 'VIEW',
        data: [{ scheme: 'http', host: '192.168.1.20', port: '2567', pathPrefix: '/r/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
    expect(config.ios?.associatedDomains).toBeUndefined();
  });

  it('TLS on another port: the filter with its port, but nothing to verify there', () => {
    expect(roomLinkHostOf({ host: 'play.example.com', secure: 'true', port: '8443' })).toEqual({
      scheme: 'https',
      host: 'play.example.com',
      port: 8443,
      verified: false,
    });
    expect(roomLinkHostOf({ host: 'Play.Example.com', secure: 'true' })).toEqual({
      scheme: 'https',
      host: 'play.example.com',
      port: null,
      verified: true,
    });
    expect(roomLinkHostOf({ host: '10.0.2.2', secure: 'false', port: '80' })).toEqual({
      scheme: 'http',
      host: '10.0.2.2',
      port: null,
      verified: false,
    });
  });

  it('no host, or not a plain host name: no room links', () => {
    for (const host of [
      undefined,
      '',
      ' ',
      'https://sudoku-fight-staging.fly.dev',
      'host/path',
      'a b',
      '::1',
      'x:443',
    ])
      expect([host, roomLinkHostOf({ host, secure: 'true' })]).toEqual([host, null]);
  });

  it("other intent filters and domains stay; the store build's own settings too", () => {
    const config = resolveAppConfig(
      {
        ...BASE,
        android: { intentFilters: [{ action: 'SEND' }] },
        ios: { associatedDomains: ['webcredentials:example.com'] },
      },
      { ...NO_ENV, server: STAGING },
      easFilesOnly,
    );
    expect(config.android?.intentFilters?.map((f) => f.action)).toEqual(['SEND', 'VIEW']);
    expect(config.ios?.associatedDomains).toEqual([
      'webcredentials:example.com',
      'applinks:sudoku-fight-staging.fly.dev',
    ]);
    const withFirebase = resolve({ server: STAGING, googleServicesJson: ANDROID_FILE });
    expect(withFirebase.android?.googleServicesFile).toBe(ANDROID_FILE);
    expect(withFirebase.android?.intentFilters).toHaveLength(1);
  });

  it("the path and the scheme are the protocol's (this file imports nothing of the workspace)", () => {
    expect(ROOM_LINK_PATH_PREFIX).toBe(roomLinkPath(''));
    expect(APP_SCHEME).toBe(FRIENDS_APP_SCHEME);
    // sudokufight://room/123456 (the browser page's "פתח באפליקציה") needs only app.json's scheme.
    expect(app.expo.scheme).toBe(FRIENDS_APP_SCHEME);
  });
});
