import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import type { AccountFetch } from '../api/accountApi';
import { createProgressApi, isProgressOffline, type ProgressApi } from '../api/progressApi';
import { authDeps, fetchMe, refreshMeIfStale, showRankedResult, useAuth } from '../auth/authStore';
import { accountConfig } from '../config/account';
import { httpBaseUrl } from '../config/server';
import type { OnlineEnd } from '../game/onlineSession';
import { rankedEndOf, rankedLeftOf } from '../game/rankedEnd';
import { openLevelsStorage } from '../levels/levelsStorage';
import { forgetLevels, refreshLevels, useLevels } from '../levels/levelsStore';
import { LevelsSync } from '../levels/levelsSync';
import { crashReporter } from '../services/crashlytics';
import { createPracticeQueue } from './practiceQueue';
import { type FinishedPractice, practiceResultOf } from './practiceResult';
import { PracticeSync } from './practiceSync';
import { RankedRefresh } from './rankedRefresh';
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
 * time the app comes back to the foreground (with the account, GET /v1/me, at most every refresh.minIntervalMs);
 * practiceFinished() (the game store, when a practice ends) queues the practice and sends it;
 * onlineGameEnded() (the game store, when a ranked game ends or is left) shows its rating and reads the account
 * and my progress until the server has stored it (rankedRefresh.ts). Signed out, nothing is sent and nothing is
 * queued (D24: registration first).
 *
 * Staged practice (1.0.2) [D57]: levelsSync() sends the levels' bests from levels.db and brings the account's
 * back (levels/levelsSync.ts), on the same triggers; a level's end flushes it too (levels/appLevels.ts).
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

/**
 * The progress API for whoever is signed in now; null when nobody is. With `owner` (a sync's player, a Firebase
 * uid): bound to them, each request carries their token or none ('signedOut') once Firebase has another player
 * signed in, so a sync that started for one account never sends to, or reads from, the next one's (a shared
 * phone, a sign-in during a slow request).
 */
export function signedInProgressApi(owner?: string): ProgressApi | null {
  if (useAuth.getState().user === null) return null;
  return createProgressApi({
    baseUrl: httpBaseUrl(),
    getToken: async (forceRefresh) => {
      const { provider } = authDeps();
      const user = provider.currentUser();
      if (!user || (owner !== undefined && user.uid !== owner)) return null;
      return provider.getIdToken(forceRefresh);
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

let levels: LevelsSync | null = null;

/** The app's levels sync (one per run): levels.db's bests to the account, and the account's back [D57]. */
export function levelsSync(): LevelsSync {
  levels ??= new LevelsSync({
    repo: openLevelsStorage,
    owner: currentOwner,
    api: signedInProgressApi,
    now: () => Date.now(),
    onProgress: (owner, progress) => adoptProgress(owner, progress, Date.now()),
    // The server's levels changed some rows (a restore, the other phone): the screens' numbers again.
    onMerged: (owner) => void refreshLevels({ owner }),
    onRejected: (owner, refused) =>
      crashReporter().recordError(
        new Error(`levels refused by the server: ${refused.map((l) => l.id).join(', ')}`),
        'levels: sync',
      ),
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    random: () => Math.random(),
    log,
  });
  return levels;
}

let ranked: RankedRefresh | null = null;

/** The app's refresh of the account after a ranked game (one per run). */
export function rankedRefresh(): RankedRefresh {
  const { confirmDelaysMs, unratedDelaysMs } = accountConfig.refresh.afterRanked;
  ranked ??= new RankedRefresh({
    fetchMe,
    refreshProgress: () => refreshMyProgress(),
    showResult: showRankedResult,
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    confirmDelaysMs,
    unratedDelaysMs,
    log,
  });
  return ranked;
}

/**
 * An online game ended, or was left while it ran (game/onlineSession.ts, from every session of the game store):
 * a rated ranked game of the signed-in player is followed until the server has stored it (rankedRefresh.ts),
 * however the screens are left. Anything else (a dev room, signed out) is nothing to follow.
 */
export function onlineGameEnded({ state, playerId, left }: OnlineEnd): void {
  if (!currentOwner()) return;
  const end = left
    ? rankedLeftOf(state, playerId, accountConfig.refresh.afterRanked.afterGraceMarginMs)
    : rankedEndOf(state, playerId);
  if (end) rankedRefresh().gameEnded(end);
}

/** Reads of my progress, numbered as they start; the newest one whose answer was taken. */
let progressReads = 0;
let progressTaken = 0;

/**
 * Reads my progress and my card again (Home, the progress tab, my card). Offline, the saved ones stay, and the
 * status says so. Resolves when done; never throws. Reads may overlap (Home's focus, the foreground, the read
 * after a ranked game is stored): an answer older than one already taken is dropped, so a read sent before the
 * server stored a game never overwrites one sent after it.
 */
export async function refreshMyProgress(api: ProgressApi | null = signedInProgressApi()): Promise<void> {
  const owner = currentOwner();
  const meId = useAuth.getState().me?.id ?? null;
  if (!owner || !api) return;
  const read = ++progressReads;
  setProgressStatus(owner, 'loading');
  try {
    const [progress, card] = await Promise.all([
      api.myProgress(),
      meId ? api.player(meId).catch(() => null) : Promise.resolve(null),
    ]);
    if (currentOwner() !== owner || read <= progressTaken) return;
    progressTaken = read;
    const now = Date.now();
    adoptProgress(owner, progress, now);
    if (card) adoptCard(owner, card, now);
  } catch (error) {
    if (currentOwner() === owner && read > progressTaken)
      setProgressStatus(owner, isProgressOffline(error) ? 'offline' : 'error');
  }
}

/** Another player (or none): the reads still on their way are not theirs, and none of them is taken. */
function forgetProgressReads(): void {
  progressTaken = progressReads;
}

/**
 * Once per run: follows the sign-in (a new player: their numbers, never the last one's; a player ready:
 * send and read) and the app's foreground. Returns the stop function (tests).
 */
export function startProgress(): () => void {
  let last: string | null = null;
  let lastOwner: string | null = null;
  const onAuth = () => {
    const owner = currentOwner();
    const { status } = useAuth.getState();
    const key = `${status}:${owner ?? ''}`;
    if (key === last) return;
    last = key;
    // Signed out, or another account: the last one's ranked game is no longer followed, nor their reads.
    if (owner !== lastOwner) {
      if (lastOwner !== null) {
        ranked?.stop();
        forgetProgressReads();
      }
      lastOwner = owner;
    }
    const saved = useProgress.getState().owner;
    // Signed out, or another account: the last one's numbers go (their queue stays for them). While the
    // sign-in loads, the saved ones stay: they are what Home shows offline.
    if (saved !== null && saved !== owner && (owner !== null || status === 'signedOut')) forgetProgress();
    // The levels' numbers too (theirs stay in levels.db, under their owner).
    const levelsOwner = useLevels.getState().owner;
    if (levelsOwner !== null && levelsOwner !== owner && (owner !== null || status === 'signedOut'))
      forgetLevels();
    if (!owner) {
      practiceSync().stop();
      levels?.stop();
      return;
    }
    void practiceSync().flush();
    void levelsSync().flush();
    void refreshMyProgress();
  };
  const unsubscribe = useAuth.subscribe(onAuth);
  onAuth();
  const foreground = AppState.addEventListener('change', (state) => {
    if (state !== 'active' || !currentOwner()) return;
    void practiceSync().flush();
    void levelsSync().flush();
    void refreshMyProgress();
    // The account too (a ranked game may have been stored meanwhile), at most every refresh.minIntervalMs.
    void refreshMeIfStale();
  });
  return () => {
    unsubscribe();
    foreground.remove();
    ranked?.stop();
    levels?.stop();
  };
}
