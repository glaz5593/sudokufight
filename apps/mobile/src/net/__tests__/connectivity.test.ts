import { checkHealth, CONNECTIVITY, type FetchLike, setHealthCheck, useConnectivity } from '../connectivity';

/** "Is there a connection?" before a game (spec §16.1): GET /health with a time limit, and the shared state. */

afterEach(() => {
  setHealthCheck(null);
  jest.useRealTimers();
});

describe('checkHealth', () => {
  it('asks GET /health once, and an answer that is ok means online', async () => {
    const fetchFn = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => ({ ok: true }));
    await expect(checkHealth({ url: 'http://server:2567/health', fetch: fetchFn })).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://server:2567/health',
      expect.objectContaining({ method: 'GET', signal: expect.anything() }),
    );
  });

  it('a server error or a failed request means no connection; it never throws', async () => {
    await expect(checkHealth({ url: 'x', fetch: async () => ({ ok: false }) })).resolves.toBe(false);
    await expect(
      checkHealth({ url: 'x', fetch: () => Promise.reject(new TypeError('Network request failed')) }),
    ).resolves.toBe(false);
  });

  it('gives up after the time limit, and aborts the request', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = checkHealth({
      url: 'x',
      timeoutMs: 1000,
      fetch: (_url, init) => {
        signal = init.signal;
        return new Promise(() => undefined);
      },
    });
    jest.advanceTimersByTime(1000);
    await expect(pending).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
  });

  it('checks the configured server by default, and waits 5 s at most', () => {
    expect(CONNECTIVITY).toEqual({ timeoutMs: 5000, recheckMs: 10_000 });
  });
});

describe('useConnectivity', () => {
  it('runs no real check under Jest unless a test sets one (stays unknown, as online)', async () => {
    await expect(useConnectivity.getState().check()).resolves.toBe(true);
    expect(useConnectivity.getState()).toMatchObject({ status: 'unknown', checking: false, failures: 0 });
  });

  it('counts the misses in a row, and forgets them once online', async () => {
    let answer = false;
    setHealthCheck(async () => answer);
    const store = useConnectivity;
    const first = store.getState().check();
    expect(store.getState().checking).toBe(true);
    await first;
    expect(store.getState()).toMatchObject({ status: 'offline', checking: false, failures: 1 });
    await store.getState().check();
    expect(store.getState().failures).toBe(2);
    answer = true;
    await store.getState().check();
    expect(store.getState()).toMatchObject({ status: 'online', failures: 0 });
  });

  it('shares a running check, and a check that throws counts as offline', async () => {
    let calls = 0;
    setHealthCheck(() => {
      calls++;
      return Promise.reject(new Error('boom'));
    });
    const [a, b] = [useConnectivity.getState().check(), useConnectivity.getState().check()];
    expect(a).toBe(b);
    await expect(a).resolves.toBe(false);
    expect(calls).toBe(1);
    expect(useConnectivity.getState().status).toBe('offline');
  });
});
