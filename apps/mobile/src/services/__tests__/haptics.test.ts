import { AppState } from 'react-native';

import { useSettings } from '../../state/settings';
import {
  createHaptics,
  HAPTIC_MIN_GAP_MS,
  HAPTIC_PATTERNS,
  LAUNCH_SECOND_KNOCK_MS,
  type HapticPattern,
  type HapticsService,
} from '../haptics';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const H = jest.requireMock<{
  selectionAsync: jest.Mock;
  impactAsync: jest.Mock;
  notificationAsync: jest.Mock;
}>('expo-haptics');

/** Every haptic call so far, as "selection", "impact:medium", "notify:error"… */
const calls = (): string[] =>
  [
    ...H.selectionAsync.mock.calls.map((_, i) => [
      H.selectionAsync.mock.invocationCallOrder[i]!,
      'selection',
    ]),
    ...H.impactAsync.mock.calls.map((a, i) => [H.impactAsync.mock.invocationCallOrder[i]!, `impact:${a[0]}`]),
    ...H.notificationAsync.mock.calls.map((a, i) => [
      H.notificationAsync.mock.invocationCallOrder[i]!,
      `notify:${a[0]}`,
    ]),
  ]
    .sort((a, b) => (a[0] as number) - (b[0] as number))
    .map((x) => x[1] as string);

/** Lets the end-of-turn flush run. */
const turn = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

let clock = 1_000;
let haptics: HapticsService;

beforeEach(() => {
  jest.clearAllMocks();
  useSettings.setState({ haptics: true });
  clock = 1_000;
  haptics = createHaptics({ now: () => clock });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('haptics: the calls (motion.md §7)', () => {
  const expected: Record<Exclude<HapticPattern, 'launch'>, string> = {
    selection: 'selection',
    light: 'impact:light',
    medium: 'impact:medium',
    heavy: 'impact:heavy',
    success: 'notify:success',
    warning: 'notify:warning',
    error: 'notify:error',
  };

  it.each(Object.entries(expected))('%s → %s', async (pattern, call) => {
    haptics.fire(pattern as HapticPattern);
    await turn();
    expect(calls()).toEqual([call]);
  });

  it('every pattern has a call', () => {
    expect([...Object.keys(expected), 'launch'].sort()).toEqual([...HAPTIC_PATTERNS].sort());
  });

  it('launch is two medium knocks, 90 ms apart', async () => {
    jest.useFakeTimers();
    haptics.fire('launch');
    await turn();
    expect(calls()).toEqual(['impact:medium']);
    jest.advanceTimersByTime(LAUNCH_SECOND_KNOCK_MS - 1);
    expect(calls()).toEqual(['impact:medium']);
    jest.advanceTimersByTime(1);
    expect(calls()).toEqual(['impact:medium', 'impact:medium']);
  });
});

describe('haptics: settings and app state', () => {
  it('buzzes nothing while haptics are off', async () => {
    useSettings.setState({ haptics: false });
    HAPTIC_PATTERNS.forEach((p) => haptics.fire(p));
    await turn();
    expect(calls()).toEqual([]);
  });

  it('follows the setting live', async () => {
    useSettings.setState({ haptics: false });
    haptics.fire('error');
    await turn();
    useSettings.setState({ haptics: true });
    haptics.fire('error');
    await turn();
    expect(calls()).toEqual(['notify:error']);
  });

  it('drops a haptic asked for just before haptics were turned off', async () => {
    haptics.fire('success');
    useSettings.setState({ haptics: false });
    await turn();
    expect(calls()).toEqual([]);
  });

  it('skips the second launch knock when haptics are turned off in between', async () => {
    jest.useFakeTimers();
    haptics.fire('launch');
    await turn();
    useSettings.setState({ haptics: false });
    jest.advanceTimersByTime(LAUNCH_SECOND_KNOCK_MS);
    expect(calls()).toEqual(['impact:medium']);
  });

  it('buzzes nothing while the app is in the background', async () => {
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    try {
      haptics.fire('success');
      await turn();
      expect(calls()).toEqual([]);
    } finally {
      Object.defineProperty(AppState, 'currentState', original);
    }
  });
});

describe('haptics: one per 80 ms, the strongest wins', () => {
  it('merges haptics of the same turn into the strongest one', async () => {
    haptics.fire('selection');
    haptics.fire('error');
    haptics.fire('light');
    await turn();
    expect(calls()).toEqual(['notify:error']);
  });

  // Error > Heavy > Success > Warning > Medium > Light > Selection
  const order: HapticPattern[] = ['error', 'heavy', 'success', 'warning', 'medium', 'light', 'selection'];
  const pairs = order.slice(1).map((weaker, i) => [order[i]!, weaker] as const);

  it.each(pairs)('%s beats %s in the same turn, in either order', async (stronger, weaker) => {
    const run = async (...patterns: HapticPattern[]) => {
      jest.clearAllMocks();
      haptics.reset();
      patterns.forEach((p) => haptics.fire(p));
      await turn();
      return calls();
    };
    const alone = await run(stronger);
    expect(await run(weaker, stronger)).toEqual(alone);
    expect(await run(stronger, weaker)).toEqual(alone);
    expect(await run(weaker)).not.toEqual(alone);
  });

  it('drops an equal or weaker haptic inside the gap, and fires once the gap has passed', async () => {
    haptics.fire('medium');
    await turn();
    clock += HAPTIC_MIN_GAP_MS - 1;
    haptics.fire('medium');
    haptics.fire('selection');
    await turn();
    expect(calls()).toEqual(['impact:medium']);
    clock += 1;
    haptics.fire('selection');
    await turn();
    expect(calls()).toEqual(['impact:medium', 'selection']);
  });

  it('lets a stronger haptic through inside the gap, so an error is never lost', async () => {
    haptics.fire('selection');
    await turn();
    clock += 10;
    haptics.fire('error');
    await turn();
    expect(calls()).toEqual(['selection', 'notify:error']);
  });

  it('reset forgets the last haptic and anything pending', async () => {
    haptics.fire('error');
    haptics.reset();
    await turn();
    expect(calls()).toEqual([]);
    haptics.fire('selection');
    await turn();
    expect(calls()).toEqual(['selection']);
  });
});

describe('haptics: errors', () => {
  it('swallows a rejected call and logs it in development', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    H.notificationAsync.mockImplementationOnce(() => Promise.reject(new Error('no vibrator')));
    haptics.fire('error');
    await turn();
    await turn();
    expect(warn).toHaveBeenCalledWith('[haptics]', expect.any(Error));
  });

  it('swallows a call that throws', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    H.selectionAsync.mockImplementationOnce(() => {
      throw new Error('native module missing');
    });
    haptics.fire('selection');
    await expect(turn()).resolves.toBeUndefined();
  });
});
