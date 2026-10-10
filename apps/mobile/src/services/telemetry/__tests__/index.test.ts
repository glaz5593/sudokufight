import { Platform } from 'react-native';

import type { TelemetryClientDeps } from '../client';

/**
 * The app's wiring of telemetry (index.ts): one client per run, the game server's `/v1/events`, this install's
 * id and the app's version in each batch, and no start on a platform the server does not know.
 */

const INSTALL_ID = '7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11';
const mockMade: { deps: TelemetryClientDeps; start: jest.Mock }[] = [];
jest.mock('../client', () => ({
  createTelemetryClient: (deps: TelemetryClientDeps) => {
    const client = { deps, start: jest.fn(), track: jest.fn() };
    mockMade.push(client);
    return client;
  },
}));
jest.mock('../ids', () => ({ getInstallId: async () => INSTALL_ID, uuidV4: () => 'an-id' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0' } } }));

type Index = typeof import('..');
const load = (): Index => {
  let mod!: Index;
  jest.isolateModules(() => {
    mod = jest.requireActual<Index>('..');
  });
  return mod;
};

const realOS = Platform.OS;
afterEach(() => {
  mockMade.length = 0;
  Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
});

describe('the app telemetry', () => {
  it('one client for the run, sending to the game server, with this install and version', async () => {
    const { telemetry } = load();
    expect(telemetry()).toBe(telemetry());
    expect(mockMade).toHaveLength(1);
    const { deps } = mockMade[0]!;
    expect(deps.url).toMatch(/^https?:\/\/[^/]+:\d+\/v1\/events$/);
    expect(await deps.meta()).toEqual({ installId: INSTALL_ID, platform: realOS, appVersion: '0.1.0' });
    expect(deps.newId()).toBe('an-id');
    expect(deps.now()).toBeGreaterThan(Date.UTC(2024, 0, 1));
    // The sign-in's ID token (auth/authStore signedInIdToken): nobody is signed in here.
    expect(deps.idToken).toBeDefined();
    expect(await deps.idToken!()).toBeNull();
  });

  it('startTelemetry starts it', () => {
    const { startTelemetry } = load();
    startTelemetry();
    expect(mockMade[0]!.start).toHaveBeenCalledTimes(1);
  });

  it('on a platform the server does not know, it does not start (events stay in memory)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'windows', configurable: true });
    const { startTelemetry } = load();
    expect(() => startTelemetry()).not.toThrow();
    expect(mockMade).toHaveLength(0);
  });

  it('its timers are the JS timers', () => {
    jest.useFakeTimers();
    try {
      const { telemetry } = load();
      telemetry();
      const { timers } = mockMade[0]!.deps;
      const fired = jest.fn();
      timers.setTimeout(fired, 100);
      const cancelled = timers.setTimeout(fired, 100);
      timers.clearTimeout(cancelled);
      jest.advanceTimersByTime(100);
      expect(fired).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
