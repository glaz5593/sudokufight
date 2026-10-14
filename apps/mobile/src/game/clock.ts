import type { Clock, Scheduler } from '@sudoku-fight/engine';

/**
 * The phone's clock and timers for LocalGameHost (spec §6: in practice the clock is the device's). The engine
 * never reads them itself; tests inject a ManualClock and a ManualScheduler instead.
 */
export const systemClock: Clock = { now: () => Date.now() };

export const timeoutScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Timers whose callbacks never throw out to React Native: on the phone a throw out of a timer is a fatal error
 * in a release build. The game host runs its own clock on them (a lock running out, an interference ending, a
 * turn passing), and hands a listener's error to whoever triggered the update: from one of its ticks that is
 * the timer itself. Such an error goes to `onError` instead, and the game goes on (the host re-armed its clock
 * before anyone heard of the tick).
 */
export function guardedScheduler(base: Scheduler, onError: (error: unknown) => void): Scheduler {
  return {
    setTimeout: (fn, ms) =>
      base.setTimeout(() => {
        try {
          fn();
        } catch (error) {
          try {
            onError(error);
          } catch {
            // Reporting failed too: nothing more to do, and still nothing thrown at the timer.
          }
        }
      }, ms),
    clearTimeout: (handle) => base.clearTimeout(handle),
  };
}
