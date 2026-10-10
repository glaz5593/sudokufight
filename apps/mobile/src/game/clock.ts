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
