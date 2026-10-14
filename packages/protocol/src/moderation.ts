import type { PublicPlayer } from './progress';

/**
 * "Report a player" and "Block" (spec §3.5; App Store guideline 1.2 and Google Play's user-generated content
 * policy: display names are content players make). docs/store/UGC-PROPOSAL.md option A, approved by Moshe on
 * 2026-10-12 (DECISIONS-PENDING 1.2): a report with one of three reasons and no free text, answered within
 * REPORT_RESPONSE_HOURS; a block that lasts until it is lifted; and two admin actions (admin.ts).
 *
 * Every route takes the Firebase ID token (`Authorization: Bearer`). Bodies are JSON; times are epoch ms.
 *
 * Routes:
 *   POST   /v1/reports            ReportRequest → 201 ReportReceipt
 *          400 badRequest (field) | self · 403 suspended · 404 notRegistered | notFound · 409 duplicate
 *          (reportId) · 429 rateLimited (retryAt, Retry-After) | tooManyRequests
 *   GET    /v1/me/blocks                        → 200 BlockList
 *          404 notRegistered
 *   POST   /v1/me/blocks          BlockRequest  → 201 BlockedPlayer (new) · 200 BlockedPlayer (already blocked)
 *          400 badRequest (field) | self · 404 notRegistered | notFound · 409 limitReached (max)
 *   DELETE /v1/me/blocks/:playerId              → 204 (also when that player was not blocked)
 *          400 badRequest · 404 notRegistered
 * Every route may also answer 401 unauthorized (refresh the token, try once more) · 413 tooLarge · 429
 * tooManyRequests (wait Retry-After seconds) · 503 disabled | unavailable · 500 internal. Answers are personal:
 * `Cache-Control: no-store`.
 *
 * Reports:
 * - About another live account only: yourself → 400 `self`; no such account, or a deleted one → 404 `notFound`.
 * - `gameId` is optional context: kept when it names a ranked game both players sat in, otherwise dropped
 *   without an error (a report from inside a game that is still being stored still counts).
 * - One open report per reporter, player and reason. Sending the same one again while it is open is
 *   409 `duplicate`, with the open report's id: nothing new is stored, and the app shows the same thank-you
 *   as for a 201 (it is not idempotent on purpose: the answer says the report was already there). Another
 *   reason on the same player is a new report; so is the same reason once the first one is resolved, or
 *   DISMISSED_REPORT_COOLDOWN_DAYS after it was dismissed (before that it is 409 `duplicate` with the
 *   dismissed report's id: an admin looked and found nothing, and a report sent again at once would only put
 *   the player back in the queue).
 * - At most REPORTS_PER_HOUR reports an hour per account (stored ones, any status: a duplicate does not
 *   count) → 429 `rateLimited` with `retryAt` and Retry-After: when the oldest of them is an hour old.
 * - A suspended account can't report: 403 `suspended`.
 * - The reported player is never told who reported them. After a 201 or a 409 the app says: "Thanks. We will
 *   review the report within 48 hours" (REPORT_RESPONSE_HOURS; the terms of use say it too).
 *
 * Blocks (both directions count, whoever blocked whom):
 * - Matchmaking never puts the two in one game (2, 3 or 4 players).
 * - In a game that brings them together anyway (one that started before the block), the server mutes the
 *   blocked player's reactions for the one who blocked them: their `reaction` events reach that player with
 *   `emoji` MUTED_REACTION_EMOJI, so the event sequence stays whole. The app shows, plays and says nothing for
 *   such a reaction. Nobody is told about a block.
 * - Blocks never hide anyone from the leaderboard: it is public, and an offensive name is handled by a report.
 * - At most MAX_BLOCKS per account; a block of an account that is deleted goes with it.
 * - A suspended account may still block and unblock (a way to protect oneself, not an account change).
 */

export const MODERATION_PATHS = {
  reports: '/v1/reports',
  blocks: '/v1/me/blocks',
  block: '/v1/me/blocks/:playerId',
} as const;

export const blockPath = (playerId: string): string => `/v1/me/blocks/${encodeURIComponent(playerId)}`;

/** Why a player is reported: "שם פוגעני", "רמאות", "אחר". No free text, so a report is never new content. */
export const REPORT_REASONS = ['offensiveName', 'cheating', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const isReportReason = (v: unknown): v is ReportReason => REPORT_REASONS.includes(v as ReportReason);

/** Open, then closed by an admin: resolved (acted on) or dismissed (nothing to do). */
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Every report is reviewed within this many hours (the thank-you message and the terms of use). */
export const REPORT_RESPONSE_HOURS = 48;
/** Reports an account may send in an hour. */
export const REPORTS_PER_HOUR = 10;
/** The same report (player and reason) may be sent again this many days after an admin dismissed it. */
export const DISMISSED_REPORT_COOLDOWN_DAYS = 7;
/** Players an account may block. */
export const MAX_BLOCKS = 100;

/**
 * The `emoji` of a `reaction` event the server muted for its receiver (a player they blocked sent it). The
 * event still carries its seq and sender, so the receiver's state stays in step; show nothing for it.
 */
export const MUTED_REACTION_EMOJI = '';

/** A player id in a path or a body: users' UUIDs (and short ids in tests). */
export const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface ReportRequest {
  /** The reported player's id (users.id: the id in games, on the leaderboard and on the card). */
  playerId: string;
  reason: ReportReason;
  /** The ranked game it is about, when there is one. */
  gameId?: string;
}

export interface ReportReceipt {
  id: string;
  playerId: string;
  reason: ReportReason;
  status: 'open';
  /** The ranked game it is about, when the server kept one (see `gameId` above). */
  gameId: string | null;
  createdAt: number;
  /** REPORT_RESPONSE_HOURS: for the thank-you message. */
  respondWithinHours: number;
}

export interface BlockRequest {
  playerId: string;
}

/** A blocked player as their public card shows them (no email, nothing private). */
export interface BlockedPlayer extends PublicPlayer {
  blockedAt: number;
}

export interface BlockList {
  /** Newest first. Deleted accounts are not listed (their blocks went with them). */
  blocks: BlockedPlayer[];
  /** MAX_BLOCKS. */
  max: number;
}

export const MODERATION_ERROR_CODES = [
  /** 400: malformed body or path; `field` names what is at fault. */
  'badRequest',
  /** 400: reporting or blocking yourself. */
  'self',
  /** 401: no token, or a bad or expired one. Refresh the ID token and try once more. */
  'unauthorized',
  /** 403: this account is suspended (POST /v1/reports). */
  'suspended',
  /** 404: this sign-in has no account. */
  'notRegistered',
  /** 404: no such player (or a deleted one), or no such route. */
  'notFound',
  /**
   * 409: the same report (player and reason) is open already, or was dismissed in the last
   * DISMISSED_REPORT_COOLDOWN_DAYS; `reportId` is that report. Show the thank-you.
   */
  'duplicate',
  /** 409: MAX_BLOCKS players are blocked already; `max` says how many. */
  'limitReached',
  /** 413: the body is too big. */
  'tooLarge',
  /** 429: REPORTS_PER_HOUR reports in the last hour; `retryAt` (and Retry-After) says when another may go. */
  'rateLimited',
  /** 429: too many calls; wait `Retry-After` seconds. */
  'tooManyRequests',
  /** 500. */
  'internal',
  /** 503: accounts are off on this server. */
  'disabled',
  /** 503: the server can't check tokens right now. */
  'unavailable',
] as const;
export type ModerationErrorCode = (typeof MODERATION_ERROR_CODES)[number];

export type ModerationField = 'playerId' | 'reason' | 'gameId' | 'body';

export interface ModerationError {
  error: ModerationErrorCode;
  message?: string;
  /** badRequest: the field at fault. */
  field?: ModerationField;
  /** duplicate: the open report. */
  reportId?: string;
  /** rateLimited: when the next report may go. */
  retryAt?: number;
  /** limitReached: MAX_BLOCKS. */
  max?: number;
}
