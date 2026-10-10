/**
 * The leaderboard's page cursor (opaque to the app): the last row of a page, as "<rating>_<user id>". Pages
 * are a keyset on (rating descending, user id ascending), so a page starts right after that row whatever
 * changed meanwhile: rows that arrive or move elsewhere never shift it (no gaps or repeats the way an offset
 * would make them).
 */

export interface LeaderboardCursor {
  rating: number;
  userId: string;
}

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RATING = /^-?\d{1,9}(\.\d{1,12})?$/;

export const encodeLeaderboardCursor = ({ rating, userId }: LeaderboardCursor): string =>
  `${String(rating)}_${userId}`;

/** The cursor's parts, or null when `value` is not one this server made. */
export function decodeLeaderboardCursor(value: unknown): LeaderboardCursor | null {
  if (typeof value !== 'string') return null;
  const cut = value.indexOf('_');
  if (cut <= 0) return null;
  const rating = value.slice(0, cut);
  const userId = value.slice(cut + 1);
  if (!RATING.test(rating) || !USER_ID.test(userId)) return null;
  return { rating: Number(rating), userId };
}
