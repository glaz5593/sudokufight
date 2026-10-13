import { fakeClock } from '../testing/clock';
import { likePattern, pageQuerySchema, parseQuery } from './params';
import { passwordMatches, readCookie, SessionKeeper } from './session';

describe('passwordMatches', () => {
  it('only the exact password matches', () => {
    expect(passwordMatches('correct horse', 'correct horse')).toBe(true);
    for (const given of ['', 'correct', 'correct horse ', 'Correct horse', 'correct horse battery']) {
      expect(passwordMatches(given, 'correct horse')).toBe(false);
    }
    expect(passwordMatches('סיסמה-בעברית', 'סיסמה-בעברית')).toBe(true);
  });
});

describe('SessionKeeper', () => {
  const PASSWORD = { method: 'password' } as const;
  const make = (now = fakeClock(1_000_000), password: string | null = 'pw') =>
    new SessionKeeper({ secret: 's'.repeat(32), password, ttlMs: 1000, now: now.now, maxRevoked: 3 });

  it('issues tokens that verify until they run out, each one different', () => {
    const clock = fakeClock(1_000_000);
    const keeper = make(clock);
    const a = keeper.issue(PASSWORD);
    const b = keeper.issue(PASSWORD);
    expect(a.expiresAt).toBe(1_001_000);
    expect(a.token).not.toBe(b.token);
    expect(keeper.verify(a.token)).toEqual({ expiresAt: 1_001_000, admin: PASSWORD });
    clock.advance(999);
    expect(keeper.verify(a.token)).toEqual({ expiresAt: 1_001_000, admin: PASSWORD });
    clock.advance(1);
    expect(keeper.verify(a.token)).toBeNull();
    expect(keeper.verify(undefined)).toBeNull();
  });

  it('a token says who signed in: the password, or a Google address (signed, so it cannot be swapped)', () => {
    const keeper = make(fakeClock(1_000_000), null);
    const google = { method: 'google', email: 'dana@example.com' } as const;
    const { token } = keeper.issue(google);
    expect(token.split('.')).toHaveLength(4);
    expect(keeper.verify(token)).toEqual({ expiresAt: 1_001_000, admin: google });
    const long = { method: 'google', email: `${'a'.repeat(64)}@${'b'.repeat(180)}.example` } as const;
    expect(keeper.verify(keeper.issue(long).token)).toEqual({ expiresAt: 1_001_000, admin: long });

    // Another admin in the same token: the MAC no longer matches.
    const [exp, nonce, , mac] = token.split('.') as [string, string, string, string];
    for (const who of ['password', 'google:someone@example.com', 'nobody', 'google:']) {
      const swapped = `${exp}.${nonce}.${Buffer.from(who).toString('base64url')}.${mac}`;
      expect({ who, session: keeper.verify(swapped) }).toEqual({ who, session: null });
    }
    // The older three-part tokens are not sessions any more.
    expect(keeper.verify(`${exp}.${nonce}.${mac}`)).toBeNull();
  });

  it('a password-less keeper (Google sign-in only) and one with a password sign different keys', () => {
    const clock = fakeClock(1_000_000);
    const { token } = make(clock, null).issue(PASSWORD);
    expect(make(clock, 'pw').verify(token)).toBeNull();
    expect(make(clock, null).verify(token)).not.toBeNull();
  });

  it('revoked tokens are refused; the list forgets expired ones and stays bounded', () => {
    const clock = fakeClock(1_000_000);
    const keeper = make(clock);
    const tokens = Array.from({ length: 5 }, () => keeper.issue(PASSWORD).token);
    keeper.revoke(tokens[0]);
    expect(keeper.verify(tokens[0])).toBeNull();
    expect(keeper.verify(tokens[1])).not.toBeNull();
    for (const tok of tokens.slice(1)) keeper.revoke(tok);
    expect(keeper.revokedCount).toBe(3);
    keeper.revoke('not a token');
    expect(keeper.revokedCount).toBe(3);
    clock.advance(1000);
    const fresh = keeper.issue(PASSWORD).token;
    keeper.revoke(fresh);
    expect(keeper.revokedCount).toBe(1);
  });
});

describe('readCookie', () => {
  it('finds one cookie by exact name', () => {
    expect(readCookie('a=1; sf_admin=x.y.z; b=2', 'sf_admin')).toBe('x.y.z');
    expect(readCookie('xsf_admin=1; sf_admin_old=2', 'sf_admin')).toBeUndefined();
    expect(readCookie('sf_admin="quoted"', 'sf_admin')).toBe('quoted');
    expect(readCookie('sf_admin=%E2%9C%93', 'sf_admin')).toBe('✓');
    expect(readCookie('sf_admin=%E2%9C', 'sf_admin')).toBe('%E2%9C');
    expect(readCookie(undefined, 'sf_admin')).toBeUndefined();
    expect(readCookie('', 'sf_admin')).toBeUndefined();
  });
});

describe('admin query strings', () => {
  it('defaults, trims and checks', () => {
    expect(parseQuery(pageQuerySchema, {})).toEqual({ ok: true, value: { page: 1, pageSize: 50 } });
    expect(parseQuery(pageQuerySchema, undefined)).toEqual({ ok: true, value: { page: 1, pageSize: 50 } });
    expect(parseQuery(pageQuerySchema, { page: '', pageSize: ' ', search: '  ' })).toEqual({
      ok: true,
      value: { page: 1, pageSize: 50 },
    });
    expect(parseQuery(pageQuerySchema, { page: '3', pageSize: '200', search: ' x ' })).toEqual({
      ok: true,
      value: { page: 3, pageSize: 200, search: 'x' },
    });
    expect(parseQuery(pageQuerySchema, { pageSize: '201' })).toEqual({
      ok: false,
      message: 'pageSize: at most 200',
    });
    expect(parseQuery(pageQuerySchema, { page: ['1', '2'] })).toMatchObject({ ok: false });
  });

  it('a search is literal in ILIKE', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(likePattern("' or 1=1")).toBe("%' or 1=1%");
  });
});
