/**
 * Sign-in for the app (spec §3.3, §17.1 Firebase Auth; work plan stage 8). The screens and the auth store
 * talk to an AuthProvider and never to Firebase itself, so the same app runs:
 * - with Firebase (FirebaseAuthProvider) once its config files are in apps/mobile/config/firebase/, and
 * - without them (DevAuthProvider): local accounts on the phone, marked "מצב פיתוח" on screen, which only a
 *   server outside production accepts.
 *
 * An AuthProvider knows who signed in (email and password); the player's profile (name, avatar, country,
 * ratings) lives on the game server, behind the ID token this provider issues (spec §18 HTTP API).
 */

export interface AuthUser {
  /** The provider's id of the account (Firebase uid). */
  uid: string;
  email: string | null;
  /** [D22] Verification never blocks practice; ranked play may ask for it (config/account.ts). */
  emailVerified: boolean;
}

export type AuthProviderKind = 'firebase' | 'dev';

export interface AuthProvider {
  readonly kind: AuthProviderKind;
  /**
   * Who is signed in when the app starts (the provider keeps its own session across runs), after the
   * provider's first answer. Null: nobody.
   */
  restore(): Promise<AuthUser | null>;
  /** The signed-in user right now, or null. */
  currentUser(): AuthUser | null;
  signIn(email: string, password: string): Promise<AuthUser>;
  /** Creates the account and signs it in. */
  signUp(email: string, password: string): Promise<AuthUser>;
  /** [D22] Sends the verification link to the signed-in user. */
  sendEmailVerification(): Promise<void>;
  /** Reads the signed-in user again (e.g. after the player opened the verification link). */
  reloadUser(): Promise<AuthUser>;
  /** [D22] "שכחתי סיסמה". Resolves the same whether or not the address has an account (no enumeration). */
  sendPasswordReset(email: string): Promise<void>;
  /** Asks for the password again before something sensitive (account deletion). */
  reauthenticate(password: string): Promise<void>;
  /** Deletes the signed-in account at the provider. Needs a recent sign-in (reauthenticate first). */
  deleteUser(): Promise<void>;
  signOut(): Promise<void>;
  /** The token every HTTP call carries (spec §18). Firebase: an ID token; dev: "dev:<uid>". */
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

/**
 * Why a provider call failed, in the app's words (the screens map each to a message, en + he). Firebase's
 * codes map onto these in errors.ts.
 */
export const AUTH_ERROR_CODES = [
  'wrongPassword',
  'userNotFound',
  /** Wrong email or password, without saying which (Firebase's email-enumeration protection). */
  'invalidCredentials',
  'tooManyRequests',
  'network',
  'emailInUse',
  'invalidEmail',
  'weakPassword',
  /** Deleting the account needs a fresh sign-in. */
  'requiresRecentLogin',
  'userDisabled',
  /** The call needs a signed-in user and there is none. */
  'noUser',
  'unknown',
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string = code,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const isAuthError = (e: unknown): e is AuthError => e instanceof AuthError;

/** expo-sqlite's key-value store, as the auth code uses it (an in-memory one in tests). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
