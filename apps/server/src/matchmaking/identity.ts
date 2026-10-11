import { accountIdentityVerifier, roomIdentityVerifier } from '../accounts/identity';
import type { IdentityVerifier } from '../auth';
import type { TokenVerifier } from '../auth/firebaseToken';
import type { ServerConfig } from '../config';
import type { Db } from '../db';

/**
 * Who may search for a ranked game: registered players only (spec §3, §21), on every server. The bearer
 * token (the SDK's `client.auth.token`: a Firebase ID token, or outside production the app's `dev:<uid>`)
 * → the live account. Unlike the dev game rooms, there is no development identity from the join options.
 *
 * With RANKED_REQUIRES_VERIFIED_EMAIL (on by default, D22) the token must also say the email is verified,
 * else the room refuses with `emailNotVerified` (./room). Development tokens count as verified (they exist
 * only outside production). The queue is the one way into a rated room, so this one check covers them:
 * - matchmaking creates the rated rooms on the server, for its matches only, and a match room lets in the
 *   match's players and nobody else (GameRoom joinLobby: `match.has`), then only its own seats again;
 * - a client's create (game/options.ts parseCreateOptions) is refused in production, `rated: true` included;
 *   outside production it is a development tool, with the development identity.
 */
export function matchmakingIdentityVerifier({
  config,
  tokens,
  db,
}: {
  config: Pick<ServerConfig, 'nodeEnv' | 'rankedRequiresVerifiedEmail'>;
  tokens: TokenVerifier;
  db: Db | (() => Db);
}): IdentityVerifier {
  const requireVerifiedEmail = config.rankedRequiresVerifiedEmail;
  // In production the game rooms' verifier takes accounts only already (and refuses everyone without a
  // Firebase project); elsewhere it would fall back to the development identity.
  if (config.nodeEnv === 'production')
    return roomIdentityVerifier({ config, tokens, db, requireVerifiedEmail });
  return accountIdentityVerifier({ tokens, db, requireVerifiedEmail });
}
