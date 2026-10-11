import { DrizzleQueryError } from 'drizzle-orm/errors';

import {
  REDACTED,
  reportableError,
  scrubBreadcrumb,
  scrubEvent,
  scrubSpan,
  scrubText,
  scrubValue,
  withoutQuery,
} from './redact';

/**
 * What may reach Sentry (work plan stage 14): no emails, tokens (Authorization headers, Firebase ID tokens,
 * development tokens, reconnection tokens), IP addresses or cookies, wherever the SDK put them.
 */

const EMAIL = 'dana@example.co.il';
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJkYW5hIn0.c2lnbmF0dXJl';
const DEV_TOKEN = `dev:dana-uid:${EMAIL}`;
const RECONNECT = 'ABC123:Xy9_kd8skQ';
const IPV4 = '203.0.113.7';
const IPV6 = '2a01:4ff:f0:1234::1';

describe('scrubText', () => {
  it.each([
    [`no profile for ${EMAIL}`, 'no profile for [email]'],
    [`Authorization: Bearer ${JWT}`, 'Authorization: Bearer [token]'],
    [`token ${JWT} expired`, 'token [jwt] expired'],
    [`refused ${DEV_TOKEN}`, 'refused dev:[token]'],
    [`/rooms/abc?reconnectionToken=${RECONNECT}&x=1`, `/rooms/abc?reconnectionToken=${REDACTED}&x=1`],
    [`client ${IPV4} limited`, 'client [ip] limited'],
    [`client ${IPV6} limited`, 'client [ip] limited'],
    ['connect ECONNREFUSED ::ffff:10.0.0.2:5432', 'connect ECONNREFUSED [ip]:5432'],
    ['Basic dXNlcjpwYXNz', 'Basic [token]'],
  ])('%s', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it('leaves what is not personal: versions, times, ids, codes', () => {
    for (const text of [
      'sudoku-fight-server@0.1.0',
      '[game ABC123] message place from 7c1e2f9a-0b6d-4a51-9f1e-2d3c4b5a6978 failed',
      'at 2026-10-11T10:31:22.123Z, 12:30:45',
      'engine 1.4.2: cell 31 is D5',
      'SQLSTATE 23505 on users_display_name_lower_idx',
    ])
      expect(scrubText(text)).toBe(text);
  });

  it('withoutQuery keeps the path only', () => {
    expect(withoutQuery('https://x.dev/v1/names/available?name=Dana#a')).toBe(
      'https://x.dev/v1/names/available',
    );
    expect(withoutQuery('/health')).toBe('/health');
  });
});

describe('scrubValue', () => {
  it('replaces the values of secret keys at any depth, scrubs every string, drops frame variables', () => {
    const out = scrubValue({
      headers: { authorization: `Bearer ${JWT}`, cookie: 'sid=1', 'x-forwarded-for': IPV4, accept: 'json' },
      nested: [{ reconnectionToken: RECONNECT, note: `from ${EMAIL}` }],
      frames: [{ function: 'f', vars: { password: 'hunter2', email: EMAIL } }],
      data: { url: `https://x.dev/v1/me?token=${JWT}`, 'http.query': 'name=Dana', count: 3, ok: true },
      ADMIN_PASSWORD: 'correct horse',
      databaseUrl: 'postgres://u:p@db/x',
    });
    expect(out).toEqual({
      headers: { authorization: REDACTED, cookie: REDACTED, 'x-forwarded-for': REDACTED, accept: 'json' },
      nested: [{ reconnectionToken: REDACTED, note: 'from [email]' }],
      frames: [{ function: 'f' }],
      data: { url: 'https://x.dev/v1/me', count: 3, ok: true },
      ADMIN_PASSWORD: REDACTED,
      databaseUrl: REDACTED,
    });
  });

  it('copies, never changes its input, and survives cycles', () => {
    const input: Record<string, unknown> = { note: EMAIL };
    input.self = input;
    expect(scrubValue(input)).toEqual({ note: '[email]', self: REDACTED });
    expect(input.note).toBe(EMAIL);
  });
});

describe('scrubEvent', () => {
  it('a whole Sentry event: request cut to method and path, no user, scrubbed messages and breadcrumbs', () => {
    const event = {
      event_id: 'e1',
      release: 'sudoku-fight-server@0.1.0',
      environment: 'production',
      message: `lookup for ${EMAIL} failed`,
      exception: {
        values: [
          { type: 'Error', value: `bad token ${JWT}`, stacktrace: { frames: [{ vars: { t: JWT } }] } },
        ],
      },
      request: {
        method: 'POST',
        url: `https://sudoku-fight-prod.fly.dev/v1/users?token=${JWT}`,
        headers: { authorization: `Bearer ${JWT}`, 'user-agent': 'okhttp' },
        cookies: { sid: 'abc' },
        data: { email: EMAIL, displayName: 'Dana' },
        query_string: 'token=x',
      },
      user: { ip_address: IPV4, email: EMAIL },
      breadcrumbs: [{ category: 'console', message: `${DEV_TOKEN} from ${IPV6}` }],
      extra: { message: `[matchmaking] ${IPV4} could not join` },
      tags: { area: 'http', route: '/v1/users' },
    };
    const out = scrubEvent(event);
    const text = JSON.stringify(out);
    for (const secret of [EMAIL, JWT, 'dana-uid', IPV4, IPV6, 'abc', 'Dana', 'okhttp'])
      expect({ secret, found: text.includes(secret) }).toEqual({ secret, found: false });
    expect(out.request).toEqual({ method: 'POST', url: 'https://sudoku-fight-prod.fly.dev/v1/users' });
    expect(out).not.toHaveProperty('user');
    expect(out.release).toBe('sudoku-fight-server@0.1.0');
    expect(out.tags).toEqual({ area: 'http', route: '/v1/users' });
    expect(out.message).toBe('lookup for [email] failed');
    // The event the SDK holds is not changed.
    expect(event.user.email).toBe(EMAIL);
  });

  it('breadcrumbs and spans too', () => {
    const crumb = scrubBreadcrumb({
      category: 'http',
      data: { url: `https://www.googleapis.com/x?key=abc&email=${EMAIL}`, method: 'GET' },
    });
    expect(crumb).toEqual({ category: 'http', data: { url: 'https://www.googleapis.com/x', method: 'GET' } });

    const span = scrubSpan({
      name: `GET /v1/names/available?name=${EMAIL}`,
      span_id: 's1',
      attributes: {
        'url.full': `https://h/v1/me?t=${JWT}`,
        'url.query': 'name=Dana',
        'client.address': IPV4,
      },
    });
    expect(span).toEqual({
      name: 'GET /v1/names/available?name=[email]',
      span_id: 's1',
      attributes: { 'url.full': 'https://h/v1/me', 'client.address': '[ip]' },
    });
  });
});

describe('reportableError', () => {
  it('a failed query becomes an Error without the values it quoted, its cause kept as an Error', () => {
    const pg = Object.assign(new Error('duplicate key'), { code: '23505', detail: `Key (email)=(${EMAIL})` });
    const query = new DrizzleQueryError('insert into "users" ("email") values ($1)', [EMAIL], pg);
    const error = reportableError(query);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Failed query: insert into "users" ("email") values ($1)');
    expect(error.cause).toBeInstanceOf(Error);
    expect(JSON.stringify({ m: error.message, s: error.stack, c: String(error.cause) })).not.toContain(EMAIL);
  });

  it('an Error as it is; a string as its message (scrubbed); anything else by its type', () => {
    const plain = new Error('boom');
    expect(reportableError(plain)).toBe(plain);
    expect(reportableError(`no user ${EMAIL}`).message).toBe('no user [email]');
    expect(reportableError(42).message).toBe('Non-error thrown (number)');
    expect(reportableError(null).message).toBe('Non-error thrown (null)');
  });
});
