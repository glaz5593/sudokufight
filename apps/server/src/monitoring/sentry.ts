import type { NodeOptions } from '@sentry/node';

import type { SentryConfig } from '../config';
import { scrubBreadcrumb, scrubEvent, scrubSpan } from './redact';
import { type ErrorContext, type Monitor, NO_MONITOR } from './report';

/**
 * Sentry for the server (work plan stage 14, spec §17.1 "Sentry לשרת"), @sentry/node 11.
 *
 * - Only with SENTRY_DSN (config.sentry): without it the SDK is never loaded, nothing starts, nothing leaves.
 * - No personal data: @sentry/node 11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect
 *   everything (headers, cookies, bodies, query strings, user info, local variables). All of it is off here,
 *   and `beforeSend`, `beforeBreadcrumb` and `beforeSendSpan` scrub what is left (./redact.ts): emails, tokens,
 *   IP addresses, cookies.
 * - Errors come from reportError() (./report.ts): the HTTP routes, the rooms, the process' handlers. The SDK's
 *   own process handlers are left out: ./process.ts has one policy with or without Sentry.
 * - Traces: SENTRY_TRACES_SAMPLE_RATE of the HTTP requests (default 5%), never the health checks (every 15 s),
 *   the admin site, the legal pages or the development routes. WebSocket messages are not traced.
 * - Sentry being down, slow or refusing never reaches the server: the SDK sends in the background, and every
 *   call here is wrapped.
 *
 * The SDK is required lazily, and stays outside the bundle (apps/server/package.json "build": esbuild
 * --external:@sentry/node), as Sentry asks for its Node SDK.
 */

export type SentryModule = typeof import('@sentry/node');

/** Handled by ./process.ts instead, the same with or without a DSN. */
const OWN_HANDLERS = new Set(['OnUncaughtException', 'OnUnhandledRejection']);

/** Requests never traced: the health checks, the admin site, the legal pages, the development routes. */
export const UNTRACED_PATH = /^\/(?:health|admin|legal|dev)(?:[/?#]|$)/;

/** The SDK's options for these settings (`transport`: tests pass a fake one). */
export function sentryOptions(
  config: SentryConfig,
  sentry: Pick<SentryModule, 'httpIntegration'>,
  transport?: NodeOptions['transport'],
): NodeOptions {
  return {
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    // 0 is no tracing at all (undefined), not "sample none of them".
    tracesSampleRate: config.tracesSampleRate > 0 ? config.tracesSampleRate : undefined,
    // `sendDefaultPii: false` in @sentry/node 11's words: collect none of it.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    maxBreadcrumbs: 50,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSendSpan: (span) => scrubSpan(span),
    integrations: (defaults) => [
      ...defaults.filter((i) => !OWN_HANDLERS.has(i.name) && i.name !== 'Http'),
      sentry.httpIntegration({ ignoreIncomingRequests: (urlPath) => UNTRACED_PATH.test(urlPath) }),
    ],
    ...(transport === undefined ? null : { transport }),
  };
}

export interface StartSentryOptions {
  /** The SDK (default: required on first use). */
  load?: () => SentryModule;
  /** Tests: a transport that records what would be sent. */
  transport?: NodeOptions['transport'];
  /** Where a failure to start is told (default console.warn). */
  warn?: (message: string, detail?: unknown) => void;
}

/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose: no DSN, no SDK */
const loadSentry = (): SentryModule => require('@sentry/node') as SentryModule;
/* eslint-enable @typescript-eslint/no-require-imports */

/** Sentry's monitor for these settings; the no-op one without them, or when the SDK fails to start. */
export function startSentry(
  config: SentryConfig | null,
  { load = loadSentry, transport, warn = console.warn }: StartSentryOptions = {},
): Monitor {
  if (config === null) return NO_MONITOR;
  let sentry: SentryModule;
  try {
    sentry = load();
    const client = sentry.init(sentryOptions(config, sentry, transport));
    if (client === undefined) throw new Error('Sentry.init returned no client');
  } catch (error) {
    warn('[monitoring] Sentry could not start; errors go to the log only', error);
    return NO_MONITOR;
  }
  return {
    enabled: true,
    capture(error: Error, { area, message, tags }: ErrorContext) {
      try {
        sentry.captureException(error, {
          tags: { area, ...tags },
          ...(message === undefined ? null : { extra: { message } }),
        });
      } catch {
        // Never the reason a request or a room fails.
      }
    },
    async flush(timeoutMs: number) {
      try {
        return await sentry.flush(timeoutMs);
      } catch {
        return false;
      }
    },
  };
}
