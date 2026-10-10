import {
  type CryptoKey,
  errors,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  jwtVerify,
  SignJWT,
} from 'jose';

import { fakeClock } from '../testing/clock';
import {
  freshnessMs,
  GOOGLE_SECURETOKEN_JWKS_URL,
  googleKeys,
  type GoogleKeysOptions,
  KeysUnavailableError,
} from './googleKeys';

const NOW = Date.UTC(2026, 9, 9, 12);
const MIN = 60_000;
const HOUR = 60 * MIN;

interface KeyPair {
  kid: string;
  privateKey: CryptoKey;
  jwk: JSONWebKeySet['keys'][number];
}

async function keyPair(kid: string): Promise<KeyPair> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
}

const sign = (k: KeyPair) =>
  new SignJWT({ sub: 'u' }).setProtectedHeader({ alg: 'RS256', kid: k.kid }).sign(k.privateKey);

/** What the fake Google answers next: keys with a Cache-Control, an HTTP error, or a network failure. */
type Answer =
  { keys: KeyPair[]; cacheControl?: string; age?: string } | { status: number } | { body: string } | 'down';

let a: KeyPair;
let b: KeyPair;
beforeAll(async () => {
  [a, b] = await Promise.all([keyPair('a'), keyPair('b')]);
});

function setup(first: Answer, options: Partial<GoogleKeysOptions> = {}) {
  const clock = fakeClock(NOW);
  let answer = first;
  const urls: string[] = [];
  const warnings: string[] = [];
  const fetch = jest.fn((url: string) => {
    urls.push(url);
    const now = answer;
    if (now === 'down') return Promise.reject(new TypeError('fetch failed'));
    if ('status' in now) return Promise.resolve(new Response('{}', { status: now.status }));
    if ('body' in now) return Promise.resolve(new Response(now.body, { status: 200 }));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (now.cacheControl !== undefined) headers['cache-control'] = now.cacheControl;
    if (now.age !== undefined) headers.age = now.age;
    const body = JSON.stringify({ keys: now.keys.map((k) => k.jwk) });
    return Promise.resolve(new Response(body, { status: 200, headers }));
  });
  const keys = googleKeys({ now: clock.now, fetch, warn: (m) => warnings.push(m), ...options });
  const check = async (k: KeyPair) => {
    try {
      await jwtVerify(await sign(k), keys.getKey, { algorithms: ['RS256'] });
      return 'ok';
    } catch (err) {
      if (err instanceof KeysUnavailableError) return 'unavailable';
      if (err instanceof errors.JWKSNoMatchingKey) return 'no key';
      throw err;
    }
  };
  return {
    clock,
    keys,
    check,
    urls,
    warnings,
    answer: (next: Answer) => {
      answer = next;
    },
  };
}

describe("Google's token keys", () => {
  it('fetches them from Google once, and keeps them for max-age', async () => {
    const g = setup({ keys: [a], cacheControl: 'public, max-age=19802, must-revalidate, no-transform' });
    expect(await g.check(a)).toBe('ok');
    expect(await g.check(a)).toBe('ok');
    expect(g.keys.fetches).toBe(1);
    expect(g.urls).toEqual([GOOGLE_SECURETOKEN_JWKS_URL]);

    g.clock.advance(19_801_000);
    expect(await g.check(a)).toBe('ok');
    expect(g.keys.fetches).toBe(1);
    g.clock.advance(2000);
    expect(await g.check(a)).toBe('ok');
    expect(g.keys.fetches).toBe(2);
  });

  it('counts the Age header against max-age', async () => {
    const g = setup({ keys: [a], cacheControl: 'max-age=3600', age: '3000' });
    expect(await g.check(a)).toBe('ok');
    g.clock.advance(601_000);
    expect(await g.check(a)).toBe('ok');
    expect(g.keys.fetches).toBe(2);
  });

  it('keeps them an hour without max-age, and at least a minute with max-age=0', async () => {
    const g = setup({ keys: [a] });
    await g.check(a);
    g.clock.advance(HOUR - 1);
    await g.check(a);
    expect(g.keys.fetches).toBe(1);

    const z = setup({ keys: [a], cacheControl: 'no-cache, max-age=0' });
    await z.check(a);
    z.clock.advance(MIN - 1);
    await z.check(a);
    expect(z.keys.fetches).toBe(1);
  });

  it('shares one fetch between requests that arrive together', async () => {
    const g = setup({ keys: [a], cacheControl: 'max-age=600' });
    expect(await Promise.all([g.check(a), g.check(a), g.check(a)])).toEqual(['ok', 'ok', 'ok']);
    expect(g.keys.fetches).toBe(1);
  });

  it('looks again for a key id it does not have (a rotation), at most once a minute', async () => {
    const g = setup({ keys: [a], cacheControl: 'max-age=20000' });
    expect(await g.check(a)).toBe('ok');
    g.answer({ keys: [a, b], cacheControl: 'max-age=20000' });

    // Within a minute of the last fetch: no new fetch, so made-up key ids can't make us hammer Google.
    g.clock.advance(MIN - 1000);
    expect(await g.check(b)).toBe('no key');
    expect(g.keys.fetches).toBe(1);

    g.clock.advance(2000);
    expect(await g.check(b)).toBe('ok');
    expect(g.keys.fetches).toBe(2);
    // A key id that is nowhere: one look, then the answer stays "no key" without fetching again.
    const c = await keyPair('c');
    g.clock.advance(2 * MIN);
    expect(await g.check(c)).toBe('no key');
    expect(await g.check(c)).toBe('no key');
    expect(g.keys.fetches).toBe(3);
  });

  it('without keys: unavailable, and the next try waits 10 seconds', async () => {
    const g = setup('down');
    expect(await g.check(a)).toBe('unavailable');
    expect(await g.check(a)).toBe('unavailable');
    expect(g.keys.fetches).toBe(1);
    g.answer({ keys: [a], cacheControl: 'max-age=600' });
    g.clock.advance(9_999);
    expect(await g.check(a)).toBe('unavailable');
    g.clock.advance(1);
    expect(await g.check(a)).toBe('ok');
    expect(g.keys.fetches).toBe(2);
  });

  it.each<[string, Answer]>([
    ['an HTTP error', { status: 503 }],
    ['not JSON', { body: '<html>' }],
    ['not a key set', { body: '{"keys":[]}' }],
    ['no keys field', { body: '{"a":1}' }],
  ])('treats %s as unavailable', async (_why, answer) => {
    expect(await setup(answer).check(a)).toBe('unavailable');
  });

  it("keeps using expired keys for a day when Google can't be reached, with a warning", async () => {
    const g = setup({ keys: [a], cacheControl: 'max-age=600' });
    expect(await g.check(a)).toBe('ok');
    g.answer('down');
    g.clock.advance(601_000);
    expect(await g.check(a)).toBe('ok');
    expect(g.warnings[0]).toMatch(/using the cached keys/);
    g.clock.advance(24 * HOUR);
    expect(await g.check(a)).toBe('unavailable');
  });
});

describe('freshnessMs', () => {
  it.each<[string | null, string | null, number | null]>([
    ['public, max-age=19802, must-revalidate, no-transform', null, 19_802_000],
    ['max-age=600', '100', 500_000],
    ['max-age=600', '900', 0],
    ['MAX-AGE="60"', null, 60_000],
    ['s-maxage=600', null, null],
    ['no-store', null, null],
    [null, null, null],
    ['max-age=600', 'soon', 600_000],
  ])('%j with Age %j → %j', (cacheControl, age, ms) => {
    expect(freshnessMs(cacheControl, age)).toBe(ms);
  });
});
