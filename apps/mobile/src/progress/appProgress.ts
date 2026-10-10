import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import type { AccountFetch } from '../api/accountApi';
import { createProgressApi, isProgressOffline, type ProgressApi } from '../api/progressApi';
import { authDeps, useAuth } from '../auth/authStore';
import { accountConfig } from '../config/account';
import { httpBaseUrl } from '../config/server';
import { createPracticeQueue } from './practiceQueue';
import { type FinishedPractice, practiceResultOf } from './practiceResult';
import { PracticeSync } from './practiceSync';
import {
  adoptCard,
  adoptProgress,
  forgetProgress,
  setPending,
  setProgressStatus,
  useProgress,
} from './progressStore';

/**
 * Progress wired to the phone (work plan stage 12): the progress API with the sign-in's ID token, the practice
 * XP queue in the key-value store [D41], and its triggers. startProgress() (the root layout, once per run)
 * sends what waits and reads my progress when a player is signed in (app start, a sign-in), and again each
 * time the app comes back to the foreground; practiceFinished() (the game store, when a practice ends) queues
 * the practice and sends it. Signed out, nothing is sent and nothing is queued (D24: registration first).
 */

/** The signed-in player with an account (status 'ready'): their Firebase uid, or null. */
export function currentOwner(): string | null {
  const { status, user } = useAuth.getState();
  return status === 'ready' && user ? user.uid : null;
}

/**
 * The fetch the progress routes go through. Under Jest (NODE_ENV 'test') there is none unless a test sets one:
 * every call is "no connection", and no test reaches for a real server by accident.
 */
const defaultFetch = (): AccountFetch | null =>
  process.env.NODE_ENV === 'test' ? null : (url, init) => fetch(url, init);

let progressFetch: AccountFetch | null = defaultFetch();

/** Tests: the fetch to use instead (null: the default again). */
export function setProgressFetch(next: AccountFetch | null): void {
  progressFetch = next ?? defaultFetch();
}

const noConnection: AccountFetch = () => Promise.reject(new TypeError('Network request failed'));

/** The progress API for whoever is signed in now; null when nobody is. */
export function signedInProgressApi(): ProgressApi | null {
  if (useAuth.getState().user === null) return null;
  return createProgressApi({
    baseUrl: httpBaseUrl(),
    getToken: async (forceRefresh) => {
      const { provider } = authDeps();
      return provider.currentUser() ? provider.getIdToken(forceRefresh) : null;
    },
    fetch: (url, init) => (progressFetch ?? noConnection)(url, init),
    timeoutMs: accountConfig.requestTimeoutMs,
  });
}

const log = (message: string, detail?: unknown) => {
  if (__DEV__) console.log(`[progress] ${message}`, ...(detail === undefined ? [] : [detail]));
};

let sync: PracticeSync | null = null;

/** The app's practice XP sync (one per run). */
export function practiceSync(): PracticeSync {
  sync ??= new PracticeSync({
    queue: createPracticeQueue(Storage),
    owner: currentOwner,
    api: signedInProgressApi,
    onProgress: (owner, progress) => adoptProgress(owner, progress, Date.now()),
    onPending: setPending,
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    random: () => Math.random(),
    log,
  });
  return sync;
}

/** A practice ended (game/session.ts): its XP is queued for the signed-in player and sent [D41]. */
export function practiceFinished(game: FinishedPractice): void {
  const result = practiceResultOf(game);
  if (!result) return;
  practiceSync()
    .enqueue(result)
    .catch((error: unknown) => log('could not queue the practice result', error));
}

/**
 * Reads my progress and my card again (Home, the progress tab, my card). Offline, the saved ones stay, and the
 * status says so. Resolves when done; never throws.
 */
export async function refreshMyProgress(api: ProgressApi | null = signedInProgressApi()): Promise<void> {
  const owner = currentOwner();
  const meId = useAuth.getState().me?.id ?? null;
  if (!owner || !api) return;
  setProgressStatus(owner, 'loading');
  try {
    const [progress, card] = await Promise.all([
      api.myProgress(),
      meId ? api.player(meId).catch(() => null) : Promise.resolve(null),
    ]);
    if (currentOwner() !== owner) return;
    const now = Date.now();
    adoptProgress(owner, progress, now);
    if (card) adoptCard(owner, card, now);
  } catch (error) {
    if (currentOwner() === owner) setProgressStatus(owner, isProgressOffline(error) ? 'offline' : 'error');
  }
}

/**
 * Once per run: follows the sign-in (a new player: their numbers, never the last one's; a player ready:
 * send and read) and the app's foreground. Returns the stop function (tests).
 */
export function startProgress(): () => void {
  let last: string | null = null;
  const onAuth = () => {
    const owner = currentOwner();
    const { status } = useAuth.getState();
    const key = `${status}:${owner ?? ''}`;
    if (key === last) return;
    last = key;
    const saved = useProgress.getState().owner;
    // Signed out, or another account: the last one's numbers go (their queue stays for them). While the
    // sign-in loads, the saved ones stay: they are what Home shows offline.
    if (saved !== null && saved !== owner && (owner !== null || status === 'signedOut')) forgetProgress();
    if (!owner) {
      practiceSync().stop();
      return;
    }
    void practiceSync().flush();
    void refreshMyProgress();
  };
  const unsubscribe = useAuth.subscribe(onAuth);
  onAuth();
  const foreground = AppState.addEventListener('change', (state) => {
    if (state !== 'active' || !currentOwner()) return;
    void practiceSync().flush();
    void refreshMyProgress();
  });
  return () => {
    unsubscribe();
    foreground.remove();
  };
}
