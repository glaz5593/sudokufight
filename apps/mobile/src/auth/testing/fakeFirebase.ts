/* Test-only: stand-ins for @react-native-firebase/auth's modular API and for Google sign-in. */
import { devToken } from '@sudoku-fight/protocol';

interface FakeFirebaseUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  providerData: { providerId: string }[];
}

/** The ID token the fake Google sign-in gives for an address (the fake Firebase reads the address back). */
export const fakeGoogleIdToken = (email: string) => `google-id-token:${email}`;

/**
 * A stand-in for @react-native-firebase/auth's modular API: one user in memory. Email and password: any address,
 * the password 'Arena1234'. Google: the credential of fakeGoogleIdToken(address) signs in to that address's
 * Google user (the same uid every time), with its email verified, as Firebase does.
 *
 * `devTokens`: getIdToken gives a development token of the user ("dev:<uid>:<email>"), which the fake account
 * server takes, so screens can run on the real Firebase provider. Otherwise 'id-token' / 'id-token-fresh'.
 */
export function fakeFirebase({ devTokens = false }: { devTokens?: boolean } = {}) {
  type Listener = (user: unknown) => void;
  const state = {
    currentUser: null as null | FakeFirebaseUser,
    listeners: [] as Listener[],
    /** The next Google credential (sign-in or re-authentication) is refused with this Firebase code, once. */
    nextCredentialError: null as string | null,
    /** Google users' uids by address. */
    googleUids: new Map<string, string>(),
    /** The next deleteUser is refused with this Firebase code (e.g. auth/requires-recent-login), once. */
    nextDeleteError: null as string | null,
  };
  const auth = {
    get currentUser() {
      return state.currentUser;
    },
  };
  const fail = (code: string) => Object.assign(new Error(code), { code });
  const takeCredentialError = () => {
    const code = state.nextCredentialError;
    state.nextCredentialError = null;
    if (code) throw fail(code);
  };
  const googleEmailOf = (idToken: string) => idToken.replace(/^google-id-token:/, '');
  const googleUidOf = (email: string) => {
    if (!state.googleUids.has(email)) state.googleUids.set(email, `fbg-${state.googleUids.size + 1}`);
    return state.googleUids.get(email)!;
  };
  type Credential = { password: string } | { providerId: 'google.com'; idToken: string };

  const mod = {
    getAuth: jest.fn(() => auth),
    onAuthStateChanged: jest.fn((_a: unknown, next: Listener) => {
      state.listeners.push(next);
      // A promise, not queueMicrotask: Jest's fake timers (which renderRouter turns on) hold that one back.
      void Promise.resolve().then(() => next(state.currentUser));
      return jest.fn();
    }),
    signInWithEmailAndPassword: jest.fn(async (_a: unknown, email: string, password: string) => {
      if (password !== 'Arena1234') throw fail('auth/wrong-password');
      state.currentUser = {
        uid: 'fb-uid-1',
        email,
        emailVerified: false,
        providerData: [{ providerId: 'password' }],
      };
      return { user: state.currentUser };
    }),
    createUserWithEmailAndPassword: jest.fn(async (_a: unknown, email: string) => {
      if (email === 'taken@example.com') throw fail('auth/email-already-in-use');
      state.currentUser = {
        uid: 'fb-uid-2',
        email,
        emailVerified: false,
        providerData: [{ providerId: 'password' }],
      };
      return { user: state.currentUser };
    }),
    sendEmailVerification: jest.fn(async () => undefined),
    reload: jest.fn(async () => {
      state.currentUser = { ...state.currentUser!, emailVerified: true };
    }),
    sendPasswordResetEmail: jest.fn(async () => undefined),
    EmailAuthProvider: { credential: jest.fn((email: string, password: string) => ({ email, password })) },
    GoogleAuthProvider: {
      credential: jest.fn((idToken: string) => ({ providerId: 'google.com' as const, idToken })),
    },
    signInWithCredential: jest.fn(async (_a: unknown, c: { idToken: string }) => {
      takeCredentialError();
      const email = googleEmailOf(c.idToken);
      state.currentUser = {
        uid: googleUidOf(email),
        email,
        emailVerified: true,
        providerData: [{ providerId: 'google.com' }],
      };
      return { user: state.currentUser };
    }),
    reauthenticateWithCredential: jest.fn(async (_u: unknown, c: Credential) => {
      if ('idToken' in c) {
        takeCredentialError();
        if (googleEmailOf(c.idToken) !== state.currentUser?.email) throw fail('auth/user-mismatch');
      } else if (c.password !== 'Arena1234') throw fail('auth/wrong-password');
      return { user: state.currentUser };
    }),
    deleteUser: jest.fn(async () => {
      const code = state.nextDeleteError;
      state.nextDeleteError = null;
      if (code) throw fail(code);
      state.currentUser = null;
    }),
    signOut: jest.fn(async () => {
      state.currentUser = null;
    }),
    getIdToken: jest.fn(async (u: FakeFirebaseUser, force?: boolean) =>
      devTokens ? devToken(u.uid, u.email) : force ? 'id-token-fresh' : 'id-token',
    ),
  };
  return { mod, state };
}

/**
 * A stand-in for @react-native-google-signin/google-signin (the part firebaseProvider.ts uses): Google's chooser
 * picks `state.account`, unless `state.next` says the next sign-in is cancelled or fails with a code (once).
 * The status codes are the library's Jest mock's ('mock_…'); DEVELOPER_ERROR and NETWORK_ERROR are Android's
 * '10' and '7'.
 */
export function fakeGoogleSignIn(account: { email: string; id?: string } = { email: 'gamer@gmail.com' }) {
  const statusCodes = {
    SIGN_IN_CANCELLED: 'mock_SIGN_IN_CANCELLED',
    IN_PROGRESS: 'mock_IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'mock_PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'mock_SIGN_IN_REQUIRED',
    NULL_PRESENTER: 'NULL_PRESENTER',
  };
  const state = {
    account,
    /** The address signed in to Google on the phone, or null. */
    signedIn: null as string | null,
    /** The next signIn: 'cancel' (the chooser closed), or a rejection with this code. Once. */
    next: null as null | 'cancel' | { code: string },
    playServices: true,
    /** False: Google gives no ID token (a build configured without the web client id). */
    idToken: true,
  };
  const fail = (code: string) => Object.assign(new Error(code), { code });
  const GoogleSignin = {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => {
      if (!state.playServices) throw fail(statusCodes.PLAY_SERVICES_NOT_AVAILABLE);
      return true;
    }),
    signIn: jest.fn(async () => {
      const next = state.next;
      state.next = null;
      if (next === 'cancel') return { type: 'cancelled' as const, data: null };
      if (next) throw fail(next.code);
      const { email, id = 'google-1' } = state.account;
      state.signedIn = email;
      return {
        type: 'success' as const,
        data: {
          user: { id, email, name: 'Gamer One', photo: null, familyName: 'One', givenName: 'Gamer' },
          scopes: [],
          idToken: state.idToken ? fakeGoogleIdToken(email) : null,
          serverAuthCode: null,
        },
      };
    }),
    signOut: jest.fn(async () => {
      state.signedIn = null;
      return null;
    }),
    revokeAccess: jest.fn(async () => null),
  };
  return { mod: { GoogleSignin, statusCodes }, state };
}
