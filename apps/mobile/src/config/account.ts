/**
 * Account settings of the app (spec §3, §23; work plan stage 8). Open decisions are settings here, so a
 * change is one line (CLAUDE.md).
 */
export const accountConfig = {
  /**
   * Spec §23 (both stores): the terms of use and the privacy policy, linked from the registration's checkbox
   * and the settings (config/legal.ts legalUrl). The game server serves them at /legal/… (stage 14); set
   * EXPO_PUBLIC_LEGAL_BASE_URL to serve them elsewhere (e.g. https://example.com/legal). Null: the server's.
   */
  legal: {
    baseUrl: process.env.EXPO_PUBLIC_LEGAL_BASE_URL ?? null,
  },
  /**
   * Spec §3.5: a suspended account is told how to reach us. EXPO_PUBLIC_SUPPORT_EMAIL, when set, is shown as text
   * (the address of the legal pages' contact section, the server's LEGAL_CONTACT_EMAIL); either way "פרטי קשר"
   * opens the terms of use at that section. Null: the link alone.
   */
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || null,
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
