import type { CreateUserRequest, Me } from '@sudoku-fight/protocol';

/**
 * A small client for the account routes in tests: `call` sends JSON with an optional bearer token and reads
 * the answer back (status, JSON body or null, headers).
 */

export interface Answer<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export interface CallOptions {
  token?: string;
  body?: unknown;
  /** Sent as is, instead of JSON.stringify(body). */
  raw?: string;
  headers?: Record<string, string>;
}

export async function call<T = unknown>(
  baseUrl: string,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Answer<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  let body: string | undefined;
  if (options.raw !== undefined || options.body !== undefined) {
    headers['content-type'] ??= 'application/json';
    body = options.raw ?? JSON.stringify(options.body);
  }
  const res = await fetch(baseUrl + path, { method, headers, body });
  const text = await res.text();
  const json: unknown =
    text !== '' && (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : null;
  return { status: res.status, body: json as T, headers: res.headers };
}

export const fighter = (overrides: Partial<CreateUserRequest> = {}): CreateUserRequest => ({
  displayName: 'Dana',
  avatarId: 'lava-lamp',
  country: 'IL',
  ...overrides,
});

export type MeAnswer = Answer<Me>;
