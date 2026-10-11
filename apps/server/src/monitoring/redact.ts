import { isIPv4, isIPv6 } from 'node:net';

/**
 * What may leave the server about an error: no personal data, no secrets (work plan stage 14, CLAUDE.md).
 * Two layers:
 * - errorForLog(): an error as it may go to the log or to Sentry. A failed query loses the values it quotes.
 * - scrubText() / scrubValue() / scrubEvent() / scrubBreadcrumb() / scrubSpan(): Sentry's `beforeSend`,
 *   `beforeBreadcrumb` and `beforeSendSpan`. Whatever the SDK gathered, emails, tokens (Authorization headers,
 *   Firebase ID tokens, development tokens, reconnection tokens), IP addresses and cookies are taken out, wherever
 *   they are: in a message, an exception's value, a breadcrumb, a tag, a span's attribute.
 * Pure (Node's net.isIP only).
 */

// ---- errors -------------------------------------------------------------------------------------------------

/** Postgres error fields that quote the row's values (e.g. `Key (email)=(…) already exists`). */
const VALUE_FIELDS = ['detail', 'where', 'parameters'];

/**
 * An error as it may go to the log: no personal data. A failed query (drizzle's DrizzleQueryError) carries its
 * parameters, which are the request's values (an email, a Firebase uid, a display name), in its message and
 * in `params`; the driver's error under it quotes values in `detail`. The query text, the SQLSTATE and the
 * constraint stay: they are what a fix needs.
 */
export function errorForLog(err: unknown, depth = 0): unknown {
  if (typeof err !== 'object' || err === null || depth > 4) return err;
  const e = err as Record<string, unknown>;
  const isQuery = typeof e.query === 'string' && Array.isArray(e.params);
  const hasValues = VALUE_FIELDS.some((f) => e[f] !== undefined);
  if (!isQuery && !hasValues && e.cause === undefined) return err;
  const safe: Record<string, unknown> = {
    name: e.name ?? (err instanceof Error ? err.name : undefined),
    message: isQuery ? `Failed query: ${String(e.query)}` : e.message,
  };
  if (isQuery) safe.params = `[${(e.params as unknown[]).length} redacted]`;
  for (const k of ['code', 'severity', 'constraint', 'constraint_name', 'table', 'table_name', 'column']) {
    if (e[k] !== undefined) safe[k] = e[k];
  }
  if (typeof e.stack === 'string') {
    // The stack starts with the message (values included): only its "at …" lines are kept.
    const frames = e.stack.split('\n').filter((line) => /^\s+at /.test(line));
    safe.stack = [`${String(safe.name)}: ${String(safe.message)}`, ...frames].join('\n');
  }
  if (e.cause !== undefined) safe.cause = errorForLog(e.cause, depth + 1);
  return safe;
}

/**
 * Something thrown, as an Error Sentry can group: errorForLog()'s safe copy turned back into an Error (its
 * name, message, stack and cause), a string as the message, anything else by its type only.
 */
export function reportableError(thrown: unknown, depth = 0): Error {
  const safe = errorForLog(thrown);
  if (safe instanceof Error) return safe;
  if (typeof safe === 'string') return new Error(scrubText(safe));
  if (typeof safe === 'object' && safe !== null && depth < 4) {
    const s = safe as { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown };
    const error = new Error(typeof s.message === 'string' ? s.message : 'Error without a message');
    if (typeof s.name === 'string') error.name = s.name;
    if (typeof s.stack === 'string') error.stack = s.stack;
    if (s.cause !== undefined) error.cause = reportableError(s.cause, depth + 1);
    return error;
  }
  return new Error(`Non-error thrown (${safe === null ? 'null' : typeof safe})`);
}

// ---- text ---------------------------------------------------------------------------------------------------

/** An email address, with a real top-level domain ("server@0.1.0" is a version, not an address). */
const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g;
/** An Authorization header's value: `Bearer <ID token>`, `Basic <user:password>`. */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[\w.~+/=:-]+/gi;
/** A development token, `dev:<uid>[:<email>]` (builds without Firebase). */
const DEV_TOKEN = /\bdev:[^\s"'`,;)}\]]+/g;
/** A JWT (a Firebase ID token): three base64url parts, the first a JSON header. */
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g;
/** A secret in a query string or a `key=value` list (a Colyseus reconnection token travels as one). */
const SECRET_PARAM =
  /(\b(?:reconnectionToken|token|access_token|id_token|refresh_token|api_?key|key|password|secret|sig|signature|code|auth|dsn)=)[^&#\s"']*/gi;
/** Runs of hex digits, colons and dots with two colons or more: IPv6 candidates (checked with isIPv6). */
const IPV6_CANDIDATE = /[0-9a-f]*:[0-9a-f.:]*:[0-9a-f.]*(?:%\w+)?/gi;
const IPV4_CANDIDATE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

export const REDACTED = '[redacted]';

/** An IPv6 candidate as `[ip]` when it is one, also with a port after it ("::ffff:10.0.0.2:5432"). */
function scrubIPv6(candidate: string): string {
  if (isIPv6(candidate.replace(/%\w+$/, ''))) return '[ip]';
  const withPort = /^(.*):(\d{1,5})$/.exec(candidate);
  return withPort && isIPv6(withPort[1]!) ? `[ip]:${withPort[2]}` : candidate;
}

/** A string with its emails, tokens and IP addresses replaced by placeholders. */
export function scrubText(text: string): string {
  return text
    .replace(AUTH_SCHEME, '$1 [token]')
    .replace(JWT, '[jwt]')
    .replace(DEV_TOKEN, 'dev:[token]')
    .replace(EMAIL, '[email]')
    .replace(SECRET_PARAM, `$1${REDACTED}`)
    .replace(IPV6_CANDIDATE, scrubIPv6)
    .replace(IPV4_CANDIDATE, (m) => (isIPv4(m) ? '[ip]' : m));
}

/** A URL without its query string and fragment (they may carry tokens, names, emails). */
export function withoutQuery(url: string): string {
  return url.replace(/[?#].*$/s, '');
}

// ---- structures ---------------------------------------------------------------------------------------------

/** Keys whose value is a secret or points at a person, at any depth: the value is replaced, whatever it is. */
const SECRET_KEY =
  /pass(?:word|wd)?$|secret|token|authorization|^auth$|cookie|session|e-?mail|^dsn$|api[_-]?key|private[_-]?key|credential|forwarded|real-ip|client-ip|connecting-ip|ip[_-]?address|^ip$|database[_-]?url/i;
/** Keys holding a URL: kept, without the query. */
const URL_KEY = /^(?:url|url\.full|http\.url|http\.target|target|request_url|server\.address\.url)$/i;
/** Keys holding a query string or a fragment on their own: dropped. */
const QUERY_KEY = /^(?:query_string|url\.query|http\.query|http\.fragment|url\.fragment)$/i;
/** Local variables of a stack frame (off in the SDK's settings; dropped here too). */
const DROPPED_KEYS = new Set(['vars']);
/** The SDK's own bookkeeping, never sent as is: left alone. */
const UNTOUCHED_KEYS = new Set([
  'sdkProcessingMetadata',
  'sdk',
  'release',
  'environment',
  'dist',
  'debug_meta',
]);

const MAX_DEPTH = 12;

const isPlainObject = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
};

/**
 * A copy of `value` with every string scrubbed and every secret key's value replaced. A cycle (or a structure
 * too deep) ends in a placeholder; an object met twice side by side is copied twice.
 */
export function scrubValue(value: unknown, depth = 0, ancestors = new Set<object>()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth > MAX_DEPTH || ancestors.has(value)) return REDACTED;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1, ancestors));
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (DROPPED_KEYS.has(key) || QUERY_KEY.test(key)) continue;
      if (UNTOUCHED_KEYS.has(key)) out[key] = v;
      else if (SECRET_KEY.test(key)) out[key] = v === undefined || v === null ? v : REDACTED;
      else if (URL_KEY.test(key) && typeof v === 'string') out[key] = scrubText(withoutQuery(v));
      else out[key] = scrubValue(v, depth + 1, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

interface EventLike {
  request?: { method?: unknown; url?: unknown } & Record<string, unknown>;
  user?: unknown;
}

/**
 * Sentry's `beforeSend` (and the same for transactions): the event scrubbed through and through; its request
 * cut down to the method and the URL without its query (no headers, cookies, body or address); no user.
 */
export function scrubEvent<E extends object>(event: E): E {
  const scrubbed = scrubValue(event) as E & EventLike;
  const request = (event as EventLike).request;
  if (request !== undefined) {
    scrubbed.request = {
      ...(typeof request.method === 'string' ? { method: request.method } : null),
      ...(typeof request.url === 'string' ? { url: scrubText(withoutQuery(request.url)) } : null),
    };
  }
  delete scrubbed.user;
  return scrubbed;
}

/** Sentry's `beforeBreadcrumb`: console lines, HTTP calls and the like, scrubbed. */
export function scrubBreadcrumb<B extends object>(breadcrumb: B): B {
  return scrubValue(breadcrumb) as B;
}

/** Sentry's `beforeSendSpan`: the span's name and attributes scrubbed (its ids and times are kept). */
export function scrubSpan<S extends { name: string; attributes?: unknown }>(span: S): S {
  return {
    ...span,
    name: scrubText(span.name),
    ...(span.attributes === undefined ? null : { attributes: scrubValue(span.attributes) }),
  };
}
