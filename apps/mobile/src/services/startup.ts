import { useEffect, useRef } from 'react';

/**
 * The app's start (spec §22: open in under 2 seconds; work plan stage 13, docs/PERF.md).
 *
 * Before the first screen the root layout does only what that screen needs: the fonts, the language and its
 * direction, and the sign-in state (the Splash covers the rest). Everything else — the usage reports, the
 * progress sync, opening the practice database — starts once the first screen is up and the JS thread is idle
 * (`useAfterFirstScreen`), so it never delays the first frame.
 *
 * `logFirstScreen` writes how long the start took: in development builds, and in a release build made with
 * EXPO_PUBLIC_STARTUP_LOG=1 (docs/PERF.md, "מדידה במכשיר").
 */

/** How long a deferred start waits for the first screen at most (a Splash that stays, e.g. "try again"). */
export const STARTUP_DEFER_MAX_MS = 3000;
/** How long it waits for an idle moment after that, at most. */
export const IDLE_TIMEOUT_MS = 1000;

type Stop = () => void;

interface IdleScheduler {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** Runs `task` when the JS thread is idle (React Native's requestIdleCallback; a timer where it's missing). */
export function whenIdle(
  task: () => void,
  timeout = IDLE_TIMEOUT_MS,
  scheduler: IdleScheduler = globalThis as IdleScheduler,
): Stop {
  const { requestIdleCallback, cancelIdleCallback } = scheduler;
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => task(), { timeout });
    return () => cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(task, 0);
  return () => clearTimeout(handle);
}

/**
 * Starts `start` once, on the first idle moment after `ready` turns true (the first screen is up), or after
 * `maxWaitMs` if it never does. What `start` returns is called when the component unmounts.
 */
export function useAfterFirstScreen(
  ready: boolean,
  start: () => Stop | void,
  maxWaitMs = STARTUP_DEFER_MAX_MS,
): void {
  const begin = useRef(start);
  const state = useRef<{ scheduled: boolean; cancel: Stop | null; stop: Stop | null }>({
    scheduled: false,
    cancel: null,
    stop: null,
  });

  useEffect(() => {
    const s = state.current;
    const schedule = () => {
      if (s.scheduled) return;
      s.scheduled = true;
      s.cancel = whenIdle(() => {
        s.cancel = null;
        s.stop = begin.current() ?? null;
      });
    };
    if (ready) {
      schedule();
      return;
    }
    const timer = setTimeout(schedule, maxWaitMs);
    return () => clearTimeout(timer);
  }, [ready, maxWaitMs]);

  useEffect(() => {
    const s = state.current;
    return () => {
      s.cancel?.();
      s.stop?.();
    };
  }, []);
}

// ---- the start's timing ----------------------------------------------------------------------------------

interface StartupClock {
  /** Metro's prelude: when the bundle started running, on `nativePerformanceNow` (else Date.now). */
  bundleStart?: number;
  /** The same clock now. */
  now: () => number;
  /** React Native's startup marks (performance.rnStartupTiming), on performance.now()'s clock. */
  native?: { startTime?: number; executeJavaScriptBundleEntryPointStart?: number } | null;
  performanceNow?: () => number;
}

export interface StartupTiming {
  /** From the bundle's first line to the first screen. */
  jsMs: number | null;
  /** From the app's native start (when React Native reports it) to the first screen. */
  appMs: number | null;
}

type Globals = {
  __BUNDLE_START_TIME__?: number;
  nativePerformanceNow?: () => number;
  performance?: {
    now?: () => number;
    rnStartupTiming?: { startTime?: number; executeJavaScriptBundleEntryPointStart?: number };
  };
};

function deviceClock(): StartupClock {
  const g = globalThis as Globals;
  const nativeNow = g.nativePerformanceNow;
  let native: StartupClock['native'] = null;
  try {
    native = g.performance?.rnStartupTiming ?? null;
  } catch {
    native = null;
  }
  return {
    bundleStart: g.__BUNDLE_START_TIME__,
    now: typeof nativeNow === 'function' ? () => nativeNow() : () => Date.now(),
    native,
    performanceNow: g.performance?.now ? () => g.performance!.now!() : undefined,
  };
}

const positive = (ms: number): number | null => (Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null);

/** How long the start took, each span on one clock. */
export function startupTiming(clock: StartupClock = deviceClock()): StartupTiming {
  const jsMs = clock.bundleStart === undefined ? null : positive(clock.now() - clock.bundleStart);
  const start = clock.native?.startTime;
  const appMs = start && start > 0 && clock.performanceNow ? positive(clock.performanceNow() - start) : null;
  return { jsMs, appMs };
}

/** The log line: "[startup] first screen: 1234 ms after the app started (JS: 640 ms)". */
export function startupLine({ jsMs, appMs }: StartupTiming): string {
  const parts = [
    appMs === null ? null : `${appMs} ms after the app started`,
    jsMs === null ? null : `${appMs === null ? '' : '('}JS: ${jsMs} ms${appMs === null ? '' : ')'}`,
  ].filter((p): p is string => p !== null);
  return `[startup] first screen: ${parts.length ? parts.join(' ') : 'no timing available'}`;
}

/** Release builds log the start only when built with EXPO_PUBLIC_STARTUP_LOG=1 (inlined at build time). */
export const STARTUP_LOG = __DEV__ || process.env.EXPO_PUBLIC_STARTUP_LOG === '1';

let logged = false;

/**
 * Logs the start once per run (`adb logcat -s ReactNativeJS`, or Metro's terminal). Without a clock to read
 * (Jest, the web) it says nothing.
 */
export function logFirstScreen(
  enabled = STARTUP_LOG,
  log: (line: string) => void = (line) => console.log(line),
  clock?: StartupClock,
): StartupTiming | null {
  if (!enabled || logged) return null;
  logged = true;
  const timing = startupTiming(clock);
  if (timing.jsMs === null && timing.appMs === null) return null;
  log(startupLine(timing));
  return timing;
}

/** Tests: the next logFirstScreen logs again. */
export function resetStartupLog(): void {
  logged = false;
}
