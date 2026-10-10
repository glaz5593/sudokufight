/* Test-only: a stand-in for @react-native-firebase/auth's modular API. */

/** A stand-in for @react-native-firebase/auth's modular API: one user in memory. */
export function fakeFirebase() {
  type Listener = (user: unknown) => void;
  const state = {
    currentUser: null as null | { uid: string; email: string | null; emailVerified: boolean },
    listeners: [] as Listener[],
  };
  const auth = {
    get currentUser() {
      return state.currentUser;
    },
  };
  const fail = (code: string) => Object.assign(new Error(code), { code });
  const mod = {
    getAuth: jest.fn(() => auth),
    onAuthStateChanged: jest.fn((_a: unknown, next: Listener) => {
      state.listeners.push(next);
      queueMicrotask(() => next(state.currentUser));
      return jest.fn();
    }),
    signInWithEmailAndPassword: jest.fn(async (_a: unknown, email: string, password: string) => {
      if (password !== 'Arena1234') throw fail('auth/wrong-password');
      state.currentUser = { uid: 'fb-uid-1', email, emailVerified: false };
      return { user: state.currentUser };
    }),
    createUserWithEmailAndPassword: jest.fn(async (_a: unknown, email: string) => {
      if (email === 'taken@example.com') throw fail('auth/email-already-in-use');
      state.currentUser = { uid: 'fb-uid-2', email, emailVerified: false };
      return { user: state.currentUser };
    }),
    sendEmailVerification: jest.fn(async () => undefined),
    reload: jest.fn(async () => {
      state.currentUser = { ...state.currentUser!, emailVerified: true };
    }),
    sendPasswordResetEmail: jest.fn(async () => undefined),
    EmailAuthProvider: { credential: jest.fn((email: string, password: string) => ({ email, password })) },
    reauthenticateWithCredential: jest.fn(async (_u: unknown, c: { password: string }) => {
      if (c.password !== 'Arena1234') throw fail('auth/wrong-password');
      return { user: state.currentUser };
    }),
    deleteUser: jest.fn(async () => {
      state.currentUser = null;
    }),
    signOut: jest.fn(async () => {
      state.currentUser = null;
    }),
    getIdToken: jest.fn(async (_u: unknown, force?: boolean) => (force ? 'id-token-fresh' : 'id-token')),
  };
  return { mod, state };
}
