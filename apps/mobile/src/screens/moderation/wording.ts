import { MAX_BLOCKS } from '@sudoku-fight/protocol';
import type { TFunction } from 'i18next';

import { isModerationApiError, isModerationOffline } from '../../api/moderationApi';

/**
 * What to tell the player when a report or a block fails (spec §3.5; protocol moderation.ts), in the app's
 * language. Pure, so the tests check each case without a screen.
 */

export type ModerationT = TFunction<'moderation'>;

const MINUTE_MS = 60_000;

/** Whole minutes until `retryAt` (at least 1), from the body's retryAt or Retry-After; null when neither says. */
export function minutesUntil(error: unknown, now: number): number | null {
  if (!isModerationApiError(error)) return null;
  const at = error.body?.retryAt;
  const ms = typeof at === 'number' ? at - now : error.retryAfterMs;
  if (ms === null || !Number.isFinite(ms)) return null;
  return Math.max(1, Math.ceil(ms / MINUTE_MS));
}

/** A failed report: the quota (with when the next may go), a suspended account, yourself, a gone player, offline. */
export function reportErrorText(t: ModerationT, error: unknown, now: number): string {
  if (!isModerationApiError(error)) return t('report.errors.failed');
  switch (error.code) {
    case 'rateLimited': {
      const minutes = minutesUntil(error, now);
      return minutes === null ? t('report.errors.busy') : t('report.errors.rateLimited', { count: minutes });
    }
    case 'tooManyRequests':
      return t('report.errors.busy');
    case 'suspended':
      return t('report.errors.suspended');
    case 'self':
      return t('report.errors.self');
    case 'notFound':
      return t('report.errors.notFound');
    default:
      return isModerationOffline(error) ? t('report.errors.offline') : t('report.errors.failed');
  }
}

/** A failed block (or unblock): the limit (with the number), yourself, a gone player, offline. */
export function blockErrorText(t: ModerationT, error: unknown, unblock: boolean): string {
  const failed = unblock ? t('block.errors.unblockFailed') : t('block.errors.failed');
  if (!isModerationApiError(error)) return failed;
  switch (error.code) {
    case 'limitReached': {
      const max = error.body?.max ?? MAX_BLOCKS;
      return t('block.errors.limitReached', { count: max, max });
    }
    case 'self':
      return t('block.errors.self');
    case 'notFound':
      return unblock ? failed : t('block.errors.notFound');
    case 'tooManyRequests':
      return t('block.errors.busy');
    default:
      if (isModerationOffline(error))
        return unblock ? t('block.errors.unblockOffline') : t('block.errors.offline');
      return failed;
  }
}
