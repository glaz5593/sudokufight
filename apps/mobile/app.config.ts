import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json holds the app's settings; this file adds Firebase (spec §17.1, work plan stage 8) only when its
 * config files are there, so the app still builds without them:
 *
 * - Locally: apps/mobile/config/firebase/google-services.json and GoogleService-Info.plist (gitignored; they
 *   come from the Firebase console of the "Sudoku Fight" project, never from another project).
 * - On EAS Build: file environment variables GOOGLE_SERVICES_JSON and GOOGLE_SERVICE_INFO_PLIST, which hold
 *   the path of the uploaded file (`eas env:create --type file`), because gitignored files aren't uploaded.
 *
 * `extra.firebase` tells the app at run time which platforms have Firebase, so the account code can fall back
 * to the development sign-in instead of crashing in a build without it.
 *
 * Stage 14: Analytics joins the Firebase plugins (without Apple's advertising identifier, and without Android's
 * AD_ID permission; firebase.json turns the rest of the ad features off), and a store build (eas.json's
 * `production` profile) must have Firebase and a reachable game server, or it fails on EAS before it is built.
 *
 * "המשך עם Google" (Moshe, 14.10.2026; Android only for now, iOS later): with the Android Firebase file, the
 * google-signin library's config plugin joins the Firebase plugins, and `extra.googleSignIn` carries the web OAuth
 * client id read from that file (readGoogleSignIn below). The library's free version doesn't find that id by
 * itself, and without it Google gives no ID token for Firebase. It is public: every APK carries it. The button
 * shows only when the file lists the key that signs the build; a store build fails while the file still lists
 * React Native's public debug key (TEMPLATE_DEBUG_KEY_SHA1).
 *
 * The build number comes from the version (versionCodeOf below): app.json's `expo.version` is the one number to
 * change, with `npm run version:bump`.
 *
 * Builds on this PC (`npm run apk`, docs/BUILD-APK.md) get more, never EAS builds: Android build fixes
 * (LOCAL_BUILD_PLUGINS: the NDK installed here for every library, and on Windows limits for C++: memory and
 * path length), and with `--server local` the APK may use plain ws:// and http:// (SF_ALLOW_CLEARTEXT), which
 * a server on this PC's network speaks.
 */
const LOCAL_ANDROID = './config/firebase/google-services.json';
const LOCAL_IOS = './config/firebase/GoogleService-Info.plist';

/** The EAS file variable's path when it exists, else the local file when it exists. */
function firebaseFile(
  fromEnv: string | undefined,
  local: string,
  exists: (path: string) => boolean,
): string | null {
  if (fromEnv && exists(fromEnv)) return fromEnv;
  return exists(resolve(__dirname, local)) ? local : null;
}

/** What EAS Build says about the build it runs (unset outside EAS Build's servers). */
export interface EasBuild {
  /** "true" on EAS Build's servers. */
  easBuild: string | undefined;
  /** The eas.json profile: development, preview, production. */
  profile: string | undefined;
  /** android or ios. */
  platform: string | undefined;
}

/** eas.json's profiles whose builds go to the stores (TestFlight, Play testing tracks, production). */
export const STORE_PROFILES: readonly string[] = ['production'];

/** A build on EAS's servers for a store profile. */
export const isStoreBuild = (build: EasBuild): boolean =>
  build.easBuild === 'true' && build.profile !== undefined && STORE_PROFILES.includes(build.profile);

/**
 * A store build without Firebase for its platform would ship the development sign-in ("מצב פיתוח", tokens a
 * production server refuses): EAS's production profile fails instead, saying what is missing. Only on EAS's
 * servers (where the file variables are), so a local `eas build` or `expo export` is never stopped by it.
 */
export function assertStoreBuildHasFirebase(
  build: EasBuild,
  found: { android: boolean; ios: boolean },
): void {
  if (!isStoreBuild(build)) return;
  const platforms =
    build.platform === 'android' || build.platform === 'ios' ? [build.platform] : ['android', 'ios'];
  const missing = platforms.filter((p) => !found[p as 'android' | 'ios']);
  if (missing.length === 0) return;
  const files = {
    android: 'GOOGLE_SERVICES_JSON (google-services.json)',
    ios: 'GOOGLE_SERVICE_INFO_PLIST (GoogleService-Info.plist)',
  };
  throw new Error(
    `Production build without Firebase for ${missing.join(' and ')}: it would ship the development sign-in. ` +
      `Upload ${missing.map((p) => files[p as 'android' | 'ios']).join(' and ')} with ` +
      '`eas env:create --type file` (docs/FIREBASE-SETUP.md).',
  );
}

/** Where the app finds the game server (src/config/server.ts), from eas.json's `env` of the profile. */
export interface ServerEnv {
  /** EXPO_PUBLIC_SERVER_HOST */
  host?: string | undefined;
  /** EXPO_PUBLIC_SERVER_SECURE ("true" for wss/https) */
  secure?: string | undefined;
}

/** A host a phone in a tester's hand can't reach, or that was never filled in. */
const UNREACHABLE_HOST =
  /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)|\.local$|example\.|change[-_]?me|todo/i;

/**
 * A store build pointing at a computer on the developer's desk (localhost, a LAN address), or at a placeholder,
 * or without TLS, would reach no server from a tester's phone: EAS's production profile fails instead, naming
 * the setting. On EAS's servers only, like the Firebase check.
 */
export function assertStoreBuildHasServer(build: EasBuild, server: ServerEnv): void {
  if (!isStoreBuild(build)) return;
  const host = server.host?.trim() ?? '';
  const problems: string[] = [];
  if (host === '' || UNREACHABLE_HOST.test(host))
    problems.push(`EXPO_PUBLIC_SERVER_HOST is ${host === '' ? 'not set' : `"${host}"`}`);
  if (server.secure !== 'true') problems.push('EXPO_PUBLIC_SERVER_SECURE is not "true"');
  if (problems.length === 0) return;
  throw new Error(
    `Production build without a reachable game server: ${problems.join('; ')}. ` +
      "Set the production server in eas.json's production profile `env` (docs/DEPLOY-PRODUCTION.md).",
  );
}

/** The largest minor and patch number: each takes two digits of the build number (versionCodeOf). */
export const VERSION_PART_MAX = 99;

/**
 * The build number of a version (Moshe, 14.10.2026: "start with 1.0.0 and next version will be 1.0.1 and I can
 * see it in the app"): major·10000 + minor·100 + patch, so 1.0.0 → 10000, 1.0.1 → 10001, 1.2.3 → 10203. It is
 * Android's versionCode and iOS's buildNumber. Android installs an APK over the app on the phone only when its
 * versionCode is not lower, so every APK of `npm run apk` after a version bump upgrades in place, data kept.
 *
 * EAS builds for the stores count on their own: eas.json has `cli.appVersionSource: "remote"` (and
 * `autoIncrement` in production), so EAS ignores these two values and raises its own number by one per build.
 * The version people see (expo.version) is app.json's in both. Throws on a version that isn't major.minor.patch,
 * or whose minor or patch is over VERSION_PART_MAX: a wrong build number must never reach a phone.
 */
export function versionCodeOf(version: string): number {
  const match = /^(\d{1,5})\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor, patch] = (match ?? []).slice(1).map(Number);
  const fits = (n: number | undefined): n is number => n !== undefined && n <= VERSION_PART_MAX;
  if (major === undefined || !fits(minor) || !fits(patch))
    throw new Error(
      `app.json expo.version "${version}" must be major.minor.patch, minor and patch at most ${VERSION_PART_MAX} ` +
        '(e.g. 1.0.1): the build number is made from it. Change it with npm run version:bump.',
    );
  const code = major * 10_000 + minor * 100 + patch;
  if (code < 1)
    throw new Error(`app.json expo.version "${version}" gives build number 0: start at 0.0.1 or more`);
  return code;
}

/** The config with its build numbers (versionCodeOf), when it has a version (tests' configs may have none). */
export function withBuildNumbers(base: ExpoConfig): ExpoConfig {
  if (base.version === undefined) return base;
  const code = versionCodeOf(base.version);
  return {
    ...base,
    android: { ...base.android, versionCode: code },
    ios: { ...base.ios, buildNumber: String(code) },
  };
}

/** The environment this file reads. */
export interface AppConfigEnv extends EasBuild {
  /** EAS file variable: the path of the uploaded google-services.json. */
  googleServicesJson: string | undefined;
  /** EAS file variable: the path of the uploaded GoogleService-Info.plist. */
  googleServiceInfoPlist: string | undefined;
  /** The game server the build points at (stage 14: a store build must point at a real one). */
  server?: ServerEnv;
  /**
   * SF_ALLOW_CLEARTEXT: "1" from `npm run apk -- --server local` (scripts/build-apk.mjs), an APK for a game
   * server on this PC's network, which speaks plain ws:// and http://. Android refuses those in release builds
   * unless the manifest allows cleartext traffic.
   */
  allowCleartext?: string | undefined;
  /**
   * SF_LOCAL_APK: "1" from `npm run apk` (scripts/build-apk.mjs), whose APK is signed with React Native's template
   * debug key (TEMPLATE_DEBUG_KEY_SHA1). Google sign-in then works only if Firebase lists that key.
   */
  localApk?: string | undefined;
}

/**
 * Config plugins for builds on this PC only (`npm run apk`, `expo run:android`), never on EAS's servers (the
 * file says why): every Android library gets the NDK the Android SDK here has, instead of downloading another;
 * on Windows, C++ compiles 2 files at a time per module (memory), and the app's in a folder short enough for
 * the 260-character path limit.
 */
export const LOCAL_BUILD_PLUGINS: readonly string[] = ['./plugins/with-local-native-build.js'];

/** Not on EAS's servers: a build or a run on this PC. */
const isLocalBuild = (build: EasBuild): boolean => build.easBuild !== 'true';

/**
 * Plain http/ws allowed in the APK: only when a local build asks (--server local). Never on EAS's servers, so
 * no cloud build (and no store build) ever allows it.
 */
export const allowsCleartext = (env: AppConfigEnv): boolean =>
  env.allowCleartext === '1' && isLocalBuild(env);

/** An APK of `npm run apk` (signed with the template debug key); never a build on EAS's servers. */
export const isLocalApk = (env: AppConfigEnv): boolean => env.localApk === '1' && isLocalBuild(env);

/**
 * Android's advertising id permission. Firebase Analytics' library asks for it; this app shows no ads and
 * never reads it (firebase.json turns its collection off), so the permission is taken out of the manifest:
 * Play's Data safety form and its "Advertising ID" declaration can then say no.
 */
export const AD_ID_PERMISSION = 'com.google.android.gms.permission.AD_ID';

/** The config plugin of @react-native-google-signin/google-signin, in its Firebase form (no options). */
export const GOOGLE_SIGN_IN_PLUGIN = '@react-native-google-signin/google-signin';

/** A Google OAuth client id ("<project number>-<letters and digits>.apps.googleusercontent.com"). */
const OAUTH_CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/**
 * The SHA-1 of the debug key in React Native's project template (android/app/debug.keystore, alias
 * androiddebugkey), which signs the APKs of `npm run apk`. That key is public: it is the same in every React
 * Native project. While Firebase lists it for this package, anyone can sign an APK named com.mosheg.sudokufight
 * with it, have someone install it, and receive the Firebase session of every Google sign-in made in it. Fine
 * for test phones; a store build refuses it (assertStoreBuildWithoutDebugKey).
 */
export const TEMPLATE_DEBUG_KEY_SHA1 = '5e8f16062ea3cd2c4a0d547876baa6f38cabf625';

/** What google-services.json says about Google sign-in for the app's Android package. */
export interface GoogleSignInSetup {
  /**
   * The web OAuth client (client_type 3), which GoogleSignin.configure({ webClientId }) needs to get an ID token
   * Firebase takes. Null when the file has none (Google sign-in is not enabled in Firebase).
   */
  webClientId: string | null;
  /**
   * The package's Android OAuth clients (client_type 1): Firebase makes one for each SHA-1 added to the Android
   * app. With none, Google answers every sign-in with DEVELOPER_ERROR, so the app shows no Google button.
   */
  androidClients: number;
  /** One of them is for the template debug key (TEMPLATE_DEBUG_KEY_SHA1). */
  debugKey: boolean;
}

const NO_GOOGLE: GoogleSignInSetup = { webClientId: null, androidClients: 0, debugKey: false };

/** A certificate hash as Firebase writes it (40 hex digits, lower case), whatever its case or colons. */
const sha1Of = (hash: unknown): string =>
  typeof hash === 'string' ? hash.replace(/:/g, '').toLowerCase() : '';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const objects = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);

/**
 * Google sign-in's part of google-services.json, for the app's package: the web client id, how many Android
 * clients there are, and whether one is the template debug key's. Reads only those fields (the file holds the
 * API key too; nothing else leaves here).
 */
export function readGoogleSignIn(json: unknown, androidPackage: string | undefined): GoogleSignInSetup {
  if (!isObject(json) || !androidPackage) return NO_GOOGLE;
  const client = objects(json.client).find((c) => {
    const info = isObject(c.client_info) ? c.client_info : {};
    const android = isObject(info.android_client_info) ? info.android_client_info : {};
    return android.package_name === androidPackage;
  });
  if (!client) return NO_GOOGLE;
  const services = isObject(client.services) ? client.services : {};
  const invite = isObject(services.appinvite_service) ? services.appinvite_service : {};
  const oauth = [...objects(client.oauth_client), ...objects(invite.other_platform_oauth_client)];
  const idOf = (c: Json) =>
    typeof c.client_id === 'string' && OAUTH_CLIENT_ID.test(c.client_id) ? c.client_id : null;
  const web = oauth.find((c) => c.client_type === 3 && idOf(c) !== null);
  const androidInfo = objects(client.oauth_client)
    .filter((c) => c.client_type === 1 && idOf(c) !== null)
    .map((c) => (isObject(c.android_info) ? c.android_info : {}))
    .filter((info) => info.package_name === androidPackage);
  return {
    webClientId: web ? idOf(web) : null,
    androidClients: androidInfo.length,
    debugKey: androidInfo.some((info) => sha1Of(info.certificate_hash) === TEMPLATE_DEBUG_KEY_SHA1),
  };
}

/**
 * An Android store build while Firebase still lets the public template debug key sign in with Google (see
 * TEMPLATE_DEBUG_KEY_SHA1) fails on EAS, saying how to take the key out. The file is the build's own copy of
 * Firebase's list, downloaded again after every fingerprint change (docs/FIREBASE-SETUP.md §4א).
 */
export function assertStoreBuildWithoutDebugKey(build: EasBuild, google: GoogleSignInSetup): void {
  if (!isStoreBuild(build) || build.platform === 'ios' || !google.debugKey) return;
  throw new Error(
    "Production build while Firebase lets React Native's public debug key sign in with Google: " +
      `google-services.json lists its SHA-1 (${TEMPLATE_DEBUG_KEY_SHA1}). Anyone could sign an APK with this ` +
      "app's package name with that key and take the Google sign-ins made in it. Remove that fingerprint in " +
      'Firebase (Project settings > Your apps > Sudoku Fight Android), download google-services.json again and ' +
      'upload it with `eas env:create ... --force` (docs/FIREBASE-SETUP.md section 4a).',
  );
}

/** google-services.json at `path` (relative to this folder, or absolute), or null when it can't be read. */
function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(__dirname, path), 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * What the app reads at run time (auth/googleConfig.ts): on which platforms "המשך עם Google" works, and the web
 * client id it configures Google sign-in with.
 */
export interface GoogleSignInExtra {
  android: boolean;
  /** iOS comes later (with Sign in with Apple, which the App Store then requires: spec §23). */
  ios: boolean;
  webClientId: string | null;
}

/** app.json's config with Firebase added for the platforms whose files exist (`exists`: tests pass theirs). */
export function resolveAppConfig(
  config: ExpoConfig,
  env: AppConfigEnv,
  exists: (path: string) => boolean = existsSync,
  readJson: (path: string) => unknown = readJsonFile,
): ExpoConfig {
  const base = withBuildNumbers(config);
  const android = firebaseFile(env.googleServicesJson, LOCAL_ANDROID, exists);
  const ios = firebaseFile(env.googleServiceInfoPlist, LOCAL_IOS, exists);
  assertStoreBuildHasFirebase(env, { android: android !== null, ios: ios !== null });
  assertStoreBuildHasServer(env, env.server ?? {});
  const google = android ? readGoogleSignIn(readJson(android), base.android?.package) : NO_GOOGLE;
  assertStoreBuildWithoutDebugKey(env, google);
  // The key that signs the build must be one Firebase lists, or every Google sign-in ends in DEVELOPER_ERROR.
  // An APK of `npm run apk` is signed with the template debug key; other builds (EAS's key, then Play's) can't
  // be told apart in the file, so any Android client will do.
  const signingKeyListed = isLocalApk(env) ? google.debugKey : google.androidClients > 0;
  const googleSignIn: GoogleSignInExtra = {
    android: google.webClientId !== null && signingKeyListed,
    ios: false,
    webClientId: google.webClientId,
  };
  const extra = {
    ...base.extra,
    firebase: { android: android !== null, ios: ios !== null },
    googleSignIn,
  };
  const cleartext = allowsCleartext(env) ? { android: { usesCleartextTraffic: true } } : null;
  const localPlugins = isLocalBuild(env) ? LOCAL_BUILD_PLUGINS : [];
  if (!android && !ios) {
    const plugins: NonNullable<ExpoConfig['plugins']> = [...localPlugins];
    if (cleartext) plugins.push(['expo-build-properties', cleartext]);
    if (plugins.length === 0) return { ...base, extra };
    return { ...base, extra, plugins: [...(base.plugins ?? []), ...plugins] };
  }

  return {
    ...base,
    extra,
    android: {
      ...base.android,
      ...(android
        ? {
            googleServicesFile: android,
            blockedPermissions: [...(base.android?.blockedPermissions ?? []), AD_ID_PERMISSION],
          }
        : null),
    },
    ios: { ...base.ios, ...(ios ? { googleServicesFile: ios } : null) },
    plugins: [
      ...(base.plugins ?? []),
      ...localPlugins,
      // React Native Firebase needs static frameworks on iOS.
      ['expo-build-properties', { ios: { useFrameworks: 'static' }, ...cleartext }],
      '@react-native-firebase/app',
      '@react-native-firebase/auth',
      '@react-native-firebase/crashlytics',
      // Stage 14: Analytics without Apple's advertising identifier (no IDFA, so no tracking prompt).
      ['@react-native-firebase/analytics', { ios: { withoutAdIdSupport: true } }],
      // "המשך עם Google" (Android first). The Firebase form of the plugin: it reads the Firebase files, and on
      // iOS adds the URL scheme from GoogleService-Info.plist once there is one (nothing without it).
      ...(android ? [GOOGLE_SIGN_IN_PLUGIN] : []),
    ],
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  resolveAppConfig(config as ExpoConfig, {
    // Each variable by its name (lint rule expo/no-dynamic-env-var).
    googleServicesJson: process.env.GOOGLE_SERVICES_JSON,
    googleServiceInfoPlist: process.env.GOOGLE_SERVICE_INFO_PLIST,
    easBuild: process.env.EAS_BUILD,
    profile: process.env.EAS_BUILD_PROFILE,
    platform: process.env.EAS_BUILD_PLATFORM,
    server: {
      host: process.env.EXPO_PUBLIC_SERVER_HOST,
      secure: process.env.EXPO_PUBLIC_SERVER_SECURE,
    },
    allowCleartext: process.env.SF_ALLOW_CLEARTEXT,
    localApk: process.env.SF_LOCAL_APK,
  });
