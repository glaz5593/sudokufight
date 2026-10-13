import {
  createLocalJWKSet,
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';

import { createTokenVerifier, firebaseIssuer, type TokenVerifier } from '../auth/firebaseToken';
import { TEST_FIREBASE_PROJECT_ID } from './config';

/**
 * Firebase ID tokens for tests, signed with an RSA key made here (never Google's): its public half is the
 * only key of a local JWK set, which the verifier takes in place of Google's (createLocalJWKSet).
 *
 *   const tokens = await testTokens();
 *   const verifier = tokens.verifier(clock.now);
 *   const token = await tokens.sign({ uid: 'u1', email: 'a@b.c' }, clock.now());
 */

export const TEST_KID = 'test-key-1';

export interface TokenClaims {
  uid?: string;
  email?: string | null;
  emailVerified?: boolean;
  /** How the user signed in (`firebase.sign_in_provider`): 'password' (default), 'google.com'… */
  provider?: string;
  /** Anything else, or a claim to override (iss, aud, exp…); undefined removes one. */
  extra?: Record<string, unknown>;
}

export interface SignOptions {
  kid?: string | null;
  /** Sign with another private key (a forgery). */
  key?: CryptoKey;
  alg?: string;
}

export interface TestTokens {
  jwks: JSONWebKeySet;
  keys: JWTVerifyGetKey;
  /** A token issued at `now` (ms) that runs for an hour, like Firebase's. */
  sign(claims: TokenClaims, now: number, options?: SignOptions): Promise<string>;
  /** A verifier for TEST_FIREBASE_PROJECT_ID with these keys (dev tokens unless `devTokens: false`). */
  verifier(now: () => number, options?: { devTokens?: boolean; projectId?: string | null }): TokenVerifier;
}

export async function testTokens(projectId = TEST_FIREBASE_PROJECT_ID): Promise<TestTokens> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwks: JSONWebKeySet = {
    keys: [{ ...(await exportJWK(publicKey)), kid: TEST_KID, alg: 'RS256', use: 'sig' }],
  };
  const keys = createLocalJWKSet(jwks);

  return {
    jwks,
    keys,
    async sign(
      { uid = 'firebase-uid-1', email = null, emailVerified = true, provider = 'password', extra = {} },
      now,
      options = {},
    ) {
      const iat = Math.floor(now / 1000);
      // Like Firebase: a Google sign-in lists the Google account's id too.
      const identities: Record<string, string[]> = email === null ? {} : { email: [email] };
      if (provider === 'google.com') identities['google.com'] = [`google-${uid}`];
      const claims: JWTPayload = {
        iss: firebaseIssuer(projectId),
        aud: projectId,
        sub: uid,
        iat,
        exp: iat + 3600,
        auth_time: iat - 60,
        user_id: uid,
        firebase: { identities, sign_in_provider: provider },
        ...(email === null ? {} : { email, email_verified: emailVerified }),
      };
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined) delete claims[k];
        else claims[k] = v;
      }
      const kid = options.kid === undefined ? TEST_KID : options.kid;
      const header = { alg: options.alg ?? 'RS256', typ: 'JWT', ...(kid === null ? {} : { kid }) };
      return new SignJWT(claims).setProtectedHeader(header).sign(options.key ?? privateKey);
    },
    verifier: (now, options = {}) =>
      createTokenVerifier({
        projectId: options.projectId === undefined ? projectId : options.projectId,
        devTokens: options.devTokens ?? true,
        now,
        keys,
      }),
  };
}
