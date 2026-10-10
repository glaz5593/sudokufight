/**
 * Account settings of the app (spec §3, §23; work plan stage 8). Open decisions are settings here, so a
 * change is one line (CLAUDE.md).
 */
export const accountConfig = {
  /**
   * Spec §23 (both stores): the terms of use and the privacy policy, linked from the registration's
   * checkbox. PLACEHOLDERS until Moshe publishes the real pages; they must be real before store submission.
   */
  legal: {
    termsUrl: 'https://sudokufight.app/terms',
    privacyUrl: 'https://sudokufight.app/privacy',
  },
  /**
   * [D22] Email verification. Decision for V1 (spec §3.1 "נשלח מייל אימות", §16: practice works offline):
   * verification is sent at registration, but it never blocks signing in or practising. Home shows a
   * banner until the address is verified, with /verify-email to resend the link and check again.
   * `requiredForRanked`: ranked play (stage 9) may require a verified address; the matchmaking screen
   * reads this flag (canPlayRanked() in auth/verification.ts). Default true, so ranked games and the
   * leaderboard hold real, reachable accounts.
   */
  verification: {
    blocksPractice: false,
    requiredForRanked: true,
  },
  /** Work plan stage 8: the name check waits this long after the last keystroke. */
  nameCheckDebounceMs: 300,
  /** HTTP calls to the account API give up after this long (then: "no connection"). */
  requestTimeoutMs: 15_000,
} as const;

export type AccountConfig = typeof accountConfig;
