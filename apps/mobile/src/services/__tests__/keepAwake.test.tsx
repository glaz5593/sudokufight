// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { render } from '@testing-library/react-native';
import * as ExpoKeepAwake from 'expo-keep-awake';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { type AppStateStatus, Text } from 'react-native';

import RootLayout from '../../../app/_layout';
import { installSignedInPlayer } from '../../auth/testing/testAuth';
import { displayConfig } from '../../config/display';
import { KEEP_AWAKE_TAG, type KeepAwakeModule, type KeepScreenOnDeps, useKeepScreenOn } from '../keepAwake';

/**
 * Spec §22 (Moshe's device test of 1.0.0, 15.10.2026: "האפליקציה צריכה לשמור על מסך דלוק"): the screen stays on
 * while the app is open, on every screen, under the app's own tag; nothing breaks when the native module is
 * missing or a call fails, and a call that failed at start-up is made again when the app comes to the foreground.
 * Each take releases the tag first, so a window made anew (Android recreating the Activity) gets the flag even
 * when the tag was left in the native set.
 */

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../analytics', () => ({ track: jest.fn() }));
jest.mock('../telemetry', () => ({ startTelemetry: jest.fn() }));
// The layout opens the practice database: here it never opens (and is not needed).
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: () => new Promise(() => undefined) }));
// The device's loader (the root layout's) reads this module.
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));

/**
 * A stand-in for expo-keep-awake and AppState, and the hook's deps, made once (as the hook asks). The module
 * behaves as Android's ExpoKeepAwakeManager (expo-keep-awake 57): a set of tags, and the window's
 * FLAG_KEEP_SCREEN_ON set only when the set was empty, cleared only when the last tag goes; with no current
 * Activity both calls fail before touching the set.
 */
function fakeDevice() {
  const native = {
    tags: new Set<string>(),
    /** FLAG_KEEP_SCREEN_ON on the current Activity's window. */
    flag: false,
    /** A current Activity (none: early at start-up, or between an old Activity and its new one). */
    activity: true,
    /** The Activity is made again (a font or display size changed): a new window, without the flag. */
    newWindow() {
      native.flag = false;
    },
  };
  const module = {
    activateKeepAwakeAsync: jest.fn<Promise<void>, [string?]>(async (tag = 'default') => {
      if (!native.activity) throw new Error('no current Activity');
      if (native.tags.size === 0) native.flag = true;
      native.tags.add(tag);
    }),
    deactivateKeepAwake: jest.fn<Promise<void>, [string?]>(async (tag = 'default') => {
      if (!native.activity) throw new Error('no current Activity');
      if (native.tags.size === 1 && native.tags.has(tag)) native.flag = false;
      native.tags.delete(tag);
    }),
  } satisfies KeepAwakeModule;
  const listeners = new Set<(state: AppStateStatus) => void>();
  const appState = {
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      return { remove: () => void listeners.delete(listener) };
    },
    /** The app goes to this state. */
    set: (state: AppStateStatus) => listeners.forEach((l) => l(state)),
    listening: () => listeners.size,
  };
  const load = jest.fn(() => module);
  const deps: KeepScreenOnDeps = { load, appState, tag: KEEP_AWAKE_TAG };
  return { native, module, load, appState, deps };
}

function KeepOn({ active, deps }: { active: boolean; deps: KeepScreenOnDeps }) {
  useKeepScreenOn(active, deps);
  return <Text testID="keep-on">{String(active)}</Text>;
}

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('useKeepScreenOn', () => {
  it('takes the app’s own tag while mounted (released first), and gives it back on unmount', async () => {
    const { native, module, appState, deps } = fakeDevice();
    const view = await render(<KeepOn active deps={deps} />);
    expect(native.flag).toBe(true);
    expect([...native.tags]).toEqual([KEEP_AWAKE_TAG]);
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    // The release before the take (a tag left over must not stop the flag): first, and ours only.
    expect(module.deactivateKeepAwake).toHaveBeenCalledTimes(1);
    expect(module.deactivateKeepAwake).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    expect(module.deactivateKeepAwake.mock.invocationCallOrder[0]).toBeLessThan(
      module.activateKeepAwakeAsync.mock.invocationCallOrder[0]!,
    );
    // Not expo's default tag (ExpoKeepAwakeTag): its dev tools take and release that one by themselves.
    expect(KEEP_AWAKE_TAG).toBe('sudoku-fight');
    expect(KEEP_AWAKE_TAG).not.toBe('ExpoKeepAwakeDefaultTag');

    // A re-render keeps it (no release and take again).
    await view.rerender(<KeepOn active deps={deps} />);
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(module.deactivateKeepAwake).toHaveBeenCalledTimes(1);

    await view.unmount();
    expect(module.deactivateKeepAwake).toHaveBeenCalledTimes(2);
    expect(native.flag).toBe(false);
    expect(native.tags.size).toBe(0);
    expect(appState.listening()).toBe(0);
  });

  it('does nothing while turned off; turning it off gives the tag back, turning it on takes it again', async () => {
    const { native, module, load, appState, deps } = fakeDevice();
    const view = await render(<KeepOn active={false} deps={deps} />);
    expect(load).not.toHaveBeenCalled();
    expect(appState.listening()).toBe(0);
    expect(module.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(module.deactivateKeepAwake).not.toHaveBeenCalled();

    await view.rerender(<KeepOn active deps={deps} />);
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(native.flag).toBe(true);
    await view.rerender(<KeepOn active={false} deps={deps} />);
    expect(module.deactivateKeepAwake).toHaveBeenLastCalledWith(KEEP_AWAKE_TAG);
    expect(native.flag).toBe(false);
    expect(appState.listening()).toBe(0);
    await act(async () => appState.set('active'));
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(native.flag).toBe(false);
    await view.unmount();
    expect(module.deactivateKeepAwake).toHaveBeenCalledTimes(2);
  });

  it('turned off before its release answered: no take after the hook let go', async () => {
    const { native, module, deps } = fakeDevice();
    let answer: () => void = () => undefined;
    module.deactivateKeepAwake.mockImplementationOnce(
      () => new Promise<void>((resolve) => (answer = resolve)),
    );
    const view = await render(<KeepOn active deps={deps} />);
    expect(module.activateKeepAwakeAsync).not.toHaveBeenCalled();
    await view.unmount();
    await act(async () => answer());
    expect(module.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(native.flag).toBe(false);
    expect(native.tags.size).toBe(0);
  });

  it('a start-up call that failed (no Activity yet) is made again when the app comes to the foreground', async () => {
    const { native, module, appState, deps } = fakeDevice();
    native.activity = false;
    const view = await render(<KeepOn active deps={deps} />);
    await act(async () => undefined);
    expect(warn).toHaveBeenCalledWith('[keep-awake]', expect.any(Error));
    expect(native.flag).toBe(false);
    native.activity = true;

    // To the background: nothing (the phone sleeps there anyway). Back: released and taken again.
    await act(async () => appState.set('background'));
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    await act(async () => appState.set('active'));
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
    expect(module.activateKeepAwakeAsync).toHaveBeenLastCalledWith(KEEP_AWAKE_TAG);
    expect(native.flag).toBe(true);
    // Each return does it again: the flag stays, and the tag is held once.
    await act(async () => appState.set('active'));
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledTimes(3);
    expect(native.flag).toBe(true);
    expect([...native.tags]).toEqual([KEEP_AWAKE_TAG]);
    await view.unmount();
    expect(native.flag).toBe(false);
  });

  it('the Activity made again in the background (its new window has no flag): back, the screen stays on', async () => {
    const { native, appState, deps } = fakeDevice();
    const view = await render(<KeepOn active deps={deps} />);
    expect(native.flag).toBe(true);
    await act(async () => appState.set('background'));
    // A font or display size changed: Android makes the Activity again, our tag is still in the set.
    native.newWindow();
    expect([...native.tags]).toEqual([KEEP_AWAKE_TAG]);
    // A take alone would change nothing (the manager adds the flag only to an empty set).
    await act(async () => appState.set('active'));
    expect(native.flag).toBe(true);
    expect([...native.tags]).toEqual([KEEP_AWAKE_TAG]);
    await view.unmount();
    expect(native.flag).toBe(false);
  });

  it('a new root after the old one’s release failed (no Activity then): the mount sets the flag again', async () => {
    const { native, deps } = fakeDevice();
    const old = await render(<KeepOn active deps={deps} />);
    expect(native.flag).toBe(true);
    // The old Activity is gone before the old root's cleanup: its release fails, the tag stays in the set.
    native.activity = false;
    await old.unmount();
    await act(async () => undefined);
    expect([...native.tags]).toEqual([KEEP_AWAKE_TAG]);
    native.activity = true;
    native.newWindow();

    const fresh = await render(<KeepOn active deps={deps} />);
    expect(native.flag).toBe(true);
    expect([...native.tags]).toEqual([KEEP_AWAKE_TAG]);
    await fresh.unmount();
    expect(native.flag).toBe(false);
    expect(native.tags.size).toBe(0);
  });

  it('a build without the native module never crashes: the phone keeps its own timeout', async () => {
    const { appState, deps } = fakeDevice();
    const missing = jest.fn((): KeepAwakeModule => {
      throw new Error("Cannot find native module 'ExpoKeepAwake'");
    });
    const view = await render(<KeepOn active deps={{ ...deps, load: missing }} />);
    expect(view.getByTestId('keep-on')).toHaveTextContent('true');
    expect(missing).toHaveBeenCalledTimes(1);
    expect(appState.listening()).toBe(0);
    await view.unmount();
    // Logged in development only.
    expect(warn).toHaveBeenCalledWith('[keep-awake]', expect.any(Error));
  });

  it('a call that fails (rejects, or throws at once) never reaches the app', async () => {
    const { module, deps } = fakeDevice();
    module.activateKeepAwakeAsync.mockImplementation(() => Promise.reject(new Error('no current Activity')));
    module.deactivateKeepAwake.mockImplementation(() => {
      throw new Error('app context lost');
    });
    const view = await render(<KeepOn active deps={deps} />);
    // Let the rejection settle: an unhandled one would fail the test run.
    await act(async () => undefined);
    await view.unmount();
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    expect(module.deactivateKeepAwake).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    // The release before the take, the take, the release on unmount.
    expect(warn).toHaveBeenCalledTimes(3);

    module.deactivateKeepAwake.mockImplementation(() => Promise.reject(new Error('later')));
    module.activateKeepAwakeAsync.mockImplementation(() => Promise.resolve());
    const again = await render(<KeepOn active deps={deps} />);
    await again.unmount();
    await act(async () => undefined);
    // A failed release does not stop the take that follows it.
    expect(module.activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(5);
  });
});

describe('the root layout', () => {
  it('keeps the screen on from the first screen, app-wide, as the setting says (on)', async () => {
    expect(displayConfig.keepScreenOn).toBe(true);
    await installSignedInPlayer();
    const app = await renderRouter(
      { _layout: RootLayout, index: () => <Text testID="screen-home">home</Text> },
      { initialUrl: '/' },
    );
    await screen.findByTestId('screen-home');
    expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    // Released first (a tag left over from an earlier root must not stop the flag), then taken.
    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(1);
    await app.unmount();
    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(2);
    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenLastCalledWith(KEEP_AWAKE_TAG);
  });
});
