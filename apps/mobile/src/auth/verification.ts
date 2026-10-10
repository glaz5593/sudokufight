import { accountConfig } from '../config/account';
import type { AuthUser } from './types';

/**
 * [D22] What an unverified email may do (config/account.ts). Practice: always (verification never blocks
 * it). Ranked play (stage 9): only with a verified address while `requiredForRanked` is on; the matchmaking
 * screen asks this, and sends an unverified player to /verify-email.
 */
export interface VerificationPolicy {
  blocksPractice: boolean;
  requiredForRanked: boolean;
}

export function canPractice(
  user: AuthUser | null,
  config: VerificationPolicy = accountConfig.verification,
): boolean {
  return !config.blocksPractice || (user?.emailVerified ?? false);
}

export function canPlayRanked(
  user: AuthUser | null,
  config: VerificationPolicy = accountConfig.verification,
): boolean {
  if (!user) return false;
  return !config.requiredForRanked || user.emailVerified;
}
