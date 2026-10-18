import { Client } from '@colyseus/sdk';

import { authDeps, useAuth } from '../auth/authStore';
import { serverEndpoint } from '../config/server';
import { systemClock, timeoutScheduler } from '../game/clock';
import type { RankedDeps } from '../game/gameStore';
import { track } from '../services/analytics';
import { crashReporter } from '../services/crashlytics';
import { deviceHost } from './device';
import { createMatchmakingConnector } from './matchmaking';

/**
 * The account's ID token for the matchmaking queue (registered players only): null when nobody is signed
 * in. Not a forced refresh (Firebase renews its own); a token that can't be had (no network for the
 * refresh) rejects, and the search says "no connection". A bearer secret: never logged.
 */
async function rankedToken(): Promise<string | null> {
  if (useAuth.getState().user === null) return null;
  return authDeps().provider.getIdToken(false);
}

/**
 * Matchmaking wired to the phone (work plan stage 9): an SDK client for the configured server, the account's
 * token, the match's room as a RemoteGameHost wired like any online game (net/device.ts), the wall clock, the
 * JS timers and analytics. Everything else is pure (net/matchmaking.ts) and takes these as deps.
 */
export function deviceMatchmakingDeps(): RankedDeps {
  return {
    connector: createMatchmakingConnector({ sdk: new Client(serverEndpoint), token: rankedToken }),
    makeHost: deviceHost,
    clock: systemClock,
    scheduler: timeoutScheduler,
    track,
    log: matchmakingLog,
    report: (error, context) => crashReporter().recordError(error, `matchmaking: ${context}`),
  };
}

/**
 * The search's log: the console in development (log, not warn: a search that fails is normal, not something
 * for LogBox), and Crashlytics' log everywhere, as breadcrumbs for the next report. The client never puts a
 * token, a reservation or a name in a line (MatchmakingClient).
 */
export function matchmakingLog(line: string): void {
  if (__DEV__) console.log(`[matchmaking] ${line}`);
  crashReporter().log(`[matchmaking] ${line}`);
}
