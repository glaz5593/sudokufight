import { accountIdentityVerifier, roomIdentityVerifier } from '../accounts/identity';
import type { IdentityVerifier } from '../auth';
import type { TokenVerifier } from '../auth/firebaseToken';
import type { ServerConfig } from '../config';
import type { Db } from '../db';

/**
 * Who may search for a ranked game: registered players only (spec §3, §21), on every server. The bearer
 * token (the SDK's `client.auth.token`: a Firebase ID token, or outside production the app's `dev:<uid>`)
 * → the live account. Unlike the dev game rooms, there is no development identity from the join options.
 */
export function matchmakingIdentityVerifier({
  config,
  tokens,
  db,
}: {
  config: Pick<ServerConfig, 'nodeEnv'>;
  tokens: TokenVerifier;
  db: Db | (() => Db);
}): IdentityVerifier {
  // In production the game rooms' verifier takes accounts only already (and refuses everyone without a
  // Firebase project); elsewhere it would fall back to the development identity.
  if (config.nodeEnv === 'production') return roomIdentityVerifier({ config, tokens, db });
  return accountIdentityVerifier({ tokens, db });
}
