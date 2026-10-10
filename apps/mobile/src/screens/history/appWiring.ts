import { authDeps, useAuth } from '../../auth';
import { accountConfig } from '../../config/account';
import { httpBaseUrl } from '../../config/server';
import { practiceStorageOrNull } from '../../game/storage';
import { useProfile } from '../../state/profile';
import type { ReplaySourceDeps } from '../replay/replaySource';
import { createHistoryApi, type HistoryApi } from './historyApi';
import type { HistoryDeps } from './historyLoader';

/**
 * The history and the replay wired to the phone (the routes use these; tests pass their own deps): the
 * practice database [D25], and the game server's history routes with the sign-in's ID token. Signed out,
 * there is no server side: practices only.
 */

/** The server's history for whoever is signed in now; null when nobody is. */
export function signedInHistoryApi(): HistoryApi | null {
  if (useAuth.getState().user === null) return null;
  return createHistoryApi({
    baseUrl: httpBaseUrl(),
    getToken: async (forceRefresh) => {
      const { provider } = authDeps();
      return provider.currentUser() ? provider.getIdToken(forceRefresh) : null;
    },
    fetch: (url, init) => fetch(url, init),
    timeoutMs: accountConfig.requestTimeoutMs,
  });
}

export function appHistoryDeps(): HistoryDeps {
  return { practice: practiceStorageOrNull, ranked: signedInHistoryApi() };
}

export function appReplayDeps(): ReplaySourceDeps {
  const { avatarId, country } = useProfile.getState();
  return {
    practice: practiceStorageOrNull,
    ranked: signedInHistoryApi(),
    myAvatar: avatarId,
    myCountry: country,
  };
}
