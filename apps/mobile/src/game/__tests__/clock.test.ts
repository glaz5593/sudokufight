import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';

import { guardedScheduler } from '../clock';

/** The game's timers on the phone (bug 9): a throw out of a timer is fatal in a release build. */
describe('guardedScheduler', () => {
  it('runs the timers as the base does, and clears them', () => {
    const base = new ManualScheduler(new ManualClock(0));
    const timers = guardedScheduler(base, jest.fn());
    const ran: string[] = [];
    timers.setTimeout(() => ran.push('a'), 100);
    const b = timers.setTimeout(() => ran.push('b'), 200);
    timers.clearTimeout(b);
    base.advance(300);
    expect(ran).toEqual(['a']);
  });

  it('an error out of a callback goes to onError, never to the timer', () => {
    const base = new ManualScheduler(new ManualClock(0));
    const onError = jest.fn();
    const boom = new Error('a listener failed');
    guardedScheduler(base, onError).setTimeout(() => {
      throw boom;
    }, 10);
    expect(() => base.advance(10)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('a report that fails is not thrown either', () => {
    const base = new ManualScheduler(new ManualClock(0));
    const timers = guardedScheduler(base, () => {
      throw new Error('reporting failed');
    });
    timers.setTimeout(() => {
      throw new Error('a listener failed');
    }, 10);
    expect(() => base.advance(10)).not.toThrow();
  });
});
