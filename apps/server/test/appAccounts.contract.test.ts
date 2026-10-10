/**
 * The contract between the app's account client and this server (spec §3, §18 "HTTP API", work plan stage
 * 8), end to end: the app's own API client (apps/mobile/src/api/accountApi.ts, the module the phone runs:
 * pure TypeScript, fetch and the token injected) against the real server (Colyseus + Express + an in-memory
 * PGlite, one port), like appTelemetry.contract.test.ts does for usage reports.
 *
 * - Tokens as the app makes them: the development sign-in's `dev:<uid>:<email>` (protocol devToken, what
 *   DevAuthProvider.getIdToken returns), and Firebase ID tokens (signed with this test's keys, never Google's;
 *   what FirebaseAuthProvider.getIdToken returns).
 * - Every answer goes through the app's own checks (isMe, the error codes it maps), so a server that drifts
 *   from the protocol fails here, as an 'unexpected' answer.
 * - The usage reports carry the same token (services/telemetry/sender.ts), and the server links them to the
 *   account.
 *
 * Only the React Native wiring (auth/index.ts: the provider choice, expo-sqlite) is left out.
 */
import type { AddressInfo } from 'node:net';

import {
  devToken,
  type Me,
  RENAME_COOLDOWN_MS,
  ratingKeysFor,
  TELEMETRY_PATH,
  type TelemetryEvent,
  validateDisplayName,
} from '@sudoku-fight/protocol';
import { eq } from 'drizzle-orm';

// The app's code (pure TypeScript, no React Native): what the phone runs.
import {
  type AccountApi,
  AccountApiError,
  type AccountFetch,
  createAccountApi,
  isOfflineError,
} from '../../mobile/src/api/accountApi';
import { isMe, nextRenameAt, ratingsByType } from '../../mobile/src/api/me';
import { TelemetryQueue } from '../../mobile/src/services/telemetry/queue';
import { type FetchLike, TelemetrySender } from '../../mobile/src/services/telemetry/sender';
import { uuidV4 } from '../../mobile/src/services/telemetry/uuid';
import { DEFAULT_ACCOUNT_LIMITS } from '../src/accounts/router';
import { createAppServer } from '../src/app';
import { appEvents, installs } from '../src/db/schema';
import { createTestDb, fakeClock, startHttp, type TestDb, type TestHttp, testConfig } from '../src/testing';
import { testTokens, type TestTokens } from '../src/testing/tokens';

const T = Date.UTC(2026, 9, 9, 12);
const DAY = 24 * 60 * 60 * 1000;

// ---- the server ------------------------------------------------------------------------------------------

const clock = fakeClock(T);
let db: TestDb;
let tokens: TestTokens;
let server: ReturnType<typeof createAppServer>;
let url = '';
const extraServers: TestHttp[] = [];

beforeAll(async () => {
  [db, tokens] = await Promise.all([createTestDb(), testTokens()]);
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig(),
    db,
    now: clock.now,
    tokens: tokens.verifier(clock.now),
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await Promise.all(extraServers.map((s) => s.close()));
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await db.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

// ---- the phone -------------------------------------------------------------------------------------------

interface Request {
  method: string;
  path: string;
  authorization: string | null;
  status: number;
}

/**
 * A phone running the app's account client against `base`, wired like auth/index.ts: the token comes from
 * the sign-in (null: signed out), and a forced refresh is what the provider does after a 401.
 */
function phone(base: string, signIn: { token: string | null; refresh?: () => Promise<string> }) {
  const requests: Request[] = [];
  const state = { ...signIn, refreshes: 0 };
  const fetchFn: AccountFetch = async (target, init) => {
    const res = await fetch(target, init);
    requests.push({
      method: init.method,
      path: target.slice(base.length),
      authorization: init.headers.Authorization ?? null,
      status: res.status,
    });
    return res;
  };
  const api: AccountApi = createAccountApi({
    baseUrl: base,
    getToken: async (forceRefresh) => {
      if (forceRefresh && state.refresh !== undefined && state.token !== null) {
        state.refreshes++;
        state.token = await state.refresh();
      }
      return state.token;
    },
    fetch: fetchFn,
    timeoutMs: 10_000,
  });
  return { api, requests, state };
}

/** The AccountApiError a call ends in. */
async function failure(p: Promise<unknown>): Promise<AccountApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AccountApiError) return e;
    throw e;
  }
  throw new Error('expected an AccountApiError');
}

const ANA = { uid: 'AnaDevUid0123456789abcdefXYZ', email: 'ana@example.com' };
const anaToken = devToken(ANA.uid, ANA.email);
let anaFirst: Me;

// ---- the story of stage 8 ------------------------------------------------------------------------------------

describe('registration (spec §3.2): step 1, the fighter, before any sign-in; step 2, the account', () => {
  it('step 1 checks the name without a token; the app and the server agree on what is invalid', async () => {
    const before = phone(url, { token: null });
    expect(await before.api.nameAvailable('Ana_Arena')).toEqual({ available: true });
    expect(before.requests[0]).toMatchObject({ authorization: null, status: 200 });

    for (const name of ['ab', 'a'.repeat(17), 'two words', 'אנה!', 'Ana-Arena']) {
      const answer = await before.api.nameAvailable(name);
      expect(answer).toEqual({ available: false, reason: 'invalid', problem: validateDisplayName(name) });
      expect(answer.problem).not.toBeNull();
    }
    for (const name of ['Sh1t', 'fuck_you', 'Admin']) {
      expect(await before.api.nameAvailable(name)).toEqual({ available: false, reason: 'blocked' });
    }
  });

  it("step 2 makes the profile with the sign-in's token: the email comes from the token, 1200 provisional", async () => {
    const ana = phone(url, { token: anaToken });
    anaFirst = await ana.api.createUser({ displayName: 'Ana_Arena', avatarId: 'av07', country: 'IL' });
    expect(isMe(anaFirst)).toBe(true);
    expect(anaFirst).toMatchObject({
      displayName: 'Ana_Arena',
      avatarId: 'av07',
      country: 'IL',
      email: ANA.email,
      displayNameChangedAt: null,
      nextRenameAt: null,
      createdAt: T,
    });
    // [D7] option B (the server's default): one rating per game type, [D23] 1200 and provisional.
    expect(anaFirst.ratings.map((r) => r.key)).toEqual(ratingKeysFor('B'));
    expect(anaFirst.ratings.every((r) => r.rating === 1200 && r.provisional && r.games === 0)).toBe(true);
    expect(ratingsByType(anaFirst.ratings)).toEqual({
      fast: { rating: 1200, provisional: true },
      normal: { rating: 1200, provisional: true },
      hard: { rating: 1200, provisional: true },
    });
    expect(ana.requests).toEqual([
      { method: 'POST', path: '/v1/users', authorization: `Bearer ${anaToken}`, status: 201 },
    ]);
    expect(await ana.api.getMe()).toEqual(anaFirst);
  });

  it('the name is now taken for others (any case), still "available" to its owner', async () => {
    const other = phone(url, { token: null });
    expect(await other.api.nameAvailable('ana_arena')).toEqual({ available: false, reason: 'taken' });
    expect(await other.api.nameAvailable('ANA_ARENA')).toEqual({ available: false, reason: 'taken' });
    expect(await phone(url, { token: anaToken }).api.nameAvailable('ana_ARENA')).toEqual({ available: true });
  });

  it('a Firebase sign-in registers the same way; a taken name and a second profile are refused', async () => {
    const benToken = await tokens.sign({ uid: 'fb-ben', email: 'ben@example.com' }, clock.now());
    const ben = phone(url, { token: benToken });
    const taken = await failure(
      ben.api.createUser({ displayName: 'ANA_arena', avatarId: 'av01', country: 'GB' }),
    );
    expect(taken).toMatchObject({ code: 'taken', status: 409 });
    const me = await ben.api.createUser({ displayName: 'Ben_Fb', avatarId: 'av01', country: 'GB' });
    expect(me).toMatchObject({ displayName: 'Ben_Fb', email: 'ben@example.com', emailVerified: true });

    // A second registration of the same sign-in (the app then reads the profile: authStore createOrFetch).
    const again = await failure(
      ben.api.createUser({ displayName: 'Ben_Two', avatarId: 'av01', country: 'GB' }),
    );
    expect(again).toMatchObject({ code: 'alreadyRegistered', status: 409 });
    // Anything but the three fields is refused: the email can't come from the body.
    const sneaky = await failure(
      ben.api.updateMe({ avatarId: 'av02', email: 'evil@example.com' } as Parameters<
        AccountApi['updateMe']
      >[0]),
    );
    expect(sneaky).toMatchObject({ code: 'badRequest', status: 400 });
    expect((await ben.api.getMe()).email).toBe('ben@example.com');
  });
});

describe('the profile (D20, D21)', () => {
  it('avatar and country any time; the name once in 30 days, with nextRenameAt the app shows', async () => {
    const ana = phone(url, { token: anaToken });
    expect(await ana.api.updateMe({ avatarId: 'av02', country: 'US' })).toMatchObject({
      avatarId: 'av02',
      country: 'US',
      displayNameChangedAt: null,
    });

    // The name chosen at registration is not a rename: the first one is allowed at once.
    clock.advance(DAY);
    const renamedAt = clock.now();
    const renamed = await ana.api.updateMe({ displayName: 'Ana_Renamed' });
    expect(renamed).toMatchObject({
      displayName: 'Ana_Renamed',
      displayNameChangedAt: renamedAt,
      nextRenameAt: renamedAt + RENAME_COOLDOWN_MS,
    });
    expect(nextRenameAt(renamed, clock.now())).toBe(renamedAt + RENAME_COOLDOWN_MS);

    clock.advance(DAY);
    const tooSoon = await failure(ana.api.updateMe({ displayName: 'Ana_Again' }));
    expect(tooSoon).toMatchObject({ code: 'renameTooSoon', status: 409 });
    expect(tooSoon.body?.nextRenameAt).toBe(renamedAt + RENAME_COOLDOWN_MS);
    expect(isOfflineError(tooSoon)).toBe(false);
    // The avatar still changes meanwhile [D21].
    expect(await ana.api.updateMe({ avatarId: 'av03' })).toMatchObject({ avatarId: 'av03' });

    clock.set(renamedAt + RENAME_COOLDOWN_MS);
    expect(nextRenameAt(await ana.api.getMe(), clock.now())).toBeNull();
    expect(await ana.api.updateMe({ displayName: 'Ana_Again' })).toMatchObject({ displayName: 'Ana_Again' });
    // The old names are free again.
    expect(await phone(url, { token: null }).api.nameAvailable('Ana_Arena')).toEqual({ available: true });
    expect(await phone(url, { token: null }).api.nameAvailable('Ana_Renamed')).toEqual({ available: true });
  });
});

describe('usage reports carry the sign-in (services/telemetry/sender.ts → POST /v1/events)', () => {
  const nodeFetch: FetchLike = async (target, init) => {
    const res = await fetch(target, init);
    return { status: res.status, headers: res.headers, text: () => res.text() };
  };

  function sendBatch(idToken: () => Promise<string | null>) {
    const installId = uuidV4();
    const queue = new TelemetryQueue();
    const event: TelemetryEvent = { id: uuidV4(), name: 'app_open', props: {}, t: clock.now() - 1000 };
    queue.append(event);
    const sender = new TelemetrySender({
      url: `${url}${TELEMETRY_PATH}`,
      queue,
      meta: () => ({ installId, platform: 'android', appVersion: '0.1.0' }),
      idToken,
      fetch: nodeFetch,
      now: clock.now,
      random: () => 0,
      timers: {
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
      },
    });
    return { installId, eventId: event.id, flush: () => sender.flush() };
  }

  it('signed in: the events and the install are linked to the account', async () => {
    const ana = await phone(url, { token: anaToken }).api.getMe();
    const batch = sendBatch(() => Promise.resolve(anaToken));
    expect(await batch.flush()).toMatchObject({ sent: 1, dropped: 0 });
    const [event] = await db.db.select().from(appEvents).where(eq(appEvents.id, batch.eventId));
    expect(event?.userId).toBe(ana.id);
    const [install] = await db.db.select().from(installs).where(eq(installs.id, batch.installId));
    expect(install?.userId).toBe(ana.id);
  });

  it('signed out, or a token the server refuses: stored all the same, anonymous', async () => {
    for (const token of [null, 'garbage', devToken('nobody_registered')]) {
      const batch = sendBatch(() => Promise.resolve(token));
      expect(await batch.flush()).toMatchObject({ sent: 1 });
      const [event] = await db.db.select().from(appEvents).where(eq(appEvents.id, batch.eventId));
      expect(event).toBeDefined();
      expect(event?.userId).toBeNull();
    }
  });
});

describe('tokens: refreshed once after a 401, signed out without a request', () => {
  it('an expired Firebase token: 401, the app refreshes it and the call goes through', async () => {
    const stale = await tokens.sign({ uid: 'fb-ben', email: 'ben@example.com' }, clock.now() - 2 * 3600_000);
    const ben = phone(url, {
      token: stale,
      refresh: () => tokens.sign({ uid: 'fb-ben', email: 'ben@example.com' }, clock.now()),
    });
    expect(await ben.api.getMe()).toMatchObject({ displayName: 'Ben_Fb' });
    expect(ben.state.refreshes).toBe(1);
    expect(ben.requests.map((r) => r.status)).toEqual([401, 200]);
  });

  it('a token that stays bad: one retry, then unauthorized (not an "offline, try later" error)', async () => {
    const bad = phone(url, { token: 'garbage', refresh: () => Promise.resolve('still-garbage') });
    const error = await failure(bad.api.getMe());
    expect(error).toMatchObject({ code: 'unauthorized', status: 401 });
    expect(isOfflineError(error)).toBe(false);
    expect(bad.requests.map((r) => [r.authorization, r.status])).toEqual([
      ['Bearer garbage', 401],
      ['Bearer still-garbage', 401],
    ]);
  });

  it('signed out: the calls that need a sign-in send nothing', async () => {
    const out = phone(url, { token: null });
    for (const call of [
      () => out.api.getMe(),
      () => out.api.deleteMe(),
      () => out.api.updateMe({ country: 'IL' }),
    ]) {
      expect(await failure(call())).toMatchObject({ code: 'signedOut', status: null });
    }
    expect(out.requests).toEqual([]);
  });
});

describe('deleting the account (spec §3.3, §23), then registering again', () => {
  it('DELETE /v1/me; a second delete counts as done; the profile is gone', async () => {
    const ana = phone(url, { token: anaToken });
    await ana.api.deleteMe();
    await ana.api.deleteMe(); // the answer of the first was lost: the app tries again, and that is fine
    expect(ana.requests.map((r) => [r.method, r.status])).toEqual([
      ['DELETE', 204],
      ['DELETE', 404],
    ]);
    expect(await failure(ana.api.getMe())).toMatchObject({ code: 'notRegistered', status: 404 });
    expect(await failure(ana.api.updateMe({ avatarId: 'av04' }))).toMatchObject({ code: 'notRegistered' });
  });

  it('the name is free at once: someone else registers it', async () => {
    expect(await phone(url, { token: null }).api.nameAvailable('Ana_Again')).toEqual({ available: true });
    const carol = phone(url, { token: devToken('CarolDevUid0123456789abcdefX', 'carol@example.com') });
    expect(
      await carol.api.createUser({ displayName: 'Ana_Again', avatarId: 'av09', country: 'FR' }),
    ).toMatchObject({
      displayName: 'Ana_Again',
      email: 'carol@example.com',
    });
  });

  it('the same sign-in may register again (the Firebase delete failed on the phone): a new profile', async () => {
    const ana = phone(url, { token: anaToken });
    const back = await ana.api.createUser({ displayName: 'Ana_Arena', avatarId: 'av07', country: 'IL' });
    expect(back.id).not.toBe(anaFirst.id);
    expect(back).toMatchObject({ displayName: 'Ana_Arena', displayNameChangedAt: null, nextRenameAt: null });
  });
});

describe('production servers (the app sees these as the protocol says)', () => {
  async function http(overrides: Parameters<typeof testConfig>[0], projectId?: null) {
    const s = await startHttp({
      config: testConfig(overrides),
      db: db.db,
      now: clock.now,
      tokens: tokens.verifier(clock.now, { devTokens: false, ...(projectId === null ? { projectId } : {}) }),
    });
    extraServers.push(s);
    return s.url;
  }

  it("production refuses the development sign-in's tokens: unauthorized; Firebase tokens work", async () => {
    const base = await http({ nodeEnv: 'production' });
    const dev = phone(base, { token: anaToken });
    expect(await failure(dev.api.getMe())).toMatchObject({ code: 'unauthorized', status: 401 });
    expect(
      await failure(dev.api.createUser({ displayName: 'Dev_Prod', avatarId: 'av01', country: 'IL' })),
    ).toMatchObject({ code: 'unauthorized' });
    // The name check takes no token: a refused one is as good as none.
    expect(await dev.api.nameAvailable('Dev_Prod')).toEqual({ available: true });

    const ben = phone(base, {
      token: await tokens.sign({ uid: 'fb-ben', email: 'ben@example.com' }, clock.now()),
    });
    expect(await ben.api.getMe()).toMatchObject({ displayName: 'Ben_Fb' });
  });

  it('production without FIREBASE_PROJECT_ID: disabled, which the app treats as "offline, try later"', async () => {
    const base = await http({ nodeEnv: 'production', firebaseProjectId: null }, null);
    const ben = phone(base, {
      token: await tokens.sign({ uid: 'fb-ben', email: 'ben@example.com' }, clock.now()),
    });
    const error = await failure(ben.api.getMe());
    expect(error).toMatchObject({ code: 'disabled', status: 503 });
    expect(isOfflineError(error)).toBe(true);
  });

  it('rate limits: 429 tooManyRequests with the wait, for the name check and for writes', async () => {
    const s = await startHttp({
      config: testConfig(),
      db: db.db,
      now: clock.now,
      tokens: tokens.verifier(clock.now),
      accountLimits: {
        ...DEFAULT_ACCOUNT_LIMITS,
        names: { limit: 2, windowMs: 60_000 },
        writes: { limit: 1, windowMs: 60_000 },
      },
    });
    extraServers.push(s);
    const ben = phone(s.url, {
      token: await tokens.sign({ uid: 'fb-ben', email: 'ben@example.com' }, clock.now()),
    });
    await ben.api.nameAvailable('Name_One');
    await ben.api.nameAvailable('Name_Two');
    const names = await failure(ben.api.nameAvailable('Name_Three'));
    expect(names).toMatchObject({ code: 'tooManyRequests', status: 429 });
    expect(names.retryAfterMs).toBeGreaterThanOrEqual(1000);
    expect(isOfflineError(names)).toBe(true);

    await ben.api.updateMe({ avatarId: 'av05' });
    expect(await failure(ben.api.updateMe({ avatarId: 'av06' }))).toMatchObject({ code: 'tooManyRequests' });
  });
});
