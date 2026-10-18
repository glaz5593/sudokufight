import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Keeping the screen on while the app is open (spec §22; Moshe's device test of 1.0.0, 15.10.2026), on
 * expo-keep-awake: Android's FLAG_KEEP_SCREEN_ON on the app's window, iOS's idle timer turned off. Either acts only
 * while the app is on screen, so the phone still sleeps when the app is in the background. Neither needs a
 * permission.
 *
 * Why it went unnoticed: Expo's dev tools keep the screen on in every development build (under its own default
 * tag), so only a release build showed the phone's own timeout.
 *
 * Errors never reach the app: a binary without the native module, or a call that fails, leaves the phone's
 * timeout as it was. They are logged in development.
 *
 * Taking the tag always releases it first. Android's keep-awake manager sets the window's flag only when its set
 * of tags is empty, and the flag lives on the Activity's window: an Activity made again (a font or display size
 * changed in the background, "Don't keep activities") has a window without it, while a release that came with
 * no current Activity failed and left our tag in the set. A plain take would then change nothing, for the rest
 * of the run. Released and taken again, in order, the flag is set on the window of the moment. That happens on
 * mount and each time the app comes back to the foreground (a start-up call before the Activity is ready fails
 * the same way), always in the foreground, so the screen never dims between the two.
 */

/**
 * Our own tag. Not expo's default one, which its dev tools take and release by themselves in development: the
 * screen may sleep again only when no tag is left (Android's keep-awake manager).
 */
export const KEEP_AWAKE_TAG = 'sudoku-fight';

/** The part of expo-keep-awake used here (tests pass their own). */
export type KeepAwakeModule = Pick<
  typeof import('expo-keep-awake'),
  'activateKeepAwakeAsync' | 'deactivateKeepAwake'
>;

/** The part of React Native's AppState used here. */
export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

export interface KeepScreenOnDeps {
  /** Loads expo-keep-awake; throws when the binary has no such native module. */
  load: () => KeepAwakeModule;
  appState: AppStateLike;
  tag: string;
}

/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose: the native module may be missing */
const loadKeepAwake = (): KeepAwakeModule => require('expo-keep-awake') as KeepAwakeModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const DEVICE: KeepScreenOnDeps = { load: loadKeepAwake, appState: AppState, tag: KEEP_AWAKE_TAG };

/**
 * Keeps the screen on while the calling component is mounted and `active` is true; turning `active` off, or
 * unmounting, gives the phone its own timeout back. Tests pass their `deps`, made once (a new object each render
 * would release and take the tag again).
 */
export function useKeepScreenOn(active: boolean, deps: KeepScreenOnDeps = DEVICE): void {
  const { load, appState, tag } = deps;
  useEffect(() => {
    if (!active) return undefined;
    let keepAwake: KeepAwakeModule;
    try {
      keepAwake = load();
    } catch (error) {
      report(error);
      return undefined;
    }
    let on = true;
    // Release, then take (see above): a release that fails (no tag held, no Activity) still takes it, unless
    // the hook let go meanwhile (its own release went after this one: no take may follow it).
    const take = () =>
      safely(() =>
        safeCall(() => keepAwake.deactivateKeepAwake(tag))
          .catch(report)
          .then(() => (on ? keepAwake.activateKeepAwakeAsync(tag) : undefined)),
      );
    take();
    const foreground = appState.addEventListener('change', (state) => {
      if (state === 'active') take();
    });
    return () => {
      on = false;
      foreground.remove();
      safely(() => keepAwake.deactivateKeepAwake(tag));
    };
  }, [active, load, appState, tag]);
}

/** A call that may throw at once or reject later: neither reaches the app. */
function safely(call: () => Promise<void>): void {
  safeCall(call).catch(report);
}

/** The call's promise; a call that throws at once is a rejection. */
function safeCall(call: () => Promise<void>): Promise<void> {
  try {
    return call();
  } catch (error) {
    return Promise.reject(error);
  }
}

function report(error: unknown): void {
  if (__DEV__) console.warn('[keep-awake]', error);
}
