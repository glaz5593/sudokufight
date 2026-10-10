/** Test helpers for the server (not shipped): a database, settings, a clock, the HTTP routes and games. */
export { fakeClock, type FakeClock } from './clock';
export { TEST_ADMIN_PASSWORD, TEST_SESSION_SECRET, testConfig } from './config';
export { createTestDb, type TestDb } from './db';
export { startHttp, type TestHttp } from './http';
export { adminLogin, type AdminClient, type ApiAnswer, getUrl, signedInAdmin } from './admin';
export {
  digitAt,
  emptyCells,
  NEARLY_DONE,
  PUZZLE,
  type QuietLog,
  quietLog,
  testPuzzles,
  wrongDigitAt,
} from './game';
