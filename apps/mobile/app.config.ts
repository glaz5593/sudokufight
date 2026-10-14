import { existsSync } from 'node:fs';
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

/**
 * Android's advertising id permission. Firebase Analytics' library asks for it; this app shows no ads and
 * never reads it (firebase.json turns its collection off), so the permission is taken out of the manifest:
 * Play's Data safety form and its "Advertising ID" declaration can then say no.
 */
export const AD_ID_PERMISSION = 'com.google.android.gms.permission.AD_ID';

/** app.json's config with Firebase added for the platforms whose files exist (`exists`: tests pass theirs). */
export function resolveAppConfig(
  base: ExpoConfig,
  env: AppConfigEnv,
  exists: (path: string) => boolean = existsSync,
): ExpoConfig {
  const android = firebaseFile(env.googleServicesJson, LOCAL_ANDROID, exists);
  const ios = firebaseFile(env.googleServiceInfoPlist, LOCAL_IOS, exists);
  assertStoreBuildHasFirebase(env, { android: android !== null, ios: ios !== null });
  assertStoreBuildHasServer(env, env.server ?? {});
  const extra = { ...base.extra, firebase: { android: android !== null, ios: ios !== null } };
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
  });
