import type { TokenVerifier } from '../auth/firebaseToken';
import {
  devIdentityVerifier,
  type Identity,
  IdentityError,
  type IdentityVerifier,
  refusingIdentityVerifier,
  SIGN_IN_REQUIRED,
} from '../auth/identity';
import type { ServerConfig } from '../config';
import type { Db } from '../db';
import { findLiveUser } from './store';

/**
 * The game room's IdentityVerifier for accounts (spec §21: "a Firebase ID token on every connection; the
 * server maps each room to a user_id"): the join's bearer token (the SDK's `client.auth.token`) → its live
 * account → { userId: users.id, name: display name }.
 *
 * The token travels as the matchmaking request's `Authorization: Bearer` header (Colyseus hands it to the
 * room's static onAuth), never in the join options: Colyseus may print those (a seat reservation that times
 * out puts its arguments in the error message).
 *
 * Without a token, `fallback` decides (outside production: the development identity of stage 7, so the
 * fake client keeps working); without a fallback, the join is refused.
 */

export interface AccountIdentityOptions {
  tokens: TokenVerifier;
  /** The database, or how to get it once it is open (the room is defined before the server listens). */
  db: Db | (() => Db);
  fallback?: IdentityVerifier;
}

export function accountIdentityVerifier({ tokens, db, fallback }: AccountIdentityOptions): IdentityVerifier {
  const database = typeof db === 'function' ? db : () => db;
  return {
    kind: fallback === undefined ? 'account' : `account+${fallback.kind}`,
    async verify(request): Promise<Identity> {
      if (request.token === undefined || request.token === '') {
        if (fallback !== undefined) return fallback.verify(request);
        throw new IdentityError('missing', SIGN_IN_REQUIRED);
      }
      const result = await tokens.verifyIdToken(request.token);
      if (!result.ok) {
        throw new IdentityError(
          result.failure === 'unavailable' ? 'disabled' : 'invalid',
          `${result.failure === 'expired' ? 'Expired' : 'Invalid'} token: ${result.message}`,
        );
      }
      const user = await findLiveUser(database(), result.token.uid);
      if (user === undefined) {
        throw new IdentityError('invalid', 'No account for this sign-in: register first');
      }
      return { userId: user.id, name: user.displayName };
    },
  };
}

export const ACCOUNTS_OFF = 'Accounts are off on this server: FIREBASE_PROJECT_ID is not set';

export interface RoomIdentityOptions {
  config: Pick<ServerConfig, 'nodeEnv'>;
  /** The same verifier as the HTTP routes (one cache of Google's keys): auth/firebaseToken tokenVerifierFor. */
  tokens: TokenVerifier;
  db: Db | (() => Db);
}

/**
 * Who may join a game room on this server (stage 8):
 * - production: a Firebase ID token of a live account, and nothing else (no development tokens, no
 *   development identity). Without FIREBASE_PROJECT_ID nobody joins, with a message that says why.
 * - elsewhere: a token (Firebase, or `dev:<uid>` from the app's development sign-in) of a live account, or,
 *   with no token at all, the development identity in the join options (the fake client, the room tests).
 */
export function roomIdentityVerifier({ config, tokens, db }: RoomIdentityOptions): IdentityVerifier {
  if (config.nodeEnv === 'production') {
    // tokenVerifierFor() never takes development tokens in production; a verifier that does is a wiring bug.
    if (tokens.devTokens) throw new Error('A production server must not accept development tokens');
    if (tokens.projectId === null) return refusingIdentityVerifier(ACCOUNTS_OFF);
    return accountIdentityVerifier({ tokens, db });
  }
  return accountIdentityVerifier({ tokens, db, fallback: devIdentityVerifier() });
}
