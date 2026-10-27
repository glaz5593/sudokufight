import Storage from 'expo-sqlite/kv-store';
import * as Updates from 'expo-updates';

import * as crashlytics from '../crashlytics';
import { DIRECTION_RESTART_KEY, directionSettled, restartApp, restartForDirection } from '../restart';

/**
 * Restarts (localization plan 0א, D104): one at a time, and never twice in a row for the same direction. When
 * the app comes back up still in the wrong direction after a restart for it (iOS can reset it on launch, plan
 * 0יא), it goes on without another restart, and the error is recorded.
 */

const reload = jest.mocked(Updates.reloadAsync);
const recordError = jest.fn();

beforeEach(() => {
  reload.mockReset().mockResolvedValue(undefined as never);
  Storage.setItemSync(DIRECTION_RESTART_KEY, '');
  recordError.mockClear();
  jest.spyOn(crashlytics, 'crashReporter').mockReturnValue({
    enabled: true,
    recordError,
    setUser: () => undefined,
    log: () => undefined,
  });
});

afterEach(() => jest.restoreAllMocks());

describe('restarting the app', () => {
  it('two calls while one is on its way restart once', async () => {
    await Promise.all([restartApp(), restartApp()]);
    expect(reload).toHaveBeenCalledTimes(1);
    await restartApp();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('restarts for a direction, and remembers which', () => {
    expect(restartForDirection(true)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Storage.getItemSync(DIRECTION_RESTART_KEY)).toBe('rtl');
  });

  it('still in the wrong direction after a restart for it: no second restart, the error recorded', () => {
    restartForDirection(true);
    reload.mockClear();
    // The next run: still LTR.
    expect(restartForDirection(true)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(recordError).toHaveBeenCalledWith(expect.any(Error), 'i18n: direction');
    expect(String(recordError.mock.calls[0]?.[0])).toContain('still LTR after a restart for rtl');
    // Nor on the runs after it (no restart on every launch), and the error is recorded once.
    expect(restartForDirection(true)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(recordError).toHaveBeenCalledTimes(1);
    // A restart for the other direction (the player chose such a language) is a new one…
    expect(restartForDirection(false)).toBe(true);
  });

  it('…and so is one after a run in the right direction', async () => {
    restartForDirection(true);
    expect(restartForDirection(true)).toBe(false);
    directionSettled();
    // The first restart is over (one at a time).
    await new Promise((done) => setTimeout(done, 0));
    reload.mockClear();
    expect(restartForDirection(true)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a run in the right direction clears it; a restart for the other direction is a new one', () => {
    restartForDirection(true);
    directionSettled();
    expect(Storage.getItemSync(DIRECTION_RESTART_KEY)).toBe('');
    expect(restartForDirection(true)).toBe(true);
    expect(restartForDirection(false)).toBe(true);
    expect(recordError).not.toHaveBeenCalled();
  });
});
