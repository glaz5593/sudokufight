import { AuthError, type AuthErrorCode } from './types';

/**
 * Firebase Auth's error codes ("auth/wrong-password") in the app's terms. Anything else is 'unknown', and
 * keeps the original error as its cause (for Crashlytics).
 */
const FIREBASE_CODES: Record<string, AuthErrorCode> = {
  'auth/wrong-password': 'wrongPassword',
  'auth/user-not-found': 'userNotFound',
  'auth/invalid-credential': 'invalidCredentials',
  'auth/invalid-login-credentials': 'invalidCredentials',
  'auth/too-many-requests': 'tooManyRequests',
  'auth/network-request-failed': 'network',
  'auth/email-already-in-use': 'emailInUse',
  'auth/invalid-email': 'invalidEmail',
  'auth/missing-email': 'invalidEmail',
  'auth/weak-password': 'weakPassword',
  // A password policy turned on in the Firebase console (Authentication › Settings) asking for more than the
  // app's 8 characters. It should stay off (spec §3.1); if it is on, the player at least hears why.
  'auth/password-does-not-meet-requirements': 'weakPassword',
  'auth/requires-recent-login': 'requiresRecentLogin',
  'auth/user-disabled': 'userDisabled',
  'auth/user-token-expired': 'requiresRecentLogin',
  'auth/no-current-user': 'noUser',
  // Google sign-in (firebaseProvider.ts): the address has an account that Firebase won't link by itself.
  'auth/account-exists-with-different-credential': 'accountExistsWithPassword',
  'auth/user-mismatch': 'userMismatch',
};

/**
 * Firebase's answers to a Google credential that mean something else than with a password: Google's ID token
 * was refused (made for another project's client id: the build's config), or Google sign-in is off in the
 * Firebase console. Both are for whoever builds the app, not for the player to retry.
 */
const FIREBASE_GOOGLE_CODES: Record<string, AuthErrorCode> = {
  'auth/invalid-credential': 'googleConfig',
  'auth/operation-not-allowed': 'googleConfig',
};

/**
 * Google Play services' status codes as @react-native-google-signin/google-signin rejects with them on Android
 * (strings; CommonStatusCodes): DEVELOPER_ERROR is a build that Google doesn't know (its signing key's SHA-1 is
 * not in Firebase, or the web client id is wrong), NETWORK_ERROR no connection.
 */
export const GOOGLE_DEVELOPER_ERROR = '10';
export const GOOGLE_NETWORK_ERROR = '7';

/** The library's own codes (its `statusCodes`, read from the native module at run time). */
export interface GoogleStatusCodes {
  SIGN_IN_CANCELLED: string;
  IN_PROGRESS: string;
  PLAY_SERVICES_NOT_AVAILABLE: string;
}

const codeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

export function authErrorCodeOf(error: unknown): AuthErrorCode {
  const code = codeOf(error);
  return typeof code === 'string' ? (FIREBASE_CODES[code] ?? 'unknown') : 'unknown';
}

/** Any thrown value as an AuthError (an AuthError stays as it is). */
export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AuthError(authErrorCodeOf(error), message, error);
}

/** A failure of the Google sign-in (the library's, or Firebase's answer to Google's token) in the app's terms. */
export function googleAuthErrorCodeOf(error: unknown, status: GoogleStatusCodes): AuthErrorCode {
  const code = codeOf(error);
  if (typeof code !== 'string') return 'unknown';
  if (code === status.SIGN_IN_CANCELLED) return 'cancelled';
  if (code === status.IN_PROGRESS) return 'inProgress';
  if (code === status.PLAY_SERVICES_NOT_AVAILABLE) return 'playServices';
  if (code === GOOGLE_DEVELOPER_ERROR) return 'googleConfig';
  if (code === GOOGLE_NETWORK_ERROR) return 'network';
  return FIREBASE_GOOGLE_CODES[code] ?? FIREBASE_CODES[code] ?? 'unknown';
}

/** Any failure of a Google sign-in as an AuthError (an AuthError stays as it is). */
export function toGoogleAuthError(error: unknown, status: GoogleStatusCodes): AuthError {
  if (error instanceof AuthError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AuthError(googleAuthErrorCodeOf(error, status), message, error);
}
