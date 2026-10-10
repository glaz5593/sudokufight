import { AccountApiError } from '../../api/accountApi';
import { ME_CACHE_KEY } from '../../api/me';
import { useProfile } from '../../state/profile';
import {
  checkEmailVerified,
  deleteAccount,
  initAuth,
  refreshMe,
  registerProfile,
  retryLoad,
  sendPasswordReset,
  sendVerificationEmail,
  setAuthDeps,
  signedInIdToken,
  signIn,
  signOut,
  signUpAndRegister,
  updateProfile,
  useAuth,
} from '../authStore';
import { createDevAuthProvider } from '../devProvider';
import { useRegistrationDraft } from '../registrationDraft';
import {
  installSignedInPlayer,
  installTestAuth,
  memoryStorage,
  seededBytes,
  TEST_PLAYER,
  type TestAuth,
} from '../testing/testAuth';
import { AuthError } from '../types';

const PROFILE = { displayName: 'MosheG', avatarId: 'av07', country: 'IL' } as const;
const state = () => useAuth.getState();

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a failure');
}

/** The same phone, a new run: the stores start over, the phone's storage and the server stay. */
function restart(auth: TestAuth): TestAuth {
  const provider = createDevAuthProvider({
    storage: auth.storage,
    now: () => auth.clock.now,
    randomBytes: seededBytes(9),
    log: () => undefined,
  });
  const deps = { ...auth.deps, provider };
  // The server signs requests with the new run's provider.
  const server = auth.server;
  setAuthDeps(deps);
  return { ...auth, provider, deps, server };
}

afterEach(() => setAuthDeps(null));

describe('starting the app', () => {
  it('nobody signed in → signedOut', async () => {
    installTestAuth();
    expect(state().status).toBe('loading');
    await initAuth();
    expect(state()).toMatchObject({ status: 'signedOut', provider: 'dev', user: null, me: null });
  });

  it('a signed-in player with a profile → ready, and the profile is saved for offline starts', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    expect(state()).toMatchObject({
      status: 'ready',
      meOffline: false,
      me: { displayName: TEST_PLAYER.displayName, avatarId: TEST_PLAYER.avatarId, country: 'IL' },
      user: { email: TEST_PLAYER.email, emailVerified: true },
    });
    expect(auth.storage.data.get(ME_CACHE_KEY)).toContain(TEST_PLAYER.displayName);
    // The game screens' local profile follows the account.
    expect(useProfile.getState()).toMatchObject({
      name: TEST_PLAYER.displayName,
      avatarId: TEST_PLAYER.avatarId,
      country: 'IL',
    });
  });

  it('calls during one start share it', async () => {
    const auth = await installSignedInPlayer();
    await Promise.all([initAuth(), initAuth()]);
    expect(auth.server.calls.filter((c) => c === 'GET /v1/me')).toHaveLength(1);
  });

  it('offline after a first sign-in: ready on the saved profile (D24: practice works offline)', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    const next = restart(auth);
    next.server.setOffline(true);
    await initAuth();
    expect(state()).toMatchObject({ status: 'ready', meOffline: true, me: { displayName: 'Tester' } });

    // Back online: Home's refresh reads the server again.
    next.server.setOffline(false);
    await refreshMe();
    expect(state()).toMatchObject({ status: 'ready', meOffline: false });
  });

  it('offline with no saved profile: stays on the Splash with the error, and retries', async () => {
    const auth = await installSignedInPlayer();
    auth.server.setOffline(true);
    await initAuth();
    expect(state()).toMatchObject({
      status: 'loading',
      loadError: 'network',
      user: { email: TEST_PLAYER.email },
    });
    auth.server.setOffline(false);
    await retryLoad();
    expect(state()).toMatchObject({ status: 'ready', loadError: null });
  });

  it('a sign-in whose profile is gone (deleted elsewhere) → needsProfile, and the saved copy is dropped', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    auth.server.users.clear();
    restart(auth);
    await initAuth();
    expect(state()).toMatchObject({ status: 'needsProfile', me: null });
    expect(auth.storage.data.has(ME_CACHE_KEY)).toBe(false);
  });

  it('an unexpected server error is reported (Crashlytics), an offline one is not', async () => {
    const auth = await installSignedInPlayer();
    auth.server.failNext('getMe', new AccountApiError('badRequest', 400));
    await initAuth();
    expect(state().loadError).toBe('badRequest');
    expect(auth.reports.map(([where]) => where)).toEqual(['getMe']);

    auth.server.failNext('getMe', new AccountApiError('network'));
    await retryLoad();
    expect(state().loadError).toBe('network');
    expect(auth.reports).toHaveLength(1);
  });
});

describe('signing in', () => {
  it('with a profile → ready', async () => {
    const auth = await installSignedInPlayer();
    await auth.provider.signOut();
    await initAuth();
    expect(state().status).toBe('signedOut');
    await signIn(TEST_PLAYER.email, TEST_PLAYER.password);
    expect(state()).toMatchObject({ status: 'ready', me: { displayName: 'Tester' } });
  });

  it('wrong password and unknown address are AuthErrors; nothing changes', async () => {
    const auth = await installSignedInPlayer();
    await auth.provider.signOut();
    await initAuth();
    expect(await rejection(signIn(TEST_PLAYER.email, 'nope12345'))).toMatchObject({ code: 'wrongPassword' });
    expect(await rejection(signIn('nobody@example.com', 'nope12345'))).toMatchObject({
      code: 'userNotFound',
    });
    expect(state().status).toBe('signedOut');
  });

  it('without a profile (registration stopped after step 2) → needsProfile', async () => {
    const auth = installTestAuth();
    await auth.provider.signUp('half@example.com', 'Arena1234');
    await auth.provider.signOut();
    await initAuth();
    await signIn('half@example.com', 'Arena1234');
    expect(state()).toMatchObject({ status: 'needsProfile', user: { email: 'half@example.com' } });
  });

  it('server unreachable and nothing saved: the sign-in is undone and the error thrown', async () => {
    const auth = await installSignedInPlayer();
    await auth.provider.signOut();
    await initAuth();
    auth.server.setOffline(true);
    expect(await rejection(signIn(TEST_PLAYER.email, TEST_PLAYER.password))).toMatchObject({
      code: 'network',
    });
    expect(state().status).toBe('signedOut');
    expect(auth.provider.currentUser()).toBeNull();
  });

  it('server unreachable but this account was here before: ready offline', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    // Signed out on the provider only (the saved profile stays), then offline.
    await auth.provider.signOut();
    auth.server.setOffline(true);
    await signIn(TEST_PLAYER.email, TEST_PLAYER.password);
    expect(state()).toMatchObject({ status: 'ready', meOffline: true });
  });
});

describe('registering (spec §3.2)', () => {
  it('step 2 makes the account, sends the verification and creates the profile → ready, 1200 provisional [D23]', async () => {
    const auth = installTestAuth();
    await initAuth();
    useRegistrationDraft.setState({ displayName: 'MosheG', avatarId: 'av07', country: 'IL' });
    await signUpAndRegister('moshe@example.com', 'Arena1234', PROFILE);
    expect(state()).toMatchObject({
      status: 'ready',
      user: { email: 'moshe@example.com', emailVerified: false },
    });
    expect(state().me?.ratings.map((r) => [r.key, r.rating, r.provisional])).toEqual([
      ['fast', 1200, true],
      ['normal', 1200, true],
      ['hard', 1200, true],
    ]);
    expect(auth.server.calls).toEqual(['POST /v1/users']);
    // The draft is done with.
    expect(useRegistrationDraft.getState().displayName).toBe('');
  });

  it('an address in use: AuthError, still signed out', async () => {
    const auth = installTestAuth();
    await auth.provider.signUp('moshe@example.com', 'Arena1234');
    await auth.provider.signOut();
    await initAuth();
    expect(await rejection(signUpAndRegister('moshe@example.com', 'Arena1234', PROFILE))).toMatchObject({
      code: 'emailInUse',
    });
    expect(state().status).toBe('signedOut');
  });

  it('the name taken meanwhile: signed in, needsProfile, and step 1 finishes it', async () => {
    const auth = installTestAuth();
    await initAuth();
    auth.server.takeName('mosheg');
    const error = await rejection(signUpAndRegister('moshe@example.com', 'Arena1234', PROFILE));
    expect(error).toMatchObject({ code: 'taken' });
    expect(state()).toMatchObject({ status: 'needsProfile', user: { email: 'moshe@example.com' } });

    await registerProfile({ ...PROFILE, displayName: 'MosheG2' });
    expect(state()).toMatchObject({ status: 'ready', me: { displayName: 'MosheG2' } });
  });

  it('a lost answer: POST again says alreadyRegistered, and the profile is read instead', async () => {
    const auth = installTestAuth();
    await initAuth();
    await auth.provider.signUp('moshe@example.com', 'Arena1234');
    await auth.server.api.createUser(PROFILE);
    await registerProfile(PROFILE);
    expect(state()).toMatchObject({ status: 'ready', me: { displayName: 'MosheG' } });
    expect(auth.server.calls.slice(-2)).toEqual(['POST /v1/users', 'GET /v1/me']);
  });

  it('registerProfile needs a sign-in', async () => {
    installTestAuth();
    await initAuth();
    expect(await rejection(registerProfile(PROFILE))).toMatchObject({ code: 'signedOut' });
  });
});

describe('the profile and the email', () => {
  it('updates the avatar and the country any time, the name once in 30 days [D20, D21]', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    await updateProfile({ avatarId: 'av09', country: 'US' });
    expect(state().me).toMatchObject({ avatarId: 'av09', country: 'US' });
    expect(useProfile.getState()).toMatchObject({ avatarId: 'av09', country: 'US' });

    await updateProfile({ displayName: 'Renamed' });
    expect(state().me?.displayName).toBe('Renamed');
    const tooSoon = await rejection(updateProfile({ displayName: 'Again' }));
    expect(tooSoon).toMatchObject({ code: 'renameTooSoon', body: { nextRenameAt: expect.any(Number) } });
    expect(auth.server.calls.at(-1)).toBe('PATCH /v1/me {"displayName":"Again"}');
  });

  it('verification [D22]: resend, then "I verified" refreshes the token and the profile', async () => {
    const auth = await installSignedInPlayer({ emailVerified: false });
    await initAuth();
    expect(state().user?.emailVerified).toBe(false);
    await sendVerificationEmail();
    expect(await checkEmailVerified()).toBe(true);
    expect(state().user?.emailVerified).toBe(true);
    expect(auth.server.calls.at(-1)).toBe('GET /v1/me');
  });

  it('password reset goes to the provider', async () => {
    installTestAuth();
    await expect(sendPasswordReset('a@b.co')).resolves.toBeUndefined();
    expect(await rejection(sendPasswordReset('nope'))).toMatchObject({ code: 'invalidEmail' });
  });

  it('signing out forgets the saved profile and the draft', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    useRegistrationDraft.setState({ displayName: 'Half' });
    await signOut();
    expect(state()).toMatchObject({ status: 'signedOut', user: null, me: null });
    expect(auth.storage.data.has(ME_CACHE_KEY)).toBe(false);
    expect(useRegistrationDraft.getState().displayName).toBe('');
    expect(auth.provider.currentUser()).toBeNull();
  });
});

describe('deleting the account (spec §3.3, §23)', () => {
  it('reauthenticates, deletes on the server, then the sign-in → signedOut, and the name is free', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    const order: string[] = [];
    const provider = auth.provider;
    const reauth = provider.reauthenticate.bind(provider);
    const del = provider.deleteUser.bind(provider);
    const token = provider.getIdToken.bind(provider);
    provider.reauthenticate = async (p) => {
      order.push('reauthenticate');
      return reauth(p);
    };
    provider.getIdToken = async (force) => {
      if (force) order.push('getIdToken(true)');
      return token(force);
    };
    provider.deleteUser = async () => {
      order.push('deleteUser');
      return del();
    };
    const deleteMe = auth.server.api.deleteMe;
    auth.server.api.deleteMe = async () => {
      order.push('DELETE /v1/me');
      return deleteMe();
    };

    expect(await deleteAccount(TEST_PLAYER.password)).toEqual({ signInDeleted: true });
    expect(order).toEqual(['reauthenticate', 'getIdToken(true)', 'DELETE /v1/me', 'deleteUser']);
    expect(state()).toMatchObject({ status: 'signedOut', me: null, user: null });
    expect(auth.storage.data.has(ME_CACHE_KEY)).toBe(false);
    expect(await auth.server.api.nameAvailable('Tester')).toEqual({ available: true });
    // The address is free again at the provider.
    await expect(provider.signUp(TEST_PLAYER.email, TEST_PLAYER.password)).resolves.toBeTruthy();
  });

  it('a wrong password deletes nothing', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    expect(await rejection(deleteAccount('wrong1234'))).toBeInstanceOf(AuthError);
    expect(auth.server.users.size).toBe(1);
    expect(state().status).toBe('ready');
  });

  it('the server still finds the sign-in too old (401 reauthRequired): nothing is deleted, try again', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    auth.server.failNext('deleteMe', new AccountApiError('reauthRequired', 401, { error: 'reauthRequired' }));
    expect(await rejection(deleteAccount(TEST_PLAYER.password))).toMatchObject({ code: 'reauthRequired' });
    expect(auth.provider.currentUser()).not.toBeNull();
    expect(auth.server.users.size).toBe(1);
    expect(state().status).toBe('ready');
    // The password again: a new re-authentication and a fresh token, and this time it goes through.
    expect(await deleteAccount(TEST_PLAYER.password)).toEqual({ signInDeleted: true });
    expect(auth.server.users.size).toBe(0);
  });

  it('the fresh token can’t be had (no connection): nothing is deleted', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    const token = auth.provider.getIdToken.bind(auth.provider);
    auth.provider.getIdToken = async (force) => {
      if (force) throw new AuthError('network');
      return token(force);
    };
    expect(await rejection(deleteAccount(TEST_PLAYER.password))).toMatchObject({ code: 'network' });
    expect(auth.server.calls).not.toContain('DELETE /v1/me');
    expect(auth.server.users.size).toBe(1);
    expect(state().status).toBe('ready');
  });

  it('the server unreachable: nothing is deleted, the player can try again', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    auth.server.setOffline(true);
    expect(await rejection(deleteAccount(TEST_PLAYER.password))).toMatchObject({ code: 'network' });
    expect(auth.provider.currentUser()).not.toBeNull();
    expect(state().status).toBe('ready');
  });

  it('the sign-in can’t be deleted (twice): the profile is gone, the player is signed out, and told', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    const del = jest.fn(async () => {
      throw new AuthError('network');
    });
    auth.provider.deleteUser = del;
    expect(await deleteAccount(TEST_PLAYER.password)).toEqual({ signInDeleted: false });
    expect(del).toHaveBeenCalledTimes(2);
    expect(auth.server.users.size).toBe(0);
    expect(state().status).toBe('signedOut');
    expect(auth.reports.map(([where]) => where)).toContain('deleteUser');

    // Signing in with the leftover sign-in starts a fresh registration.
    await signIn(TEST_PLAYER.email, TEST_PLAYER.password);
    expect(state().status).toBe('needsProfile');
  });

  it('a first failure of the sign-in deletion is retried once', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    const real = auth.provider.deleteUser.bind(auth.provider);
    let calls = 0;
    auth.provider.deleteUser = async () => {
      calls += 1;
      if (calls === 1) throw new AuthError('network');
      return real();
    };
    expect(await deleteAccount(TEST_PLAYER.password)).toEqual({ signInDeleted: true });
    expect(calls).toBe(2);
  });
});

describe('wiring', () => {
  it('a fresh setAuthDeps starts over at loading', async () => {
    installTestAuth();
    await initAuth();
    expect(state().status).toBe('signedOut');
    setAuthDeps({
      provider: createDevAuthProvider({ storage: memoryStorage(), log: () => undefined }),
      api: installTestAuth().server.api,
      meCache: { load: async () => null, save: async () => undefined, clear: async () => undefined },
    });
    expect(state().status).toBe('loading');
  });
});

describe('signedInIdToken (the token usage reports carry)', () => {
  it('null before anyone signs in, and when the auth is not wired', async () => {
    installTestAuth();
    await initAuth();
    expect(await signedInIdToken()).toBeNull();
    setAuthDeps(null);
    expect(await signedInIdToken()).toBeNull();
  });

  it("the provider's token once signed in, without forcing a refresh; null again after sign-out", async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    const getIdToken = jest.spyOn(auth.provider, 'getIdToken');
    const token = await signedInIdToken();
    expect(token).toMatch(/^dev:[A-Za-z0-9]{28}:player@example\.com$/);
    expect(getIdToken).toHaveBeenCalledWith(false);
    await signOut();
    expect(await signedInIdToken()).toBeNull();
  });

  it('never throws: a provider that fails gives null', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    jest.spyOn(auth.provider, 'getIdToken').mockRejectedValue(new AuthError('network'));
    await expect(signedInIdToken()).resolves.toBeNull();
  });
});
