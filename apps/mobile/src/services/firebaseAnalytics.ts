import type { TelemetryEventName, TelemetryProps } from '@sudoku-fight/protocol';

import { firebaseConfigured } from '../auth/chooseProvider';
import { ga4Event, ga4ScreenView } from './ga4';

/**
 * Firebase Analytics (work plan stage 14: "מחברים את track() ל־Firebase Analytics"), through React Native
 * Firebase's modular API. track() (services/analytics.ts) hands every event here as well as to our server.
 *
 * - Only in a build with Firebase for this platform (`extra.firebase`, app.config.ts); otherwise a no-op that
 *   never loads the module.
 * - Collection is on in release builds only (`!__DEV__`), like Crashlytics: a developer's runs stay out of the
 *   reports. firebase.json keeps it off from the native start until this says so, and keeps advertising ids,
 *   ad personalization and automatic screen reporting off for good (no IDFA on iOS either: app.config.ts).
 * - GA4's rules (services/ga4.ts): names, at most 25 parameters, values cut to 100 characters, and no personal
 *   data. `screen_view` goes through logScreenView, with the route's pattern as the screen.
 * - No user id is set: the reports are about the app, not about a person.
 * - Never throws, never waits: a failed call is dropped.
 *
 * The module is required lazily (as in services/crashlytics.ts): a build without Firebase never loads it.
 */

type AnalyticsModule = typeof import('@react-native-firebase/analytics');
type Instance = ReturnType<AnalyticsModule['getAnalytics']>;

export interface AnalyticsSink {
  readonly enabled: boolean;
  log(name: TelemetryEventName, props: TelemetryProps): void;
}

const NOOP: AnalyticsSink = { enabled: false, log: () => undefined };

export interface FirebaseAnalyticsOptions {
  configured?: boolean;
  release?: boolean;
  load?: () => AnalyticsModule;
}

/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see above */
const loadAnalytics = (): AnalyticsModule => require('@react-native-firebase/analytics') as AnalyticsModule;
/* eslint-enable @typescript-eslint/no-require-imports */

/** A call's promise (or nothing) whose failure is dropped: analytics never breaks the app. */
const settle = (result: unknown) => {
  void Promise.resolve(result).catch(() => undefined);
};

/** Firebase Analytics when the build has Firebase; a no-op sink otherwise. Never throws. */
export function createFirebaseAnalytics({
  configured = firebaseConfigured(),
  release = !__DEV__,
  load = loadAnalytics,
}: FirebaseAnalyticsOptions = {}): AnalyticsSink {
  if (!configured) return NOOP;
  let mod: AnalyticsModule;
  let instance: Instance;
  try {
    mod = load();
    instance = mod.getAnalytics();
    settle(mod.setAnalyticsCollectionEnabled(instance, release));
  } catch (error) {
    if (__DEV__) console.warn('[analytics] Firebase Analytics could not start', error);
    return NOOP;
  }
  return {
    enabled: true,
    log(name, props) {
      try {
        if (name === 'screen_view') {
          const screen = ga4ScreenView(props);
          if (screen) settle(mod.logScreenView(instance, screen));
          return;
        }
        const event = ga4Event(name, props);
        if (event) settle(mod.logEvent(instance, event.name, event.params));
      } catch {
        // Analytics must never break the app.
      }
    },
  };
}

let sink: AnalyticsSink | null = null;

/** The app's sink, started on first use (the first track(), app_open). */
export function firebaseAnalytics(): AnalyticsSink {
  sink ??= createFirebaseAnalytics();
  return sink;
}
