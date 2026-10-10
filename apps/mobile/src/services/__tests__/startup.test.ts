import { act, renderHook } from '@testing-library/react-native';

import {
  logFirstScreen,
  resetStartupLog,
  STARTUP_DEFER_MAX_MS,
  startupLine,
  startupTiming,
  useAfterFirstScreen,
  whenIdle,
} from '../startup';

beforeEach(() => {
  jest.useFakeTimers();
  resetStartupLog();
});
afterEach(() => jest.useRealTimers());

describe('whenIdle', () => {
  it("uses React Native's requestIdleCallback, with a timeout, and cancels through it", () => {
    let idle: (() => void) | null = null;
    const scheduler = {
      requestIdleCallback: jest.fn((cb: () => void) => {
        idle = cb;
        return 7;
      }),
      cancelIdleCallback: jest.fn(),
    };
    const task = jest.fn();
    const cancel = whenIdle(task, 500, scheduler);
    expect(scheduler.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 });
    expect(task).not.toHaveBeenCalled();
    idle!();
    expect(task).toHaveBeenCalledTimes(1);
    cancel();
    expect(scheduler.cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('falls back to a timer where there is none', () => {
    const task = jest.fn();
    whenIdle(task, 500, {});
    expect(task).not.toHaveBeenCalled();
    jest.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledTimes(1);

    const later = jest.fn();
    const cancel = whenIdle(later, 500, {});
    cancel();
    jest.runAllTimers();
    expect(later).not.toHaveBeenCalled();
  });
});

describe('useAfterFirstScreen (spec §22: open in under 2 s)', () => {
  const idle = async () => {
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
  };

  it('waits for the first screen, starts once on an idle moment, and stops on unmount', async () => {
    const stop = jest.fn();
    const start = jest.fn(() => stop);
    const { rerender, unmount } = await renderHook(
      ({ ready }: { ready: boolean }) => useAfterFirstScreen(ready, start),
      { initialProps: { ready: false } },
    );
    await idle();
    expect(start).not.toHaveBeenCalled();

    await rerender({ ready: true });
    await idle();
    expect(start).toHaveBeenCalledTimes(1);

    // The Splash again (e.g. signing out and in), and back: nothing starts twice.
    await rerender({ ready: false });
    await rerender({ ready: true });
    await act(async () => {
      jest.advanceTimersByTime(STARTUP_DEFER_MAX_MS * 2);
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    await unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('starts anyway when the first screen never comes (a Splash that stays)', async () => {
    const start = jest.fn();
    await renderHook(() => useAfterFirstScreen(false, start));
    await act(async () => {
      jest.advanceTimersByTime(STARTUP_DEFER_MAX_MS - 1);
    });
    expect(start).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2);
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('unmounted before the idle moment: never starts', async () => {
    const start = jest.fn();
    const { unmount } = await renderHook(() => useAfterFirstScreen(true, start));
    await unmount();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(start).not.toHaveBeenCalled();
  });
});

describe('the startup log', () => {
  it('measures the JS part on the prelude’s clock, and the whole start on React Native’s marks', () => {
    expect(
      startupTiming({
        bundleStart: 1_000,
        now: () => 1_640.4,
        native: { startTime: 50_000 },
        performanceNow: () => 51_234,
      }),
    ).toEqual({ jsMs: 640, appMs: 1234 });
    // Nothing known: no numbers rather than wrong ones.
    expect(startupTiming({ now: () => 5, native: { startTime: 0 } })).toEqual({ jsMs: null, appMs: null });
    expect(startupTiming({ bundleStart: 10, now: () => 5 })).toEqual({ jsMs: null, appMs: null });
  });

  it('writes one line', () => {
    expect(startupLine({ jsMs: 640, appMs: 1234 })).toBe(
      '[startup] first screen: 1234 ms after the app started (JS: 640 ms)',
    );
    expect(startupLine({ jsMs: 640, appMs: null })).toBe('[startup] first screen: JS: 640 ms');
    expect(startupLine({ jsMs: null, appMs: null })).toBe('[startup] first screen: no timing available');
  });

  it('logs once per run, and only when enabled (development, or EXPO_PUBLIC_STARTUP_LOG=1)', () => {
    const log = jest.fn();
    const clock = { bundleStart: 0, now: () => 900 };
    expect(logFirstScreen(false, log, clock)).toBeNull();
    expect(log).not.toHaveBeenCalled();
    expect(logFirstScreen(true, log, clock)).toEqual({ jsMs: 900, appMs: null });
    expect(logFirstScreen(true, log, clock)).toBeNull();
    expect(log.mock.calls).toEqual([['[startup] first screen: JS: 900 ms']]);
  });

  it('says nothing without a clock to read (Jest, the web)', () => {
    const log = jest.fn();
    expect(logFirstScreen(true, log, { now: () => 5 })).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});
