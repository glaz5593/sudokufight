import { TELEMETRY_PATH } from '@sudoku-fight/protocol';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { signedInIdToken } from '../../auth/authStore';
import { httpBaseUrl } from '../../config/server';
import { cleanAppVersion, platformOf } from './batching';
import { createTelemetryClient, type TelemetryClient, type TelemetryClientDeps } from './client';
import { getInstallId, uuidV4 } from './ids';
import { openDeviceTelemetryStore } from './storage';

/**
 * The app's usage reports (spec §27.1), wired to the phone: the queue in telemetry.db, `fetch` to the game
 * server's `POST /v1/events` (with the sign-in's ID token when there is one), the wall clock, the JS timers
 * and AppState. track() (services/analytics.ts)
 * queues into it from the first event; nothing touches the disk or the network before startTelemetry(),
 * which the root layout calls once per run.
 */

let client: TelemetryClient | null = null;

export function telemetry(): TelemetryClient {
  client ??= createTelemetryClient(deviceDeps());
  return client;
}

/** Loads what earlier runs left, sends it, and starts the triggers. On a platform the server doesn't know
 * (only iOS, Android and the web), events stay in memory. Never throws. */
export function startTelemetry(): void {
  try {
    if (platformOf(Platform.OS) === null) return;
    telemetry().start();
  } catch (error) {
    if (__DEV__) console.log('[telemetry] could not start', error);
  }
}

function deviceDeps(): TelemetryClientDeps {
  return {
    openStore: openDeviceTelemetryStore,
    url: `${httpBaseUrl()}${TELEMETRY_PATH}`,
    meta: async () => {
      const platform = platformOf(Platform.OS);
      if (platform === null) throw new Error(`no telemetry on ${Platform.OS}`);
      const appVersion = cleanAppVersion(Constants.expoConfig?.version);
      return { installId: await getInstallId(), platform, appVersion };
    },
    // Signed in: the batches carry the ID token, so the server links them to the account (stage 8).
    idToken: signedInIdToken,
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    random: () => Math.random(),
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    appState: AppState,
    newId: () => uuidV4(),
    // console.log, not warn: an offline phone is normal, not something to show in LogBox.
    log: (message, detail) => {
      if (__DEV__) console.log(`[telemetry] ${message}`, ...(detail === undefined ? [] : [detail]));
    },
  };
}
