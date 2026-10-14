import { devToken } from '@sudoku-fight/protocol';

import { type RandomBytes, systemRandomBytes } from '../services/telemetry/uuid';
import { sha256Hex } from './sha256';
import { AuthError, type AuthProvider, type AuthUser, type KeyValueStore } from './types';

/**
 * The development sign-in: used ONLY while Firebase isn't configured for this platform (chooseProvider.ts),
 * and marked "מצב פיתוח" on every account screen so nobody takes it for the real thing.
 *
 * - Accounts live on this phone (expo-sqlite's key-value store): email, a salted SHA-256 of the password,
 *   a uid shaped like Firebase's (28 letters and digits), and whether the email counts as verified.
 * - Its token is "dev:<uid>:<email>" (the protocol's devToken()), which the game server accepts only outside
 *   production (NODE_ENV !== 'production'). A production server refuses it, so a dev build can't reach real
 *   data.
 * - No email leaves the phone: "send verification" and "reset password" only log; "I verified" (reloadUser)
 *   marks the address verified, as if the link had been opened.
 * - It behaves like Firebase where the screens care: wrong password vs unknown user, a lockout after
 *   MAX_FAILURES wrong passwords in a row (for LOCKOUT_MS), email in use, weak password (< 6), and delete
 *   needing a sign-in within RECENT_LOGIN_MS.
 * - No Google: "המשך עם Google" needs Firebase (and Google's web client id), so the screens show no Google button.
 */

export const DEV_ACCOUNTS_KEY = 'devAuth.accounts';
export const DEV_SESSION_KEY = 'devAuth.session';
/** Firebase locks an address out after a burst of wrong passwords; so does this, to test that state. */
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 60_000;
/** Firebase asks for a fresh sign-in (≈5 min) before deleting an account. */
export const RECENT_LOGIN_MS = 5 * 60_000;
/** Firebase's own minimum; the app asks for more (config/account.ts). */
export const DEV_MIN_PASSWORD = 6;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UID_LENGTH = 28;

interface DevAccount {
  uid: string;
  email: string;
  salt: string;
  hash: string;
  emailVerified: boolean;
}

type Accounts = Record<string, DevAccount>;

export interface DevAuthDeps {
  storage: KeyValueStore;
  now?: () => number;
  randomBytes?: RandomBytes;
  log?: (message: string) => void;
}

const keyOf = (email: string) => email.trim().toLowerCase();

function randomString(bytes: RandomBytes, length: number, alphabet: string): string {
  const b = new Uint8Array(length);
  bytes(b);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}

const hashOf = (salt: string, password: string) => sha256Hex(`${salt}:${password}`);

export function createDevAuthProvider({
  storage,
  now = () => Date.now(),
  randomBytes = systemRandomBytes,
  log = (message) => {
    if (__DEV__) console.log(`[dev auth] ${message}`);
  },
}: DevAuthDeps): AuthProvider {
  let current: AuthUser | null = null;
  let signedInAt = 0;
  const failures = new Map<string, { count: number; until: number }>();

  async function readAccounts(): Promise<Accounts> {
    const raw = await storage.getItem(DEV_ACCOUNTS_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed !== null ? (parsed as Accounts) : {};
    } catch {
      return {};
    }
  }
  const writeAccounts = (accounts: Accounts) => storage.setItem(DEV_ACCOUNTS_KEY, JSON.stringify(accounts));

  const userOf = (a: DevAccount): AuthUser => ({
    uid: a.uid,
    email: a.email,
    emailVerified: a.emailVerified,
    methods: ['password'],
  });

  async function startSession(account: DevAccount): Promise<AuthUser> {
    current = userOf(account);
    signedInAt = now();
    await storage.setItem(DEV_SESSION_KEY, account.uid);
    return current;
  }

  async function accountOfCurrent(): Promise<{ accounts: Accounts; key: string; account: DevAccount }> {
    if (!current) throw new AuthError('noUser');
    const accounts = await readAccounts();
    const entry = Object.entries(accounts).find(([, a]) => a.uid === current!.uid);
    if (!entry) {
      // Deleted behind our back: the session is over.
      current = null;
      await storage.removeItem(DEV_SESSION_KEY);
      throw new AuthError('noUser');
    }
    return { accounts, key: entry[0], account: entry[1] };
  }

  function checkLockout(key: string) {
    const f = failures.get(key);
    if (f && f.count >= MAX_FAILURES && now() < f.until) throw new AuthError('tooManyRequests');
    if (f && f.count >= MAX_FAILURES) failures.delete(key);
  }

  function failed(key: string) {
    const count = (failures.get(key)?.count ?? 0) + 1;
    failures.set(key, { count, until: now() + LOCKOUT_MS });
  }

  return {
    kind: 'dev',

    async restore() {
      const uid = await storage.getItem(DEV_SESSION_KEY);
      if (!uid) return null;
      const account = Object.values(await readAccounts()).find((a) => a.uid === uid);
      if (!account) {
        await storage.removeItem(DEV_SESSION_KEY);
        return null;
      }
      current = userOf(account);
      // A restored session is not a recent sign-in.
      signedInAt = 0;
      return current;
    },

    currentUser: () => current,

    async signIn(email, password) {
      const key = keyOf(email);
      if (!EMAIL.test(key)) throw new AuthError('invalidEmail');
      checkLockout(key);
      const account = (await readAccounts())[key];
      if (!account) throw new AuthError('userNotFound');
      if (hashOf(account.salt, password) !== account.hash) {
        failed(key);
        throw new AuthError('wrongPassword');
      }
      failures.delete(key);
      return startSession(account);
    },

    async signUp(email, password) {
      const key = keyOf(email);
      if (!EMAIL.test(key)) throw new AuthError('invalidEmail');
      if (password.length < DEV_MIN_PASSWORD) throw new AuthError('weakPassword');
      const accounts = await readAccounts();
      if (accounts[key]) throw new AuthError('emailInUse');
      const salt = randomString(randomBytes, 16, UID_ALPHABET);
      const account: DevAccount = {
        uid: randomString(randomBytes, UID_LENGTH, UID_ALPHABET),
        email: email.trim(),
        salt,
        hash: hashOf(salt, password),
        emailVerified: false,
      };
      await writeAccounts({ ...accounts, [key]: account });
      return startSession(account);
    },

    async sendEmailVerification() {
      const { account } = await accountOfCurrent();
      log(`verification email for ${account.email} (not sent: development sign-in)`);
    },

    async reloadUser() {
      const { accounts, key, account } = await accountOfCurrent();
      // Development: "I verified" counts as having opened the link.
      const verified = { ...account, emailVerified: true };
      await writeAccounts({ ...accounts, [key]: verified });
      current = userOf(verified);
      return current;
    },

    async sendPasswordReset(email) {
      const key = keyOf(email);
      if (!EMAIL.test(key)) throw new AuthError('invalidEmail');
      // The same answer whether or not the address has an account, as Firebase gives.
      log(`password reset for ${key} (not sent: development sign-in)`);
    },

    async reauthenticate(password) {
      const { account } = await accountOfCurrent();
      const key = keyOf(account.email);
      checkLockout(key);
      if (hashOf(account.salt, password) !== account.hash) {
        failed(key);
        throw new AuthError('wrongPassword');
      }
      failures.delete(key);
      signedInAt = now();
    },

    async deleteUser() {
      const { accounts, key } = await accountOfCurrent();
      if (now() - signedInAt > RECENT_LOGIN_MS) throw new AuthError('requiresRecentLogin');
      const rest = { ...accounts };
      delete rest[key];
      await writeAccounts(rest);
      current = null;
      await storage.removeItem(DEV_SESSION_KEY);
    },

    async signOut() {
      current = null;
      await storage.removeItem(DEV_SESSION_KEY);
    },

    async getIdToken() {
      if (!current) throw new AuthError('noUser');
      try {
        return devToken(current.uid, current.email);
      } catch {
        // An address the token format can't carry: the uid alone (the server then has no email).
        return devToken(current.uid);
      }
    },
  };
}
