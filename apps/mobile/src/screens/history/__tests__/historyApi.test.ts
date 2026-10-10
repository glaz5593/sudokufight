import type { HistoryPage } from '@sudoku-fight/protocol';

import type { FetchInit, FetchResponse } from '../../../api/accountApi';
import { historyGameOf, rankedDuel } from '../../replay/testing/sources';
import { createHistoryApi, HistoryApiError } from '../historyApi';

/** The history routes as the app calls them (protocol history.ts): the token, the retry on 401, the errors. */

interface Call {
  url: string;
  init: FetchInit;
}

function answer(status: number, body: unknown): FetchResponse {
  return {
    status,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function api(
  responses: (FetchResponse | Error)[],
  token: (force: boolean) => string | null = (f) => (f ? 'fresh' : 'old'),
) {
  const calls: Call[] = [];
  const tokens: boolean[] = [];
  const client = createHistoryApi({
    baseUrl: 'http://server:2567',
    getToken: async (force) => {
      tokens.push(force);
      return token(force);
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('no more answers');
      if (next instanceof Error) throw next;
      return next;
    },
    timeoutMs: 1000,
  });
  return { client, calls, tokens };
}

const table = rankedDuel();
const page: HistoryPage = { games: [historyGameOf(table)], nextCursor: '1760000000000_g9' };

describe('createHistoryApi', () => {
  it('GET /v1/me/games with the token, and the cursor as it came', async () => {
    const { client, calls } = api([answer(200, page), answer(200, { games: [], nextCursor: null })]);
    expect(await client.myGames(null)).toEqual(page);
    expect(calls[0]).toMatchObject({
      url: 'http://server:2567/v1/me/games',
      init: { method: 'GET', headers: { Authorization: 'Bearer old', Accept: 'application/json' } },
    });
    await client.myGames('1760000000000_g9');
    expect(calls[1]!.url).toBe('http://server:2567/v1/me/games?cursor=1760000000000_g9');
  });

  it('GET /v1/games/:id/replay: the game and its log', async () => {
    const replay = { game: historyGameOf(table), events: table.log };
    const { client, calls } = api([answer(200, replay)]);
    expect(await client.replay('ranked-1')).toEqual(JSON.parse(JSON.stringify(replay)));
    expect(calls[0]!.url).toBe('http://server:2567/v1/games/ranked-1/replay');
  });

  it('a 401 refreshes the token and tries once more', async () => {
    const { client, tokens, calls } = api([answer(401, { error: 'unauthorized' }), answer(200, page)]);
    expect(await client.myGames(null)).toEqual(page);
    expect(tokens).toEqual([false, true]);
    expect(calls[1]!.init.headers.Authorization).toBe('Bearer fresh');
  });

  it('turns failures into codes: the server’s, or the app’s own', async () => {
    const codeOf = async (r: FetchResponse | Error, call: 'games' | 'replay' = 'replay') => {
      const { client } = api([r, r]);
      try {
        await (call === 'games' ? client.myGames(null) : client.replay('g1'));
        return 'ok';
      } catch (e) {
        expect(e).toBeInstanceOf(HistoryApiError);
        return (e as HistoryApiError).code;
      }
    };
    expect(await codeOf(answer(404, { error: 'notFound' }))).toBe('notFound');
    expect(await codeOf(answer(409, { error: 'notFinished' }))).toBe('notFinished');
    expect(await codeOf(answer(404, { error: 'notRegistered' }))).toBe('notRegistered');
    expect(await codeOf(answer(503, '<html>proxy</html>'))).toBe('unavailable');
    expect(await codeOf(answer(500, null))).toBe('internal');
    expect(await codeOf(answer(429, { error: 'tooManyRequests' }))).toBe('tooManyRequests');
    expect(await codeOf(new TypeError('Network request failed'))).toBe('network');
    // An answer the app can't read.
    expect(await codeOf(answer(200, { games: 'x' }), 'games')).toBe('unexpected');
    expect(await codeOf(answer(200, { game: {}, events: [] }))).toBe('unexpected');
  });

  it('signed out: no request at all', async () => {
    const { client, calls } = api([], () => null);
    await expect(client.myGames(null)).rejects.toMatchObject({ code: 'signedOut' });
    expect(calls).toEqual([]);
  });

  it('gives up after the timeout', async () => {
    let fire: () => void = () => undefined;
    const client = createHistoryApi({
      baseUrl: 'http://server',
      getToken: async () => 't',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      timeoutMs: 1000,
      setTimeout: (cb) => {
        fire = cb;
        return 1;
      },
      clearTimeout: () => undefined,
    });
    const pending = client.myGames(null);
    await Promise.resolve();
    await Promise.resolve();
    fire();
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
  });
});
