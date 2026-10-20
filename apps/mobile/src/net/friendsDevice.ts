import { roomLink } from '@sudoku-fight/protocol';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { AccountFetch } from '../api/accountApi';
import { createRoomsApi, type RoomsApi } from '../api/roomsApi';
import { authDeps, useAuth } from '../auth/authStore';
import { accountConfig } from '../config/account';
import { httpBaseUrl } from '../config/server';
import { useGameStore } from '../game/gameStore';
import type { OnlineSession } from '../game/onlineSession';
import { track } from '../services/analytics';
import { crashReporter } from '../services/crashlytics';
import {
  createFriendsRooms,
  type FriendsRooms,
  type FriendsRoomsDeps,
  friendsRoomOf,
  type FriendsRoomView,
} from './friends';
import type { OnlineInfo, RemoteGameHost } from './remoteGameHost';

/**
 * Playing with friends wired to the phone (1.0.4; the logic is net/friends.ts): the routes with the sign-in's
 * ID token, the game store, a RemoteGameHost wired like any online game (net/device.ts, loaded when a room is
 * entered: it brings the network SDK, which the screens that only show the buttons don't need), analytics, and
 * Crashlytics' log for the diagnostics.
 *
 * For the screens: friendsRooms() (createRoom, joinByCode, start, setGameType, kick, leave, shared),
 * useFriendsRoom() (the room as they draw it, on every change), friendsRoomLink() (the share message's link).
 * For the link handling (M3): currentFriendsRoomCode() and subscribeCurrentFriendsRoom(), to keep "the room I
 * am in" on the phone and come back to it after the app was closed (joinByCode(code, 'resume')).
 */

/**
 * The fetch the rooms' routes go through. Under Jest (NODE_ENV 'test') there is none unless a test sets one:
 * every call is "no connection", so no test reaches for a real server by accident.
 */
const defaultFetch = (): AccountFetch | null =>
  process.env.NODE_ENV === 'test' ? null : (url, init) => fetch(url, init);

let roomsFetch: AccountFetch | null = defaultFetch();

/** Tests: the fetch to use instead (null: the default again). */
export function setFriendsFetch(next: AccountFetch | null): void {
  roomsFetch = next ?? defaultFetch();
}

const noConnection: AccountFetch = () => Promise.reject(new TypeError('Network request failed'));

/** The rooms' routes for whoever is signed in now; null when nobody is. */
export function signedInRoomsApi(): RoomsApi | null {
  if (useAuth.getState().user === null) return null;
  return createRoomsApi({
    baseUrl: httpBaseUrl(),
    getToken: async (forceRefresh) => {
      const { provider } = authDeps();
      return provider.currentUser() ? provider.getIdToken(forceRefresh) : null;
    },
    fetch: (url, init) => (roomsFetch ?? noConnection)(url, init),
    timeoutMs: accountConfig.requestTimeoutMs,
  });
}

/** The phone's online host, loaded with the SDK only when a room is entered. */
type Device = typeof import('./device');
/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see above */
const deviceHost = (): RemoteGameHost => (require('./device') as Device).deviceHost();
/* eslint-enable @typescript-eslint/no-require-imports */

/** The room's log: the console in development, Crashlytics' log everywhere (never a code or a name). */
export function friendsLog(line: string): void {
  if (__DEV__) console.log(`[friends] ${line}`);
  crashReporter().log(`[friends] ${line}`);
}

/** The deps of the phone's friendsRooms(). */
export function deviceFriendsDeps(overrides: Partial<FriendsRoomsDeps> = {}): FriendsRoomsDeps {
  return {
    api: signedInRoomsApi,
    store: {
      getOnline: () => useGameStore.getState().online,
      startFriends: (request, deps) => useGameStore.getState().startFriends(request, deps),
      clear: () => useGameStore.getState().clear(),
    },
    makeHost: deviceHost,
    track,
    log: friendsLog,
    ...overrides,
  };
}

let rooms: FriendsRooms | null = null;
let roomsOverride: FriendsRooms | null = null;

/** The phone's friends rooms (one for the app's run). */
export function friendsRooms(): FriendsRooms {
  if (roomsOverride) return roomsOverride;
  rooms ??= createFriendsRooms(deviceFriendsDeps());
  return rooms;
}

/** Tests: friends rooms of your own (createFriendsRooms with fakes), or null for the phone's again. */
export function setFriendsRooms(next: FriendsRooms | null): void {
  roomsOverride = next;
}

/**
 * A room's link for the share message (D87, §6.7): `https://<this app's server>/r/123456`, so staging and
 * production each share their own.
 */
export function friendsRoomLink(code: string): string {
  return roomLink(httpBaseUrl(), code);
}

// ---------------------------------------------------------------------------------------------------------
// For the screens: the room on every change

const noSubscription = () => () => undefined;

/** The store's friends session, if `online` is one. */
const friendsSessionOf = (online: OnlineSession | null): OnlineSession | null =>
  online && online.request.kind === 'friends' ? online : null;

/**
 * The friends room the game store holds, as the screens draw it (net/friends.ts friendsRoomOf), with its
 * session (for the game screen once the game is here); null when the store holds no friends room.
 */
export function useFriendsRoom(): { session: OnlineSession; room: FriendsRoomView } | null {
  const session = useGameStore((s) => friendsSessionOf(s.online));
  const subscribe = useCallback(
    (onChange: () => void) => (session ? session.subscribeOnline(onChange) : noSubscription()),
    [session],
  );
  const info = useSyncExternalStore<OnlineInfo | null>(
    subscribe,
    useCallback(() => (session ? session.online : null), [session]),
  );
  return useMemo(
    () =>
      session && info && session.request.kind === 'friends'
        ? { session, room: friendsRoomOf(info, session.request) }
        : null,
    [session, info],
  );
}

// ---------------------------------------------------------------------------------------------------------
// For the link handling (M3): the room I am in, to come back to after the app was closed

/**
 * The code of the friends room this phone is in now, or null: a friends session that is still in it (or lost
 * its connection, and may come back). Out of it on purpose, put out, or past its game: null.
 */
export function currentFriendsRoomCode(
  online: OnlineSession | null = useGameStore.getState().online,
): string | null {
  const session = friendsSessionOf(online);
  if (!session) return null;
  const info = session.online;
  if (info.status === 'closed' && info.closeReason !== 'lostConnection') return null;
  return session.friendsCode;
}

/**
 * Tells `listener` the code of the room this phone is in (currentFriendsRoomCode) whenever it changes, and
 * once now. Returns the unsubscribe function.
 */
export function subscribeCurrentFriendsRoom(listener: (code: string | null) => void): () => void {
  let last: string | null | undefined;
  let session: OnlineSession | null = null;
  let unsubscribeSession: (() => void) | null = null;
  const tell = () => {
    const code = currentFriendsRoomCode();
    if (code === last) return;
    last = code;
    try {
      listener(code);
    } catch {
      // A listener's failure never breaks a room.
    }
  };
  const follow = (online: OnlineSession | null) => {
    const next = friendsSessionOf(online);
    if (next !== session) {
      unsubscribeSession?.();
      session = next;
      unsubscribeSession = next ? next.subscribeOnline(tell) : null;
    }
    tell();
  };
  const unsubscribeStore = useGameStore.subscribe((s) => follow(s.online));
  follow(useGameStore.getState().online);
  return () => {
    unsubscribeStore();
    unsubscribeSession?.();
  };
}
