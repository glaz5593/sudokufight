import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import * as Sentry from '@sentry/node';
import express from 'express';

import { loadConfig, type SentryConfig } from '../config';
import { jsonErrorHandler } from '../http/errors';
import { consoleGameLog } from '../rooms/GameRoom';
import { flushReports, NO_MONITOR, reportError, setMonitor } from './report';
import { sentryOptions, startSentry, UNTRACED_PATH } from './sentry';

/**
 * Sentry for the server (work plan stage 14), with the real SDK and a fake transport that keeps what would be
 * sent: nothing starts without a DSN; with one, the HTTP routes', the rooms' and the process' errors arrive
 * without emails, tokens, IP addresses or cookies; and Sentry being down breaks nothing.
 */

const EMAIL = 'dana@example.com';
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJkYW5hIn0.c2lnbmF0dXJl';
const CONFIG: SentryConfig = {
  dsn: 'https://publickey@o1.ingest.sentry.io/123',
  environment: 'test',
  release: 'sudoku-fight-server@0.1.0+test',
  tracesSampleRate: 0,
};

describe('without SENTRY_DSN', () => {
  it('nothing starts: the SDK is not even loaded, and reports go nowhere', () => {
    const load = jest.fn();
    expect(loadConfig({ NODE_ENV: 'test' }).sentry).toBeNull();
    expect(startSentry(loadConfig({ NODE_ENV: 'test' }).sentry, { load })).toBe(NO_MONITOR);
    expect(load).not.toHaveBeenCalled();
    expect(Sentry.isInitialized()).toBe(false);
    setMonitor(NO_MONITOR);
    expect(() => reportError(new Error('x'), { area: 'test' })).not.toThrow();
  });

  it('an SDK that fails to start leaves the no-op monitor, with a warning', () => {
    const warn = jest.fn<void, [string, unknown?]>();
    const monitor = startSentry(CONFIG, {
      load: () => {
        throw new Error('Cannot find module @sentry/node');
      },
      warn,
    });
    expect(monitor).toBe(NO_MONITOR);
    expect(warn.mock.calls[0]![0]).toContain('Sentry could not start');
  });
});

describe('the options', () => {
  const fakeSdk = {
    httpIntegration: jest.fn((options: unknown) => ({ name: 'Http', options })),
  } as unknown as Parameters<typeof sentryOptions>[1];

  it('collect no personal data (sendDefaultPii: false, in @sentry/node 11 words)', () => {
    const options = sentryOptions(CONFIG, fakeSdk);
    expect(options).toMatchObject({
      dsn: CONFIG.dsn,
      environment: 'test',
      release: CONFIG.release,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        databaseQueryData: false,
        stackFrameVariables: false,
      },
    });
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
    expect(typeof options.beforeSendSpan).toBe('function');
  });

  it('traces a low share of requests, never health checks, the admin site or dev routes; 0 is off', () => {
    expect(sentryOptions(CONFIG, fakeSdk).tracesSampleRate).toBeUndefined();
    expect(sentryOptions({ ...CONFIG, tracesSampleRate: 0.05 }, fakeSdk).tracesSampleRate).toBe(0.05);
    for (const path of [
      '/health',
      '/admin',
      '/admin/api/login',
      '/legal/privacy',
      '/dev/metrics',
      '/health?x=1',
    ])
      expect({ path, untraced: UNTRACED_PATH.test(path) }).toEqual({ path, untraced: true });
    for (const path of ['/v1/me', '/v1/events', '/matchmake/joinOrCreate/game', '/healthy'])
      expect({ path, untraced: UNTRACED_PATH.test(path) }).toEqual({ path, untraced: false });
  });

  it("leaves out the SDK's process handlers (ours handle them) and configures its HTTP integration", () => {
    const integrations = sentryOptions(CONFIG, fakeSdk).integrations as (
      defaults: { name: string }[],
    ) => { name: string; options?: { ignoreIncomingRequests: (path: string) => boolean } }[];
    const result = integrations([
      { name: 'OnUncaughtException' },
      { name: 'OnUnhandledRejection' },
      { name: 'Http' },
      { name: 'Console' },
      { name: 'Dedupe' },
    ]);
    expect(result.map((i) => i.name)).toEqual(['Console', 'Dedupe', 'Http']);
    expect(result[2]!.options!.ignoreIncomingRequests('/health')).toBe(true);
    expect(result[2]!.options!.ignoreIncomingRequests('/v1/me')).toBe(false);
  });
});

describe('with SENTRY_DSN (a fake transport)', () => {
  const envelopes: string[] = [];
  let down = false;
  const sent = () => envelopes.join('\n');
  const decoder = new TextDecoder();

  beforeAll(() => {
    setMonitor(
      startSentry(CONFIG, {
        transport: (options) =>
          Sentry.createTransport(options, (request) => {
            if (down) return Promise.reject(new Error('Sentry is down'));
            envelopes.push(typeof request.body === 'string' ? request.body : decoder.decode(request.body));
            return Promise.resolve({ statusCode: 200 });
          }),
      }),
    );
  });

  afterAll(async () => {
    setMonitor(NO_MONITOR);
    await Sentry.close(2000);
  });

  beforeEach(() => {
    envelopes.length = 0;
    down = false;
  });

  it('starts the SDK with our settings, without its process handlers', () => {
    const client = Sentry.getClient();
    expect(client).toBeDefined();
    const names = client!.getOptions().integrations.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['Http', 'Console', 'Dedupe', 'LinkedErrors']));
    expect(names).not.toContain('OnUncaughtException');
    expect(names).not.toContain('OnUnhandledRejection');
    expect(client!.getOptions().environment).toBe('test');
    expect(client!.getOptions().release).toBe(CONFIG.release);
  });

  it('an HTTP route that fails: reported by its pattern, with no email, token, cookie, query or IP', async () => {
    const app = express();
    app.get('/v1/players/:id', () => {
      throw new Error(`no profile for ${EMAIL} (token ${JWT})`);
    });
    app.use(jsonErrorHandler);
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/v1/players/7?token=${JWT}&name=Dana`, {
        headers: { authorization: `Bearer ${JWT}`, cookie: 'sid=s3cret-cookie', connection: 'close' },
      });
      expect(res.status).toBe(500);
      expect(await flushReports(2000)).toBe(true);
    } finally {
      quiet.mockRestore();
      await new Promise<void>((r) => server.close(() => r()));
    }
    const text = sent();
    expect(text).toContain('no profile for [email] (token [jwt])');
    expect(text).toContain('"area":"http"');
    expect(text).toContain('"route":"/v1/players/:id"');
    for (const secret of [EMAIL, JWT, 's3cret-cookie', 'Dana', '127.0.0.1'])
      expect({ secret, sent: text.includes(secret) }).toEqual({ secret, sent: false });
  });

  it("a room's error: the log line goes along, scrubbed; the same error object is reported once", async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error(`engine failed for ${EMAIL}`);
    consoleGameLog.error('[game ABC123] message place from 203.0.113.7 failed', error);
    consoleGameLog.error('[game ABC123] close', error);
    quiet.mockRestore();
    await flushReports(2000);
    const text = sent();
    expect(text.match(/engine failed for \[email\]/g)).toHaveLength(1);
    expect(text).toContain('"area":"rooms"');
    expect(text).toContain('[game ABC123] message place from [ip] failed');
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('203.0.113.7');
  });

  it('Sentry being down breaks nothing: no throw, no unhandled rejection, flush still answers', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      down = true;
      expect(() => reportError(new Error('while Sentry is down'), { area: 'test' })).not.toThrow();
      await expect(flushReports(1000)).resolves.toEqual(expect.any(Boolean));
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect(envelopes).toEqual([]);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
