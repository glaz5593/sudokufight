import { FRIENDS_APP_SCHEME, friendCodeFromLink, isFriendCode } from '@sudoku-fight/protocol';

import { serverEndpoint, type ServerEndpoint } from './server';

/**
 * Room links on the phone (1.0.4; docs/handoff/2026-10-19/friends-room.md §6, D87, D88): what a link opens, how
 * long its code waits through a sign-in, and the room the app goes back to after it was closed. Each number is
 * a default built as a setting (CLAUDE.md), read by the code it names.
 *
 * A room's link is `https://<this app's server>/r/123456` (protocol roomLink; staging and production each have
 * their own), or the app's own `sudokufight://room/123456`. app/+native-intent.tsx turns either into
 * ROOM_ROUTE, which goes straight into the room [D88 א]; the share message's link is net/friendsDevice.ts
 * friendsRoomLink.
 */
export interface LinksUiSettings {
  /**
   * §6.5: a room code from a link the player opened while signed out (or before the registration ended, or
   * before a new name), kept on the phone, through an app closed meanwhile: after the sign-in it goes straight
   * into the room, not Home (auth/pendingInvite.ts). After this long it is forgotten.
   */
  pendingInviteTtlMs: number;
  /**
   * §6.5: the friends room this phone is in, kept so the next start goes back to it, to the same seat (Android
   * may close the app while its player shares the link in WhatsApp). As long as the server holds an away seat
   * (its `lobbyAwayHoldMs`, 6 hours [D84a]); after that the seat is gone anyway.
   */
  currentRoomTtlMs: number;
}

export const LINKS_UI: LinksUiSettings = {
  pendingInviteTtlMs: 60 * 60_000,
  currentRoomTtlMs: 6 * 60 * 60_000,
};

/** The route that goes straight into a room by its code (app/room/[code].tsx). */
export const ROOM_ROUTE = '/room/[code]';

/**
 * The route of a room by its code. `resume`: back to the room the app was in when it was closed (§6.5), which
 * the room screen takes as `joinByCode(code, 'resume')` (no friends_room_join: it is not a new join).
 */
export function roomPath(code: string, { resume = false }: { resume?: boolean } = {}): `/room/${string}` {
  if (!isFriendCode(code)) throw new RangeError(`not a room code: ${code}`);
  return resume ? `/room/${code}?resume=1` : `/room/${code}`;
}

/**
 * The screens that are a friends room, as the auth gate's paths (segments without groups): the room by its
 * code, and the waiting room. Reaching one uses up a pending invite (auth/useAuthGate.ts).
 */
export const ROOM_PATHS: readonly string[] = ['room/[code]', 'friends/room'];

/** The host room links are on: this app's own server (staging, production, or this PC's `--server local`). */
export const linkHost = (endpoint: ServerEndpoint = serverEndpoint): string => endpoint.hostname;

/**
 * A URL is a room link's shape: `https://<any host>/r/…`, `sudokufight://room/…`, or a bare `/r/…`, `/room/…`,
 * whatever comes after (a code or not).
 */
const ROOM_LINK_SHAPE = new RegExp(
  `^(?:https?://[^/?#\\s]+/r|${FRIENDS_APP_SCHEME}:///?room|/(?:r|room))(?=$|[/?#])`,
  'i',
);

/**
 * What a URL the app was opened with says (app/+native-intent.tsx): a room's code (a link to this app's server,
 * or the app's own scheme), `badRoom` for a room link that leads nowhere (another server, a code that is not 6
 * digits: Home), or `other` for any other URL (expo-router routes it; app/+not-found.tsx catches the unknown).
 */
export function roomLinkOf(
  url: string,
  host: string = linkHost(),
): { kind: 'room'; code: string } | { kind: 'badRoom' } | { kind: 'other' } {
  const code = friendCodeFromLink(url, host);
  if (code !== null) return { kind: 'room', code };
  return ROOM_LINK_SHAPE.test(url.trim()) ? { kind: 'badRoom' } : { kind: 'other' };
}
