import { MAX_BLOCKS, type Me, REPORT_RESPONSE_HOURS } from '@sudoku-fight/protocol';

import { isMe, isSuspended, needsNewName, nextRenameAt, readMe } from '../me';
import {
  createModerationApi,
  isModerationOffline,
  type ModerationApiError,
  readBlockList,
  readReportReceipt,
} from '../moderationApi';
import { bodyOf, type FakeReply, fakeFetch } from '../testing/fakeProgress';

/**
 * "דווח על שחקן" and "חסום שחקן" as the app calls them (spec §3.5; protocol moderation.ts): the paths, the
 * bodies and the ID token (refreshed once on a 401), a duplicate report taken as sent, the answers checked, and
 * every failure as a code (with the server's retryAt and max). Then the profile's moderation flags (Me).
 */

const BASE = 'https://game.example';
const NOW = 1_760_000_000_000;

function api(reply: (url: string, method: string) => FakeReply, { token = 'tok' as string | null } = {}) {
  const fetch = fakeFetch((call) => reply(call.url, call.init.method));
  const tokens: boolean[] = [];
  const timers: (() => void)[] = [];
  const client = createModerationApi({
    baseUrl: BASE,
    getToken: async (force) => {
      tokens.push(force);
      return token === null ? null : force ? `${token}-fresh` : token;
    },
    fetch,
    timeoutMs: 1000,
    setTimeout: (cb) => timers.push(cb),
    clearTimeout: () => undefined,
  });
  return { client, fetch, tokens, timers };
}

const fail = async (p: Promise<unknown>): Promise<ModerationApiError> => {
  try {
    await p;
  } catch (error) {
    return error as ModerationApiError;
  }
  throw new Error('expected a failure');
};

const nina = { id: 'nina', displayName: 'NinaVolt', avatarId: 'maya', country: 'DE', league: null, level: 7 };
const receipt = {
  id: 'r1',
  playerId: 'nina',
  reason: 'offensiveName',
  status: 'open',
  gameId: 'g1',
  createdAt: NOW,
  respondWithinHours: 48,
};

describe('reports: POST /v1/reports', () => {
  it('sends the player, the reason and the game with the bearer token; a 201 is a new report', async () => {
    const { client, fetch } = api(() => ({ status: 201, body: receipt }));
    await expect(client.report({ playerId: 'nina', reason: 'offensiveName', gameId: 'g1' })).resolves.toEqual(
      {
        id: 'r1',
        duplicate: false,
        respondWithinHours: 48,
      },
    );
    expect(fetch.calls[0]!.url).toBe(`${BASE}/v1/reports`);
    expect(fetch.calls[0]!.init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    });
    expect(bodyOf(fetch.calls[0]!)).toEqual({ playerId: 'nina', reason: 'offensiveName', gameId: 'g1' });
  });

  it('409 duplicate is the same thank-you: resolved, with the open report id (no free text ever sent)', async () => {
    const { client } = api(() => ({ status: 409, body: { error: 'duplicate', reportId: 'r0' } }));
    await expect(client.report({ playerId: 'nina', reason: 'cheating' })).resolves.toEqual({
      id: 'r0',
      duplicate: true,
      respondWithinHours: REPORT_RESPONSE_HOURS,
    });
  });

  it('the hourly quota: 429 rateLimited with retryAt and Retry-After; and the other refusals by code', async () => {
    const at = NOW + 12 * 60_000;
    const quota = await fail(
      api(() => ({
        status: 429,
        body: { error: 'rateLimited', retryAt: at },
        headers: { 'Retry-After': '720' },
      })).client.report({ playerId: 'nina', reason: 'other' }),
    );
    expect(quota).toMatchObject({ code: 'rateLimited', status: 429, retryAfterMs: 720_000 });
    expect(quota.body?.retryAt).toBe(at);
    for (const [status, error] of [
      [403, 'suspended'],
      [400, 'self'],
      [404, 'notFound'],
      [404, 'notRegistered'],
      [503, 'disabled'],
    ] as const) {
      const e = await fail(
        api(() => ({ status, body: { error } })).client.report({ playerId: 'x', reason: 'other' }),
      );
      expect({ status, code: e.code }).toEqual({ status, code: error });
    }
    // A code this app doesn't know: the status says it.
    const odd = await fail(
      api(() => ({ status: 418, body: { error: 'teapot' } })).client.report({
        playerId: 'x',
        reason: 'other',
      }),
    );
    expect(odd.code).toBe('badRequest');
  });

  it('a bad player id never leaves the phone; an unreadable answer is "unexpected"', async () => {
    const { client, fetch } = api(() => ({ status: 201, body: receipt }));
    expect((await fail(client.report({ playerId: 'a/b', reason: 'other' }))).code).toBe('badRequest');
    expect(fetch.calls).toHaveLength(0);
    const garbled = api(() => ({ status: 201, body: '<html>proxy</html>' }));
    expect((await fail(garbled.client.report({ playerId: 'nina', reason: 'other' }))).code).toBe(
      'unexpected',
    );
  });
});

describe('blocks: GET, POST, DELETE /v1/me/blocks', () => {
  it('reads the list (newest first, rows it cannot read left out) and the limit', async () => {
    const list = {
      blocks: [{ ...nina, blockedAt: NOW }, { id: 'broken' }, { ...nina, id: 'pip', blockedAt: NOW - 1 }],
      max: 100,
    };
    const { client, fetch } = api(() => ({ body: list }));
    const read = await client.blocks();
    expect(read.blocks.map((b) => b.id)).toEqual(['nina', 'pip']);
    expect(read.max).toBe(100);
    expect(fetch.calls[0]!.url).toBe(`${BASE}/v1/me/blocks`);
    expect(fetch.calls[0]!.init.method).toBe('GET');
    expect(readBlockList({ blocks: [] })).toEqual({ blocks: [], max: MAX_BLOCKS });
    expect(readBlockList({ nope: true })).toBeNull();
  });

  it('blocks (201 new, 200 already) and unblocks by path (204, also when not blocked)', async () => {
    const { client, fetch } = api((url, method) =>
      method === 'DELETE' ? { status: 204 } : { status: 201, body: { ...nina, blockedAt: NOW } },
    );
    await expect(client.block('nina')).resolves.toMatchObject({
      id: 'nina',
      displayName: 'NinaVolt',
      blockedAt: NOW,
    });
    expect(bodyOf(fetch.calls[0]!)).toEqual({ playerId: 'nina' });
    await expect(client.unblock('nina')).resolves.toBeUndefined();
    expect(fetch.calls[1]!.url).toBe(`${BASE}/v1/me/blocks/nina`);
    expect(fetch.calls[1]!.init.method).toBe('DELETE');
  });

  it('409 limitReached carries the limit', async () => {
    const e = await fail(
      api(() => ({ status: 409, body: { error: 'limitReached', max: 100 } })).client.block('nina'),
    );
    expect(e.code).toBe('limitReached');
    expect(e.body?.max).toBe(100);
  });
});

describe('the token and the connection', () => {
  it('a 401 refreshes the token once', async () => {
    let n = 0;
    const { client, fetch, tokens } = api(() =>
      n++ === 0 ? { status: 401, body: { error: 'unauthorized' } } : { body: { blocks: [], max: 100 } },
    );
    await client.blocks();
    expect(tokens).toEqual([false, true]);
    expect(fetch.calls[1]!.init.headers.Authorization).toBe('Bearer tok-fresh');
  });

  it('signed out, no connection and the server down are told apart (offline ones say so)', async () => {
    expect((await fail(api(() => ({}), { token: null }).client.blocks())).code).toBe('signedOut');
    const network = await fail(api(() => ({ fail: true })).client.blocks());
    expect(network.code).toBe('network');
    expect(isModerationOffline(network)).toBe(true);
    const down = await fail(api(() => ({ status: 503, body: { error: 'unavailable' } })).client.blocks());
    expect(isModerationOffline(down)).toBe(true);
    const quota = await fail(api(() => ({ status: 429, body: { error: 'rateLimited' } })).client.blocks());
    expect(isModerationOffline(quota)).toBe(false);
  });

  it('gives up after the time limit ("timeout")', async () => {
    const fetch = fakeFetch(
      (call) =>
        new Promise<FakeReply>((resolve) => {
          call.init.signal?.addEventListener('abort', () => resolve({ fail: true }));
        }),
    );
    const timers: (() => void)[] = [];
    const client = createModerationApi({
      baseUrl: BASE,
      getToken: async () => 'tok',
      fetch,
      timeoutMs: 10,
      setTimeout: (cb) => timers.push(cb),
      clearTimeout: () => undefined,
    });
    const pending = client.blocks();
    await new Promise((r) => setImmediate(r));
    timers.forEach((fire) => fire());
    expect((await fail(pending)).code).toBe('timeout');
  });

  it('reads a receipt leniently where it may, strictly where it must', () => {
    expect(readReportReceipt({ id: 'r', reason: 'cheating' })).toMatchObject({
      id: 'r',
      reason: 'cheating',
      gameId: null,
      respondWithinHours: REPORT_RESPONSE_HOURS,
    });
    expect(readReportReceipt({ id: 'r', reason: 'spam' })).toBeNull();
    expect(readReportReceipt({ reason: 'cheating' })).toBeNull();
  });
});

describe("the profile's moderation flags (Me, spec §3.5)", () => {
  const me: Me = {
    id: 'me',
    displayName: 'שחקן48213',
    avatarId: 'maya',
    country: 'IL',
    email: 'a@b.co',
    emailVerified: true,
    createdAt: NOW,
    displayNameChangedAt: NOW - 1000,
    nextRenameAt: null,
    ratings: [],
    nameResetRequired: true,
    suspended: false,
  };

  it('are optional booleans: an older server leaves them out, a null reads as false, anything else is refused', () => {
    expect(isMe(me)).toBe(true);
    const { nameResetRequired: _r, suspended: _s, ...older } = me;
    expect(isMe(older)).toBe(true);
    expect(readMe({ ...me, suspended: null })).not.toBeNull();
    expect(isMe({ ...me, suspended: 'yes' })).toBe(false);
    expect(isMe({ ...me, nameResetRequired: 1 })).toBe(false);
  });

  it('a reset name asks for a new one at once (no 30 days), unless the account is suspended', () => {
    expect(needsNewName(me)).toBe(true);
    // An older server's profile would otherwise fall back on 30 days after the last rename.
    expect(nextRenameAt(me, NOW)).toBeNull();
    expect(nextRenameAt({ ...me, nameResetRequired: false }, NOW)).not.toBeNull();
    expect(needsNewName({ ...me, suspended: true })).toBe(false);
    expect(needsNewName({ ...me, nameResetRequired: undefined })).toBe(false);
    expect(needsNewName(null)).toBe(false);
    expect(isSuspended({ ...me, suspended: true })).toBe(true);
    expect(isSuspended(me)).toBe(false);
    expect(isSuspended(undefined)).toBe(false);
  });
});
