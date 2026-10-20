import { isFriendCode } from '@sudoku-fight/protocol';

import { roomPath } from '../config/links';
import type { AuthStatus } from './authStore';

/**
 * Where the app belongs for an auth status (spec §4.2 navigation map; work plan stage 8): the root layout
 * sends the player there whenever the status or the screen changes.
 *
 * - loading: nowhere yet (the Splash covers the app).
 * - signedOut: the login and the two registration steps (and "שכחתי סיסמה"); anything else → /login.
 * - needsProfile: signed in without a profile → /register/fighter, which finishes the registration.
 * - ready: everything but the sign-in screens, which send the player home. /verify-email is open to a
 *   signed-in player only: verification never blocks [D22].
 * - ready, but an admin reset the display name (spec §3.5, Me.nameResetRequired, api/me.ts needsNewName):
 *   /choose-name until a new name is saved (then it sends the player home), and meanwhile only what needs no
 *   name (OPEN_WHILE_NAME_RESET): practice, which works offline too (spec §16.1), where saving a name can't;
 *   and the settings, where the account can be deleted instead.
 * - A room link opened before the player could go in (1.0.4, friends-room.md §6.5, D88; auth/pendingInvite.ts):
 *   the sign-in, the end of the registration and the new name lead straight into that room, not Home. Until
 *   then the link changes nothing: a signed-out player still signs in first, a new name still comes first.
 */

export const ROUTES = {
  home: '/',
  login: '/login',
  forgotPassword: '/forgot-password',
  registerFighter: '/register/fighter',
  registerAccount: '/register/account',
  verifyEmail: '/verify-email',
  editProfile: '/edit-profile',
  chooseName: '/choose-name',
} as const;

export type AuthRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** The way into a room by its code (config/links.ts roomPath, app/room/[code].tsx). */
export type RoomRoute = `/room/${string}`;

/** The screens of a signed-out player, by their first segments. */
const SIGNED_OUT: readonly string[] = ['login', 'forgot-password', 'register/fighter', 'register/account'];

/** A screen's path as these rules name it: its segments without the groups ('register/fighter', '' for Home). */
export const pathOf = (segments: readonly string[]): string =>
  segments.filter((s) => !s.startsWith('(')).join('/');

/** The screens of signing in, signing up and choosing a new name: the ones a pending invite leads out of. */
export const isSignInPath = (path: string): boolean => SIGNED_OUT.includes(path) || path === 'choose-name';

/**
 * Where a player whose name was reset may go before choosing a new one: practice alone or against a bot (the
 * mode choice, the bot's level, the game, its results, the interferences' guide) and the settings (with the
 * blocked players, the licenses, and deleting the account). Not Home, the modes (ranked is there), the player
 * card or the profile: those lead back to /choose-name.
 */
export const OPEN_WHILE_NAME_RESET: readonly string[] = [
  'choose-name',
  'game-type',
  'bot-select',
  'game',
  'results/[id]',
  'interferences',
  'settings',
  'blocked-players',
  'licenses',
];

/** What else decides where a ready player belongs. */
export interface AuthGates {
  /** The profile asks for a new display name (spec §3.5): /choose-name, and OPEN_WHILE_NAME_RESET only. */
  nameReset?: boolean;
  /**
   * The code of a room link the player opened, still waiting (auth/pendingInvite.ts pendingInviteCode): where
   * the sign-in, the registration's end and the new name go instead of Home [D88].
   */
  invite?: string | null;
}

/** The route to go to, or null to stay. */
export function redirectFor(
  status: AuthStatus,
  segments: readonly string[],
  { nameReset = false, invite = null }: AuthGates = {},
): AuthRoute | RoomRoute | null {
  const path = pathOf(segments);
  const onSignedOutScreen = SIGNED_OUT.includes(path);
  switch (status) {
    case 'loading':
      return null;
    case 'signedOut':
      return onSignedOutScreen ? null : ROUTES.login;
    case 'needsProfile':
      return path === 'register/fighter' ? null : ROUTES.registerFighter;
    case 'ready':
      if (nameReset) return OPEN_WHILE_NAME_RESET.includes(path) ? null : ROUTES.chooseName;
      if (!isSignInPath(path)) return null;
      return isFriendCode(invite) ? roomPath(invite) : ROUTES.home;
  }
}
