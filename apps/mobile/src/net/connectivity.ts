import { useEffect } from 'react';
import { create } from 'zustand';

import { httpBaseUrl } from '../config/server';

/**
 * Is there a connection before a game (spec §16.1)? The app has no network-state module, so it asks the game
 * server itself: a cheap `GET /health` with a short time limit. An answer means ranked games can be played;
 * none (no network, or a server that does not answer, which the player can't tell apart either) means the
 * Modes screen dims the ranked cards ("דורש חיבור"), shows "אין חיבור לאינטרנט" with "עבור לאימון" and
 * "בדוק שוב", and checks again in the background until the connection is back.
 */

export const CONNECTIVITY = {
  /** A check gives up after this long. */
  timeoutMs: 5000,
  /** While offline, the background check runs this often. */
  recheckMs: 10_000,
} as const;

export type FetchLike = (
  url: string,
  init: { method: 'GET'; signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean }>;

export interface HealthCheckOptions {
  /** The server's health route. */
  url?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** True when the game server answers `GET /health` within the limit. Never throws. */
export async function checkHealth({
  url = `${httpBaseUrl()}/health`,
  fetch: fetchFn = (target, init) => fetch(target, init),
  timeoutMs = CONNECTIVITY.timeoutMs,
}: HealthCheckOptions = {}): Promise<boolean> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(false);
    }, timeoutMs);
  });
  try {
    const answer = fetchFn(url, {
      method: 'GET',
      signal: controller?.signal,
      headers: { 'cache-control': 'no-cache' },
    }).then(
      (res) => res.ok,
      () => false,
    );
    return await Promise.race([answer, late]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export type ConnectivityStatus = 'unknown' | 'online' | 'offline';

export interface ConnectivityState {
  status: ConnectivityStatus;
  /** A check is running ("בודק…"). */
  checking: boolean;
  /** Checks in a row that found no connection ("עדיין אין חיבור · ניסיון 2"); 0 once online. */
  failures: number;
  /** Checks now (a running check is shared). Resolves with whether the server answered. */
  check(): Promise<boolean>;
}

/**
 * The check the store runs. Under Jest (NODE_ENV 'test') none runs unless a test sets one: screens that
 * show the connection stay 'unknown' (as online), and no test reaches for a real server by accident.
 */
const defaultCheck = (): (() => Promise<boolean>) | null =>
  process.env.NODE_ENV === 'test' ? null : () => checkHealth();

let healthCheck: (() => Promise<boolean>) | null = defaultCheck();
let running: Promise<boolean> | null = null;

/** Tests: the check to run instead of GET /health (null: the default again), and a fresh state. */
export function setHealthCheck(next: (() => Promise<boolean>) | null): void {
  healthCheck = next ?? defaultCheck();
  running = null;
  useConnectivity.setState({ status: 'unknown', checking: false, failures: 0 });
}

export const useConnectivity = create<ConnectivityState>()((set) => ({
  status: 'unknown',
  checking: false,
  failures: 0,
  check() {
    if (running) return running;
    const run = healthCheck;
    if (!run) return Promise.resolve(true);
    set({ checking: true });
    const attempt = run()
      .catch(() => false)
      .then((ok) => {
        if (running === attempt) running = null;
        set((s) => ({
          status: ok ? 'online' : 'offline',
          checking: false,
          failures: ok ? 0 : s.failures + 1,
        }));
        return ok;
      });
    running = attempt;
    return attempt;
  },
}));

/**
 * Checks on mount and, while offline, again every `recheckMs` in the background (spec §16.1). Returns the
 * state for the screen.
 */
export function useConnectivityWatch(enabled = true): ConnectivityState {
  const state = useConnectivity();
  const offline = state.status === 'offline';

  useEffect(() => {
    if (!enabled) return;
    void useConnectivity.getState().check();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !offline) return;
    const id = setInterval(() => void useConnectivity.getState().check(), CONNECTIVITY.recheckMs);
    return () => clearInterval(id);
  }, [enabled, offline]);

  return state;
}
