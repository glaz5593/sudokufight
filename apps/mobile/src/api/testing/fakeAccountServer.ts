/* Test-only: the game server's account routes in memory, with the protocol's rules. */
import {
  type AccountError,
  type CreateUserRequest,
  isAvatarId,
  isCountryCode,
  type Me,
  type NameAvailability,
  normalizeForCompare,
  parseDevToken,
  ratingKeysFor,
  RENAME_COOLDOWN_MS,
  type UpdateMeRequest,
  validateDisplayName,
} from '@sudoku-fight/protocol';

import { type AccountApi, AccountApiError } from '../accountApi';

/** Offensive words of the fake server (the real list lives on the server only). */
export const FAKE_BLOCKED_WORDS = ['nasty'];

interface Row {
  me: Me;
  uid: string;
}

export interface FakeAccountServer {
  /** The account API as the app calls it, signed in with the token `getToken` gives. */
  api: AccountApi;
  /** Profiles by Firebase (or dev) uid. */
  readonly users: Map<string, Row>;
  /** Every call, as "METHOD path". */
  readonly calls: string[];
  /** The next call of `method` fails with this error (once). */
  failNext(method: keyof AccountApi, error: AccountApiError): void;
  /** Every call fails with 'network' while on. */
  setOffline(offline: boolean): void;
  /** Someone else registers `name`. */
  takeName(name: string): void;
  /** The server's clock. */
  setNow(now: number): void;
}

export function createFakeAccountServer({
  getToken,
  now: start = 1_760_000_000_000,
}: {
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  now?: number;
}): FakeAccountServer {
  const users = new Map<string, Row>();
  const calls: string[] = [];
  const failures = new Map<keyof AccountApi, AccountApiError>();
  let offline = false;
  let now = start;
  let nextId = 1;

  const reject = (status: number, body: AccountError): never => {
    throw new AccountApiError(body.error, status, body);
  };

  async function caller(method: keyof AccountApi, required: boolean): Promise<string | null> {
    if (offline) throw new AccountApiError('network');
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
    const token = await getToken(false);
    if (!token) {
      if (required) throw new AccountApiError('signedOut');
      return null;
    }
    const dev = parseDevToken(token);
    if (!dev) return reject(401, { error: 'unauthorized' });
    return dev.uid;
  }

  const nameOwner = (name: string): string | null => {
    const key = normalizeForCompare(name);
    for (const [uid, row] of users) if (normalizeForCompare(row.me.displayName) === key) return uid;
    return null;
  };

  const checkName = (name: string, self: string | null): void => {
    const problem = validateDisplayName(name);
    if (problem) reject(400, { error: 'invalidName', problem });
    if (FAKE_BLOCKED_WORDS.some((w) => name.toLowerCase().includes(w))) reject(422, { error: 'blocked' });
    const owner = nameOwner(name);
    if (owner !== null && owner !== self) reject(409, { error: 'taken' });
  };

  const rowOf = (uid: string): Row => users.get(uid) ?? reject(404, { error: 'notRegistered' });
  const copy = (me: Me): Me => ({ ...me, ratings: me.ratings.map((r) => ({ ...r })) });

  function newMe(body: CreateUserRequest): Me {
    return {
      id: `user-${nextId++}`,
      displayName: body.displayName,
      avatarId: body.avatarId,
      country: body.country,
      email: null,
      emailVerified: false,
      createdAt: now,
      displayNameChangedAt: null,
      nextRenameAt: null,
      ratings: ratingKeysFor('B').map((key) => ({
        key,
        rating: 1200,
        games: 0,
        provisional: true,
        peak: 1200,
      })),
    };
  }

  const api: AccountApi = {
    async nameAvailable(name) {
      calls.push(`GET /v1/names/available?name=${name}`);
      const self = await caller('nameAvailable', false);
      const problem = validateDisplayName(name);
      if (problem) return { available: false, reason: 'invalid', problem } satisfies NameAvailability;
      if (FAKE_BLOCKED_WORDS.some((w) => name.toLowerCase().includes(w))) {
        return { available: false, reason: 'blocked' };
      }
      const owner = nameOwner(name);
      return owner === null || owner === self ? { available: true } : { available: false, reason: 'taken' };
    },

    async createUser(body) {
      calls.push('POST /v1/users');
      const uid = (await caller('createUser', true))!;
      if (users.has(uid)) reject(409, { error: 'alreadyRegistered' });
      if (!isAvatarId(body.avatarId)) reject(400, { error: 'badRequest', field: 'avatarId' });
      if (!isCountryCode(body.country)) reject(400, { error: 'badRequest', field: 'country' });
      checkName(body.displayName, null);
      const me = newMe(body);
      users.set(uid, { uid, me });
      return copy(me);
    },

    async getMe() {
      calls.push('GET /v1/me');
      const uid = (await caller('getMe', true))!;
      return copy(rowOf(uid).me);
    },

    async updateMe(patch: UpdateMeRequest) {
      calls.push(`PATCH /v1/me ${JSON.stringify(patch)}`);
      const uid = (await caller('updateMe', true))!;
      const row = rowOf(uid);
      const me = { ...row.me };
      if (patch.avatarId !== undefined) {
        if (!isAvatarId(patch.avatarId)) reject(400, { error: 'badRequest', field: 'avatarId' });
        me.avatarId = patch.avatarId;
      }
      if (patch.country !== undefined) {
        if (!isCountryCode(patch.country)) reject(400, { error: 'badRequest', field: 'country' });
        me.country = patch.country;
      }
      if (patch.displayName !== undefined && patch.displayName !== me.displayName) {
        if (me.nextRenameAt !== null && now < me.nextRenameAt) {
          reject(409, { error: 'renameTooSoon', nextRenameAt: me.nextRenameAt });
        }
        checkName(patch.displayName, uid);
        me.displayName = patch.displayName;
        me.displayNameChangedAt = now;
        me.nextRenameAt = now + RENAME_COOLDOWN_MS;
      }
      row.me = me;
      return copy(me);
    },

    async deleteMe() {
      calls.push('DELETE /v1/me');
      const uid = (await caller('deleteMe', true))!;
      // The real server keeps an anonymous row and forgets the uid: here the row just goes.
      users.delete(uid);
    },
  };

  return {
    api,
    users,
    calls,
    failNext: (method, error) => void failures.set(method, error),
    setOffline: (on) => {
      offline = on;
    },
    takeName: (name) => {
      const uid = `other-${nextId}`;
      users.set(uid, {
        uid,
        me: newMe({ displayName: name, avatarId: 'balloon', country: 'US' }),
      });
    },
    setNow: (t) => {
      now = t;
    },
  };
}
