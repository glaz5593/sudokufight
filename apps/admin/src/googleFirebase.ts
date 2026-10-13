import type { AdminGoogleWebConfig } from '@sudoku-fight/protocol';
import { type FirebaseOptions, initializeApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup,
  signOut,
} from 'firebase/auth';

import type { GoogleSignIn } from './google';

/**
 * The Firebase JS SDK side of Google sign-in (google.ts loads this module on demand: it is a chunk of its
 * own, with firebase/app and firebase/auth only).
 *
 * initializeAuth rather than getAuth: the user and their tokens live in memory only, never in the browser's
 * storage, and the bundle leaves out the persistence code getAuth brings. (firebase/app still keeps its usage
 * heartbeat, dates only, in IndexedDB.)
 */

/** One Firebase app and Auth per web config: the SDK refuses a second initializeAuth for the same app. */
const made = new Map<string, Promise<GoogleSignIn>>();
/** Apps named so far: each new one gets a name of its own, even after a config the SDK refused. */
let apps = 0;

/**
 * Google sign-in with this config, once Auth has initialized (authStateReady). On Safari and phones that
 * includes loading Google's hidden iframe, which the SDK starts at once there: a click before it is ready would
 * wait for it before opening the popup, and Safari would block the late popup. Throws (or rejects) with the
 * SDK's error for a config it refuses.
 */
export function createGoogleSignIn(config: AdminGoogleWebConfig): Promise<GoogleSignIn> {
  const key = JSON.stringify([config.apiKey, config.authDomain, config.projectId, config.appId]);
  const known = made.get(key);
  if (known) return known;

  const options: FirebaseOptions = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    ...(config.appId === null ? {} : { appId: config.appId }),
  };
  apps += 1;
  const app = initializeApp(options, `sudoku-fight-admin-${apps}`);
  const auth = initializeAuth(app, {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });

  const google: GoogleSignIn = {
    async signIn(lang) {
      auth.languageCode = lang;
      const provider = new GoogleAuthProvider();
      // The account chooser every time, so another account is one click away (e.g. after "no access").
      provider.setCustomParameters({ prompt: 'select_account' });
      const { user } = await signInWithPopup(auth, provider);
      return { idToken: await user.getIdToken(), email: user.email };
    },
    signOut: () => signOut(auth),
  };
  const ready = auth.authStateReady().then(() => google);
  made.set(key, ready);
  // A failed start is not kept: the next try makes a new app.
  ready.catch(() => {
    if (made.get(key) === ready) made.delete(key);
  });
  return ready;
}
