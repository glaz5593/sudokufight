import { isAccountApiError } from '../../api/accountApi';
import {
  deleteAccountWithGoogle,
  initAuth,
  leaveRegistration,
  registerProfile,
  registerWithGoogle,
  setAuthDeps,
  signInWithGoogle,
  signOut,
  useAuth,
} from '../authStore';
import { googleAuthErrorCodeOf, toGoogleAuthError } from '../errors';
import {
  createFirebaseAuthProvider,
  type FirebaseAuthModule,
  type GoogleSignInModule,
} from '../firebaseProvider';
import { googleSignInConfig } from '../googleConfig';
import { useRegistrationDraft } from '../registrationDraft';
import { fakeFirebase, fakeGoogleIdToken, fakeGoogleSignIn } from '../testing/fakeFirebase';
import {
  addGooglePlayer,
  installFirebaseTestAuth,
  installTestAuth,
  TEST_WEB_CLIENT_ID,
} from '../testing/testAuth';
import { AuthError } from '../types';

/**
 * "המשך עם Google" (Moshe, 14.10.2026): the Firebase provider's Google sign-in (the library's chooser → an ID
 * token → Firebase's credential), its failures in the app's terms, and the auth store's flows: login,
 * registration, sign-out and deletion.
 */

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AuthError);
    return (e as AuthError).code;
  }
  throw new Error('expected a failure');
}

const FIGHTER = { displayName: 'Gamer', avatarId: 'fox', country: 'IL' } as const;

describe('the build config at run time (googleConfig.ts)', () => {
  const extra = (googleSignIn: unknown) => ({ firebase: { android: true }, googleSignIn });

  it('reads the web client id for this platform, and nothing that is not one', () => {
    const on = { android: true, ios: false, webClientId: TEST_WEB_CLIENT_ID };
    expect(googleSignInConfig(extra(on), 'android')).toEqual({ webClientId: TEST_WEB_CLIENT_ID });
    expect(googleSignInConfig(extra(on), 'ios')).toBeNull();
    expect(googleSignInConfig(extra({ ...on, android: false }), 'android')).toBeNull();
    expect(googleSignInConfig(extra({ ...on, webClientId: null }), 'android')).toBeNull();
    expect(googleSignInConfig(extra({ ...on, webClientId: 'AIzaSy-not-a-client' }), 'android')).toBeNull();
    expect(googleSignInConfig({}, 'android')).toBeNull();
    expect(googleSignInConfig(null, 'android')).toBeNull();
  });

  it('in this test build (no Firebase files) there is none', () => {
    expect(googleSignInConfig()).toBeNull();
  });
});

describe('FirebaseAuthProvider with Google', () => {
  function make({ google = true } = {}) {
    const firebase = fakeFirebase();
    const g = fakeGoogleSignIn();
    const loadGoogle = jest.fn(() => g.mod as unknown as GoogleSignInModule);
    const provider = createFirebaseAuthProvider(
      () => firebase.mod as unknown as FirebaseAuthModule,
      google ? { webClientId: TEST_WEB_CLIENT_ID, load: loadGoogle } : null,
    );
    return { provider, firebase, g, loadGoogle };
  }

  it('without a web client id the provider has no Google; an email account says "password"', async () => {
    const { provider } = make({ google: false });
    expect(provider.google).toBeUndefined();
    expect((await provider.signIn('a@b.co', 'Arena1234')).methods).toEqual(['password']);
  });

  it('signs in: Play services, the chooser, the ID token, then Firebase; the library loads on first use', async () => {
    const { provider, firebase, g, loadGoogle } = make();
    expect(loadGoogle).not.toHaveBeenCalled();
    const user = await provider.google!.signIn();
    expect(user).toEqual({
      uid: 'fbg-1',
      email: 'gamer@gmail.com',
      emailVerified: true,
      methods: ['google'],
    });
    expect(g.mod.GoogleSignin.configure).toHaveBeenCalledWith({ webClientId: TEST_WEB_CLIENT_ID });
    expect(g.mod.GoogleSignin.hasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
    expect(firebase.mod.GoogleAuthProvider.credential).toHaveBeenCalledWith(
      fakeGoogleIdToken('gamer@gmail.com'),
    );
    expect(firebase.mod.signInWithCredential).toHaveBeenCalledTimes(1);
    expect(provider.currentUser()).toEqual(user);
    // Configured once, however many sign-ins.
    await provider.signOut();
    await provider.google!.signIn();
    expect(loadGoogle).toHaveBeenCalledTimes(1);
    expect(g.mod.GoogleSignin.configure).toHaveBeenCalledTimes(1);
    // The same Google account is the same Firebase user.
    expect(provider.currentUser()?.uid).toBe('fbg-1');
  });

  it('a closed chooser is "cancelled": Firebase is not asked, nothing to undo', async () => {
    const { provider, firebase, g } = make();
    g.state.next = 'cancel';
    expect(await codeOf(provider.google!.signIn())).toBe('cancelled');
    expect(firebase.mod.signInWithCredential).not.toHaveBeenCalled();
    expect(g.mod.GoogleSignin.signOut).not.toHaveBeenCalled();
    expect(provider.currentUser()).toBeNull();
  });

  it("Google's failures: in progress, Play services, DEVELOPER_ERROR, network, no ID token", async () => {
    const { provider, g } = make();
    const codes = g.mod.statusCodes;
    g.state.next = { code: codes.IN_PROGRESS };
    expect(await codeOf(provider.google!.signIn())).toBe('inProgress');
    // A second tap while the first runs: the first is not undone.
    expect(g.mod.GoogleSignin.signOut).not.toHaveBeenCalled();
    g.state.next = { code: '10' };
    expect(await codeOf(provider.google!.signIn())).toBe('googleConfig');
    g.state.next = { code: '7' };
    expect(await codeOf(provider.google!.signIn())).toBe('network');
    g.state.next = { code: '12500' };
    expect(await codeOf(provider.google!.signIn())).toBe('unknown');
    g.state.playServices = false;
    expect(await codeOf(provider.google!.signIn())).toBe('playServices');
    g.state.playServices = true;
    g.state.idToken = false;
    expect(await codeOf(provider.google!.signIn())).toBe('googleConfig');
    expect(provider.currentUser()).toBeNull();
  });

  it('one Google step at a time: a second call meanwhile fails at once and leaves the first alone', async () => {
    const { provider, g } = make();
    const first = provider.google!.signIn();
    expect(await codeOf(provider.google!.signIn())).toBe('inProgress');
    expect(await codeOf(provider.google!.reauthenticate())).toBe('inProgress');
    expect(await first).toMatchObject({ uid: 'fbg-1', methods: ['google'] });
    // The library saw one sign-in, and nothing was undone for the refused calls.
    expect(g.mod.GoogleSignin.signIn).toHaveBeenCalledTimes(1);
    expect(g.mod.GoogleSignin.signOut).not.toHaveBeenCalled();
    // Done: the next one runs.
    await provider.signOut();
    await expect(provider.google!.signIn()).resolves.toMatchObject({ uid: 'fbg-1' });
    // A failed step frees it too.
    await provider.signOut();
    g.state.next = { code: '7' };
    expect(await codeOf(provider.google!.signIn())).toBe('network');
    await expect(provider.google!.signIn()).resolves.toMatchObject({ uid: 'fbg-1' });
  });

  it("Firebase's refusals: a password account on the address, a token for another project, no network", async () => {
    const { provider, firebase, g } = make();
    firebase.state.nextCredentialError = 'auth/account-exists-with-different-credential';
    expect(await codeOf(provider.google!.signIn())).toBe('accountExistsWithPassword');
    // Signed in to Google but not to Firebase: out of Google again, so the chooser shows next time.
    expect(g.mod.GoogleSignin.signOut).toHaveBeenCalledTimes(1);
    expect(g.state.signedIn).toBeNull();
    firebase.state.nextCredentialError = 'auth/invalid-credential';
    expect(await codeOf(provider.google!.signIn())).toBe('googleConfig');
    firebase.state.nextCredentialError = 'auth/operation-not-allowed';
    expect(await codeOf(provider.google!.signIn())).toBe('googleConfig');
    firebase.state.nextCredentialError = 'auth/network-request-failed';
    expect(await codeOf(provider.google!.signIn())).toBe('network');
    firebase.state.nextCredentialError = 'auth/user-disabled';
    expect(await codeOf(provider.google!.signIn())).toBe('userDisabled');
    expect(provider.currentUser()).toBeNull();
  });

  it('signs out of Firebase and of Google; a failing Google sign-out never blocks it', async () => {
    const { provider, firebase, g } = make();
    await provider.google!.signIn();
    await provider.signOut();
    expect(firebase.mod.signOut).toHaveBeenCalledTimes(1);
    expect(g.mod.GoogleSignin.signOut).toHaveBeenCalledTimes(1);
    expect(provider.currentUser()).toBeNull();

    await provider.google!.signIn();
    g.mod.GoogleSignin.signOut.mockRejectedValueOnce(new Error('not signed in'));
    await expect(provider.signOut()).resolves.toBeUndefined();
    // Firebase failing: Google is signed out all the same, and the failure is an AuthError.
    await provider.google!.signIn();
    firebase.mod.signOut.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/internal' }));
    expect(await codeOf(provider.signOut())).toBe('unknown');
    expect(g.state.signedIn).toBeNull();
  });

  it('an email account signs out of Google too (harmless), and needs no Google to delete', async () => {
    const { provider, g } = make();
    await provider.signIn('a@b.co', 'Arena1234');
    await provider.reauthenticate('Arena1234');
    await provider.deleteUser();
    expect(g.mod.GoogleSignin.revokeAccess).not.toHaveBeenCalled();
    await provider.signOut();
    expect(g.mod.GoogleSignin.signOut).toHaveBeenCalledTimes(1);
  });

  it('re-authenticates with the chooser shown again, and the same account only', async () => {
    const { provider, firebase, g } = make();
    await codeOf(provider.google!.reauthenticate()).then((code) => expect(code).toBe('noUser'));
    await provider.google!.signIn();
    g.mod.GoogleSignin.signOut.mockClear();
    await provider.google!.reauthenticate();
    // Out of Google first: the chooser shows, and the player picks the account on purpose.
    expect(g.mod.GoogleSignin.signOut).toHaveBeenCalledTimes(1);
    expect(firebase.mod.reauthenticateWithCredential).toHaveBeenLastCalledWith(firebase.state.currentUser, {
      providerId: 'google.com',
      idToken: fakeGoogleIdToken('gamer@gmail.com'),
    });
    g.state.next = 'cancel';
    expect(await codeOf(provider.google!.reauthenticate())).toBe('cancelled');
    g.state.account = { email: 'someone.else@gmail.com' };
    expect(await codeOf(provider.google!.reauthenticate())).toBe('userMismatch');
    // Still signed in to Firebase as before.
    expect(provider.currentUser()?.email).toBe('gamer@gmail.com');
  });

  it("deleting a Google account lets go of Google: revokes the app's access and signs out", async () => {
    const { provider, g } = make();
    await provider.google!.signIn();
    await provider.google!.reauthenticate();
    await provider.deleteUser();
    expect(provider.currentUser()).toBeNull();
    expect(g.mod.GoogleSignin.revokeAccess).toHaveBeenCalledTimes(1);
    expect(g.state.signedIn).toBeNull();

    // A failing revoke does not fail the deletion.
    await provider.google!.signIn();
    g.mod.GoogleSignin.revokeAccess.mockRejectedValueOnce(new Error('offline'));
    await expect(provider.deleteUser()).resolves.toBeUndefined();
  });
});

describe("Google's error codes in the app's terms (errors.ts)", () => {
  const status = {
    SIGN_IN_CANCELLED: '12501',
    IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'P',
  };
  const err = (code: unknown) => Object.assign(new Error('x'), { code });

  it('maps the library, Google Play services and Firebase codes', () => {
    expect(googleAuthErrorCodeOf(err('12501'), status)).toBe('cancelled');
    expect(googleAuthErrorCodeOf(err('ASYNC_OP_IN_PROGRESS'), status)).toBe('inProgress');
    expect(googleAuthErrorCodeOf(err('P'), status)).toBe('playServices');
    expect(googleAuthErrorCodeOf(err('10'), status)).toBe('googleConfig');
    expect(googleAuthErrorCodeOf(err('7'), status)).toBe('network');
    expect(googleAuthErrorCodeOf(err('auth/invalid-credential'), status)).toBe('googleConfig');
    expect(googleAuthErrorCodeOf(err('auth/user-mismatch'), status)).toBe('userMismatch');
    expect(googleAuthErrorCodeOf(err('auth/too-many-requests'), status)).toBe('tooManyRequests');
    expect(googleAuthErrorCodeOf(err(10), status)).toBe('unknown');
    expect(googleAuthErrorCodeOf('boom', status)).toBe('unknown');
  });

  it('keeps an AuthError, and the original as the cause otherwise', () => {
    const e = new AuthError('network');
    expect(toGoogleAuthError(e, status)).toBe(e);
    const raw = err('12500');
    expect(toGoogleAuthError(raw, status)).toMatchObject({ code: 'unknown', cause: raw });
  });
});

describe('the auth store with Google', () => {
  afterEach(() => setAuthDeps(null));
  beforeEach(() => useRegistrationDraft.getState().reset());

  it('a Firebase build with Google says so; the development sign-in has none', async () => {
    installFirebaseTestAuth();
    await initAuth();
    expect(useAuth.getState()).toMatchObject({ provider: 'firebase', google: true, status: 'signedOut' });

    installFirebaseTestAuth({ google: false });
    await initAuth();
    expect(useAuth.getState()).toMatchObject({ provider: 'firebase', google: false });

    installTestAuth();
    await initAuth();
    expect(useAuth.getState()).toMatchObject({ provider: 'dev', google: false });
    expect(await codeOf(signInWithGoogle())).toBe('unknown');
  });

  it('login: a Google account new to the game is signed in without a profile → step 1, which creates it', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    expect(await signInWithGoogle()).toBe('needsProfile');
    expect(useAuth.getState()).toMatchObject({
      status: 'needsProfile',
      user: { email: 'gamer@gmail.com', emailVerified: true, methods: ['google'] },
    });
    // No verification email: Google vouched for the address.
    expect(auth.firebase.mod.sendEmailVerification).not.toHaveBeenCalled();
    await registerProfile(FIGHTER);
    expect(useAuth.getState()).toMatchObject({ status: 'ready', me: { displayName: 'Gamer' } });
    expect([...auth.server.users.keys()]).toEqual(['fbg-1']);
  });

  it('login: a Google account with a fighter goes home', async () => {
    const auth = installFirebaseTestAuth();
    await addGooglePlayer(auth, { displayName: 'Returning' });
    await initAuth();
    expect(await signInWithGoogle()).toBe('ready');
    expect(useAuth.getState()).toMatchObject({ status: 'ready', me: { displayName: 'Returning' } });
  });

  it('login: a closed chooser changes nothing and asks the server nothing', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    auth.google.state.next = 'cancel';
    expect(await signInWithGoogle()).toBe('cancelled');
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.server.calls).toEqual([]);
  });

  it("login: Google's failure is thrown as it is; nothing changes", async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    auth.google.state.next = { code: '10' };
    expect(await codeOf(signInWithGoogle())).toBe('googleConfig');
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it("Crashlytics hears of the failures nobody on the phone can fix, with Google's code; not of the rest", async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    auth.google.state.next = { code: '10' };
    await codeOf(signInWithGoogle());
    auth.google.state.next = { code: '12500' };
    await codeOf(registerWithGoogle(FIGHTER));
    expect(auth.reports.map(([where]) => where)).toEqual([
      'google.signIn: googleConfig (10)',
      'google.signIn: unknown (12500)',
    ]);
    expect(auth.reports[0]![1]).toMatchObject({ code: 'googleConfig', cause: { code: '10' } });
    // The player's or the phone's: a closed chooser, no connection, no Play services, a password account.
    auth.reports.length = 0;
    auth.google.state.next = 'cancel';
    await signInWithGoogle();
    auth.google.state.next = { code: '7' };
    await codeOf(signInWithGoogle());
    auth.google.state.playServices = false;
    await codeOf(signInWithGoogle());
    auth.google.state.playServices = true;
    auth.firebase.state.nextCredentialError = 'auth/account-exists-with-different-credential';
    await codeOf(signInWithGoogle());
    expect(auth.reports).toEqual([]);
    // Deletion's re-authentication too.
    await registerWithGoogle(FIGHTER);
    auth.google.state.next = { code: '10' };
    expect(await codeOf(deleteAccountWithGoogle())).toBe('googleConfig');
    expect(auth.reports.map(([where]) => where)).toEqual(['google.reauthenticate: googleConfig (10)']);
    expect(auth.server.users.size).toBe(1);
  });

  it('login: no server and no saved profile undoes the sign-in, Google included', async () => {
    const auth = installFirebaseTestAuth();
    await addGooglePlayer(auth);
    await initAuth();
    auth.server.setOffline(true);
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'network' });
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.provider.currentUser()).toBeNull();
    expect(auth.google.state.signedIn).toBeNull();
  });

  it('registration: Google, then the fighter of step 1; the draft is cleared', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    useRegistrationDraft.getState().setName('Gamer');
    expect(await registerWithGoogle(FIGHTER)).toBe('created');
    expect(useAuth.getState()).toMatchObject({
      status: 'ready',
      provider: 'firebase',
      user: { methods: ['google'], emailVerified: true },
      me: { displayName: 'Gamer', avatarId: 'fox', country: 'IL' },
    });
    expect(auth.server.calls).toEqual(['GET /v1/me', 'POST /v1/users']);
    expect(auth.firebase.mod.sendEmailVerification).not.toHaveBeenCalled();
    expect(useRegistrationDraft.getState().displayName).toBe('');
  });

  it('registration: a Google account that already has a fighter just signs in (its own fighter)', async () => {
    const auth = installFirebaseTestAuth();
    await addGooglePlayer(auth, { displayName: 'Veteran' });
    await initAuth();
    auth.server.calls.length = 0;
    expect(await registerWithGoogle(FIGHTER)).toBe('existing');
    expect(useAuth.getState()).toMatchObject({ status: 'ready', me: { displayName: 'Veteran' } });
    expect(auth.server.calls).toEqual(['GET /v1/me']);
  });

  it('registration: the name taken meanwhile keeps the sign-in, and step 1 finishes it', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    auth.server.takeName('Gamer');
    const error: unknown = await registerWithGoogle(FIGHTER).catch((e: unknown) => e);
    expect(isAccountApiError(error) && error.code).toBe('taken');
    expect(useAuth.getState()).toMatchObject({ status: 'needsProfile', user: { methods: ['google'] } });
    // The terms, accepted just before the chooser, are this account's: step 1 won't ask again.
    expect(useRegistrationDraft.getState().termsAcceptedBy).toBe('fbg-1');
    await registerProfile({ ...FIGHTER, displayName: 'Gamer2' });
    expect(useAuth.getState().status).toBe('ready');
  });

  it("registration: when the server can't say whether there is a fighter, the sign-in is undone", async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    auth.server.setOffline(true);
    await expect(registerWithGoogle(FIGHTER)).rejects.toMatchObject({ code: 'network' });
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.provider.currentUser()).toBeNull();
    expect(auth.server.users.size).toBe(0);
  });

  it('registration: a closed chooser changes nothing (and no account accepted the terms)', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    auth.google.state.next = 'cancel';
    expect(await registerWithGoogle(FIGHTER)).toBe('cancelled');
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.server.calls).toEqual([]);
    expect(useRegistrationDraft.getState().termsAcceptedBy).toBeNull();
  });

  it('leaving step 1: a Google-only sign-in without a fighter is deleted, Google let go, nothing reported', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    expect(await signInWithGoogle()).toBe('needsProfile');
    useRegistrationDraft.getState().setName('Gamer');
    await leaveRegistration();
    expect(useAuth.getState()).toMatchObject({ status: 'signedOut', user: null });
    expect(auth.firebase.mod.deleteUser).toHaveBeenCalledTimes(1);
    expect(auth.google.mod.GoogleSignin.revokeAccess).toHaveBeenCalledTimes(1);
    expect(auth.provider.currentUser()).toBeNull();
    expect(useRegistrationDraft.getState().displayName).toBe('');
    expect(auth.reports).toEqual([]);
  });

  it('leaving step 1 long after the sign-in (Firebase wants a recent one): signed out, nothing reported', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    await signInWithGoogle();
    auth.firebase.state.nextDeleteError = 'auth/requires-recent-login';
    await leaveRegistration();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.provider.currentUser()).toBeNull();
    expect(auth.google.state.signedIn).toBeNull();
    expect(auth.reports).toEqual([]);
    // Another failure is worth a report, and still signs out.
    await signInWithGoogle();
    auth.firebase.state.nextDeleteError = 'auth/internal-error';
    await leaveRegistration();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.reports.map(([where]) => where)).toEqual(['leaveRegistration.deleteUser']);
  });

  it('leaving: a password sign-in, or an account with a fighter, is only signed out', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    await auth.provider.signUp('new@example.com', 'Arena1234');
    setAuthDeps(auth.deps);
    await initAuth();
    expect(useAuth.getState()).toMatchObject({ status: 'needsProfile', user: { methods: ['password'] } });
    await leaveRegistration();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.firebase.mod.deleteUser).not.toHaveBeenCalled();

    await registerWithGoogle(FIGHTER);
    expect(useAuth.getState().status).toBe('ready');
    await leaveRegistration();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.firebase.mod.deleteUser).not.toHaveBeenCalled();
    expect(auth.server.users.size).toBe(1);
  });

  it('sign-out leaves Google too, so its chooser shows next time', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    await registerWithGoogle(FIGHTER);
    await signOut();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.google.state.signedIn).toBeNull();
  });

  it('deletion: Google instead of the password, then the server, then Firebase, then Google lets go', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    await registerWithGoogle(FIGHTER);
    // The chooser closed: nothing is deleted.
    auth.google.state.next = 'cancel';
    expect(await codeOf(deleteAccountWithGoogle())).toBe('cancelled');
    expect(auth.server.users.size).toBe(1);
    expect(useAuth.getState().status).toBe('ready');

    expect(await deleteAccountWithGoogle()).toEqual({ signInDeleted: true });
    expect(auth.firebase.mod.reauthenticateWithCredential).toHaveBeenCalledTimes(1);
    expect(auth.firebase.mod.getIdToken).toHaveBeenCalledWith(expect.anything(), true);
    expect(auth.server.calls).toContain('DELETE /v1/me');
    expect(auth.firebase.mod.deleteUser).toHaveBeenCalledTimes(1);
    expect(auth.google.mod.GoogleSignin.revokeAccess).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('deletion: another Google account is refused before anything is deleted', async () => {
    const auth = installFirebaseTestAuth();
    await initAuth();
    await registerWithGoogle(FIGHTER);
    auth.google.state.account = { email: 'other@gmail.com' };
    expect(await codeOf(deleteAccountWithGoogle())).toBe('userMismatch');
    expect(auth.server.calls).not.toContain('DELETE /v1/me');
    expect(useAuth.getState().status).toBe('ready');
  });
});
