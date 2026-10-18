import Storage from 'expo-sqlite/kv-store';

import { createAccountApi } from '../api/accountApi';
import { createMeCache } from '../api/me';
import { accountConfig } from '../config/account';
import { httpBaseUrl } from '../config/server';
import { setNetIdentitySource } from '../net/identity';
import { crashReporter } from '../services/crashlytics';
import { type AuthDeps, setDefaultAuthDeps } from './authStore';
import { chooseAuthProvider } from './chooseProvider';
import { accountNetIdentity } from './netIdentity';

/**
 * Accounts (work plan stage 8): the auth store and its actions, wired to the phone. The provider is
 * Firebase when the build has it, the development sign-in otherwise (chooseProvider.ts); the account API
 * is the game server's (config/server.ts).
 */
export function defaultAuthDeps(): AuthDeps {
  const provider = chooseAuthProvider();
  const crash = crashReporter();
  return {
    provider,
    api: createAccountApi({
      baseUrl: httpBaseUrl(),
      getToken: async (forceRefresh) => (provider.currentUser() ? provider.getIdToken(forceRefresh) : null),
      fetch: (url, init) => fetch(url, init),
      timeoutMs: accountConfig.requestTimeoutMs,
    }),
    meCache: createMeCache(Storage),
    onIdentity: (id) => crash.setUser(id),
    report: (error, where) => crash.recordError(error, `auth: ${where}`),
  };
}

setDefaultAuthDeps(defaultAuthDeps);
// Game rooms know the player by the account's ID token (net/identity.ts; signed out: the dev identity).
setNetIdentitySource(() => accountNetIdentity());

export {
  type AuthDeps,
  authDeps,
  type AuthState,
  type AuthStatus,
  checkEmailVerified,
  deleteAccount,
  deleteAccountWithGoogle,
  type DeleteOutcome,
  fetchMe,
  type GoogleRegisterOutcome,
  type GoogleSignInOutcome,
  initAuth,
  leaveRegistration,
  refreshMe,
  refreshMeIfStale,
  registerProfile,
  registerWithGoogle,
  retryLoad,
  sendPasswordReset,
  sendVerificationEmail,
  setAuthDeps,
  showRankedResult,
  signedInIdToken,
  signIn,
  signInWithGoogle,
  signOut,
  signUpAndRegister,
  updateProfile,
  useAuth,
} from './authStore';
export { chooseAuthProvider, firebaseConfigured } from './chooseProvider';
export { createDevAuthProvider } from './devProvider';
export { createFirebaseAuthProvider } from './firebaseProvider';
export { authErrorCodeOf, googleAuthErrorCodeOf, toAuthError, toGoogleAuthError } from './errors';
export { type GoogleSignInConfig, googleSignInConfig } from './googleConfig';
export { accountNetIdentity } from './netIdentity';
export * from './password';
export { redirectFor, ROUTES } from './redirect';
export { defaultCountry, useRegistrationDraft } from './registrationDraft';
export { useAuthGate } from './useAuthGate';
export { canPlayRanked, canPractice } from './verification';
export {
  AuthError,
  type AuthErrorCode,
  type AuthProvider,
  type AuthUser,
  type GoogleAuth,
  isAuthError,
  type SignInMethod,
} from './types';
