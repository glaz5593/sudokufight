import { toAuthError } from './errors';
import { AuthError, type AuthProvider, type AuthUser } from './types';

/**
 * Firebase Auth (spec §17.1), through React Native Firebase's modular API. The module is required lazily,
 * inside the provider: a build without Firebase's config files has no default Firebase app, and merely
 * importing it at the top of a file that also runs there would be a risk. chooseProvider.ts creates this
 * provider only when the build has Firebase for this platform.
 *
 * Every failure comes out as an AuthError (errors.ts maps Firebase's codes).
 */

export type FirebaseAuthModule = typeof import('@react-native-firebase/auth');
type FirebaseUser = NonNullable<ReturnType<FirebaseAuthModule['getAuth']>['currentUser']>;

/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see above */
const loadFirebaseAuth = (): FirebaseAuthModule =>
  require('@react-native-firebase/auth') as FirebaseAuthModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const userOf = (u: FirebaseUser): AuthUser => ({
  uid: u.uid,
  email: u.email,
  emailVerified: u.emailVerified,
});

async function wrap<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toAuthError(error);
  }
}

export function createFirebaseAuthProvider(load: () => FirebaseAuthModule = loadFirebaseAuth): AuthProvider {
  let mod: FirebaseAuthModule | null = null;
  const fb = () => (mod ??= load());
  const auth = () => fb().getAuth();
  const signedIn = (): FirebaseUser => {
    const user = auth().currentUser;
    if (!user) throw new AuthError('noUser');
    return user;
  };

  return {
    kind: 'firebase',

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

    deleteUser: () => wrap(() => fb().deleteUser(signedIn())),

    signOut: () => wrap(() => fb().signOut(auth())),

    getIdToken: (forceRefresh = false) => wrap(() => fb().getIdToken(signedIn(), forceRefresh)),
  };
}
