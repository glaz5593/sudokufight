import type { AdminGoogleWebConfig } from '@sudoku-fight/protocol';

/**
 * Google sign-in for the admin site (spec §27.3), through the Firebase JS SDK: Google's account chooser in a
 * popup, then the Firebase ID token of the account that signed in, for POST /admin/api/login/google.
 *
 * The SDK (firebase/app and firebase/auth only) is a chunk of its own (googleFirebase.ts), loaded only on a
 * server that offers Google sign-in (GET /admin/api/auth/methods): with just the password, the browser never
 * downloads it. The login page loads it as soon as it knows, and takes a click only once it is ready (Auth
 * initialized, which on Safari and phones includes Google's hidden iframe): then the click opens the popup at
 * once, while the browser still counts it as the user's doing. A popup opened later (after a download inside
 * the click) is blocked, Safari's after about a second.
 *
 * Firebase keeps its sign-in in memory only, and the page signs out of it once the server has answered: the
 * server's session cookie is what keeps the admin signed in.
 */

export interface GoogleAccount {
  /** The Firebase ID token of the account that signed in. */
  idToken: string;
  /** Its address as Google gave it; null when it gave none. */
  email: string | null;
}

export interface GoogleSignIn {
  /** Opens Google's account chooser (in `lang`) in a popup. Rejects with a GoogleSignInError. */
  signIn(lang: string): Promise<GoogleAccount>;
  /** Forgets the Firebase sign-in in this page. Never rejects. */
  signOut(): Promise<void>;
}

/**
 * Why a Google sign-in did not happen:
 * - popupClosed: the user closed Google's window (or cancelled) before an account was chosen.
 * - popupBlocked: the browser blocked the window.
 * - network: Google could not be reached.
 * - unauthorizedDomain: this site's host is not on the Firebase project's Authorized domains.
 * - providerOff: Google is not turned on as a sign-in provider in the Firebase project.
 * - webStorage: the browser gives Google's hidden iframe (on the auth domain) no storage: third-party cookies
 *   and site data are blocked (an Incognito window, privacy settings). Trying again doesn't help.
 * - load: the SDK's chunk did not load (no network, or a new deploy replaced it).
 * - failed: anything else; `code` says what.
 */
export type GoogleFailure =
  | 'popupClosed'
  | 'popupBlocked'
  | 'network'
  | 'unauthorizedDomain'
  | 'providerOff'
  | 'webStorage'
  | 'load'
  | 'failed';

export class GoogleSignInError extends Error {
  constructor(
    readonly failure: GoogleFailure,
    /** The Firebase error code (`auth/…`), when there was one. */
    readonly code: string | null,
    message?: string,
  ) {
    super(message ?? code ?? failure);
    this.name = 'GoogleSignInError';
  }
}

/** The Firebase Auth error codes that have a failure of their own; any other is 'failed'. */
const FAILURES: Partial<Record<string, GoogleFailure>> = {
  'auth/popup-closed-by-user': 'popupClosed',
  'auth/cancelled-popup-request': 'popupClosed',
  'auth/user-cancelled': 'popupClosed',
  'auth/popup-blocked': 'popupBlocked',
  'auth/network-request-failed': 'network',
  'auth/unauthorized-domain': 'unauthorizedDomain',
  'auth/operation-not-allowed': 'providerOff',
  'auth/web-storage-unsupported': 'webStorage',
};

/** Any error of the SDK as a GoogleSignInError, by its Firebase code. */
export function toGoogleSignInError(error: unknown): GoogleSignInError {
  if (error instanceof GoogleSignInError) return error;
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  const failure = (code !== null && Object.hasOwn(FAILURES, code) ? FAILURES[code] : undefined) ?? 'failed';
  return new GoogleSignInError(failure, code, error instanceof Error ? error.message : String(error));
}

/**
 * The SDK's chunk, and Google sign-in with this web config (from GET /admin/api/auth/methods), once ready for
 * a click. The bundler and the browser load the chunk once; the chunk makes one Firebase app per config.
 */
export async function loadGoogleSignIn(config: AdminGoogleWebConfig): Promise<GoogleSignIn> {
  let firebase: typeof import('./googleFirebase');
  try {
    firebase = await import('./googleFirebase');
  } catch (error) {
    throw new GoogleSignInError('load', null, error instanceof Error ? error.message : String(error));
  }
  let google: GoogleSignIn;
  try {
    google = await firebase.createGoogleSignIn(config);
  } catch (error) {
    throw toGoogleSignInError(error);
  }
  return {
    signIn: (lang) =>
      google.signIn(lang).catch((error: unknown) => {
        throw toGoogleSignInError(error);
      }),
    signOut: () => google.signOut().catch(() => undefined),
  };
}
