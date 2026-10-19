import {
  ADMIN_ACTION_ERRORS,
  ADMIN_API_PREFIX,
  ADMIN_AUTH_METHODS_PATH,
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_GOOGLE_LOGIN_PATH,
  ADMIN_LOGIN_PATH,
  type AdminActionErrorCode,
  type AdminAuditEntry,
  type AdminAuthMethods,
  type AdminError,
  type AdminGameDetail,
  type AdminGameRow,
  type AdminGoogleLoginErrorCode,
  type AdminGoogleLoginRequest,
  type AdminInstallDetail,
  type AdminInstallRow,
  type AdminLevels,
  type AdminLoginRequest,
  type AdminModerationResult,
  type AdminOverview,
  type AdminPage,
  type AdminReport,
  type AdminReportedPlayer,
  type AdminReportFilter,
  type AdminScreens,
  type AdminSession,
  type AdminUserDetail,
  type AdminUserRow,
  isAdminGoogleLoginErrorCode,
} from '@sudoku-fight/protocol';

/**
 * The admin API client (packages/protocol/src/admin.ts is the contract). Same origin, so the session cookie
 * (HttpOnly) rides along by itself; the site never sees it.
 *
 * Every failure is an ApiError. A 401 from any route but the sign-in ones and session also calls
 * `onUnauthorized`, so the site goes back to the login screen wherever it was.
 *
 * The moderation actions (spec §3.5) are the site's only writes: each is a POST with the JSON body `{}`
 * (the server refuses anything else), and the page asks for a confirmation first.
 */

/**
 * The contract's error names (AdminError, the moderation actions' own, and the Google sign-in's), or no
 * answer / not one of them.
 */
export type ApiErrorCode =
  AdminError['error'] | AdminActionErrorCode | AdminGoogleLoginErrorCode | 'network' | 'server';

/** Every error name of the contract; TypeScript complains here when the list grows. */
const ADMIN_ERROR_CODES: Record<AdminError['error'], true> = {
  unauthorized: true,
  notFound: true,
  badRequest: true,
  tooManyRequests: true,
  disabled: true,
  tooLarge: true,
  internal: true,
};

function isAdminErrorCode(value: string): value is AdminError['error'] {
  return Object.hasOwn(ADMIN_ERROR_CODES, value);
}

function isActionErrorCode(value: string): value is AdminActionErrorCode {
  return (ADMIN_ACTION_ERRORS as readonly string[]).includes(value);
}

function isNamedCode(
  value: string,
): value is AdminError['error'] | AdminActionErrorCode | AdminGoogleLoginErrorCode {
  return isAdminErrorCode(value) || isActionErrorCode(value) || isAdminGoogleLoginErrorCode(value);
}

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    /** The HTTP status; 0 when the server never answered. */
    readonly status: number,
    /** From Retry-After on a 429; null when the server didn't say. */
    readonly retryAfterMs: number | null = null,
    message?: string,
  ) {
    super(message ?? `${code} (${status})`);
    this.name = 'ApiError';
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError('network', 0, null, error instanceof Error ? error.message : String(error));
}

export interface ListQuery {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface GameListQuery {
  mode?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ReportListQuery {
  /** Defaults to 'open' (the server's default too). */
  status?: AdminReportFilter;
  page?: number;
  pageSize?: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface AdminApi {
  /** How this server lets an admin sign in (no session needed). */
  authMethods(): Promise<AdminAuthMethods>;
  login(password: string): Promise<void>;
  /** Signs in with the Firebase ID token of a Google sign-in. */
  loginWithGoogle(idToken: string): Promise<void>;
  logout(): Promise<void>;
  session(): Promise<AdminSession>;
  overview(days: number): Promise<AdminOverview>;
  installs(query: ListQuery): Promise<AdminPage<AdminInstallRow>>;
  install(id: string): Promise<AdminInstallDetail>;
  users(query: ListQuery): Promise<AdminPage<AdminUserRow>>;
  user(id: string): Promise<AdminUserDetail>;
  games(query: GameListQuery): Promise<AdminPage<AdminGameRow>>;
  game(id: string): Promise<AdminGameDetail>;
  screens(days: number): Promise<AdminScreens>;
  /** Staged practice (1.0.2): every level over the period, and every gate. */
  levels(days: number): Promise<AdminLevels>;
  /** Reported players, the most reported first (spec §3.5). */
  reports(query: ReportListQuery): Promise<AdminPage<AdminReportedPlayer>>;
  resolveReport(reportId: string): Promise<AdminReport>;
  dismissReport(reportId: string): Promise<AdminReport>;
  resetName(userId: string): Promise<AdminModerationResult>;
  suspend(userId: string): Promise<AdminModerationResult>;
  unsuspend(userId: string): Promise<AdminModerationResult>;
  /** The admin actions, newest first. */
  audit(query: PageQuery): Promise<AdminPage<AdminAuditEntry>>;
}

/** The body of every moderation action: an empty JSON object, nothing else (the server checks). */
const ACTION_BODY = {};

/** The part of the fetch Response the client reads, so tests can answer with a plain object. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponse>;

export interface ApiOptions {
  /** Defaults to the browser's fetch (looked up on each call). */
  fetch?: FetchLike;
  /** Defaults to ADMIN_API_PREFIX ('/admin/api'). */
  base?: string;
  onUnauthorized?: () => void;
}

/** `?a=1&b=x`, leaving out empty values; '' when nothing is left. */
export function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

function errorCode(status: number, body: unknown): ApiErrorCode {
  const named =
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : null;
  if (named !== null && isNamedCode(named)) return named;
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 400) return 'badRequest';
  if (status === 429) return 'tooManyRequests';
  return 'server';
}

function bodyMessage(body: unknown): string | undefined {
  return typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
    ? body.message
    : undefined;
}

export function createApi(options: ApiOptions = {}): AdminApi {
  const base = options.base ?? ADMIN_API_PREFIX;
  const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    { body, authCheck = true }: { body?: unknown; authCheck?: boolean } = {},
  ): Promise<T> {
    const init: RequestInit = {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    let res: FetchResponse;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch (error) {
      throw toApiError(error);
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => undefined);
    if (res.ok) {
      if (data === undefined) throw new ApiError('server', res.status, null, 'not JSON');
      return data as T;
    }
    const code = errorCode(res.status, data);
    if (code === 'unauthorized' && authCheck) options.onUnauthorized?.();
    throw new ApiError(code, res.status, parseRetryAfter(res.headers.get('Retry-After')), bodyMessage(data));
  }

  const page = (q: { page?: number; pageSize?: number }) => ({
    page: q.page ?? 1,
    pageSize: q.pageSize ?? ADMIN_DEFAULT_PAGE_SIZE,
  });
  const id = (value: string) => encodeURIComponent(value);

  return {
    authMethods: () => request<AdminAuthMethods>('GET', ADMIN_AUTH_METHODS_PATH, { authCheck: false }),
    login: (password) =>
      request<void>('POST', ADMIN_LOGIN_PATH, {
        body: { password } satisfies AdminLoginRequest,
        authCheck: false,
      }),
    loginWithGoogle: (idToken) =>
      request<void>('POST', ADMIN_GOOGLE_LOGIN_PATH, {
        body: { idToken } satisfies AdminGoogleLoginRequest,
        authCheck: false,
      }),
    logout: () => request<void>('POST', '/logout', { authCheck: false }),
    session: () => request<AdminSession>('GET', '/session', { authCheck: false }),
    overview: (days) => request<AdminOverview>('GET', `/overview${queryString({ days })}`),
    installs: (q) =>
      request<AdminPage<AdminInstallRow>>('GET', `/installs${queryString({ search: q.search, ...page(q) })}`),
    install: (installId) => request<AdminInstallDetail>('GET', `/installs/${id(installId)}`),
    users: (q) =>
      request<AdminPage<AdminUserRow>>('GET', `/users${queryString({ search: q.search, ...page(q) })}`),
    user: (userId) => request<AdminUserDetail>('GET', `/users/${id(userId)}`),
    games: (q) =>
      request<AdminPage<AdminGameRow>>(
        'GET',
        `/games${queryString({ mode: q.mode, search: q.search, ...page(q) })}`,
      ),
    game: (gameId) => request<AdminGameDetail>('GET', `/games/${id(gameId)}`),
    screens: (days) => request<AdminScreens>('GET', `/screens${queryString({ days })}`),
    levels: (days) => request<AdminLevels>('GET', `/levels${queryString({ days })}`),
    reports: (q) =>
      request<AdminPage<AdminReportedPlayer>>(
        'GET',
        `/reports${queryString({ status: q.status ?? 'open', ...page(q) })}`,
      ),
    resolveReport: (reportId) =>
      request<AdminReport>('POST', `/reports/${id(reportId)}/resolve`, { body: ACTION_BODY }),
    dismissReport: (reportId) =>
      request<AdminReport>('POST', `/reports/${id(reportId)}/dismiss`, { body: ACTION_BODY }),
    resetName: (userId) =>
      request<AdminModerationResult>('POST', `/users/${id(userId)}/reset-name`, { body: ACTION_BODY }),
    suspend: (userId) =>
      request<AdminModerationResult>('POST', `/users/${id(userId)}/suspend`, { body: ACTION_BODY }),
    unsuspend: (userId) =>
      request<AdminModerationResult>('POST', `/users/${id(userId)}/unsuspend`, { body: ACTION_BODY }),
    audit: (q) => request<AdminPage<AdminAuditEntry>>('GET', `/audit${queryString(page(q))}`),
  };
}
