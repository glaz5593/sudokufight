import { GAME_TYPES, ratingKey, type RatingOption } from '@sudoku-fight/engine';

/**
 * The player's own account over HTTP (spec §3, §18 "HTTP API", §19): types, routes and the rules both sides
 * check, so the app shows the server's rules live while the player types.
 *
 * Who is calling: `Authorization: Bearer <Firebase ID token>` on every call. A build without Firebase
 * (development only) sends `dev:<uid>` instead (devToken()); servers in production refuse it.
 * One exception: GET /v1/names/available also works without a token, because step 1 of registration
 * ("create your fighter", spec §3.2) checks the name before the Firebase account exists (step 2). With a
 * token, the caller's own current name counts as available (a rename back to the same name).
 *
 * Routes (bodies are JSON; times are epoch ms):
 *   GET    /v1/names/available?name=…  → 200 NameAvailability
 *   POST   /v1/users   CreateUserRequest → 201 Me    · 409 alreadyRegistered | taken · 400 invalidName ·
 *                                                      422 blocked
 *   GET    /v1/me                        → 200 Me    · 404 notRegistered
 *   PATCH  /v1/me      UpdateMeRequest   → 200 Me    · 404 notRegistered · 409 renameTooSoon (nextRenameAt)
 *                                                      | taken · 400 invalidName · 422 blocked
 *   DELETE /v1/me                        → 204       · 404 notRegistered (already deleted: count it as done) ·
 *                                                      401 reauthRequired when the sign-in is older than
 *                                                      RECENT_SIGN_IN_MS (re-authenticate, then a fresh token)
 * Every route may answer:
 *   400 badRequest (malformed; `field` says which) · 401 unauthorized (no token, a bad or an expired one:
 *   refresh the token and try once more) · 413 tooLarge · 429 tooManyRequests (wait Retry-After seconds) ·
 *   503 disabled (this server has no Firebase project) or unavailable (it can't check tokens right now) ·
 *   500 internal.
 *
 * Deleting an account (spec §3.3, §23): the app re-authenticates, calls DELETE /v1/me with a token from after
 * that sign-in (getIdToken(true)), then deletes the Firebase user. The server wants the sign-in recent
 * (RECENT_SIGN_IN_MS), as Firebase does for deleting a user: a device left signed in for days can't delete the
 * account without the password. The server keeps the row (games keep their players) with deleted_at set, an
 * anonymous name and no email, and forgets the Firebase uid: the name is free again at once, and signing in
 * again (even with the same Firebase account, if its deletion failed) starts a fresh registration.
 */

// ---------------------------------------------------------------------------------------------------------
// Routes

export const ACCOUNT_PATHS = {
  namesAvailable: '/v1/names/available',
  users: '/v1/users',
  me: '/v1/me',
} as const;

/**
 * DELETE /v1/me needs a sign-in (the token's `auth_time`) at most this long ago: 5 minutes, Firebase's own
 * rule for deleting a user (the server's ACCOUNT_DELETE_MAX_AUTH_AGE_MS; this is its default). An older one is
 * refused with 401 `reauthRequired` and
 * `WWW-Authenticate: Bearer error="insufficient_user_authentication", max_age=300` (RFC 9470). A refreshed
 * token keeps the old sign-in time: re-authenticate first, then getIdToken(true). Development tokens have no
 * sign-in time: they pass outside production (where they are taken at all).
 */
export const RECENT_SIGN_IN_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------------
// Display names (spec §3.1)

/**
 * 3–16 characters: Hebrew or English letters, digits, `_` and `.`. Unique without regard to case (and to
 * Hebrew final letters, see normalizeForCompare). Offensive words are refused by the server only (its word
 * list is not shipped in the app), with `blocked`.
 */
export const NAME_RULES = {
  minLength: 3,
  maxLength: 16,
  /** One allowed character. א–ת includes the final forms (ך ם ן ף ץ). */
  char: /^[A-Za-z0-9_.א-ת]$/,
} as const;

export const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_.א-ת]{3,16}$/;

/** What is wrong with a name, in the order the app should mention it. */
export const DISPLAY_NAME_PROBLEMS = ['invalidChars', 'tooShort', 'tooLong'] as const;
export type DisplayNameProblem = (typeof DISPLAY_NAME_PROBLEMS)[number];

/** The characters of `name` that NAME_RULES does not allow, each once, in order. */
export function invalidNameChars(name: string): string[] {
  const bad = new Set<string>();
  for (const ch of name) if (!NAME_RULES.char.test(ch)) bad.add(ch);
  return [...bad];
}

/** null when `name` follows NAME_RULES as it is (no trimming: the app trims what the player typed). */
export function validateDisplayName(name: string): DisplayNameProblem | null {
  if (invalidNameChars(name).length > 0) return 'invalidChars';
  const length = [...name].length;
  if (length < NAME_RULES.minLength) return 'tooShort';
  if (length > NAME_RULES.maxLength) return 'tooLong';
  return null;
}

/** Hebrew final letters and their regular forms, position by position. */
export const HEBREW_FINAL_LETTERS = 'ךםןףץ';
export const HEBREW_REGULAR_LETTERS = 'כמנפצ';

/**
 * The form two names are compared in: English letters in lower case and Hebrew final letters as regular ones,
 * so "Dana" = "dana" and "דן" = "דנ". The server's unique index uses the same rule in SQL
 * (`translate(lower(name), 'ךםןףץ', 'כמנפצ')`); a test keeps the two equal.
 */
export function normalizeForCompare(name: string): string {
  let out = '';
  for (const ch of name) {
    const final = HEBREW_FINAL_LETTERS.indexOf(ch);
    if (final >= 0) out += HEBREW_REGULAR_LETTERS[final];
    else if (ch >= 'A' && ch <= 'Z') out += ch.toLowerCase();
    else out += ch;
  }
  return out;
}

/** D20: the display name changes at most once in this many days. The name chosen at registration is free. */
export const RENAME_COOLDOWN_DAYS = 30;
export const RENAME_COOLDOWN_MS = RENAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/** GET /v1/names/available: why a name can't be had. */
export type NameUnavailableReason = 'taken' | 'invalid' | 'blocked';

export interface NameAvailability {
  available: boolean;
  /** Set when `available` is false. */
  reason?: NameUnavailableReason;
  /** reason 'invalid': what is wrong (validateDisplayName). */
  problem?: DisplayNameProblem;
}

// ---------------------------------------------------------------------------------------------------------
// Avatars (spec §3.4)

/** The avatars a player can choose: av01–av51 without av36 (assets/avatars). */
// prettier-ignore
export const AVATAR_IDS = [
  'av01', 'av02', 'av03', 'av04', 'av05', 'av06', 'av07', 'av08', 'av09', 'av10',
  'av11', 'av12', 'av13', 'av14', 'av15', 'av16', 'av17', 'av18', 'av19', 'av20',
  'av21', 'av22', 'av23', 'av24', 'av25', 'av26', 'av27', 'av28', 'av29', 'av30',
  'av31', 'av32', 'av33', 'av34', 'av35', 'av37', 'av38', 'av39', 'av40',
  'av41', 'av42', 'av43', 'av44', 'av45', 'av46', 'av47', 'av48', 'av49', 'av50', 'av51',
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

/** "No avatar": what the app draws for a deleted account or a missing one. Never chosen, never stored. */
export const NO_AVATAR_ID = 'av00';

export const isAvatarId = (v: unknown): v is AvatarId => AVATAR_IDS.includes(v as AvatarId);

// ---------------------------------------------------------------------------------------------------------
// Countries (spec §3.1, D21: detected from the device, can be changed any time)

/**
 * ISO 3166-1 alpha-2: the 249 assigned codes, plus XK (Kosovo), the one user-assigned code that devices and
 * flag emoji use. Upper case.
 */
// prettier-ignore
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV',
  'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY',
  'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW',
  'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU',
  'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV',
  'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'XK',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export const isCountryCode = (v: unknown): v is CountryCode => COUNTRY_CODES.includes(v as CountryCode);

// ---------------------------------------------------------------------------------------------------------
// Ratings (spec §11.1, D7, D23)

/** Ranked games have 2–4 players. */
export const RATED_PLAYER_COUNTS = [2, 3, 4] as const;

/**
 * The rating keys an account has under the server's RATING_OPTION: B (default) one per game type
 * (fast, normal, hard); A one per game type and player count (fast-2p … hard-4p).
 */
export function ratingKeysFor(option: RatingOption): string[] {
  if (option === 'B') return GAME_TYPES.map((type) => ratingKey(type, 2, 'B'));
  return GAME_TYPES.flatMap((type) => RATED_PLAYER_COUNTS.map((n) => ratingKey(type, n, 'A')));
}

export interface RatingEntry {
  key: string;
  rating: number;
  games: number;
  /** The first 10 games of a key count double (spec §11.2). */
  provisional: boolean;
  peak: number;
}

// ---------------------------------------------------------------------------------------------------------
// Requests and answers

export interface CreateUserRequest {
  displayName: string;
  avatarId: AvatarId;
  country: CountryCode;
}

/** At least one field. Avatar and country change any time (D21); the name once in 30 days (D20). */
export interface UpdateMeRequest {
  displayName?: string;
  avatarId?: AvatarId;
  country?: CountryCode;
}

/** The signed-in player's own account. */
export interface Me {
  /** users.id: the player's public id (in games, on the leaderboard). Not the Firebase uid. */
  id: string;
  displayName: string;
  /** NO_AVATAR_ID only for an account made outside the app (sample data) without a valid one. */
  avatarId: AvatarId | typeof NO_AVATAR_ID;
  /** Null only for an account made outside the app (sample data) without a valid one. */
  country: CountryCode | null;
  /** From the sign-in (Firebase); null for a development account without one. */
  email: string | null;
  /** From the token of this very request [D22]. */
  emailVerified: boolean;
  createdAt: number;
  /** The last rename, null when the name is the one chosen at registration. */
  displayNameChangedAt: number | null;
  /** When the next rename is allowed; null: now. */
  nextRenameAt: number | null;
  /** One per rating key of the server's RATING_OPTION, in ratingKeysFor() order. */
  ratings: RatingEntry[];
}

export const ACCOUNT_ERROR_CODES = [
  /** 400: malformed body or query; `field` names the field at fault. */
  'badRequest',
  /** 400: the display name breaks NAME_RULES; `problem` says how. */
  'invalidName',
  /** 401: no token, or a bad or expired one. Refresh the ID token and try once more. */
  'unauthorized',
  /**
   * 401, DELETE /v1/me only: the sign-in is too old (RECENT_SIGN_IN_MS). A refreshed token does not help (it
   * keeps the sign-in time): re-authenticate (the password again), then call with getIdToken(true).
   */
  'reauthRequired',
  /** 404: this sign-in has no account (never registered, or deleted). Go to registration. */
  'notRegistered',
  /** 404: no such route. */
  'notFound',
  /** 409: this sign-in already has an account (POST /v1/users twice). */
  'alreadyRegistered',
  /** 409: someone else has this display name (or one that differs only in case or final letters). */
  'taken',
  /** 409: the name changed less than 30 days ago; `nextRenameAt` says when it may. */
  'renameTooSoon',
  /** 413: the body is too big. */
  'tooLarge',
  /** 422: the display name contains an offensive or reserved word. */
  'blocked',
  /** 429: too many calls; wait `Retry-After` seconds. */
  'tooManyRequests',
  /** 500. */
  'internal',
  /** 503: accounts are off on this server (production without a Firebase project). */
  'disabled',
  /** 503: the server can't check tokens right now (Google's keys unreachable). Try again later. */
  'unavailable',
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

export type AccountField = 'displayName' | 'avatarId' | 'country' | 'name' | 'body';

export interface AccountError {
  error: AccountErrorCode;
  message?: string;
  /** badRequest: the field at fault. */
  field?: AccountField;
  /** invalidName: what is wrong with the name. */
  problem?: DisplayNameProblem;
  /** renameTooSoon: when the name may change again. */
  nextRenameAt?: number;
}

// ---------------------------------------------------------------------------------------------------------
// Development tokens

/**
 * Builds without Firebase (development only) sign in locally and send `dev:<uid>` (or `dev:<uid>:<email>`)
 * as the bearer token. A server outside production takes the app's word for it; in production it is refused.
 */
export const DEV_TOKEN_PREFIX = 'dev:';
/** 1–64 letters, digits, `_` or `-`. */
export const DEV_UID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DEV_EMAIL = /^[^\s:@]{1,64}@[^\s:@]{1,189}$/;

export function devToken(uid: string, email?: string | null): string {
  if (!DEV_UID_PATTERN.test(uid)) throw new RangeError(`Bad dev uid: ${uid}`);
  if (email === undefined || email === null) return `${DEV_TOKEN_PREFIX}${uid}`;
  if (!DEV_EMAIL.test(email)) throw new RangeError(`Bad dev email: ${email}`);
  return `${DEV_TOKEN_PREFIX}${uid}:${email}`;
}

/** The uid (and email) of a development token, or null when `token` is not one. */
export function parseDevToken(token: string): { uid: string; email: string | null } | null {
  if (!token.startsWith(DEV_TOKEN_PREFIX)) return null;
  const rest = token.slice(DEV_TOKEN_PREFIX.length);
  const colon = rest.indexOf(':');
  const uid = colon < 0 ? rest : rest.slice(0, colon);
  const email = colon < 0 ? null : rest.slice(colon + 1);
  if (!DEV_UID_PATTERN.test(uid)) return null;
  if (email !== null && !DEV_EMAIL.test(email)) return null;
  return { uid, email };
}
