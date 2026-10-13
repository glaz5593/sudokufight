import {
  ADMIN_API_PREFIX,
  ADMIN_AUTH_METHODS_PATH,
  ADMIN_GOOGLE_LOGIN_ERRORS,
  ADMIN_GOOGLE_LOGIN_PATH,
  ADMIN_LOGIN_PATH,
  type AdminAuthMethods,
  isAdminGoogleLoginErrorCode,
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
});
