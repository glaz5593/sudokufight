import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { isolate, type Lang } from '../strings';
import { overviewFixture } from '../testing/fixtures';
import {
  fakeServer,
  type FakeServer,
  GOOGLE_AND_PASSWORD,
  GOOGLE_ONLY,
  GOOGLE_WEB,
  type Handler,
  methods,
  PASSWORD_ONLY,
  type Reply,
  renderSite,
  SIGNED_IN,
  SIGNED_OUT,
} from '../testing/server';

/**
 * The login page against a fake server, with the Firebase JS SDK (firebase/app and firebase/auth, which the
 * lazy chunk googleFirebase.ts imports) mocked. Every test starts with a fresh module registry, so `loaded`
 * says whether this test's page loaded the SDK at all.
 */

interface MockAuth {
  app: unknown;
  deps: Record<string, unknown>;
  languageCode: string | null;
  authStateReady(): Promise<void>;
}
interface MockProvider {
  params: Record<string, string>;
}
interface MockUser {
  email: string | null;
  getIdToken(): Promise<string>;
}

const mockSdk = {
  loaded: [] as string[],
  /** The chunk fails to load (no network, or a deploy replaced it). */
  failLoad: false,
  /** When Auth has initialized (authStateReady): at once unless a test holds it back. */
  authReady: Promise.resolve(),
  initializeApp: jest.fn((options: Record<string, unknown>, name: string) => ({ options, name })),
  initializeAuth: jest.fn((app: unknown, deps: Record<string, unknown>): MockAuth => ({
    app,
    deps,
    languageCode: null,
    authStateReady: () => mockSdk.authReady,
  })),
  signInWithPopup: jest.fn<Promise<{ user: MockUser }>, [MockAuth, MockProvider]>(),
  signOut: jest.fn<Promise<void>, [MockAuth]>(),
};

jest.mock('firebase/app', () => {
  mockSdk.loaded.push('firebase/app');
  if (mockSdk.failLoad) throw new TypeError('Failed to fetch dynamically imported module');
  return { initializeApp: mockSdk.initializeApp };
});

jest.mock('firebase/auth', () => {
  mockSdk.loaded.push('firebase/auth');
  class GoogleAuthProvider implements MockProvider {
    params: Record<string, string> = {};
    setCustomParameters(params: Record<string, string>) {
      this.params = params;
      return this;
    }
  }
  return {
    browserPopupRedirectResolver: 'browserPopupRedirectResolver',
    inMemoryPersistence: 'inMemoryPersistence',
    GoogleAuthProvider,
    initializeAuth: mockSdk.initializeAuth,
    signInWithPopup: mockSdk.signInWithPopup,
    signOut: mockSdk.signOut,
  };
});

const EMAIL = 'you@example.com';

const signedInAs = (email: string | null = EMAIL, idToken = 'firebase-id-token') => ({
  user: { email, getIdToken: () => Promise.resolve(idToken) },
});

/** An error as the SDK throws it: a FirebaseError with its `auth/…` code. */
const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetModules();
  mockSdk.loaded.length = 0;
  mockSdk.failLoad = false;
  mockSdk.authReady = Promise.resolve();
  jest.clearAllMocks();
  mockSdk.signInWithPopup.mockReset();
  mockSdk.signInWithPopup.mockResolvedValue(signedInAs());
  mockSdk.signOut.mockReset();
  mockSdk.signOut.mockResolvedValue(undefined);
});

/** Signed out; the server offers `ways`; a sign-in is taken unless `routes` say otherwise. */
function serverFor(ways: Reply, routes: Record<string, Handler> = {}) {
  return fakeServer({
    'GET /session': SIGNED_OUT,
    'GET /auth/methods': ways,
    'POST /login/google': { status: 204 },
    'POST /login': { status: 204 },
    'GET /overview': { body: overviewFixture() },
    ...routes,
  });
}

/** The site on that server. */
function setup(ways: Reply, routes: Record<string, Handler> = {}, lang: Lang = 'en') {
  const server = serverFor(ways, routes);
  renderSite(server, { lang });
  return server;
}

/** Fails the requests to `path` as a dead network does (the first `times`; all by default). */
function failNetwork(server: FakeServer, path: string, times = Infinity) {
  const fetch = server.fetch;
  let failed = 0;
  server.fetch = (url, init) =>
    url.endsWith(path) && failed++ < times
      ? Promise.reject(new TypeError('Failed to fetch'))
      : fetch(url, init);
}

const googleButton = () => screen.findByRole('button', { name: 'Sign in with Google' });
const overview = () => screen.findByRole('heading', { name: 'Overview', level: 1 });

/** The alert's message, without the technical detail under it. */
const messageOf = (alert: HTMLElement) => alert.firstChild?.textContent ?? '';
const detailOf = (alert: HTMLElement) => alert.querySelector('.form-error-detail')?.textContent ?? null;

describe('the ways to sign in (GET /auth/methods)', () => {
  it('password only: the form, no Google button, and the Firebase SDK never loads', async () => {
    const server = setup(PASSWORD_ONLY);
    const input = await screen.findByLabelText('Admin password');
    expect(screen.getByText("With the admin password from the server's settings.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toContain('btn-primary');

    fireEvent.change(input, { target: { value: 'the-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await overview();
    expect(server.requests.find((r) => r.path === '/login')?.body).toEqual({ password: 'the-password' });
    expect(mockSdk.loaded).toEqual([]);
    expect(mockSdk.initializeApp).not.toHaveBeenCalled();
  });

  it('Google only: the Google button, no password; the SDK loads at once with the served config', async () => {
    setup(GOOGLE_ONLY);
    const button = await googleButton();
    expect(screen.getByText('With a Google account that has access to the admin site.')).toBeTruthy();
    expect(screen.queryByLabelText('Admin password')).toBeNull();
    expect(document.activeElement).toBe(button);

    // Loaded before any click, so the click can open the popup straight away.
    await waitFor(() => expect(mockSdk.initializeAuth).toHaveBeenCalledTimes(1));
    expect(mockSdk.loaded.sort()).toEqual(['firebase/app', 'firebase/auth']);
    expect(mockSdk.initializeApp).toHaveBeenCalledWith(
      {
        apiKey: GOOGLE_WEB.apiKey,
        authDomain: GOOGLE_WEB.authDomain,
        projectId: GOOGLE_WEB.projectId,
        appId: GOOGLE_WEB.appId,
      },
      expect.any(String),
    );
    // In memory only: nothing of the Firebase sign-in stays in the browser.
    expect(mockSdk.initializeAuth).toHaveBeenCalledWith(expect.anything(), {
      persistence: 'inMemoryPersistence',
      popupRedirectResolver: 'browserPopupRedirectResolver',
    });
    expect(mockSdk.signInWithPopup).not.toHaveBeenCalled();
  });

  it('a web config without an app id: the SDK gets none', async () => {
    setup(methods(false, { ...GOOGLE_WEB, appId: null }));
    await googleButton();
    await waitFor(() => expect(mockSdk.initializeApp).toHaveBeenCalledTimes(1));
    expect(mockSdk.initializeApp.mock.calls[0]?.[0]).not.toHaveProperty('appId');
  });

  it('both: Google first, then "or", then the password (not the yellow button any more)', async () => {
    setup(GOOGLE_AND_PASSWORD);
    const button = await googleButton();
    const input = screen.getByLabelText('Admin password');
    const or = screen.getByText('or');
    expect(
      screen.getByText(
        'With a Google account that has access to the admin site, or with the admin password.',
      ),
    ).toBeTruthy();
    expect(button.compareDocumentPosition(or) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(or.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('button', { name: 'Sign in' }).className).not.toContain('btn-primary');
  });

  it('shows that it is asking while the answer is on its way', async () => {
    const server = fakeServer({ 'GET /session': SIGNED_OUT, 'GET /auth/methods': GOOGLE_ONLY });
    const answer = deferred<void>();
    const fetch = server.fetch;
    server.fetch = async (url, init) => {
      if (url.endsWith('/auth/methods')) await answer.promise;
      return fetch(url, init);
    };
    renderSite(server);
    const status = await screen.findByText('Loading the ways to sign in…');
    expect(status.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
    answer.resolve();
    await googleButton();
    expect(screen.queryByText('Loading the ways to sign in…')).toBeNull();
  });

  it.each([
    ['neither way', methods(false, null)],
    ['503 disabled', { status: 503, body: { error: 'disabled' } }],
  ])('%s: the admin site is off here, with no way in and "check again"', async (_name, ways) => {
    const server = setup(ways);
    expect(messageOf(await screen.findByRole('alert'))).toBe(
      'The admin site is off on this server: no way to sign in is set up (Google with ADMIN_EMAILS, or ADMIN_PASSWORD).',
    );
    expect(screen.queryByLabelText('Admin password')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(server.gets('/auth/methods')).toHaveLength(2));
    expect(mockSdk.loaded).toEqual([]);
  });

  it('an unreachable server: says so; "check again" asks again and the sign-in appears', async () => {
    const server = serverFor(GOOGLE_ONLY);
    failNetwork(server, '/auth/methods', 1);
    renderSite(server);
    expect(messageOf(await screen.findByRole('alert'))).toBe("Can't reach the server.");
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await googleButton();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a session that ran out: says so above Google, and signing in returns to the same page', async () => {
    let session = true;
    const server = fakeServer({
      'GET /session': () => (session ? SIGNED_IN : SIGNED_OUT),
      'GET /overview': { body: overviewFixture() },
      'GET /installs': () =>
        session ? { body: { items: [], page: 1, pageSize: 50, total: 0 } } : SIGNED_OUT,
      'GET /auth/methods': GOOGLE_ONLY,
      'POST /login/google': () => {
        session = true;
        return { status: 204 };
      },
    });
    renderSite(server);
    await overview();
    session = false;
    act(() => {
      window.location.hash = '#/installs';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const notice = await screen.findByRole('alert');
    expect(messageOf(notice)).toBe('Your session ended. Sign in again.');
    const button = await googleButton();
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(await screen.findByRole('heading', { name: 'Installs', level: 1 })).toBeTruthy();
  });
});

describe('Google sign-in', () => {
  it('the popup, the token to the server, a Firebase sign-out, and the site opens', async () => {
    const popup = deferred<{ user: MockUser }>();
    mockSdk.signInWithPopup.mockReturnValueOnce(popup.promise);
    const server = setup(GOOGLE_ONLY);
    const button = await googleButton();
    fireEvent.click(button);

    // Google's window is open: the button says so and takes no second click.
    await waitFor(() => expect(button.textContent).toBe('Waiting for Google…'));
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    const [auth, provider] = mockSdk.signInWithPopup.mock.calls[0]!;
    expect(provider.params).toEqual({ prompt: 'select_account' });
    expect(auth.languageCode).toBe('en');

    popup.resolve(signedInAs(EMAIL, 'the-id-token'));
    await overview();
    expect(server.requests.filter((r) => r.path === '/login/google')).toMatchObject([
      { method: 'POST', body: { idToken: 'the-id-token' }, credentials: 'same-origin' },
    ]);
    // The session cookie keeps the admin in; Firebase's own sign-in is dropped.
    expect(mockSdk.signOut).toHaveBeenCalledTimes(1);
    expect(mockSdk.signOut).toHaveBeenCalledWith(auth);
  });

  it('in Hebrew: Google speaks Hebrew, and a refusal names the account (isolated); English follows', async () => {
    setup(GOOGLE_ONLY, { 'POST /login/google': { status: 403, body: { error: 'notAllowed' } } }, 'he');
    fireEvent.click(await screen.findByRole('button', { name: 'כניסה עם Google' }));
    const alert = await screen.findByRole('alert');
    expect(messageOf(alert)).toBe(
      `לחשבון ${isolate(EMAIL)} אין גישה לאתר הניהול. אפשר לבחור חשבון Google אחר.`,
    );
    expect(mockSdk.signInWithPopup.mock.calls[0]?.[0].languageCode).toBe('he');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(messageOf(screen.getByRole('alert'))).toBe(
      `The account ${isolate(EMAIL)} has no access to the admin site. Choose another Google account.`,
    );
  });

  it.each([
    [
      403,
      'notAllowed',
      `The account ${isolate(EMAIL)} has no access to the admin site. Choose another Google account.`,
      null,
    ],
    [
      403,
      'unverifiedEmail',
      "Google hasn't verified this account's email address, so it can't sign in here.",
      null,
    ],
    [403, 'wrongProvider', 'Only a Google account can sign in here.', null],
    [
      401,
      'invalidToken',
      "The server couldn't verify the Google sign-in. Try again.",
      'unexpected "aud" claim value',
    ],
    [
      503,
      'unavailable',
      "The server can't check Google sign-ins right now. Try again in a few minutes.",
      null,
    ],
    [400, 'badRequest', 'Something went wrong on the server. Try again.', null],
    [413, 'tooLarge', 'Something went wrong on the server. Try again.', null],
    [500, 'internal', 'Something went wrong on the server. Try again.', null],
  ])('the server answers %i %s: says so under the button', async (status, error, text, detail) => {
    const server = setup(GOOGLE_AND_PASSWORD, {
      'POST /login/google': { status, body: { error, message: 'unexpected "aud" claim value' } },
    });
    const button = await googleButton();
    fireEvent.click(button);
    const alert = await screen.findByRole('alert');
    expect(messageOf(alert)).toBe(text);
    expect(detailOf(alert)).toBe(detail);
    // Under the Google button, which tells about it and has the focus back.
    expect(button.parentElement?.contains(alert)).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(alert.id);
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(button).toHaveProperty('disabled', false);
    expect(button.textContent).toBe('Sign in with Google');
    expect(mockSdk.signOut).toHaveBeenCalledTimes(1);
    expect(server.requests.filter((r) => r.path === '/login/google')).toHaveLength(1);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('too many tries: how long to wait', async () => {
    setup(GOOGLE_ONLY, {
      'POST /login/google': {
        status: 429,
        body: { error: 'tooManyRequests' },
        headers: { 'Retry-After': '30' },
      },
    });
    fireEvent.click(await googleButton());
    expect(messageOf(await screen.findByRole('alert'))).toBe('Too many tries. Try again in 30 seconds.');
  });

  it('an account without an address: "this Google account"', async () => {
    mockSdk.signInWithPopup.mockResolvedValueOnce(signedInAs(null));
    setup(GOOGLE_ONLY, { 'POST /login/google': { status: 403, body: { error: 'notAllowed' } } });
    fireEvent.click(await googleButton());
    expect(messageOf(await screen.findByRole('alert'))).toBe(
      'This Google account has no access to the admin site. Choose another account.',
    );
  });

  it('then another account: the chooser again, and in', async () => {
    mockSdk.signInWithPopup
      .mockResolvedValueOnce(signedInAs('someone@example.com', 'token-1'))
      .mockResolvedValueOnce(signedInAs(EMAIL, 'token-2'));
    const server = setup(GOOGLE_ONLY, {
      'POST /login/google': (req) =>
        (req.body as { idToken: string }).idToken === 'token-2'
          ? { status: 204 }
          : { status: 403, body: { error: 'notAllowed' } },
    });
    fireEvent.click(await googleButton());
    expect(messageOf(await screen.findByRole('alert'))).toContain(isolate('someone@example.com'));
    fireEvent.click(await googleButton());
    await overview();
    expect(server.requests.filter((r) => r.path === '/login/google')).toHaveLength(2);
    expect(mockSdk.signOut).toHaveBeenCalledTimes(2);
    // One Firebase app for the page, however many tries.
    expect(mockSdk.initializeApp).toHaveBeenCalledTimes(1);
  });

  it("the server can't be reached: says so", async () => {
    const server = serverFor(GOOGLE_ONLY);
    failNetwork(server, '/login/google');
    renderSite(server);
    fireEvent.click(await googleButton());
    expect(messageOf(await screen.findByRole('alert'))).toBe("Can't reach the server.");
    expect(mockSdk.signOut).toHaveBeenCalledTimes(1);
  });

  it('403 disabled with the password on: Google goes away, the password stays and says why', async () => {
    setup(GOOGLE_AND_PASSWORD, { 'POST /login/google': { status: 403, body: { error: 'disabled' } } });
    fireEvent.click(await googleButton());
    const alert = await screen.findByRole('alert');
    expect(messageOf(alert)).toBe('Google sign-in is off on this server.');
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
    const input = screen.getByLabelText('Admin password');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    expect(input.getAttribute('aria-invalid')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it.each([
    ['403 disabled, Google only', GOOGLE_ONLY, 403],
    ['503 disabled', GOOGLE_AND_PASSWORD, 503],
  ])('%s: the admin site is off here', async (_name, ways, status) => {
    setup(ways, { 'POST /login/google': { status, body: { error: 'disabled' } } });
    fireEvent.click(await googleButton());
    await waitFor(() =>
      expect(messageOf(screen.getByRole('alert'))).toContain('The admin site is off on this server'),
    );
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
    expect(screen.queryByLabelText('Admin password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it.each([
    ['auth/popup-closed-by-user', "Google's window was closed before an account was chosen.", null],
    ['auth/cancelled-popup-request', "Google's window was closed before an account was chosen.", null],
    ['auth/user-cancelled', "Google's window was closed before an account was chosen.", null],
    [
      'auth/popup-blocked',
      "The browser blocked Google's sign-in window. Allow pop-ups for this site and try again.",
      null,
    ],
    ['auth/network-request-failed', "Can't reach Google. Check the connection and try again.", null],
    [
      'auth/unauthorized-domain',
      `Google sign-in is not allowed on this address (${isolate('localhost')}). Add it to Authorized domains in the Firebase project.`,
      'auth/unauthorized-domain',
    ],
    [
      'auth/operation-not-allowed',
      'Google is not turned on as a sign-in provider in the Firebase project.',
      'auth/operation-not-allowed',
    ],
    [
      'auth/web-storage-unsupported',
      'This browser blocks the storage Google sign-in needs (third-party cookies and site data, e.g. in an Incognito window). Allow it for this site, or use a normal window.',
      'auth/web-storage-unsupported',
    ],
    ['auth/internal-error', "Google sign-in didn't work. Try again.", 'auth/internal-error'],
  ])('Firebase fails with %s: says so, and nothing goes to the server', async (code, text, detail) => {
    mockSdk.signInWithPopup.mockRejectedValueOnce(firebaseError(code));
    const server = setup(GOOGLE_ONLY);
    const button = await googleButton();
    fireEvent.click(button);
    const alert = await screen.findByRole('alert');
    expect(messageOf(alert)).toBe(text);
    expect(detailOf(alert)).toBe(detail);
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(server.requests.some((r) => r.path === '/login/google')).toBe(false);
  });

  it('until the SDK is ready, the button says so and keeps the focus, and a click opens nothing', async () => {
    const ready = deferred<void>();
    mockSdk.authReady = ready.promise;
    setup(GOOGLE_ONLY);
    const button = await screen.findByRole('button', { name: 'Loading Google sign-in…' });
    await waitFor(() => expect(mockSdk.initializeAuth).toHaveBeenCalledTimes(1));
    // Off for clicks, but focusable (aria-disabled), so the focus lands on it.
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);

    ready.resolve();
    await waitFor(() => expect(button.textContent).toBe('Sign in with Google'));
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBe('false');
    // The early click was not kept for later: a popup opened then would be blocked.
    expect(mockSdk.signInWithPopup).not.toHaveBeenCalled();
    fireEvent.click(button);
    await overview();
    expect(mockSdk.signInWithPopup).toHaveBeenCalledTimes(1);
  });

  it("the SDK's chunk fails to load: says so under the button, which loads it again, and only that", async () => {
    mockSdk.failLoad = true;
    setup(GOOGLE_AND_PASSWORD);
    const button = await screen.findByRole('button', { name: 'Load Google sign-in again' });
    const alert = await screen.findByRole('alert');
    expect(messageOf(alert)).toBe(
      "Google sign-in didn't load. Check the connection and try again, or reload the page.",
    );
    expect(button.parentElement?.contains(alert)).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(alert.id);
    expect(mockSdk.initializeApp).not.toHaveBeenCalled();

    mockSdk.failLoad = false;
    fireEvent.click(button);
    // That click loads the SDK, outside any popup's way: the next one signs in.
    await waitFor(() => expect(button.textContent).toBe('Sign in with Google'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockSdk.signInWithPopup).not.toHaveBeenCalled();
    fireEvent.click(button);
    await overview();
    expect(mockSdk.signInWithPopup).toHaveBeenCalledTimes(1);
  });

  it('a config the SDK refuses at start: says why under the button, with the code', async () => {
    mockSdk.initializeAuth.mockImplementationOnce(() => {
      throw firebaseError('auth/invalid-api-key');
    });
    setup(GOOGLE_ONLY);
    await screen.findByRole('button', { name: 'Load Google sign-in again' });
    const alert = await screen.findByRole('alert');
    expect(messageOf(alert)).toBe("Google sign-in didn't work. Try again.");
    expect(detailOf(alert)).toBe('auth/invalid-api-key');
  });
});

describe('password next to Google', () => {
  it('403 disabled for the password: the form goes away, Google stays and says why', async () => {
    setup(GOOGLE_AND_PASSWORD, { 'POST /login': { status: 403, body: { error: 'disabled' } } });
    const button = await googleButton();
    fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByRole('alert');
    expect(messageOf(alert)).toBe('Password sign-in is off on this server. Sign in with Google.');
    expect(screen.queryByLabelText('Admin password')).toBeNull();
    expect(within(button.parentElement!).getByRole('alert')).toBe(alert);
    expect(mockSdk.signInWithPopup).not.toHaveBeenCalled();
  });

  it('a wrong password shows under the password, not under Google', async () => {
    setup(GOOGLE_AND_PASSWORD, { 'POST /login': { status: 401, body: { error: 'unauthorized' } } });
    const button = await googleButton();
    const input = screen.getByLabelText('Admin password');
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByRole('alert');
    expect(messageOf(alert)).toBe('Wrong password.');
    expect(button.parentElement?.contains(alert)).toBe(false);
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
