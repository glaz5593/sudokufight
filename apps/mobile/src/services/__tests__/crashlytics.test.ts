import { createCrashReporter } from '../crashlytics';

type CrashlyticsModule = typeof import('@react-native-firebase/crashlytics');

function fakeCrashlytics() {
  const instance = { name: 'crashlytics' };
  const mod = {
    getCrashlytics: jest.fn(() => instance),
    setCrashlyticsCollectionEnabled: jest.fn(async () => null),
    recordError: jest.fn(),
    log: jest.fn(),
    setUserId: jest.fn(async () => null),
  };
  return { mod, instance, load: jest.fn(() => mod as unknown as CrashlyticsModule) };
}

describe('Crashlytics (work plan stage 8)', () => {
  it('does nothing, and never loads the module, when the build has no Firebase', () => {
    const { load } = fakeCrashlytics();
    const reporter = createCrashReporter({ configured: false, load });
    expect(reporter.enabled).toBe(false);
    reporter.recordError(new Error('x'));
    reporter.setUser('u');
    reporter.log('hello');
    expect(load).not.toHaveBeenCalled();
  });

  it('collects in release builds only', () => {
    const release = fakeCrashlytics();
    createCrashReporter({ configured: true, release: true, load: release.load, hermes: undefined });
    expect(release.mod.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(release.instance, true);

    const debug = fakeCrashlytics();
    createCrashReporter({ configured: true, release: false, load: debug.load, hermes: undefined });
    expect(debug.mod.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(debug.instance, false);
  });

  it('records errors (anything thrown becomes an Error), with the context as a log line', () => {
    const { mod, instance, load } = fakeCrashlytics();
    const reporter = createCrashReporter({ configured: true, release: true, load, hermes: undefined });
    const error = new Error('render failed');
    reporter.recordError(error, 'error boundary');
    expect(mod.log).toHaveBeenCalledWith(instance, 'error boundary');
    expect(mod.recordError).toHaveBeenCalledWith(instance, error);
    reporter.recordError('a string');
    expect(mod.recordError.mock.calls[1]![1]).toEqual(new Error('a string'));
    reporter.setUser('user-7');
    reporter.setUser(null);
    expect(mod.setUserId.mock.calls).toEqual([
      [instance, 'user-7'],
      [instance, ''],
    ]);
  });

  it('records unhandled promise rejections through Hermes in release builds', () => {
    const { mod, instance, load } = fakeCrashlytics();
    const hermes = { enablePromiseRejectionTracker: jest.fn() };
    createCrashReporter({ configured: true, release: true, load, hermes });
    const options = hermes.enablePromiseRejectionTracker.mock.calls[0]![0] as {
      allRejections: boolean;
      onUnhandled: (id: number, rejection: unknown) => void;
    };
    expect(options.allRejections).toBe(true);
    options.onUnhandled(1, new Error('lost promise'));
    expect(mod.recordError).toHaveBeenCalledWith(instance, new Error('lost promise'));

    const debugHermes = { enablePromiseRejectionTracker: jest.fn() };
    createCrashReporter({
      configured: true,
      release: false,
      load: fakeCrashlytics().load,
      hermes: debugHermes,
    });
    expect(debugHermes.enablePromiseRejectionTracker).not.toHaveBeenCalled();
  });

  it('a module that fails to start leaves a no-op reporter', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reporter = createCrashReporter({
      configured: true,
      load: () => {
        throw new Error('No Firebase App');
      },
    });
    expect(reporter.enabled).toBe(false);
    expect(() => reporter.recordError(new Error('x'))).not.toThrow();
    warn.mockRestore();
  });

  it('reporting never throws', () => {
    const { mod, load } = fakeCrashlytics();
    mod.recordError.mockImplementation(() => {
      throw new Error('native gone');
    });
    const reporter = createCrashReporter({ configured: true, release: true, load, hermes: undefined });
    expect(() => reporter.recordError(new Error('x'))).not.toThrow();
  });
});
