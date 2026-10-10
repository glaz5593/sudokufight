import { parseDevToken } from '@sudoku-fight/protocol';
import { decodeProtectedHeader, errors, type JWTVerifyGetKey, jwtVerify } from 'jose';

import type { ServerConfig } from '../config';
import { googleKeys, KeysUnavailableError } from './googleKeys';

/**
 * Who is calling (spec §18 "HTTP API", §21): the Firebase ID token the app sends as `Authorization: Bearer`.
 *
 * A Firebase ID token is a JWT signed by Google. It holds when (Firebase's documented checks):
 * - the header says RS256 and names a key id (`kid`) of Google's securetoken key set (./googleKeys);
 * - the signature is good;
 * - `iss` is https://securetoken.google.com/<project id> and `aud` is the project id;
 * - `exp` is in the future, `iat` and `auth_time` are not (give or take a small clock skew);
 * - `sub` is a non-empty string: the user's Firebase uid.
 *
 * Development tokens (`dev:<uid>[:<email>]`, protocol devToken()) stand in for Firebase in builds without
 * it, and are taken only outside production. Their uid is kept as `dev:<uid>`, so it can never match a
 * Firebase uid (which has no colon).
 */

export const MAX_TOKEN_LENGTH = 4096;
/** Seconds of clock difference allowed between Google and this server. */
export const DEFAULT_CLOCK_SKEW_SEC = 30;
/** Firebase uids are at most 128 characters. */
const MAX_UID_LENGTH = 128;

export interface VerifiedToken {
  /** The Firebase uid, or `dev:<uid>` for a development token. Stored as users.firebase_uid. */
  uid: string;
  email: string | null;
  emailVerified: boolean;
  kind: 'firebase' | 'dev';
  /**
   * When the user last signed in (the token's `auth_time`, epoch ms): a refreshed token keeps it, a sign-in
   * or a re-authentication moves it on. Null for a development token, which has none.
   */
  signedInAt: number | null;
}

/**
 * - invalid: forged, malformed, for another project, refused here (a dev token in production);
 * - expired: was good, ran out (the app refreshes it);
 * - unavailable: can't be checked right now (Google's keys unreachable).
 */
export type TokenFailure = 'invalid' | 'expired' | 'unavailable';

export type VerifyResult =
  { ok: true; token: VerifiedToken } | { ok: false; failure: TokenFailure; message: string };

export interface TokenVerifier {
  /** The Firebase project whose tokens are taken, or null (none). */
  readonly projectId: string | null;
  /** Development tokens are taken (never in production). */
  readonly devTokens: boolean;
  verifyIdToken(token: string): Promise<VerifyResult>;
}

export interface TokenVerifierOptions {
  projectId: string | null;
  devTokens: boolean;
  now: () => number;
  /** Where the public keys come from. Default: Google's securetoken key set, cached (./googleKeys). */
  keys?: JWTVerifyGetKey;
  clockSkewSec?: number;
}

const fail = (failure: TokenFailure, message: string): VerifyResult => ({ ok: false, failure, message });

export const firebaseIssuer = (projectId: string) => `https://securetoken.google.com/${projectId}`;

export function createTokenVerifier({
  projectId,
  devTokens,
  now,
  keys,
  clockSkewSec = DEFAULT_CLOCK_SKEW_SEC,
}: TokenVerifierOptions): TokenVerifier {
  const getKey = keys ?? (projectId !== null ? googleKeys({ now }).getKey : null);

  async function verifyFirebase(token: string): Promise<VerifyResult> {
    if (projectId === null || getKey === null) {
      return fail('invalid', 'Firebase sign-in is not set up on this server (FIREBASE_PROJECT_ID)');
    }
    let kid: unknown;
    try {
      kid = decodeProtectedHeader(token).kid;
    } catch {
      return fail('invalid', 'not a JWT');
    }
    if (typeof kid !== 'string' || kid === '') return fail('invalid', 'no key id (kid)');
    try {
      const nowSec = now() / 1000;
      const { payload } = await jwtVerify(token, getKey, {
        algorithms: ['RS256'],
        issuer: firebaseIssuer(projectId),
        audience: projectId,
        clockTolerance: clockSkewSec,
        currentDate: new Date(now()),
        requiredClaims: ['exp', 'iat', 'sub', 'auth_time'],
      });
      const { sub, iat, auth_time: authTime, email, email_verified: emailVerified } = payload;
      if (typeof sub !== 'string' || sub === '' || sub.length > MAX_UID_LENGTH) {
        return fail('invalid', 'no subject (sub)');
      }
      if (typeof iat !== 'number' || iat > nowSec + clockSkewSec) {
        return fail('invalid', 'issued in the future (iat)');
      }
      if (typeof authTime !== 'number' || authTime > nowSec + clockSkewSec) {
        return fail('invalid', 'signed in in the future (auth_time)');
      }
      return {
        ok: true,
        token: {
          uid: sub,
          email: typeof email === 'string' && email !== '' ? email : null,
          emailVerified: emailVerified === true,
          kind: 'firebase',
          signedInAt: authTime * 1000,
        },
      };
    } catch (err) {
      if (err instanceof errors.JWTExpired) return fail('expired', 'the token has expired');
      if (err instanceof KeysUnavailableError) return fail('unavailable', err.message);
      if (err instanceof errors.JOSEError) return fail('invalid', `${err.code}: ${err.message}`);
      throw err;
    }
  }

  return {
    projectId,
    devTokens,
    verifyIdToken(token) {
      if (token === '' || token.length > MAX_TOKEN_LENGTH) {
        return Promise.resolve(fail('invalid', 'empty or too long'));
      }
      const dev = parseDevToken(token);
      if (dev !== null) {
        if (!devTokens) return Promise.resolve(fail('invalid', 'development tokens are refused here'));
        return Promise.resolve({
          ok: true,
          token: {
            uid: `dev:${dev.uid}`,
            email: dev.email,
            emailVerified: dev.email !== null,
            kind: 'dev',
            signedInAt: null,
          },
        });
      }
      return verifyFirebase(token);
    },
  };
}

/**
 * The verifier for these settings: Firebase tokens of FIREBASE_PROJECT_ID (when set), and development tokens
 * outside production.
 */
export function tokenVerifierFor(
  config: Pick<ServerConfig, 'nodeEnv' | 'firebaseProjectId'>,
  now: () => number,
  keys?: JWTVerifyGetKey,
): TokenVerifier {
  return createTokenVerifier({
    projectId: config.firebaseProjectId,
    devTokens: config.nodeEnv !== 'production',
    now,
    keys,
  });
}

/**
 * The token of an `Authorization: Bearer <token>` header; undefined without one (or with another scheme).
 * The scheme is matched without case (RFC 9110).
 */
export function bearerToken(header: string | undefined): string | undefined {
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? '');
  return m?.[1];
}
