import { LEVEL_RULES } from '@sudoku-fight/engine';
import { act, renderHook } from '@testing-library/react-native';

import { useTestingSwitches } from '../../state/testingSwitches';
import {
  activeSwitches,
  levelRulesNow,
  testingSwitchesAllowed,
  thisBuild,
  useUnlockAllLevels,
} from '../testing';

/**
 * The testing switches of a staging build (1.0.2, so Moshe can try staged practice before he decides): which
 * builds have them, and that a production build never reads them.
 */

const ON = { chainPenalty: true, unlockAllLevels: true };

afterEach(() => {
  useTestingSwitches.setState({ chainPenalty: false, unlockAllLevels: false });
});

describe('which builds have the testing switches', () => {
  it.each([
    [{ server: 'staging', dev: false }, true],
    [{ server: 'staging', dev: true }, true],
    [{ server: 'local', dev: true }, true],
    [{ server: '192.168.1.20', dev: true }, true],
    [{ server: 'production', dev: false }, false],
    [{ server: 'production', dev: true }, false],
    [{ server: 'local', dev: false }, false],
    [{ server: 'sudoku.example.com', dev: false }, false],
  ])('%j: %s', (build, allowed) => {
    expect(testingSwitchesAllowed(build)).toBe(allowed);
    expect(activeSwitches(ON, build)).toEqual(allowed ? ON : { chainPenalty: false, unlockAllLevels: false });
  });

  it('this build: its server label (EXPO_PUBLIC_SERVER_LABEL, else the host) and __DEV__', () => {
    expect(thisBuild()).toEqual({ server: 'local', dev: true });
  });
});

describe('what the code reads', () => {
  it("[D64] the stages' rules: LEVEL_RULES ('accept'), and 'penalty' with the chain switch", () => {
    expect(levelRulesNow({ chainPenalty: false, unlockAllLevels: false })).toBe(LEVEL_RULES);
    expect(levelRulesNow({ chainPenalty: true, unlockAllLevels: false })).toEqual({
      ...LEVEL_RULES,
      chainNotYet: 'penalty',
    });
    // By default from the store, in this (development) build.
    expect(levelRulesNow().chainNotYet).toBe('accept');
    useTestingSwitches.setState({ chainPenalty: true });
    expect(levelRulesNow().chainNotYet).toBe('penalty');
  });

  it('"פתח את כל השלבים": the switch, and never on production', async () => {
    const staging = await renderHook(() => useUnlockAllLevels({ server: 'staging', dev: false }));
    const production = await renderHook(() => useUnlockAllLevels({ server: 'production', dev: false }));
    expect(staging.result.current).toBe(false);
    await act(async () => useTestingSwitches.getState().setUnlockAllLevels(true));
    expect(staging.result.current).toBe(true);
    expect(production.result.current).toBe(false);
  });
});
