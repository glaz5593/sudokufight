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
};

export function authErrorCodeOf(error: unknown): AuthErrorCode {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? (FIREBASE_CODES[code] ?? 'unknown') : 'unknown';
}

/** Any thrown value as an AuthError (an AuthError stays as it is). */
export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AuthError(authErrorCodeOf(error), message, error);
}
