import { firebaseConfigured } from '../auth/chooseProvider';

/**
 * Crash reports (work plan stage 8: "Crashlytics מתחבר כבר עכשיו"), through React Native Firebase's modular
 * API. Only when the build has Firebase for this platform; otherwise every call does nothing.
 *
 * - Collection is on in release builds only (`!__DEV__`): a developer's crashes stay on the developer's
 *   machine.
 * - Fatal JS errors and unhandled promise rejections: React Native Firebase installs its own handlers when
 *   Crashlytics starts (ErrorUtils' global handler, and the `promise` rejection tracker). Hermes runs native
 *   promises that tracker can't see, so release builds also register Hermes' own tracker.
 * - The root error boundary (app/_layout.tsx) records render errors with recordError().
 *
 * The module is required lazily (see auth/firebaseProvider.ts): a build without Firebase never loads it.
 */

type CrashlyticsModule = typeof import('@react-native-firebase/crashlytics');
type Instance = ReturnType<CrashlyticsModule['getCrashlytics']>;

interface HermesTracker {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled?: (id: number) => void;
  }) => void;
}

export interface CrashReporter {
  readonly enabled: boolean;
  recordError(error: unknown, context?: string): void;
  setUser(id: string | null): void;
  log(message: string): void;
}

const NOOP: CrashReporter = {
  enabled: false,
  recordError: () => undefined,
  setUser: () => undefined,
  log: () => undefined,
};

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : JSON.stringify(value));

export interface CrashlyticsOptions {
  configured?: boolean;
  release?: boolean;
  load?: () => CrashlyticsModule;
  hermes?: HermesTracker | undefined;
}

/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see above */
const loadCrashlytics = (): CrashlyticsModule =>
  require('@react-native-firebase/crashlytics') as CrashlyticsModule;
/* eslint-enable @typescript-eslint/no-require-imports */

/** Starts Crashlytics when the build has Firebase; a no-op reporter otherwise. Never throws. */
export function createCrashReporter({
  configured = firebaseConfigured(),
  release = !__DEV__,
  load = loadCrashlytics,
  hermes = (globalThis as { HermesInternal?: HermesTracker }).HermesInternal,
}: CrashlyticsOptions = {}): CrashReporter {
  if (!configured) return NOOP;
  let mod: CrashlyticsModule;
  let instance: Instance;
  try {
    mod = load();
    instance = mod.getCrashlytics();
    void mod.setCrashlyticsCollectionEnabled(instance, release).catch(() => undefined);
  } catch (error) {
    if (__DEV__) console.warn('[crashlytics] could not start', error);
    return NOOP;
  }

  const reporter: CrashReporter = {
    enabled: true,
    recordError(error, context) {
      try {
        if (context) mod.log(instance, context);
        mod.recordError(instance, asError(error));
      } catch {
        // Reporting must never be the thing that breaks.
      }
    },
    setUser(id) {
      void mod.setUserId(instance, id ?? '').catch(() => undefined);
    },
    log(message) {
      try {
        mod.log(instance, message);
      } catch {
        // as above
      }
    },
  };

  if (release) {
    hermes?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => reporter.recordError(rejection, 'unhandled promise rejection'),
    });
  }
  return reporter;
}

let reporter: CrashReporter | null = null;

/** The app's reporter, started on first use. */
export function crashReporter(): CrashReporter {
  reporter ??= createCrashReporter();
  return reporter;
}
