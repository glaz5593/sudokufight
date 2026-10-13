import { GoogleSignInError, loadGoogleSignIn, toGoogleSignInError } from './google';
import { GOOGLE_WEB } from './testing/server';

/** firebase/app and firebase/auth as googleFirebase.ts uses them (pages/LoginPage.test.tsx drives the page). */
const mockSdk = {
  initializeApp: jest.fn((options: Record<string, unknown>, name: string) => ({ options, name })),
  initializeAuth: jest.fn((app: unknown) => ({
    app,
    languageCode: null as string | null,
    authStateReady: (): Promise<void> => Promise.resolve(),
  })),
  signInWithPopup: jest.fn<Promise<unknown>, [unknown, unknown]>(),
  signOut: jest.fn<Promise<void>, [unknown]>(),
};

jest.mock('firebase/app', () => ({ initializeApp: mockSdk.initializeApp }));
jest.mock('firebase/auth', () => ({
  browserPopupRedirectResolver: {},
  inMemoryPersistence: {},
  GoogleAuthProvider: class {
    setCustomParameters() {
      return this;
    }
  },
  initializeAuth: mockSdk.initializeAuth,
  signInWithPopup: mockSdk.signInWithPopup,
  signOut: mockSdk.signOut,
}));

const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

describe('toGoogleSignInError', () => {
  it.each([
    ['auth/popup-closed-by-user', 'popupClosed'],
    ['auth/cancelled-popup-request', 'popupClosed'],
    ['auth/user-cancelled', 'popupClosed'],
    ['auth/popup-blocked', 'popupBlocked'],
    ['auth/network-request-failed', 'network'],
    ['auth/unauthorized-domain', 'unauthorizedDomain'],
    ['auth/operation-not-allowed', 'providerOff'],
    ['auth/web-storage-unsupported', 'webStorage'],
    ['auth/internal-error', 'failed'],
    ['auth/invalid-api-key', 'failed'],
  ])('%s is %s, with its code', (code, failure) => {
    const error = toGoogleSignInError(firebaseError(code));
    expect(error).toBeInstanceOf(GoogleSignInError);
    expect(error).toMatchObject({ failure, code, message: `Firebase: Error (${code}).` });
  });

  it('anything without a code is "failed"; a GoogleSignInError stays as it is', () => {
    expect(toGoogleSignInError(new Error('boom'))).toMatchObject({
      failure: 'failed',
      code: null,
      message: 'boom',
    });
    expect(toGoogleSignInError('odd')).toMatchObject({ failure: 'failed', code: null, message: 'odd' });
    expect(toGoogleSignInError({ code: 42 })).toMatchObject({ failure: 'failed', code: null });
    // Not a key of the table's prototype either.
    expect(toGoogleSignInError({ code: 'toString' })).toMatchObject({ failure: 'failed', code: 'toString' });
    const load = new GoogleSignInError('load', null);
    expect(toGoogleSignInError(load)).toBe(load);
  });
});

describe('loadGoogleSignIn', () => {
  beforeEach(() => jest.clearAllMocks());

  it('one Firebase app per web config, however often the page asks', async () => {
    await loadGoogleSignIn(GOOGLE_WEB);
    await loadGoogleSignIn({ ...GOOGLE_WEB });
    expect(mockSdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(mockSdk.initializeAuth).toHaveBeenCalledTimes(1);

    // Another config (the server's settings changed): another app, under another name.
    await loadGoogleSignIn({ ...GOOGLE_WEB, apiKey: 'another-test-key' });
    expect(mockSdk.initializeApp).toHaveBeenCalledTimes(2);
    const [first, second] = mockSdk.initializeApp.mock.calls;
    expect(first?.[1]).not.toBe(second?.[1]);
  });

  it("signIn's failures come as GoogleSignInError; signOut never rejects", async () => {
    const google = await loadGoogleSignIn(GOOGLE_WEB);
    mockSdk.signInWithPopup.mockRejectedValueOnce(firebaseError('auth/popup-blocked'));
    await expect(google.signIn('en')).rejects.toMatchObject({
      name: 'GoogleSignInError',
      failure: 'popupBlocked',
      code: 'auth/popup-blocked',
    });
    mockSdk.signOut.mockRejectedValueOnce(new Error('offline'));
    await expect(google.signOut()).resolves.toBeUndefined();
  });

  it('ready only once Auth has initialized; a start that failed is not kept, the next try starts again', async () => {
    const config = { ...GOOGLE_WEB, apiKey: 'slow-test-key' };
    const start: { reject?: (error: unknown) => void } = {};
    mockSdk.initializeAuth.mockImplementationOnce((app: unknown) => ({
      app,
      languageCode: null,
      authStateReady: () =>
        new Promise<void>((_resolve, reject) => {
          start.reject = reject;
        }),
    }));
    let settled = false;
    const loading = loadGoogleSignIn(config);
    loading.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 10 && start.reject === undefined; i++) await new Promise((r) => setTimeout(r, 0));
    expect(start.reject).toBeDefined();
    expect(settled).toBe(false);
    start.reject?.(firebaseError('auth/network-request-failed'));
    await expect(loading).rejects.toMatchObject({ failure: 'network', code: 'auth/network-request-failed' });

    // Again: a new app, and this time it starts.
    await expect(loadGoogleSignIn(config)).resolves.toBeDefined();
    expect(mockSdk.initializeApp).toHaveBeenCalledTimes(2);
  });

  it('a config the SDK refuses comes as a GoogleSignInError too', async () => {
    mockSdk.initializeAuth.mockImplementationOnce(() => {
      throw firebaseError('auth/invalid-api-key');
    });
    await expect(loadGoogleSignIn({ ...GOOGLE_WEB, apiKey: 'refused-test-key' })).rejects.toMatchObject({
      failure: 'failed',
      code: 'auth/invalid-api-key',
    });
  });
});
