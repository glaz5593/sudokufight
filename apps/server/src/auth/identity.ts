import type { ServerConfig } from '../config';

/**
 * Who is connecting (spec §21: "Firebase ID token on every connection; the server maps each room to a
 * user_id"). The game room asks an IdentityVerifier once per join, before a seat is reserved; its answer
 * stays with the connection (reconnections keep it).
 *
 * The verifiers:
 * - devIdentityVerifier(): outside production, takes the player's word for it (join options devUserId, name);
 * - refusingIdentityVerifier(): refuses everyone with a clear message;
 * - stage 8, accounts/identity.ts roomIdentityVerifier(): the ID token (`request.token`, which the SDK sends
 *   as `Authorization: Bearer …` when the app sets `client.auth.token`; never in the join options) → the live
 *   account → { users.id, display name }. Outside production a join without a token falls back to the dev
 *   identity; production takes Firebase tokens only. createAppServer wires it (app.ts gameDepsFor).
 *
 * defaultIdentityVerifier() below is for a room without the database (tests of the room alone).
 */

export interface Identity {
  /**
   * Stable and public: the player's id in the game (the engine's PlayerId), which every player in the room
   * sees in the events. Stage 8: the users.id of the account, not the Firebase uid.
   */
  userId: string;
  /** The display name shown on the cards. */
  name: string;
}

export interface IdentityRequest {
  /** The bearer token of the matchmaking request, if any (stage 8: a Firebase ID token). */
  token: string | undefined;
  /** The join or create options the client sent. */
  options: unknown;
  /** The client's address, when known. */
  ip: string | undefined;
}

export interface IdentityVerifier {
  /** For logs: which verifier is on. */
  readonly kind: string;
  /** The identity, or an IdentityError saying why not. */
  verify(request: IdentityRequest): Promise<Identity>;
}

export type IdentityErrorCode =
  /** Nothing to go on (no token, no dev identity). */
  | 'missing'
  /** A token or dev identity that does not hold up. */
  | 'invalid'
  /** Nobody can join here yet (production before stage 8). */
  | 'disabled';

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

/** A dev user id: 1–64 letters, digits, `_` or `-`. */
export const DEV_USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A display name (spec §3.1): 3–16 characters, Hebrew or English letters, digits, `_` and `.`. */
export const DISPLAY_NAME = /^[A-Za-z0-9_.א-ת]{3,16}$/;

/** Outside production: the join options say who it is (`devUserId`, `name`), after a format check. */
export function devIdentityVerifier(): IdentityVerifier {
  return {
    kind: 'dev',
    verify({ options }) {
      const o = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
      const { devUserId, name } = o;
      if (devUserId === undefined || name === undefined) {
        return Promise.reject(
          new IdentityError('missing', 'Join with { devUserId, name } (development identity, until stage 8)'),
        );
      }
      if (typeof devUserId !== 'string' || !DEV_USER_ID.test(devUserId)) {
        return Promise.reject(
          new IdentityError('invalid', 'devUserId: 1–64 characters, letters, digits, "_" or "-"'),
        );
      }
      if (typeof name !== 'string' || !DISPLAY_NAME.test(name)) {
        return Promise.reject(
          new IdentityError(
            'invalid',
            'name: 3–16 characters, Hebrew or English letters, digits, "_" or "." (spec §3.1)',
          ),
        );
      }
      return Promise.resolve({ userId: devUserId, name });
    },
  };
}

export const SIGN_IN_REQUIRED =
  'Sign-in required: this server takes Firebase accounts only (send the ID token as client.auth.token)';

/** Nobody joins (production without accounts). */
export function refusingIdentityVerifier(message = SIGN_IN_REQUIRED): IdentityVerifier {
  return {
    kind: 'refuse',
    verify: () => Promise.reject(new IdentityError('disabled', message)),
  };
}

/**
 * The verifier for these settings when there is no database: production refuses everyone, elsewhere the dev
 * identity. The real server uses accounts/identity.ts roomIdentityVerifier() instead.
 */
export function defaultIdentityVerifier(config: Pick<ServerConfig, 'nodeEnv'>): IdentityVerifier {
  return config.nodeEnv === 'production' ? refusingIdentityVerifier() : devIdentityVerifier();
}

/** What a verifier returned, checked again where it is used (client.auth is untyped in Colyseus). */
export function isIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) return false;
  const { userId, name } = value as Record<string, unknown>;
  return typeof userId === 'string' && userId !== '' && typeof name === 'string';
}
