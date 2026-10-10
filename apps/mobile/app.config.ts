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

/**
 * A store build without Firebase for its platform would ship the development sign-in ("מצב פיתוח", tokens a
 * production server refuses): EAS's production profile fails instead, saying what is missing. Only on EAS's
 * servers (where the file variables are), so a local `eas build` or `expo export` is never stopped by it.
 */
export function assertStoreBuildHasFirebase(
  build: EasBuild,
  found: { android: boolean; ios: boolean },
): void {
  if (build.easBuild !== 'true' || build.profile !== 'production') return;
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

/** The environment this file reads. */
export interface AppConfigEnv extends EasBuild {
  /** EAS file variable: the path of the uploaded google-services.json. */
  googleServicesJson: string | undefined;
  /** EAS file variable: the path of the uploaded GoogleService-Info.plist. */
  googleServiceInfoPlist: string | undefined;
}

/** app.json's config with Firebase added for the platforms whose files exist (`exists`: tests pass theirs). */
export function resolveAppConfig(
  base: ExpoConfig,
  env: AppConfigEnv,
  exists: (path: string) => boolean = existsSync,
): ExpoConfig {
  const android = firebaseFile(env.googleServicesJson, LOCAL_ANDROID, exists);
  const ios = firebaseFile(env.googleServiceInfoPlist, LOCAL_IOS, exists);
  assertStoreBuildHasFirebase(env, { android: android !== null, ios: ios !== null });
  const extra = { ...base.extra, firebase: { android: android !== null, ios: ios !== null } };
  if (!android && !ios) return { ...base, extra };

  return {
    ...base,
    extra,
    android: { ...base.android, ...(android ? { googleServicesFile: android } : null) },
    ios: { ...base.ios, ...(ios ? { googleServicesFile: ios } : null) },
    plugins: [
      ...(base.plugins ?? []),
      // React Native Firebase needs static frameworks on iOS.
      ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
      '@react-native-firebase/app',
      '@react-native-firebase/auth',
      '@react-native-firebase/crashlytics',
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
  });
