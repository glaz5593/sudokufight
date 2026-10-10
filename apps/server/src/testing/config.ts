import { DEFAULT_CHEAT_THRESHOLDS, type ServerConfig } from '../config';

export const TEST_ADMIN_PASSWORD = 'test-admin-password';
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';
/** The Firebase project of tests: tokens are signed with keys the test makes (testing/tokens.ts). */
export const TEST_FIREBASE_PROJECT_ID = 'sudoku-fight-test';

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
      sessionSecret: TEST_SESSION_SECRET,
      devPassword: false,
    },
    adminTz: 'Asia/Jerusalem',
    trustProxy: false,
    firebaseProjectId: TEST_FIREBASE_PROJECT_ID,
    ratingOption: 'B',
    cheat: DEFAULT_CHEAT_THRESHOLDS,
    ...overrides,
  };
}
