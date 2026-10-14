/* Test-only: the auth store wired to the development sign-in and an in-memory account server. */
import type { AvatarId, CountryCode } from '@sudoku-fight/protocol';

import { createMeCache } from '../../api/me';
import { createFakeAccountServer, type FakeAccountServer } from '../../api/testing/fakeAccountServer';
import { type AuthDeps, setAuthDeps } from '../authStore';
import { createDevAuthProvider } from '../devProvider';
import {
  createFirebaseAuthProvider,
  type FirebaseAuthModule,
  type GoogleSignInModule,
} from '../firebaseProvider';
import type { AuthProvider, KeyValueStore } from '../types';
import { fakeFirebase, fakeGoogleSignIn } from './fakeFirebase';

/** A key-value store in memory (expo-sqlite's, as the auth code sees it). */
export function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

/** Random bytes that are the same in every run (uids and salts in tests). */
export function seededBytes(seed = 1): (bytes: Uint8Array) => void {
  let x = seed >>> 0 || 1;
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      bytes[i] = (x >>> 0) & 255;
    }
  };
}

export interface TestAuth {
  provider: AuthProvider;
  server: FakeAccountServer;
  storage: ReturnType<typeof memoryStorage>;
  deps: AuthDeps;
  /** The provider's clock (dev sign-in lockouts and recent-login checks). */
  clock: { now: number };
  reports: [where: string, error: unknown][];
}

/**
 * Installs a fresh wiring in the auth store (status back to 'loading'): the development sign-in on an
 * in-memory store, and the fake account server. Nobody is signed in.
 */
export function installTestAuth({ seed = 1, now = 1_760_000_000_000 } = {}): TestAuth {
  const storage = memoryStorage();
  const clock = { now };
  const provider = createDevAuthProvider({
    storage,
    now: () => clock.now,
    randomBytes: seededBytes(seed),
    log: () => undefined,
  });
  const server = createFakeAccountServer({
    getToken: async (force) => (provider.currentUser() ? provider.getIdToken(force) : null),
    now,
  });
  const reports: TestAuth['reports'] = [];
  const deps: AuthDeps = {
    provider,
    api: server.api,
    meCache: createMeCache(storage),
    report: (error, where) => reports.push([where, error]),
  };
  setAuthDeps(deps);
  return { provider, server, storage, deps, clock, reports };
}

export interface TestPlayer {
  email?: string;
  password?: string;
  displayName?: string;
  avatarId?: AvatarId;
  country?: CountryCode;
  emailVerified?: boolean;
}

export const TEST_PLAYER = {
  email: 'player@example.com',
  password: 'Arena1234',
  displayName: 'Tester',
  avatarId: 'sun',
  country: 'IL',
} as const satisfies TestPlayer;

/**
 * A player who registered on this phone earlier and is still signed in: the next app start (initAuth, the
 * root layout) restores them and opens on Home. For the screens' end-to-end tests, which start at Home.
 */
export async function installSignedInPlayer(
  player: TestPlayer = {},
  options?: { seed?: number; now?: number },
): Promise<TestAuth> {
  const auth = installTestAuth(options);
  const p = { ...TEST_PLAYER, ...player };
  await auth.provider.signUp(p.email, p.password);
  if (p.emailVerified ?? true) await auth.provider.reloadUser();
  await auth.server.api.createUser({ displayName: p.displayName, avatarId: p.avatarId, country: p.country });
  return auth;
}

/** A web OAuth client id shaped like Google's (the tests' "extra.googleSignIn.webClientId"). */
export const TEST_WEB_CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';

export interface FirebaseTestAuth {
  provider: AuthProvider;
  server: FakeAccountServer;
  storage: ReturnType<typeof memoryStorage>;
  deps: AuthDeps;
  reports: [where: string, error: unknown][];
  /** The fake Firebase module (its state and jest.fn calls). */
  firebase: ReturnType<typeof fakeFirebase>;
  /** The fake Google sign-in library: `google.state.next` makes the next chooser cancel or fail. */
  google: ReturnType<typeof fakeGoogleSignIn>;
}

/**
 * Installs the real Firebase provider on fake Firebase and Google modules (a Firebase build with "המשך עם
 * Google", or without Google when `google` is false), and the fake account server. Nobody is signed in. The
 * chooser picks `account` (gamer@gmail.com by default).
 */
export function installFirebaseTestAuth({
  google = true,
  account,
}: { google?: boolean; account?: { email: string } } = {}): FirebaseTestAuth {
  const storage = memoryStorage();
  const firebase = fakeFirebase({ devTokens: true });
  const googleFake = fakeGoogleSignIn(account);
  const provider = createFirebaseAuthProvider(
    () => firebase.mod as unknown as FirebaseAuthModule,
    google
      ? { webClientId: TEST_WEB_CLIENT_ID, load: () => googleFake.mod as unknown as GoogleSignInModule }
      : null,
  );
  const server = createFakeAccountServer({
    getToken: async (force) => (provider.currentUser() ? provider.getIdToken(force) : null),
  });
  const reports: FirebaseTestAuth['reports'] = [];
  const deps: AuthDeps = {
    provider,
    api: server.api,
    meCache: createMeCache(storage),
    report: (error, where) => reports.push([where, error]),
  };
  setAuthDeps(deps);
  return { provider, server, storage, deps, reports, firebase, google: googleFake };
}

/**
 * A Google account that already has its fighter on the server (registered earlier, maybe on another phone),
 * signed out of the app now.
 */
export async function addGooglePlayer(
  auth: FirebaseTestAuth,
  fighter: { displayName?: string; avatarId?: AvatarId; country?: CountryCode } = {},
): Promise<void> {
  await auth.provider.google!.signIn();
  await auth.server.api.createUser({
    displayName: fighter.displayName ?? 'GoogleGamer',
    avatarId: fighter.avatarId ?? 'sun',
    country: fighter.country ?? 'IL',
  });
  await auth.provider.signOut();
}
