import { type Me, RENAME_COOLDOWN_MS } from '@sudoku-fight/protocol';

import {
  type AccountFetch,
  AccountApiError,
  createAccountApi,
  type FetchInit,
  isOfflineError,
} from '../accountApi';
import { createMeCache, isMe, leagueRating, ME_CACHE_KEY, nextRenameAt, ratingsByType } from '../me';
import { memoryStorage } from '../../auth/testing/testAuth';

const BASE = 'http://game.test:2567';

export const SAMPLE_ME: Me = {
  id: 'user-1',
  displayName: 'MosheG',
  avatarId: 'av05',
  country: 'IL',
  email: 'mosheg@example.com',
  emailVerified: false,
  createdAt: 1_760_000_000_000,
  displayNameChangedAt: null,
  nextRenameAt: null,
  ratings: [
    { key: 'fast', rating: 1200, games: 0, provisional: true, peak: 1200 },
    { key: 'normal', rating: 1200, games: 0, provisional: true, peak: 1200 },
    { key: 'hard', rating: 1200, games: 0, provisional: true, peak: 1200 },
  ],
};

interface Answer {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A fetch that answers from a script, and records what it was asked. */
function scripted(...answers: (Answer | Error)[]) {
  const requests: { url: string; init: FetchInit }[] = [];
  const fetch: AccountFetch = async (url, init) => {
    requests.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    const headers = new Map(Object.entries(next.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: next.status,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      text: async () =>
        next.body === undefined ? '' : typeof next.body === 'string' ? next.body : JSON.stringify(next.body),
    };
  };
  return { fetch, requests };
}

function api(
  fetch: AccountFetch,
  token: string | null = 'tok',
  extra: Partial<Parameters<typeof createAccountApi>[0]> = {},
) {
  const getToken = jest.fn(async (force: boolean) =>
    token === null ? null : force ? `${token}-fresh` : token,
  );
  return { api: createAccountApi({ baseUrl: BASE, getToken, fetch, timeoutMs: 1_000, ...extra }), getToken };
}

async function failure(p: Promise<unknown>): Promise<AccountApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AccountApiError);
    return e as AccountApiError;
  }
  throw new Error('expected a failure');
}

describe('account API client (spec §18 HTTP API)', () => {
  it('GET /v1/me with the bearer token', async () => {
    const { fetch, requests } = scripted({ status: 200, body: SAMPLE_ME });
    expect(await api(fetch).api.getMe()).toEqual(SAMPLE_ME);
    expect(requests[0]).toEqual({
      url: `${BASE}/v1/me`,
      init: expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: 'Bearer tok' },
      }),
    });
  });

  it('POST /v1/users and PATCH /v1/me send JSON', async () => {
    const { fetch, requests } = scripted({ status: 201, body: SAMPLE_ME }, { status: 200, body: SAMPLE_ME });
    const { api: client } = api(fetch);
    await client.createUser({ displayName: 'MosheG', avatarId: 'av05', country: 'IL' });
    await client.updateMe({ avatarId: 'av07' });
    expect(requests.map((r) => [r.init.method, r.url, r.init.body])).toEqual([
      ['POST', `${BASE}/v1/users`, '{"displayName":"MosheG","avatarId":"av05","country":"IL"}'],
      ['PATCH', `${BASE}/v1/me`, '{"avatarId":"av07"}'],
    ]);
    expect(requests[0]!.init.headers['Content-Type']).toBe('application/json');
  });

  it('checks a name without a token when signed out, with one when signed in', async () => {
    const out = scripted({ status: 200, body: { available: true } });
    expect(await api(out.fetch, null).api.nameAvailable('דן.Fox_1')).toEqual({ available: true });
    expect(out.requests[0]!.url).toBe(`${BASE}/v1/names/available?name=${encodeURIComponent('דן.Fox_1')}`);
    expect(out.requests[0]!.init.headers.Authorization).toBeUndefined();

    const signedIn = scripted({ status: 200, body: { available: false, reason: 'taken' } });
    expect(await api(signedIn.fetch).api.nameAvailable('MosheG')).toEqual({
      available: false,
      reason: 'taken',
    });
    expect(signedIn.requests[0]!.init.headers.Authorization).toBe('Bearer tok');
  });

  it('a 401 refreshes the token and tries once more', async () => {
    const { fetch, requests } = scripted(
      { status: 401, body: { error: 'unauthorized' } },
      { status: 200, body: SAMPLE_ME },
    );
    const { api: client, getToken } = api(fetch);
    expect(await client.getMe()).toEqual(SAMPLE_ME);
    expect(getToken.mock.calls).toEqual([[false], [true]]);
    expect(requests.map((r) => r.init.headers.Authorization)).toEqual(['Bearer tok', 'Bearer tok-fresh']);

    const twice = scripted(
      { status: 401, body: { error: 'unauthorized' } },
      { status: 401, body: { error: 'unauthorized' } },
    );
    expect((await failure(api(twice.fetch).api.getMe())).code).toBe('unauthorized');
    expect(twice.requests).toHaveLength(2);
  });

  it('turns the server’s errors into codes, with their details', async () => {
    const cases: [Answer, string][] = [
      [{ status: 404, body: { error: 'notRegistered' } }, 'notRegistered'],
      [{ status: 409, body: { error: 'taken' } }, 'taken'],
      [{ status: 409, body: { error: 'alreadyRegistered' } }, 'alreadyRegistered'],
      [{ status: 400, body: { error: 'invalidName', problem: 'tooShort' } }, 'invalidName'],
      [{ status: 422, body: { error: 'blocked' } }, 'blocked'],
      [{ status: 503, body: { error: 'disabled' } }, 'disabled'],
      [{ status: 503, body: { error: 'unavailable' } }, 'unavailable'],
      [{ status: 500, body: { error: 'internal' } }, 'internal'],
      // No body the app knows: by the status.
      [{ status: 502, body: '<html>bad gateway</html>' }, 'internal'],
      [{ status: 404 }, 'notFound'],
      [{ status: 413 }, 'tooLarge'],
      [{ status: 400, body: { error: 'whatever' } }, 'badRequest'],
    ];
    for (const [answer, code] of cases) {
      const e = await failure(api(scripted(answer).fetch).api.getMe());
      expect({ status: answer.status, code: e.code }).toEqual({ status: answer.status, code });
      expect(e.status).toBe(answer.status);
    }
    const tooSoon = await failure(
      api(scripted({ status: 409, body: { error: 'renameTooSoon', nextRenameAt: 123 } }).fetch).api.updateMe({
        displayName: 'NewName',
      }),
    );
    expect(tooSoon.body).toEqual({ error: 'renameTooSoon', nextRenameAt: 123 });
  });

  it('429: says how long to wait', async () => {
    const e = await failure(
      api(
        scripted({ status: 429, body: { error: 'tooManyRequests' }, headers: { 'Retry-After': '30' } }).fetch,
      ).api.getMe(),
    );
    expect(e.code).toBe('tooManyRequests');
    expect(e.retryAfterMs).toBe(30_000);
  });

  it('no answer: network; too slow: timeout; signed out: no call at all', async () => {
    expect(
      (await failure(api(scripted(new TypeError('Network request failed')).fetch).api.getMe())).code,
    ).toBe('network');

    jest.useFakeTimers();
    try {
      const hanging: AccountFetch = (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      const pending = api(hanging).api.getMe();
      const settled = failure(pending);
      await jest.advanceTimersByTimeAsync(1_000);
      expect((await settled).code).toBe('timeout');
    } finally {
      jest.useRealTimers();
    }

    const { fetch, requests } = scripted();
    expect((await failure(api(fetch, null).api.getMe())).code).toBe('signedOut');
    expect(requests).toHaveLength(0);
  });

  it('refuses an answer that is not a Me', async () => {
    expect((await failure(api(scripted({ status: 200, body: { id: 1 } }).fetch).api.getMe())).code).toBe(
      'unexpected',
    );
    expect((await failure(api(scripted({ status: 200, body: 'not json' }).fetch).api.getMe())).code).toBe(
      'unexpected',
    );
    expect(
      (await failure(api(scripted({ status: 200, body: { nope: true } }).fetch).api.nameAvailable('abc')))
        .code,
    ).toBe('unexpected');
  });

  it('DELETE /v1/me: 204 or an account already gone are both done', async () => {
    const ok = scripted({ status: 204 });
    await expect(api(ok.fetch).api.deleteMe()).resolves.toBeUndefined();
    expect(ok.requests[0]!.init.method).toBe('DELETE');
    const gone = scripted({ status: 404, body: { error: 'notRegistered' } });
    await expect(api(gone.fetch).api.deleteMe()).resolves.toBeUndefined();
    const down = scripted({ status: 503, body: { error: 'unavailable' } });
    expect((await failure(api(down.fetch).api.deleteMe())).code).toBe('unavailable');
  });

  it('DELETE /v1/me: 401 reauthRequired is not retried with a refreshed token (it keeps the sign-in time)', async () => {
    const stale = scripted({
      status: 401,
      body: { error: 'reauthRequired', message: 'Sign in again' },
      headers: { 'WWW-Authenticate': 'Bearer error="insufficient_user_authentication", max_age=300' },
    });
    const { api: client, getToken } = api(stale.fetch);
    const e = await failure(client.deleteMe());
    expect(e).toMatchObject({ code: 'reauthRequired', status: 401 });
    expect(stale.requests).toHaveLength(1);
    expect(getToken.mock.calls).toEqual([[false]]);

    // A plain 401 (an expired token) still gets its one refresh.
    const expired = scripted({ status: 401, body: { error: 'unauthorized' } }, { status: 204 });
    const second = api(expired.fetch);
    await expect(second.api.deleteMe()).resolves.toBeUndefined();
    expect(expired.requests.map((r) => r.init.headers.Authorization)).toEqual([
      'Bearer tok',
      'Bearer tok-fresh',
    ]);
  });

  it('an abort from the caller (a newer name to check) is passed through, not reported as offline', async () => {
    const controller = new AbortController();
    const hanging: AccountFetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    // Aborted while the request is out…
    const pending = api(hanging).api.nameAvailable('MosheG', controller.signal);
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    // …or before it left: no request at all.
    const { fetch, requests } = scripted({ status: 200, body: { available: true } });
    const early = new AbortController();
    const asked = api(fetch).api.nameAvailable('MosheG', early.signal);
    early.abort();
    await expect(asked).rejects.toThrow('aborted');
    expect(requests).toHaveLength(0);
  });

  it('knows which errors mean "try again later"', () => {
    for (const code of [
      'network',
      'timeout',
      'unavailable',
      'disabled',
      'internal',
      'tooManyRequests',
    ] as const) {
      expect(isOfflineError(new AccountApiError(code))).toBe(true);
    }
    for (const code of ['taken', 'notRegistered', 'unauthorized', 'renameTooSoon'] as const) {
      expect(isOfflineError(new AccountApiError(code))).toBe(false);
    }
    expect(isOfflineError(new Error('x'))).toBe(false);
  });
});

describe('the profile as the app keeps it', () => {
  it('accepts a Me, and refuses anything else', () => {
    expect(isMe(SAMPLE_ME)).toBe(true);
    expect(isMe({ ...SAMPLE_ME, avatarId: 'av00', country: null })).toBe(true);
    expect(isMe({ ...SAMPLE_ME, avatarId: 'av36' })).toBe(false);
    expect(isMe({ ...SAMPLE_ME, country: 'Israel' })).toBe(false);
    expect(isMe({ ...SAMPLE_ME, ratings: [{ key: 'fast' }] })).toBe(false);
    expect(isMe({ ...SAMPLE_ME, id: '' })).toBe(false);
    expect(isMe(null)).toBe(false);
  });

  it('when the name may change again [D20]', () => {
    const now = SAMPLE_ME.createdAt;
    expect(nextRenameAt(SAMPLE_ME, now)).toBeNull();
    expect(nextRenameAt({ ...SAMPLE_ME, nextRenameAt: now + 5 }, now)).toBe(now + 5);
    expect(nextRenameAt({ ...SAMPLE_ME, nextRenameAt: now - 5 }, now)).toBeNull();
    // An older server without nextRenameAt: 30 days after the last rename.
    expect(nextRenameAt({ ...SAMPLE_ME, displayNameChangedAt: now - 1000 }, now)).toBe(
      now - 1000 + RENAME_COOLDOWN_MS,
    );
  });

  it('keeps one profile per sign-in on the phone', async () => {
    const storage = memoryStorage();
    const cache = createMeCache(storage);
    expect(await cache.load('uid-1')).toBeNull();
    await cache.save('uid-1', SAMPLE_ME);
    expect(await cache.load('uid-1')).toEqual(SAMPLE_ME);
    expect(await cache.load('uid-2')).toBeNull();
    storage.data.set(ME_CACHE_KEY, '{broken');
    expect(await cache.load('uid-1')).toBeNull();
    storage.data.set(ME_CACHE_KEY, JSON.stringify({ uid: 'uid-1', me: { ...SAMPLE_ME, ratings: 'x' } }));
    expect(await cache.load('uid-1')).toBeNull();
    await cache.clear();
    expect(storage.data.has(ME_CACHE_KEY)).toBe(false);
  });

  it('three ratings for the card: option B as is, option A in short [D7]', () => {
    expect(ratingsByType(SAMPLE_ME.ratings)).toEqual({
      fast: { rating: 1200, provisional: true },
      normal: { rating: 1200, provisional: true },
      hard: { rating: 1200, provisional: true },
    });
    const optionA = [
      { key: 'normal-2p', rating: 1290, games: 14, provisional: false, peak: 1300 },
      { key: 'normal-3p', rating: 1350, games: 3, provisional: true, peak: 1350 },
      { key: 'normal-4p', rating: 1250, games: 11, provisional: false, peak: 1250 },
      { key: 'fast-2p', rating: 1210, games: 2, provisional: true, peak: 1210 },
      { key: 'fast-3p', rating: 1230, games: 1, provisional: true, peak: 1230 },
    ];
    expect(ratingsByType(optionA)).toEqual({
      normal: { rating: 1290, provisional: false },
      fast: { rating: 1230, provisional: true },
    });
    expect(leagueRating(SAMPLE_ME.ratings)).toBeNull();
    expect(leagueRating(optionA)).toBe(1290);
  });
});
