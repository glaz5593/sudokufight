import type { CreateUserRequest, Me, UpdateMeRequest } from '@sudoku-fight/protocol';
import { create } from 'zustand';

import { type AccountApi, AccountApiError, isAccountApiError, isOfflineError } from '../api/accountApi';
import type { MeCache } from '../api/me';
import { useProfile } from '../state/profile';
import { toAuthError } from './errors';
import { useRegistrationDraft } from './registrationDraft';
import type { AuthProvider, AuthProviderKind, AuthUser } from './types';

/**
 * Who is playing (spec §3, work plan stage 8). The provider (Firebase, or the development sign-in) says who
 * signed in; the game server holds the profile (GET /v1/me). Together they make the status the router
 * follows (auth/redirect.ts):
 *
 * - loading: the app is starting (Splash). With `loadError`, there is a sign-in but its profile could not be
 *   read and none is saved on the phone: the Splash offers "try again" and "sign out".
 * - signedOut: → /login (registration starts there).
 * - needsProfile: signed in, but the server has no profile for it (registration stopped after the account
 *   was made, or the account was deleted) → /register/fighter resumes it.
 * - ready: signed in with a profile → Home. `meOffline`: the profile came from the phone (no server this
 *   run); practice works the same [D24 not approved: registration first, then offline practice].
 *
 * [D22] Email verification is not a status: it never blocks practice. Home shows a banner while
 * `user.emailVerified` is false (config/account.ts says what ranked play will ask for).
 */
export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready';

export interface AuthState {
  status: AuthStatus;
  provider: AuthProviderKind | null;
  user: AuthUser | null;
  me: Me | null;
  meOffline: boolean;
  loadError: AccountApiError['code'] | null;
}

export const useAuth = create<AuthState>()(() => ({
  status: 'loading',
  provider: null,
  user: null,
  me: null,
  meOffline: false,
  loadError: null,
}));

export interface AuthDeps {
  provider: AuthProvider;
  api: AccountApi;
  meCache: MeCache;
  /** Who is signed in now (Crashlytics' user id); null after sign-out. */
  onIdentity?: (meId: string | null) => void;
  /** Something went wrong that the player can't fix (for Crashlytics). */
  report?: (error: unknown, where: string) => void;
}

let deps: AuthDeps | null = null;
let defaults: (() => AuthDeps) | null = null;
let starting: Promise<void> | null = null;

/** The app's wiring (auth/index.ts installs it); tests install theirs with setAuthDeps. */
export function setDefaultAuthDeps(make: () => AuthDeps): void {
  defaults = make;
}

export function authDeps(): AuthDeps {
  if (!deps) {
    if (!defaults) throw new Error('auth is not configured');
    deps = defaults();
  }
  return deps;
}

/** Tests: new wiring, and a store back at 'loading' (the next initAuth() starts over). */
export function setAuthDeps(next: AuthDeps | null): void {
  deps = next;
  starting = null;
  useAuth.setState(
    { status: 'loading', provider: null, user: null, me: null, meOffline: false, loadError: null },
    false,
  );
}

const set = (patch: Partial<AuthState>) => useAuth.setState(patch);
const report = (error: unknown, where: string) => deps?.report?.(error, where);

/** The profile from the server or the phone: kept, saved, and mirrored where the game screens read it. */
async function adopt(user: AuthUser, me: Me, offline: boolean): Promise<void> {
  set({ status: 'ready', user, me, meOffline: offline, loadError: null });
  // The game screens and the modes screen show "my" avatar from the local profile store.
  useProfile.setState({ name: me.displayName, avatarId: me.avatarId, country: me.country });
  authDeps().onIdentity?.(me.id);
  if (!offline) {
    await authDeps()
      .meCache.save(user.uid, me)
      .catch((error: unknown) => report(error, 'meCache.save'));
  }
}

async function forgetLocal(): Promise<void> {
  const { meCache } = authDeps();
  await meCache.clear().catch((error: unknown) => report(error, 'meCache.clear'));
  useRegistrationDraft.getState().reset();
  authDeps().onIdentity?.(null);
  set({ status: 'signedOut', user: null, me: null, meOffline: false, loadError: null });
}

/**
 * The profile of a sign-in: the saved one first (the app opens offline on it), then the server's.
 * `strict`: a failure without a saved profile throws (sign-in screen) instead of becoming `loadError`
 * (app start).
 */
async function loadProfile(user: AuthUser, strict: boolean): Promise<void> {
  const { api, meCache } = authDeps();
  const saved = await meCache.load(user.uid).catch(() => null);
  if (saved) await adopt(user, saved, true);
  try {
    await adopt(user, await api.getMe(), false);
  } catch (error) {
    if (isAccountApiError(error) && error.code === 'notRegistered') {
      // No profile on the server (never made, or deleted): the registration goes on from step 1.
      await meCache.clear().catch(() => undefined);
      set({ status: 'needsProfile', user, me: null, meOffline: false, loadError: null });
      return;
    }
    if (saved) return; // offline: the saved profile stays.
    if (strict) throw error;
    const code = isAccountApiError(error) ? error.code : 'unexpected';
    if (!isOfflineError(error)) report(error, 'getMe');
    set({ status: 'loading', user, me: null, meOffline: false, loadError: code });
  }
}

/** Once per app run: who is signed in, and their profile. Calls during a start share it. */
export function initAuth(): Promise<void> {
  starting ??= (async () => {
    const { provider } = authDeps();
    set({ provider: provider.kind, loadError: null });
    let user: AuthUser | null = null;
    try {
      user = await provider.restore();
    } catch (error) {
      report(error, 'restore');
    }
    if (!user) {
      set({ status: 'signedOut', user: null, me: null, meOffline: false });
      return;
    }
    await loadProfile(user, false);
  })();
  return starting;
}

/** The Splash's "try again" after a loadError. */
export async function retryLoad(): Promise<void> {
  const user = useAuth.getState().user;
  if (!user) return;
  set({ loadError: null });
  await loadProfile(user, false);
}

/**
 * Login. Throws AuthError (wrong password, unknown user, too many attempts, no connection…), or
 * AccountApiError when the profile can't be read and none is saved (the sign-in is undone, so the player
 * stays on the login screen and can try again).
 */
export async function signIn(email: string, password: string): Promise<void> {
  const { provider } = authDeps();
  const user = await provider.signIn(email, password);
  try {
    await loadProfile(user, true);
  } catch (error) {
    await provider.signOut().catch(() => undefined);
    set({ status: 'signedOut', user: null, me: null });
    throw error;
  }
}

/**
 * Step 2 of the registration (spec §3.2): the Firebase account, the verification email [D22], then the
 * profile (POST /v1/users) from step 1. The status changes only at the end, so the screen stays put while
 * it works.
 *
 * Throws AuthError when the account can't be made (nothing changed). When the account was made but the
 * profile was not (the name was taken meanwhile, no connection), the sign-in stays and the status becomes
 * needsProfile: the router goes back to step 1, which finishes the registration. The error is thrown too,
 * so the screen can say what happened.
 */
export async function signUpAndRegister(
  email: string,
  password: string,
  profile: CreateUserRequest,
): Promise<void> {
  const { provider, api } = authDeps();
  const user = await provider.signUp(email, password);
  set({ provider: provider.kind });
  provider.sendEmailVerification().catch((error: unknown) => report(error, 'sendEmailVerification'));
  try {
    await adoptCreated(user, await createOrFetch(api, profile));
  } catch (error) {
    set({ status: 'needsProfile', user, me: null, meOffline: false, loadError: null });
    throw error;
  }
}

/** POST /v1/users; when the sign-in already has a profile (a retry after a lost answer), that one. */
async function createOrFetch(api: AccountApi, profile: CreateUserRequest): Promise<Me> {
  try {
    return await api.createUser(profile);
  } catch (error) {
    if (isAccountApiError(error) && error.code === 'alreadyRegistered') return api.getMe();
    throw error;
  }
}

async function adoptCreated(user: AuthUser, me: Me): Promise<void> {
  useRegistrationDraft.getState().reset();
  await adopt(user, me, false);
}

/** Step 1 when already signed in (needsProfile): the profile alone. Throws AccountApiError. */
export async function registerProfile(profile: CreateUserRequest): Promise<void> {
  const { provider, api } = authDeps();
  const user = useAuth.getState().user ?? provider.currentUser();
  if (!user) throw new AccountApiError('signedOut');
  await adoptCreated(user, await createOrFetch(api, profile));
}

/** PATCH /v1/me. Throws AccountApiError (taken, renameTooSoon with nextRenameAt, offline…). */
export async function updateProfile(patch: UpdateMeRequest): Promise<Me> {
  const user = useAuth.getState().user;
  if (!user) throw new AccountApiError('signedOut');
  const me = await authDeps().api.updateMe(patch);
  await adopt(user, me, false);
  return me;
}

/** GET /v1/me again (e.g. after the email was verified, or when Home comes back online). */
export async function refreshMe(): Promise<void> {
  const user = useAuth.getState().user;
  if (!user || useAuth.getState().status !== 'ready') return;
  try {
    await adopt(user, await authDeps().api.getMe(), false);
  } catch (error) {
    if (isAccountApiError(error) && error.code === 'notRegistered') {
      await authDeps()
        .meCache.clear()
        .catch(() => undefined);
      set({ status: 'needsProfile', me: null, meOffline: false });
    }
  }
}

/**
 * The signed-in player's ID token for background calls (usage reports): null when nobody is signed in, the
 * auth isn't wired, or the provider fails. Never a forced refresh, never throws. The token is not kept here:
 * the provider holds its own (Firebase in its secure store, the development sign-in makes it on demand).
 */
export async function signedInIdToken(): Promise<string | null> {
  try {
    if (useAuth.getState().user === null) return null;
    const { provider } = authDeps();
    if (provider.currentUser() === null) return null;
    return await provider.getIdToken(false);
  } catch {
    return null;
  }
}

/** [D22] Sends the verification link again. Throws AuthError. */
export async function sendVerificationEmail(): Promise<void> {
  await authDeps().provider.sendEmailVerification();
}

/**
 * [D22] "I verified": reads the sign-in again; when verified, a fresh token (so the server sees it too)
 * and the profile again. Returns whether the address is verified. Throws AuthError.
 */
export async function checkEmailVerified(): Promise<boolean> {
  const { provider } = authDeps();
  const user = await provider.reloadUser();
  set({ user });
  if (user.emailVerified) {
    await provider.getIdToken(true).catch(() => undefined);
    await refreshMe();
  }
  return user.emailVerified;
}

/** [D22] "שכחתי סיסמה". Throws AuthError (invalid email, no connection, too many requests). */
export async function sendPasswordReset(email: string): Promise<void> {
  await authDeps().provider.sendPasswordReset(email);
}

/** Settings → "התנתקות", and the escape from a profile that can't load. */
export async function signOut(): Promise<void> {
  await authDeps()
    .provider.signOut()
    .catch((error: unknown) => report(toAuthError(error), 'signOut'));
  await forgetLocal();
}

export interface DeleteOutcome {
  /** False when the server's profile is gone but the sign-in could not be deleted (see below). */
  signInDeleted: boolean;
}

/**
 * Settings → "מחיקת חשבון" (spec §3.3, §23; work plan stage 8), in the safer order:
 *
 * 1. Re-authenticate with the password. Proves it is the owner, and makes the provider's delete possible
 *    (it needs a recent sign-in). A wrong password stops here: nothing is deleted.
 * 2. A fresh ID token (getIdToken(true)): the server checks the token's sign-in time (auth_time), and the
 *    token the provider kept may predate step 1.
 * 3. DELETE /v1/me with it. The server is where the personal data and the name live: it marks deleted_at,
 *    makes the name anonymous (free again at once) and drops the email. A failure stops here: nothing is
 *    deleted, and the player can try again (the sign-in still works). 401 'reauthRequired' (the server still
 *    finds the sign-in too old) is one of these: the dialog asks for the password again.
 * 4. Delete the sign-in (Firebase user), with one more try if it fails.
 * 5. Sign out on the phone, forget the saved profile → the login screen.
 *
 * Why not Firebase first: if the server call then failed, the profile, the name and the email would stay on
 * the server with no way to sign in and delete them. This order can leave only a Firebase sign-in without a
 * profile (step 4 failing twice), which holds no game data: signing in with it again starts a fresh
 * registration (protocol: the server forgets the uid). `signInDeleted: false` lets the screen say so.
 *
 * Throws AuthError (steps 1–2) or AccountApiError (step 3).
 */
export async function deleteAccount(password: string): Promise<DeleteOutcome> {
  const { provider, api } = authDeps();
  await provider.reauthenticate(password);
  await provider.getIdToken(true);
  await api.deleteMe();
  let signInDeleted = true;
  try {
    await provider.deleteUser();
  } catch {
    try {
      await provider.deleteUser();
    } catch (error) {
      signInDeleted = false;
      report(error, 'deleteUser');
      await provider.signOut().catch(() => undefined);
    }
  }
  await forgetLocal();
  return { signInDeleted };
}
