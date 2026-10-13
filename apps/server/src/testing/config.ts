import { RECENT_SIGN_IN_MS } from '@sudoku-fight/protocol';

import {
  type AdminGoogleSignIn,
  DEFAULT_CHEAT_THRESHOLDS,
  DEFAULT_PRACTICE_XP_DAILY_CAP,
  type ServerConfig,
} from '../config';

export const TEST_ADMIN_PASSWORD = 'test-admin-password';
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';
/** The Firebase project of tests: tokens are signed with keys the test makes (testing/tokens.ts). */
export const TEST_FIREBASE_PROJECT_ID = 'sudoku-fight-test';
/** An admin address for Google sign-in tests (example.com: never a real one). */
export const TEST_ADMIN_EMAIL = 'admin@example.com';
/** A made-up Firebase web API key of the right shape, built here so no key-like text sits in the repo. */
export const TEST_WEB_API_KEY = `AIza${'T'.repeat(35)}`;

/** Google sign-in for the admin site, for TEST_FIREBASE_PROJECT_ID and these addresses (lower case). */
export function testGoogleAdmin(allowedEmails: readonly string[] = [TEST_ADMIN_EMAIL]): AdminGoogleSignIn {
  return {
    web: {
      apiKey: TEST_WEB_API_KEY,
      authDomain: `${TEST_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: TEST_FIREBASE_PROJECT_ID,
      appId: '1:123456789012:web:0123456789abcdef',
    },
    allowedEmails,
  };
}

/**
 * Settings for tests: in-memory PGlite, the admin site on with TEST_ADMIN_PASSWORD, accounts on for
 * TEST_FIREBASE_PROJECT_ID (and dev tokens, outside production). Override what you need.
 */
export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    database: { kind: 'pglite', dataDir: null },
    admin: {
      enabled: true,
      password: TEST_ADMIN_PASSWORD,
      devPassword: false,
      google: null,
      sessionSecret: TEST_SESSION_SECRET,
    },
    adminTz: 'Asia/Jerusalem',
    trustProxy: false,
    firebaseProjectId: TEST_FIREBASE_PROJECT_ID,
    ratingOption: 'B',
    cheat: DEFAULT_CHEAT_THRESHOLDS,
    accountDeleteMaxAuthAgeMs: RECENT_SIGN_IN_MS,
    rankedRequiresVerifiedEmail: true,
    progress: { practiceXpDailyCap: DEFAULT_PRACTICE_XP_DAILY_CAP, inviteUrl: null },
    // No error reports from tests (src/monitoring/sentry.test.ts starts Sentry with a fake transport itself).
    sentry: null,
    ...overrides,
  };
}
