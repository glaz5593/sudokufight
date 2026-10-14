import Constants from 'expo-constants';

import { serverEndpoint } from './server';

/**
 * Which app this is (Moshe, 14.10.2026: "manage the version… and I can see it in the app"): the settings and
 * the login screen show "גרסה 1.0.0", and under it "build a1b2c3d · staging".
 *
 * - version: the installed app's own (expo-application: Android's versionName, iOS's CFBundleShortVersionString),
 *   so it is what is really on the phone; app.json's (the config embedded in the bundle) where there is no
 *   native one. `npm run version:bump` raises it (docs/BUILD-APK.md). expo-application is read lazily and may
 *   be missing: a development build made before it was added has no ExpoApplication native module, and its
 *   module throws as soon as it is loaded; then the config's version shows, instead of the app crashing on the
 *   login and settings screens.
 * - build: the commit `npm run apk` built ("a1b2c3d", "-dirty" when files had changed since it), from
 *   EXPO_PUBLIC_APP_BUILD (scripts/lib/build-apk.mjs buildInfoEnv). None in a build that doesn't set it (Metro
 *   in development, EAS).
 * - server: staging, production or local, from EXPO_PUBLIC_SERVER_LABEL (npm run apk, eas.json); else guessed
 *   from the server's host.
 */
export interface AppVersionInfo {
  /** "1.0.0"; null when neither the native app nor the config says. */
  version: string | null;
  /** "a1b2c3d" or "a1b2c3d-dirty"; null when the build didn't say. */
  build: string | null;
  /** "staging", "production", "local", or a host. */
  server: string;
}

export interface VersionSources {
  native: string | null | undefined;
  config: string | null | undefined;
  build: string | undefined;
  label: string | undefined;
  host: string;
}

/** A commit as git prints it (7 to 40 hex digits), or "nogit"; then "-dirty" or nothing. */
const BUILD_ID = /^(?:[0-9a-f]{7,40}|nogit)(?:-dirty)?$/;
/** A label short and plain enough for one line: letters, digits, dots, dashes, colons. */
const LABEL = /^[A-Za-z0-9.:-]{1,64}$/;
const LAN_OR_LOCAL =
  /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$)|\.local$/i;

const clean = (v: string | null | undefined): string | null => {
  const s = v?.trim();
  return s ? s : null;
};

/** The server's label when the build didn't name it: local for this PC's network, staging, production, or the host. */
export function serverLabelOf(label: string | undefined, host: string): string {
  const named = clean(label);
  if (named && LABEL.test(named)) return named;
  if (LAN_OR_LOCAL.test(host)) return 'local';
  if (/staging/i.test(host)) return 'staging';
  if (/prod/i.test(host)) return 'production';
  return host;
}

/** Pure: what the screens show, from where it comes (tests pass theirs). */
export function readVersionInfo(s: VersionSources): AppVersionInfo {
  const build = clean(s.build);
  return {
    version: clean(s.native) ?? clean(s.config),
    build: build && BUILD_ID.test(build) ? build : null,
    server: serverLabelOf(s.label, s.host),
  };
}

/** The part of expo-application read here. */
export type ApplicationModule = Pick<typeof import('expo-application'), 'nativeApplicationVersion'>;

/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose: the native module may be missing */
const loadApplication = (): ApplicationModule => require('expo-application') as ApplicationModule;
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The installed app's version from expo-application, or null when the binary has no such native module (its
 * module throws when it loads: "Cannot find native module 'ExpoApplication'"), or doesn't say.
 */
export function nativeVersionOf(load: () => ApplicationModule = loadApplication): string | null {
  try {
    return load().nativeApplicationVersion ?? null;
  } catch {
    return null;
  }
}

/** This app's version, build and server. Tests pass their expo-application and config version. */
export function appVersionInfo({
  load,
  configVersion = Constants.expoConfig?.version,
}: { load?: () => ApplicationModule; configVersion?: string | null } = {}): AppVersionInfo {
  return readVersionInfo({
    native: nativeVersionOf(load),
    config: configVersion,
    // Each variable by its name: Metro inlines EXPO_PUBLIC_* only when read this way.
    build: process.env.EXPO_PUBLIC_APP_BUILD,
    label: process.env.EXPO_PUBLIC_SERVER_LABEL,
    host: serverEndpoint.hostname,
  });
}
