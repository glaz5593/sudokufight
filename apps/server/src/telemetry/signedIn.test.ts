import { randomUUID } from 'node:crypto';

import { ACCOUNT_PATHS, type Me, TELEMETRY_PATH, type TelemetryBatch } from '@sudoku-fight/protocol';

import type { ServerConfig } from '../config';
import { appEvents, installs } from '../db/schema';
import { call, fighter } from '../testing/accounts';
import { fakeClock, type FakeClock } from '../testing/clock';
import { testConfig } from '../testing/config';
import { createTestDb, type TestDb } from '../testing/db';
import { startHttp, type TestHttp } from '../testing/http';
import { testTokens, type TestTokens } from '../testing/tokens';

/**
 * POST /v1/events with an optional Authorization header (stage 8): a valid token of a live account puts it on
 * the batch's events and on the install; anything else leaves the batch anonymous, and it is stored all the
 * same.
 */

const NOW = Date.UTC(2026, 9, 9, 12);
const INSTALL = '7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11';

let t: TestDb;
let tokens: TestTokens;
let clock: FakeClock;
let http: TestHttp;

beforeAll(async () => {
  [t, tokens] = await Promise.all([createTestDb(), testTokens()]);
}, 30_000);
afterAll(() => t.close());
afterEach(() => http.close());

async function start(config: Partial<ServerConfig> = {}) {
  await t.reset();
  clock = fakeClock(NOW);
  const cfg = testConfig(config);
  http = await startHttp({
    config: cfg,
    db: t.db,
    now: clock.now,
    tokens: tokens.verifier(clock.now, {
      projectId: cfg.firebaseProjectId,
      devTokens: cfg.nodeEnv !== 'production',
    }),
    adminSiteDir: null,
  });
}

const idToken = (uid: string) => tokens.sign({ uid, email: `${uid}@example.com` }, clock.now());

const batch = (extra: Record<string, unknown> = {}): TelemetryBatch & Record<string, unknown> => ({
  installId: INSTALL,
  platform: 'ios',
  appVersion: '0.1.0',
  events: [{ id: randomUUID(), name: 'app_open', props: {}, t: clock.now() - 1000 }],
  ...extra,
});

const send = (body: unknown, token?: string) => call(http.url, 'POST', TELEMETRY_PATH, { body, token });

async function registered(uid: string, displayName: string): Promise<string> {
  const res = await call<Me>(http.url, 'POST', ACCOUNT_PATHS.users, {
    token: await idToken(uid),
    body: fighter({ displayName }),
  });
  expect(res.status).toBe(201);
  return res.body.id;
}

const eventUsers = async () =>
  (await t.db.select({ userId: appEvents.userId }).from(appEvents)).map((r) => r.userId);
const installUser = async () => (await t.db.select({ userId: installs.userId }).from(installs))[0]?.userId;

describe('POST /v1/events, signed in', () => {
  beforeEach(() => start());

  it('a valid token puts the account on the events and the install', async () => {
    const id = await registered('uid-1', 'Dana');
    expect((await send(batch(), await idToken('uid-1'))).status).toBe(202);
    expect(await eventUsers()).toEqual([id]);
    expect(await installUser()).toBe(id);
  });

  it('without a token, or with a bad or expired one, the batch is stored anonymous', async () => {
    await registered('uid-1', 'Dana');
    const expired = await idToken('uid-1');
    clock.advance(2 * 3600_000);
    for (const token of [undefined, 'garbage', expired, (await idToken('uid-1')).slice(0, -3) + 'abc']) {
      expect((await send(batch(), token)).status).toBe(202);
    }
    expect(await eventUsers()).toEqual([null, null, null, null]);
    expect(await installUser()).toBeNull();
  });

  it('a valid token without an account (registration not finished) is anonymous', async () => {
    expect((await send(batch(), await idToken('uid-9'))).status).toBe(202);
    expect(await eventUsers()).toEqual([null]);
  });

  it('never takes the user from the body, token or not', async () => {
    const id = await registered('uid-1', 'Dana');
    await registered('uid-2', 'Noa');
    const body = batch({ userId: 'someone-else' });
    body.events = body.events.map((e) => ({ ...e, userId: 'someone-else' }));
    expect((await send(body, await idToken('uid-1'))).status).toBe(202);
    expect(await eventUsers()).toEqual([id]);
  });

  it('an anonymous batch later keeps the install linked; another account takes it over', async () => {
    const dana = await registered('uid-1', 'Dana');
    const noa = await registered('uid-2', 'Noa');
    await send(batch(), await idToken('uid-1'));
    await send(batch());
    expect(await installUser()).toBe(dana);
    await send(batch(), await idToken('uid-2'));
    expect(await installUser()).toBe(noa);
  });

  it('after the account is deleted: the install is unlinked, and its old token links nothing', async () => {
    await registered('uid-1', 'Dana');
    const token = await idToken('uid-1');
    await send(batch(), token);
    expect((await call(http.url, 'DELETE', ACCOUNT_PATHS.me, { token })).status).toBe(204);
    expect(await installUser()).toBeNull();
    await send(batch(), token); // still within the hour the token is good for
    expect(await installUser()).toBeNull();
    expect((await eventUsers()).filter((u) => u === null)).toHaveLength(1);
  });

  it('development tokens link outside production', async () => {
    const res = await call<Me>(http.url, 'POST', ACCOUNT_PATHS.users, {
      token: 'dev:ana',
      body: fighter({ displayName: 'Ana' }),
    });
    await send(batch(), 'dev:ana');
    expect(await eventUsers()).toEqual([res.body.id]);
  });
});

describe('POST /v1/events in production', () => {
  it('ignores development tokens', async () => {
    await start({ nodeEnv: 'production' });
    expect((await send(batch(), 'dev:ana')).status).toBe(202);
    expect(await eventUsers()).toEqual([null]);
  });

  it('without FIREBASE_PROJECT_ID, events still arrive, anonymous', async () => {
    await start({ nodeEnv: 'production', firebaseProjectId: null });
    expect((await send(batch(), await idToken('uid-1'))).status).toBe(202);
    expect(await eventUsers()).toEqual([null]);
  });
});
