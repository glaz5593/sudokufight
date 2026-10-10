import { AppState } from 'react-native';

import { systemClock, timeoutScheduler } from '../game/clock';
import { serverEndpoint } from '../config/server';
import { track } from '../services/analytics';
import { type DevRoom, devRooms } from './devRooms';
import { netIdentity } from './identity';
import { createOnlineClient, type DevRoomOptions } from './onlineClient';
import { RemoteGameHost, type RemoteHostDeps } from './remoteGameHost';

/**
 * Development builds ping once a second (release: every 2 s), so the debug screen has stage 7's 200 round
 * trips after some 3 minutes of a game. Still half the server's ping limit (5 per 2.5 s, spec §21).
 */
export const DEV_PING_EVERY_MS = 1000;

/**
 * The online game wired to the phone: the SDK client for the configured server (config/server.ts), the
 * identity (identity.ts: dev until stage 8), the wall clock, the JS timers, React Native's AppState and
 * analytics. Everything else in src/net is pure and takes these as deps.
 */
export function deviceHostDeps(overrides: Partial<RemoteHostDeps> = {}): RemoteHostDeps {
  return {
    client: createOnlineClient({ endpoint: serverEndpoint, identity: netIdentity }),
    clock: systemClock,
    scheduler: timeoutScheduler,
    appState: AppState,
    track,
    ...(__DEV__ ? { options: { pingEveryMs: DEV_PING_EVERY_MS } } : null),
    // console.log, not warn: a dropped connection is normal, not something for LogBox.
    log: (line) => {
      if (__DEV__) console.log(`[online] ${line}`);
    },
    ...overrides,
  };
}

/** A RemoteGameHost wired to the phone (it has not joined anything yet: create() or join() it). */
export function deviceHost(): RemoteGameHost {
  return new RemoteGameHost(deviceHostDeps());
}

/** Creates a private room on the server (dev, stage 7) and joins it; resolves with the host and the code. */
export function createDevRoom(options: DevRoomOptions = {}): Promise<DevRoom> {
  return devRooms(deviceHostDeps()).createDevRoom(options);
}

/** Joins the private room with this code (as typed). */
export function joinDevRoom(code: string): Promise<RemoteGameHost> {
  return devRooms(deviceHostDeps()).joinDevRoom(code);
}
