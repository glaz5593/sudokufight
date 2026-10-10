/**
 * The small error code on a connection error (spec §16.3: "קוד שגיאה קטן לצורך תמיכה"), from any of the app's
 * request errors: one that already has a support code (OnlineError, MatchmakingFailure), or one with a `code`
 * and an HTTP `status` (ProgressApiError, HistoryApiError, AccountApiError): "unavailable-503", "network".
 * Only the app's own enumerated codes go in it, never a message, a token or a URL. Null when there is none.
 */
export function supportCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { supportCode?: unknown; code?: unknown; status?: unknown };
  if (typeof e.supportCode === 'string' && SAFE.test(e.supportCode)) return e.supportCode;
  if (typeof e.code !== 'string' || !SAFE.test(e.code)) return null;
  const status = typeof e.status === 'number' || typeof e.status === 'string' ? String(e.status) : '';
  return status && SAFE.test(status) ? `${e.code}-${status}` : e.code;
}

/** A code is a short word: letters, digits, "-", "_" and "/" ("auth/network-request-failed"). */
const SAFE = /^[\w/-]{1,64}$/;
