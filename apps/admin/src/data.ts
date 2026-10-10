import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { type AdminApi, type ApiError, toApiError } from './api';

/** The API client and the clock, shared by every page. */

export const ApiContext = createContext<AdminApi | null>(null);

export function useApi(): AdminApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi outside ApiContext');
  return api;
}

/** The current time for "3 days ago"; App moves it on every minute. */
export const NowContext = createContext<number>(0);

export function useNow(): number {
  return useContext(NowContext);
}

export interface AsyncResult<T> {
  /** The latest data; while a new load runs it is the previous one (shown faded, so the page doesn't jump). */
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

interface Settled<T> {
  load: () => Promise<T>;
  nonce: number;
  data: T | undefined;
  error: ApiError | undefined;
}

/**
 * Runs `load` (memoize it with useCallback on what it reads) and again whenever it changes or reload() is
 * called. A result that arrives after a newer load started, or after unmount, is dropped.
 */
export function useAsync<T>(load: () => Promise<T>): AsyncResult<T> {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (data) => {
        if (live) setSettled({ load, nonce, data, error: undefined });
      },
      (error: unknown) => {
        if (live) setSettled((prev) => ({ load, nonce, data: prev?.data, error: toApiError(error) }));
      },
    );
    return () => {
      live = false;
    };
  }, [load, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = settled !== null && settled.load === load && settled.nonce === nonce;
  return {
    data: settled?.data,
    error: current ? settled.error : undefined,
    loading: !current,
    reload,
  };
}
