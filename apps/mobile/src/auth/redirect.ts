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
 */

export const ROUTES = {
  home: '/',
  login: '/login',
  forgotPassword: '/forgot-password',
  registerFighter: '/register/fighter',
  registerAccount: '/register/account',
  verifyEmail: '/verify-email',
  editProfile: '/edit-profile',
} as const;

export type AuthRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** The screens of a signed-out player, by their first segments. */
const SIGNED_OUT: readonly string[] = ['login', 'forgot-password', 'register/fighter', 'register/account'];

const pathOf = (segments: readonly string[]) => segments.filter((s) => !s.startsWith('(')).join('/');

/** The route to go to, or null to stay. */
export function redirectFor(status: AuthStatus, segments: readonly string[]): AuthRoute | null {
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
      return onSignedOutScreen ? ROUTES.home : null;
  }
}
