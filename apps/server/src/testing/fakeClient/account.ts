import {
  ACCOUNT_PATHS,
  type AccountError,
  type AvatarId,
  type CountryCode,
  type CreateUserRequest,
  type Me,
} from '@sudoku-fight/protocol';

/**
 * The fake client's account (stage 9: ranked games are for registered players only, spec §3, §10), over the
 * server's account routes (protocol account.ts) with the same token the game connections carry: read it with
 * GET /v1/me, and register it with POST /v1/users the first time.
 */

/** The account routes' origin for a game server address: ws:// → http://, wss:// → https://. */
export function httpOrigin(url: string): string {
  const u = new URL(url);
  if (u.protocol === 'ws:') u.protocol = 'http:';
  else if (u.protocol === 'wss:') u.protocol = 'https:';
  return u.origin;
}

export class FakeAccountError extends Error {
  constructor(
    readonly status: number,
    readonly body: AccountError | null,
    what: string,
  ) {
    super(`${what}: ${status}${body ? ` ${body.error}${body.message ? ` (${body.message})` : ''}` : ''}`);
    this.name = 'FakeAccountError';
  }
}

async function request(
  origin: string,
  method: 'GET' | 'POST',
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, connection: 'close' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(origin + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const errorOf = (json: unknown): AccountError | null =>
  typeof json === 'object' && json !== null && typeof (json as AccountError).error === 'string'
    ? (json as AccountError)
    : null;

/** GET /v1/me; undefined when the token has no account (404). Throws FakeAccountError otherwise. */
export async function readMe(origin: string, token: string): Promise<Me | undefined> {
  const res = await request(origin, 'GET', ACCOUNT_PATHS.me, token);
  if (res.status === 200) return res.json as Me;
  if (res.status === 404 && errorOf(res.json)?.error === 'notRegistered') return undefined;
  throw new FakeAccountError(res.status, errorOf(res.json), 'GET /v1/me');
}

export interface FakeProfile {
  displayName: string;
  avatarId: AvatarId;
  country: CountryCode;
}

/** The token's account: read, or registered with `profile` when there is none yet. */
export async function signIn(
  origin: string,
  token: string,
  profile: FakeProfile,
): Promise<{ me: Me; registered: boolean }> {
  const me = await readMe(origin, token);
  if (me !== undefined) return { me, registered: false };
  const body: CreateUserRequest = profile;
  const res = await request(origin, 'POST', ACCOUNT_PATHS.users, token, body);
  if (res.status === 201) return { me: res.json as Me, registered: true };
  throw new FakeAccountError(res.status, errorOf(res.json), 'POST /v1/users');
}
