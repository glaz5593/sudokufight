import { parseDevToken } from '@sudoku-fight/protocol';

import { chooseAuthProvider, firebaseConfigured } from '../chooseProvider';
import {
  createDevAuthProvider,
  DEV_ACCOUNTS_KEY,
  DEV_SESSION_KEY,
  LOCKOUT_MS,
  MAX_FAILURES,
  RECENT_LOGIN_MS,
} from '../devProvider';
import { createFirebaseAuthProvider, type FirebaseAuthModule } from '../firebaseProvider';
import { fakeFirebase } from '../testing/fakeFirebase';
import { memoryStorage, seededBytes } from '../testing/testAuth';
import { AuthError, type AuthProvider } from '../types';

const T0 = 1_760_000_000_000;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AuthError);
    return (e as AuthError).code;
  }
  throw new Error('expected a failure');
}

describe('DevAuthProvider (no Firebase in this build)', () => {
  function make(storage = memoryStorage(), clock = { now: T0 }) {
    const logs: string[] = [];
    const provider = createDevAuthProvider({
      storage,
      now: () => clock.now,
      randomBytes: seededBytes(7),
      log: (m) => logs.push(m),
    });
    return { provider, storage, clock, logs };
  }

  it('signs up, keeps the session for the next run, and issues dev tokens', async () => {
    const { provider, storage } = make();
    expect(provider.kind).toBe('dev');
    expect(await provider.restore()).toBeNull();
    expect(provider.currentUser()).toBeNull();
    await expect(provider.getIdToken()).rejects.toMatchObject({ code: 'noUser' });

    const user = await provider.signUp(' Moshe@Example.com ', 'Arena1234');
    expect(user).toEqual({
      uid: expect.stringMatching(/^[A-Za-z0-9]{28}$/),
      email: 'Moshe@Example.com',
      emailVerified: false,
    });
    expect(provider.currentUser()).toEqual(user);
    const token = await provider.getIdToken(true);
    expect(parseDevToken(token)).toEqual({ uid: user.uid, email: 'Moshe@Example.com' });

    // The password is not kept in the clear.
    const saved = storage.data.get(DEV_ACCOUNTS_KEY)!;
    expect(saved).not.toContain('Arena1234');
    expect(storage.data.get(DEV_SESSION_KEY)).toBe(user.uid);

    // A new run on the same phone: restored.
    const next = make(storage).provider;
    expect(await next.restore()).toEqual(user);
  });

  it('signs in with the right password only, and tells a wrong password from an unknown address', async () => {
    const { provider } = make();
    await provider.signUp('moshe@example.com', 'Arena1234');
    await provider.signOut();
    expect(provider.currentUser()).toBeNull();

    expect(await codeOf(provider.signIn('moshe@example.com', 'wrong-pass1'))).toBe('wrongPassword');
    expect(await codeOf(provider.signIn('nobody@example.com', 'Arena1234'))).toBe('userNotFound');
    expect(await codeOf(provider.signIn('not-an-email', 'Arena1234'))).toBe('invalidEmail');
    // Any case of the address.
    expect((await provider.signIn('MOSHE@example.com', 'Arena1234')).email).toBe('moshe@example.com');
  });

  it('locks an address out after too many wrong passwords, for a while', async () => {
    const { provider, clock } = make();
    await provider.signUp('moshe@example.com', 'Arena1234');
    await provider.signOut();
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect(await codeOf(provider.signIn('moshe@example.com', 'nope12345'))).toBe('wrongPassword');
    }
    expect(await codeOf(provider.signIn('moshe@example.com', 'Arena1234'))).toBe('tooManyRequests');
    clock.now += LOCKOUT_MS;
    await expect(provider.signIn('moshe@example.com', 'Arena1234')).resolves.toBeTruthy();
  });

  it('refuses a taken address and a password shorter than Firebase allows', async () => {
    const { provider } = make();
    await provider.signUp('moshe@example.com', 'Arena1234');
    expect(await codeOf(provider.signUp('MOSHE@example.com', 'Other1234'))).toBe('emailInUse');
    expect(await codeOf(provider.signUp('new@example.com', 'a1b2'))).toBe('weakPassword');
    expect(await codeOf(provider.signUp('bad email', 'Arena1234'))).toBe('invalidEmail');
  });

  it('verification: "sent" is only logged; reloading marks the address verified (as if the link was opened)', async () => {
    const { provider, logs } = make();
    await expect(provider.sendEmailVerification()).rejects.toMatchObject({ code: 'noUser' });
    await provider.signUp('moshe@example.com', 'Arena1234');
    await provider.sendEmailVerification();
    expect(logs.join()).toMatch(/verification email for moshe@example.com/);
    expect((await provider.reloadUser()).emailVerified).toBe(true);
    expect(provider.currentUser()?.emailVerified).toBe(true);
  });

  it('password reset answers the same for known and unknown addresses', async () => {
    const { provider, logs } = make();
    await provider.signUp('moshe@example.com', 'Arena1234');
    await expect(provider.sendPasswordReset('moshe@example.com')).resolves.toBeUndefined();
    await expect(provider.sendPasswordReset('nobody@example.com')).resolves.toBeUndefined();
    expect(await codeOf(provider.sendPasswordReset('nope'))).toBe('invalidEmail');
    expect(logs.filter((l) => l.startsWith('password reset'))).toHaveLength(2);
  });

  it('deletes only after a recent sign-in; reauthenticate checks the password', async () => {
    const { provider, storage, clock } = make();
    await provider.signUp('moshe@example.com', 'Arena1234');
    clock.now += RECENT_LOGIN_MS + 1;
    expect(await codeOf(provider.deleteUser())).toBe('requiresRecentLogin');
    expect(await codeOf(provider.reauthenticate('wrong1234'))).toBe('wrongPassword');
    await provider.reauthenticate('Arena1234');
    await provider.deleteUser();
    expect(provider.currentUser()).toBeNull();
    expect(storage.data.get(DEV_SESSION_KEY)).toBeUndefined();
    expect(JSON.parse(storage.data.get(DEV_ACCOUNTS_KEY)!)).toEqual({});
    // The address is free again.
    await expect(provider.signUp('moshe@example.com', 'Arena1234')).resolves.toBeTruthy();
  });

  it('a restored session is not a recent sign-in', async () => {
    const shared = make();
    await shared.provider.signUp('moshe@example.com', 'Arena1234');
    const next = make(shared.storage, shared.clock).provider;
    await next.restore();
    expect(await codeOf(next.deleteUser())).toBe('requiresRecentLogin');
  });

  it('forgets a session whose account is gone, and survives a corrupt store', async () => {
    const storage = memoryStorage();
    storage.data.set(DEV_SESSION_KEY, 'ghost');
    expect(await make(storage).provider.restore()).toBeNull();
    expect(storage.data.has(DEV_SESSION_KEY)).toBe(false);
    storage.data.set(DEV_ACCOUNTS_KEY, '{not json');
    const { provider } = make(storage);
    await expect(provider.signUp('moshe@example.com', 'Arena1234')).resolves.toBeTruthy();
  });
});

describe('FirebaseAuthProvider (React Native Firebase, modular API)', () => {
  function make() {
    const fake = fakeFirebase();
    const load = jest.fn(() => fake.mod as unknown as FirebaseAuthModule);
    return { provider: createFirebaseAuthProvider(load), load, ...fake };
  }

  it('loads the module only when first used', async () => {
    const { provider, load } = make();
    expect(provider.kind).toBe('firebase');
    expect(load).not.toHaveBeenCalled();
    expect(await provider.restore()).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    provider.currentUser();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('restores the saved session from the first auth-state answer', async () => {
    const { provider, state } = make();
    state.currentUser = { uid: 'u1', email: 'a@b.co', emailVerified: true };
    expect(await provider.restore()).toEqual({ uid: 'u1', email: 'a@b.co', emailVerified: true });
  });

  it('signs in and up, and maps Firebase errors', async () => {
    const { provider, mod } = make();
    expect(await codeOf(provider.signIn('a@b.co', 'nope'))).toBe('wrongPassword');
    expect(await provider.signIn(' a@b.co ', 'Arena1234')).toEqual({
      uid: 'fb-uid-1',
      email: 'a@b.co',
      emailVerified: false,
    });
    expect(mod.signInWithEmailAndPassword).toHaveBeenLastCalledWith(expect.anything(), 'a@b.co', 'Arena1234');
    expect(await codeOf(provider.signUp('taken@example.com', 'Arena1234'))).toBe('emailInUse');
    expect((await provider.signUp('new@example.com', 'Arena1234')).uid).toBe('fb-uid-2');
  });

  it('verification, reload, reset, tokens', async () => {
    const { provider, mod } = make();
    await expect(provider.sendEmailVerification()).rejects.toMatchObject({ code: 'noUser' });
    await provider.signUp('new@example.com', 'Arena1234');
    await provider.sendEmailVerification();
    expect(mod.sendEmailVerification).toHaveBeenCalledTimes(1);
    expect((await provider.reloadUser()).emailVerified).toBe(true);
    await provider.sendPasswordReset(' new@example.com ');
    expect(mod.sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'new@example.com');
    expect(await provider.getIdToken()).toBe('id-token');
    expect(await provider.getIdToken(true)).toBe('id-token-fresh');
  });

  it('reauthenticates with the email credential, then deletes and signs out', async () => {
    const { provider, mod } = make();
    await provider.signIn('a@b.co', 'Arena1234');
    expect(await codeOf(provider.reauthenticate('nope'))).toBe('wrongPassword');
    await provider.reauthenticate('Arena1234');
    expect(mod.EmailAuthProvider.credential).toHaveBeenLastCalledWith('a@b.co', 'Arena1234');
    await provider.deleteUser();
    expect(provider.currentUser()).toBeNull();
    await provider.signOut();
    expect(mod.signOut).toHaveBeenCalled();
  });
});

describe('choosing the provider', () => {
  it('reads extra.firebase for this platform', () => {
    expect(firebaseConfigured({ firebase: { android: true, ios: false } }, 'android')).toBe(true);
    expect(firebaseConfigured({ firebase: { android: true, ios: false } }, 'ios')).toBe(false);
    expect(firebaseConfigured({ firebase: { android: 'yes' } }, 'android')).toBe(false);
    expect(firebaseConfigured({}, 'android')).toBe(false);
    expect(firebaseConfigured(undefined, 'android')).toBe(false);
    expect(firebaseConfigured(null, 'android')).toBe(false);
  });

  it('Firebase when configured, the development sign-in otherwise', () => {
    const firebase = { kind: 'firebase' } as AuthProvider;
    const dev = { kind: 'dev' } as AuthProvider;
    const make = { firebase: jest.fn(() => firebase), dev: jest.fn(() => dev) };
    expect(chooseAuthProvider(true, make)).toBe(firebase);
    expect(chooseAuthProvider(false, make)).toBe(dev);
    expect(make.firebase).toHaveBeenCalledTimes(1);
    expect(make.dev).toHaveBeenCalledTimes(1);
  });

  it('in this test build (no Firebase files) the default is the development sign-in', () => {
    expect(firebaseConfigured()).toBe(false);
    expect(chooseAuthProvider().kind).toBe('dev');
  });
});
