import {
  ADMIN_API_PREFIX,
  ADMIN_AUTH_METHODS_PATH,
  ADMIN_GOOGLE_LOGIN_ERRORS,
  ADMIN_GOOGLE_LOGIN_PATH,
  ADMIN_LOGIN_PATH,
  ADMIN_QA_BUGS_PATH,
  ADMIN_QA_CATALOG_PATH,
  ADMIN_QA_PATH,
  ADMIN_QA_RUNS_PATH,
  adminQaItemPath,
  adminQaRunPath,
  type AdminAuthMethods,
  isAdminGoogleLoginErrorCode,
  QA_BUG_FILTERS,
  QA_ID_PATTERN,
} from './index';

describe('the admin API contract', () => {
  it('names the sign-in routes under /admin/api', () => {
    expect(ADMIN_API_PREFIX).toBe('/admin/api');
    expect([ADMIN_AUTH_METHODS_PATH, ADMIN_LOGIN_PATH, ADMIN_GOOGLE_LOGIN_PATH]).toEqual([
      '/auth/methods',
      '/login',
      '/login/google',
    ]);
  });

  it('lists the Google sign-in errors once each', () => {
    expect(new Set(ADMIN_GOOGLE_LOGIN_ERRORS).size).toBe(ADMIN_GOOGLE_LOGIN_ERRORS.length);
    expect(ADMIN_GOOGLE_LOGIN_ERRORS).toEqual(
      expect.arrayContaining(['invalidToken', 'wrongProvider', 'unverifiedEmail', 'notAllowed', 'disabled']),
    );
    for (const code of ADMIN_GOOGLE_LOGIN_ERRORS) expect(isAdminGoogleLoginErrorCode(code)).toBe(true);
    for (const other of ['unauthorized', 'not-allowed', '', null, 42, undefined])
      expect(isAdminGoogleLoginErrorCode(other)).toBe(false);
  });

  it('the auth methods carry the web config, and nothing that could list the admins', () => {
    const methods: AdminAuthMethods = {
      password: false,
      google: {
        apiKey: 'web-api-key',
        authDomain: 'sudoku-fight-1a2b3.firebaseapp.com',
        projectId: 'sudoku-fight-1a2b3',
        appId: null,
      },
    };
    expect(Object.keys(methods).sort()).toEqual(['google', 'password']);
    expect(Object.keys(methods.google!).sort()).toEqual(['apiKey', 'appId', 'authDomain', 'projectId']);
  });

  it("names the QA routes and builds a run's and a task's paths (the task id escaped)", () => {
    expect([ADMIN_QA_PATH, ADMIN_QA_CATALOG_PATH, ADMIN_QA_RUNS_PATH, ADMIN_QA_BUGS_PATH]).toEqual([
      '/qa',
      '/qa/catalog',
      '/qa/runs',
      '/qa/bugs',
    ]);
    expect(adminQaRunPath(7)).toBe('/qa/runs/7');
    expect(adminQaRunPath(7, 'close')).toBe('/qa/runs/7/close');
    expect(adminQaItemPath(7, 'friends-room-create', 'result')).toBe(
      '/qa/runs/7/items/friends-room-create/result',
    );
    expect(adminQaItemPath(12, 'a/b?c', 'fix')).toBe('/qa/runs/12/items/a%2Fb%3Fc/fix');
    expect(QA_BUG_FILTERS).toEqual(['active', 'open', 'handled', 'verified', 'reopened', 'all']);
    expect(['friends', 'a1-b2', '0x'].every((id) => QA_ID_PATTERN.test(id))).toBe(true);
    expect(['', '-a', 'A', 'a_b', 'א', 'a'.repeat(81)].some((id) => QA_ID_PATTERN.test(id))).toBe(false);
  });
});
