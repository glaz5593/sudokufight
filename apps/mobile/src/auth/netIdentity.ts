import { devIdentity } from '../net/identity';
import type { NetIdentity } from '../net/onlineClient';
import { authDeps, useAuth } from './authStore';

/**
 * Who this phone is to the game rooms (spec §21, work plan stage 8), asked on every join (net/identity.ts
 * setNetIdentitySource; auth/index.ts installs it):
 *
 * - signed in: the account's ID token (Firebase's, or the development sign-in's `dev:<uid>`), which the
 *   online client sends as the SDK's auth token (the Authorization header, never the join options). The
 *   server maps it to the account: users.id and the display name. Not a forced refresh: Firebase hands out a
 *   cached token, renewed by itself before it runs out.
 * - signed out: stage 7's development identity, which only a development server takes (a production server
 *   refuses it, and the app needs a sign-in before it gets anywhere near a room anyway: D24 is not approved).
 *
 * A signed-in player whose token can't be had (no network for Firebase's refresh) does not become someone
 * else: the join fails (an AuthError, which the online client reports), and can be tried again.
 */
export async function accountNetIdentity(
  fallback: () => Promise<NetIdentity> = () => devIdentity(),
): Promise<NetIdentity> {
  if (useAuth.getState().user === null) return fallback();
  const token = await authDeps().provider.getIdToken(false);
  return { kind: 'token', token };
}
