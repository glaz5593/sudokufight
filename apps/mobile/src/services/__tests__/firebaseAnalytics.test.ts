import { createFirebaseAnalytics } from '../firebaseAnalytics';

/**
 * Firebase Analytics (work plan stage 14), against a Jest mock of @react-native-firebase/analytics: nothing
 * without Firebase in the build; collection in release builds only; spec §22's events under GA4's rules;
 * screen_view through logScreenView; and nothing it does can break the app.
 */

const mockInstance = { app: 'analytics' };
jest.mock('@react-native-firebase/analytics', () => ({
  getAnalytics: jest.fn(() => mockInstance),
  setAnalyticsCollectionEnabled: jest.fn(() => Promise.resolve()),
  logEvent: jest.fn(() => Promise.resolve()),
  logScreenView: jest.fn(() => Promise.resolve()),
  setUserId: jest.fn(() => Promise.resolve()),
}));

type AnalyticsModule = typeof import('@react-native-firebase/analytics');
const firebase = jest.requireMock<jest.Mocked<AnalyticsModule>>('@react-native-firebase/analytics');

beforeEach(() => jest.clearAllMocks());

describe('Firebase Analytics', () => {
  it('without Firebase in the build: a no-op that never loads the module', () => {
    const load = jest.fn();
    const sink = createFirebaseAnalytics({ configured: false, load });
    expect(sink.enabled).toBe(false);
    sink.log('app_open', {});
    expect(load).not.toHaveBeenCalled();
    expect(firebase.logEvent).not.toHaveBeenCalled();
  });

  it('loads the module on its own (lazily) when the build has Firebase', () => {
    const sink = createFirebaseAnalytics({ configured: true, release: true });
    expect(sink.enabled).toBe(true);
    expect(firebase.getAnalytics).toHaveBeenCalledTimes(1);
  });

  it('collects in release builds only', () => {
    createFirebaseAnalytics({ configured: true, release: true });
    createFirebaseAnalytics({ configured: true, release: false });
    expect(firebase.setAnalyticsCollectionEnabled.mock.calls).toEqual([
      [mockInstance, true],
      [mockInstance, false],
    ]);
  });

  it("logs spec §22's events under GA4's rules, and never a user id", () => {
    const sink = createFirebaseAnalytics({ configured: true, release: true });
    sink.log('game_end', { mode: 'ranked', result: 'won', score: 41.5, mistakes: 2, durationSec: 312 });
    sink.log('interference_sent', { kind: 'cats', cost: 3 });
    sink.log('register_step', { step: 'account', email: 'dana@example.com' });
    expect(firebase.logEvent.mock.calls).toEqual([
      [
        mockInstance,
        'game_end',
        { mode: 'ranked', result: 'won', score: 41.5, mistakes: 2, duration_sec: 312 },
      ],
      [mockInstance, 'interference_sent', { kind: 'cats', cost: 3 }],
      [mockInstance, 'register_step', { step: 'account' }],
    ]);
    expect(firebase.setUserId).not.toHaveBeenCalled();
  });

  it("screen_view goes through logScreenView, with the route's pattern", () => {
    const sink = createFirebaseAnalytics({ configured: true, release: true });
    sink.log('screen_view', { screen: '/results/[id]' });
    sink.log('screen_view', {});
    expect(firebase.logScreenView.mock.calls).toEqual([
      [mockInstance, { screen_name: '/results/[id]', screen_class: '/results/[id]' }],
    ]);
    expect(firebase.logEvent).not.toHaveBeenCalled();
  });

  it('never breaks the app: a module that fails to start, a call that throws or rejects', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = createFirebaseAnalytics({
      configured: true,
      load: () => {
        throw new Error('No Firebase App');
      },
    });
    expect(broken.enabled).toBe(false);
    expect(() => broken.log('app_open', {})).not.toThrow();
    warn.mockRestore();

    const sink = createFirebaseAnalytics({ configured: true, release: true });
    firebase.logEvent.mockImplementationOnce(() => {
      throw new Error('native gone');
    });
    expect(() => sink.log('app_open', {})).not.toThrow();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      firebase.logScreenView.mockImplementationOnce(() => Promise.reject(new Error('rejected')));
      expect(() => sink.log('screen_view', { screen: '/' })).not.toThrow();
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
