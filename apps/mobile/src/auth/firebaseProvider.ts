import { toAuthError, toGoogleAuthError } from './errors';
import type { GoogleSignInConfig } from './googleConfig';
import { AuthError, type AuthProvider, type AuthUser, type GoogleAuth, type SignInMethod } from './types';

/**
 * Firebase Auth (spec §17.1), through React Native Firebase's modular API. The module is required lazily,
 * inside the provider: a build without Firebase's config files has no default Firebase app, and merely
 * importing it at the top of a file that also runs there would be a risk. chooseProvider.ts creates this
 * provider only when the build has Firebase for this platform.
 *
 * "המשך עם Google" (Moshe, 14.10.2026), when the build has Google's web client id (googleConfig.ts):
 * @react-native-google-signin/google-signin shows Google's account chooser and gives an ID token for that client;
 * Firebase signs in with it (GoogleAuthProvider.credential → signInWithCredential), as React Native Firebase's
 * documentation does it. The Google module is required lazily too, and configured once, on first use.
 *
 * One account per email address (Firebase's default, and this project's): a Google sign-in never makes a second
 * account for an address that has one. Either Firebase signs in to that same account (same uid, so the same
 * profile and games on our server), or it refuses ('accountExistsWithPassword') and nothing changes. Nothing is
 * merged. One case to know (spec §3.3): Firebase trusts Google for Gmail addresses, so a Gmail account made with a
 * password and never verified loses that password when the address's owner signs in with Google, and the owner
 * gets its uid, so the fighter on it. If someone else made that account (the address isn't theirs, and [D22]
 * lets them play unverified), the owner lands in a fighter they never made; settings → delete, then a new
 * registration, starts clean.
 *
 * One Google step at a time: a second call while Google's chooser is open fails with 'inProgress' here, before it
 * reaches the library (which would cancel the first one and open a second chooser nobody waits for).
 *
 * Every failure comes out as an AuthError (errors.ts maps Firebase's and Google's codes).
 */

export type FirebaseAuthModule = typeof import('@react-native-firebase/auth');
type FirebaseUser = NonNullable<ReturnType<FirebaseAuthModule['getAuth']>['currentUser']>;

/** The part of @react-native-google-signin/google-signin this provider uses. */
export type GoogleSignInModule = Pick<
  typeof import('@react-native-google-signin/google-signin'),
  'GoogleSignin' | 'statusCodes'
>;

/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see above */
const loadFirebaseAuth = (): FirebaseAuthModule =>
  require('@react-native-firebase/auth') as FirebaseAuthModule;
const loadGoogleSignIn = (): GoogleSignInModule =>
  require('@react-native-google-signin/google-signin') as GoogleSignInModule;
/* eslint-enable @typescript-eslint/no-require-imports */

/** Google sign-in for this provider: the web client id, and (tests) a stand-in for the library. */
export interface FirebaseGoogleOptions extends GoogleSignInConfig {
  load?: () => GoogleSignInModule;
}

/** Firebase's provider ids → the app's sign-in methods (anything else, e.g. "firebase", is not one). */
const METHOD_OF: Record<string, SignInMethod> = { password: 'password', 'google.com': 'google' };
const METHODS: readonly SignInMethod[] = ['password', 'google'];

function methodsOf(u: FirebaseUser): SignInMethod[] {
  const ids = new Set((u.providerData ?? []).map((p) => METHOD_OF[p.providerId]));
  return METHODS.filter((m) => ids.has(m));
}

const userOf = (u: FirebaseUser): AuthUser => ({
  uid: u.uid,
  email: u.email,
  emailVerified: u.emailVerified,
  methods: methodsOf(u),
});

async function wrap<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toAuthError(error);
  }
}

export function createFirebaseAuthProvider(
  load: () => FirebaseAuthModule = loadFirebaseAuth,
  google: FirebaseGoogleOptions | null = null,
): AuthProvider {
  let mod: FirebaseAuthModule | null = null;
  const fb = () => (mod ??= load());
  const auth = () => fb().getAuth();
  const signedIn = (): FirebaseUser => {
    const user = auth().currentUser;
    if (!user) throw new AuthError('noUser');
    return user;
  };

  // ---- Google ------------------------------------------------------------------------------------------------

  let googleModule: GoogleSignInModule | null = null;
  /** The library, configured once: email and profile (its defaults), an ID token for the web client. */
  const googleSignIn = (options: FirebaseGoogleOptions): GoogleSignInModule => {
    if (googleModule) return googleModule;
    const g = (options.load ?? loadGoogleSignIn)();
    g.GoogleSignin.configure({ webClientId: options.webClientId });
    googleModule = g;
    return g;
  };

  /** A Google step (sign-in or re-authentication) is running: its chooser may be on the screen. */
  let googleRunning = false;

  /**
   * Runs a Google step, one at a time (a second one meanwhile fails with 'inProgress' and touches nothing); its
   * failure as an AuthError in Google's terms (errors.ts toGoogleAuthError).
   */
  async function withGoogle<T>(
    options: FirebaseGoogleOptions,
    run: (g: GoogleSignInModule) => Promise<T>,
  ): Promise<T> {
    if (googleRunning) throw new AuthError('inProgress', 'a Google sign-in is already running');
    googleRunning = true;
    let g: GoogleSignInModule | null = null;
    try {
      g = googleSignIn(options);
      return await run(g);
    } catch (error) {
      throw g ? toGoogleAuthError(error, g.statusCodes) : toAuthError(error);
    } finally {
      googleRunning = false;
    }
  }

  /** Google's chooser → the ID token for Firebase. */
  async function googleIdToken(g: GoogleSignInModule): Promise<string> {
    // Shows Google's own "update Google Play services" dialog when they are missing or too old.
    const playServices = await g.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    if (!playServices) throw new AuthError('playServices');
    const result = await g.GoogleSignin.signIn();
    if (result.type !== 'success') throw new AuthError('cancelled');
    const { idToken } = result.data;
    // No ID token: the library was configured without a (valid) web client id. A build problem.
    if (!idToken) throw new AuthError('googleConfig', 'Google gave no ID token: check the web client id');
    return idToken;
  }

  /** Out of Google (its chooser shows next time); never fails: Firebase's sign-out is what matters. */
  async function signOutOfGoogle(): Promise<void> {
    if (!google) return;
    try {
      await googleSignIn(google).GoogleSignin.signOut();
    } catch {
      // Not signed in to Google, or the library is unavailable: nothing to undo.
    }
  }

  const googleAuth = (options: FirebaseGoogleOptions): GoogleAuth => ({
    signIn: async () => {
      try {
        return await withGoogle(options, async (g) => {
          const idToken = await googleIdToken(g);
          const credential = fb().GoogleAuthProvider.credential(idToken);
          const { user } = await fb().signInWithCredential(auth(), credential);
          return userOf(user);
        });
      } catch (error) {
        const failure = toAuthError(error);
        // Signed in to Google but not to Firebase: out of Google again, so the next try shows the chooser
        // (maybe for another account). A cancel or a second tap left nothing to undo.
        if (failure.code !== 'cancelled' && failure.code !== 'inProgress') await signOutOfGoogle();
        throw failure;
      }
    },

    reauthenticate: () =>
      withGoogle(options, async (g) => {
        const user = signedIn();
        // The chooser on purpose: the player confirms by picking the account, not with a silent token.
        await g.GoogleSignin.signOut().catch(() => undefined);
        const idToken = await googleIdToken(g);
        await fb().reauthenticateWithCredential(user, fb().GoogleAuthProvider.credential(idToken));
      }),
  });

  // ---- the provider ------------------------------------------------------------------------------------------

  return {
    kind: 'firebase',
    ...(google ? { google: googleAuth(google) } : null),

    restore: () =>
      wrap(
        () =>
          new Promise<AuthUser | null>((resolve, reject) => {
            const { onAuthStateChanged } = fb();
            // The first call says who is signed in after Firebase read its saved session.
            let unsubscribe: (() => void) | null = null;
            let done = false;
            unsubscribe = onAuthStateChanged(
              auth(),
              (user) => {
                if (done) return;
                done = true;
                unsubscribe?.();
                resolve(user ? userOf(user) : null);
              },
              (error) => {
                if (done) return;
                done = true;
                unsubscribe?.();
                reject(error);
              },
            );
            if (done) unsubscribe();
          }),
      ),

    currentUser: () => {
      const user = auth().currentUser;
      return user ? userOf(user) : null;
    },

    signIn: (email, password) =>
      wrap(async () => {
        const credential = await fb().signInWithEmailAndPassword(auth(), email.trim(), password);
        return userOf(credential.user);
      }),

    signUp: (email, password) =>
      wrap(async () => {
        const credential = await fb().createUserWithEmailAndPassword(auth(), email.trim(), password);
        return userOf(credential.user);
      }),

    sendEmailVerification: () => wrap(() => fb().sendEmailVerification(signedIn())),

    reloadUser: () =>
      wrap(async () => {
        await fb().reload(signedIn());
        // reload() refreshes the current user; the object read before it is a snapshot.
        return userOf(signedIn());
      }),

    sendPasswordReset: (email) => wrap(() => fb().sendPasswordResetEmail(auth(), email.trim())),

    reauthenticate: (password) =>
      wrap(async () => {
        const user = signedIn();
        if (!user.email) throw new AuthError('noUser', 'the signed-in user has no email');
        const credential = fb().EmailAuthProvider.credential(user.email, password);
        await fb().reauthenticateWithCredential(user, credential);
      }),

    deleteUser: () =>
      wrap(async () => {
        const user = signedIn();
        const hadGoogle = methodsOf(user).includes('google');
        await fb().deleteUser(user);
        if (!hadGoogle || !google) return;
        // The account is gone: the app lets go of the Google account too (revokes the access it was given),
        // and signs out of Google. Neither may fail the deletion.
        try {
          const g = googleSignIn(google);
          await g.GoogleSignin.revokeAccess().catch(() => undefined);
          await g.GoogleSignin.signOut().catch(() => undefined);
        } catch {
          // The library is unavailable: nothing to revoke from here.
        }
      }),

    signOut: () =>
      wrap(async () => {
        try {
          await fb().signOut(auth());
        } finally {
          await signOutOfGoogle();
        }
      }),

    getIdToken: (forceRefresh = false) => wrap(() => fb().getIdToken(signedIn(), forceRefresh)),
  };
}
