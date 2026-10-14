/**
 * Sign-in for the app (spec §3.3, §17.1 Firebase Auth; work plan stage 8). The screens and the auth store
 * talk to an AuthProvider and never to Firebase itself, so the same app runs:
 * - with Firebase (FirebaseAuthProvider) once its config files are in apps/mobile/config/firebase/, and
 * - without them (DevAuthProvider): local accounts on the phone, marked "מצב פיתוח" on screen, which only a
 *   server outside production accepts.
 *
 * An AuthProvider knows who signed in (email and password, or Google: Moshe, 14.10.2026); the player's profile
 * (name, avatar, country, ratings) lives on the game server, behind the ID token this provider issues (spec §18
 * HTTP API).
 */

/**
 * How an account signs in: its Firebase providers ("password", "google.com"). An account can have both: Firebase
 * keeps one account per email address, and links Google to an existing one in some cases (firebaseProvider.ts).
 */
export type SignInMethod = 'password' | 'google';

export interface AuthUser {
  /** The provider's id of the account (Firebase uid). */
  uid: string;
  email: string | null;
  /**
   * [D22] Verification never blocks practice; ranked play may ask for it (config/account.ts). A Google sign-in
   * comes verified (Google vouches for the address), so it never sees the verification screen.
   */
  emailVerified: boolean;
  /** How this account signs in (the settings show it; deletion asks for the password or for Google). */
  methods: readonly SignInMethod[];
}

/**
 * "המשך עם Google": only a Firebase build with Google's web client id has it (googleConfig.ts); the development
 * sign-in has none, and then the screens show no Google button.
 */
export interface GoogleAuth {
  /**
   * Google's account chooser, then the Firebase sign-in with Google's ID token. A new Google user becomes a new
   * Firebase account (verified email); an existing one signs in. Throws AuthError: 'cancelled' when the player
   * closes the chooser (nothing changed), 'inProgress', 'playServices', 'googleConfig' (DEVELOPER_ERROR: this
   * build's SHA-1 is not in Firebase), 'accountExistsWithPassword', 'network'…
   */
  signIn(): Promise<AuthUser>;
  /**
   * Asks for the Google account again before something sensitive (account deletion), with the chooser shown.
   * Throws AuthError ('cancelled', 'userMismatch' when another Google account is chosen, …).
   */
  reauthenticate(): Promise<void>;
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
  /** "המשך עם Google", when this build has it (see GoogleAuth). */
  readonly google?: GoogleAuth;
  /** Deletes the signed-in account at the provider. Needs a recent sign-in (reauthenticate first). */
  deleteUser(): Promise<void>;
  /** Signs out; also out of Google, so its account chooser shows again next time. */
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
  /** The player closed Google's account chooser: nothing changed, and nothing is said. */
  'cancelled',
  /** A Google sign-in is already running (a second tap). */
  'inProgress',
  /** Google Play services are missing or too old on this phone (Google shows how to update them). */
  'playServices',
  /**
   * Google refused this build (DEVELOPER_ERROR): the SHA-1 of the key that signed it is not in Firebase, or the
   * client id is wrong, or Google sign-in is off in Firebase. Only testers of a new build should ever see it.
   */
  'googleConfig',
  /**
   * The Google account's email already has an account with a password, and Firebase won't link them by itself
   * (Firebase's one account per email): sign in with the password instead. Nothing is lost or merged.
   */
  'accountExistsWithPassword',
  /** Re-authentication chose another Google account than the signed-in one. */
  'userMismatch',
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
