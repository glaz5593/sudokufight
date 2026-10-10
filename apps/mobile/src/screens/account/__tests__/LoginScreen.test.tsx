// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { AuthError } from '../../../auth/types';
import {
  installSignedInPlayer,
  installTestAuth,
  TEST_PLAYER,
  type TestAuth,
} from '../../../auth/testing/testAuth';
import { ltr } from '../../../components/player';
import { directionProblems } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { renderAccount } from '../testing/accountTesting';

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);

let auth: TestAuth;

/** A registered player, signed out, on the login screen. */
async function atLogin(): Promise<ReturnType<typeof renderAccount>> {
  auth = await installSignedInPlayer();
  await auth.provider.signOut();
  await initAuth();
  return renderAccount('/login');
}

const type = (testID: string, text: string) => fireEvent.changeText(screen.getByTestId(testID), text);
const submit = () => fireEvent.press(screen.getByTestId('login-submit'));

beforeEach(async () => {
  await i18n.changeLanguage('he');
});
afterEach(() => setAuthDeps(null));

describe('Login (spec §3.3)', () => {
  it('shows the title, the development mode, the fields and the ways out', async () => {
    await atLogin();
    expect(screen.getByRole('header', { name: 'חוזרים לזירה' })).toBeOnTheScreen();
    expect(screen.getByTestId('dev-mode-badge')).toHaveProp(
      'accessibilityLabel',
      'מצב פיתוח: חשבונות מקומיים במכשיר הזה בלבד, בלי Firebase',
    );
    expect(screen.getByLabelText('מייל')).toBeOnTheScreen();
    expect(screen.getByLabelText('סיסמה')).toHaveProp('secureTextEntry', true);
    expect(screen.getByRole('button', { name: 'שכחתי סיסמה' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'הרשמה' })).toBeOnTheScreen();
    // Emails and passwords read left to right in Hebrew too.
    expect(screen.getByTestId('login-email')).toHaveStyle({ writingDirection: 'ltr' });
    expect(screen.getByTestId('login-password')).toHaveStyle({ writingDirection: 'ltr' });
    expect(directionProblems(screen.getByTestId('login'))).toEqual([]);
  });

  it('the eye shows and hides the password', async () => {
    await atLogin();
    await fireEvent.press(screen.getByRole('button', { name: 'הצג סיסמה' }));
    expect(screen.getByTestId('login-password')).toHaveProp('secureTextEntry', false);
    await fireEvent.press(screen.getByRole('button', { name: 'הסתר סיסמה' }));
    expect(screen.getByTestId('login-password')).toHaveProp('secureTextEntry', true);
  });

  it('empty fields and a malformed email are caught before anything is sent', async () => {
    await atLogin();
    await submit();
    expect(screen.getByTestId('login-email-error')).toHaveTextContent('כתוב את המייל שלך');
    expect(screen.getByTestId('login-password-error')).toHaveTextContent('כתוב את הסיסמה');
    await type('login-email', 'mosheg@');
    await type('login-password', 'x');
    await submit();
    expect(screen.getByTestId('login-email-error')).toHaveTextContent('כתובת המייל לא תקינה');
    expect(screen.queryByTestId('login-password-error')).toBeNull();
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('a wrong password: under the password field', async () => {
    await atLogin();
    await type('login-email', TEST_PLAYER.email);
    await type('login-password', 'Wrong1234');
    await submit();
    expect(await screen.findByTestId('login-password-error')).toHaveTextContent(
      'הסיסמה שגויה. נסה שוב, או אפס אותה.',
    );
    expect(screen.getByLabelText(/^סיסמה, הסיסמה שגויה/)).toBeOnTheScreen();
  });

  it('an unknown address: under the email field', async () => {
    await atLogin();
    await type('login-email', 'nobody@example.com');
    await type('login-password', 'Arena1234');
    await submit();
    expect(await screen.findByTestId('login-email-error')).toHaveTextContent(
      'אין משתמש עם המייל הזה. אולי כדאי להירשם?',
    );
  });

  it('too many attempts: over the form', async () => {
    await atLogin();
    await type('login-email', TEST_PLAYER.email);
    await type('login-password', 'Wrong1234');
    for (let i = 0; i < 5; i++) {
      await submit();
      await screen.findByTestId('login-password-error');
    }
    await type('login-password', TEST_PLAYER.password);
    await submit();
    expect(await screen.findByTestId('login-alert')).toHaveTextContent(/יותר מדי ניסיונות/);
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('no network: over the form', async () => {
    await atLogin();
    auth.provider.signIn = async () => {
      throw new AuthError('network');
    };
    await type('login-email', TEST_PLAYER.email);
    await type('login-password', TEST_PLAYER.password);
    await submit();
    expect(await screen.findByTestId('login-alert')).toHaveTextContent(
      'אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב.',
    );
  });

  it('the server unreachable after the sign-in: over the form, still signed out', async () => {
    await atLogin();
    auth.server.setOffline(true);
    await type('login-email', TEST_PLAYER.email);
    await type('login-password', TEST_PLAYER.password);
    await submit();
    expect(await screen.findByTestId('login-alert')).toHaveTextContent(/אין חיבור לשרת/);
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('signs in: the status turns ready (the root layout then goes home)', async () => {
    await atLogin();
    await type('login-email', ` ${TEST_PLAYER.email} `);
    await type('login-password', TEST_PLAYER.password);
    await submit();
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(useAuth.getState().me?.displayName).toBe(TEST_PLAYER.displayName);
  });

  it('"שכחתי סיסמה" carries the typed email; "הרשמה" opens step 1', async () => {
    const app = await atLogin();
    await type('login-email', 'mosheg@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'שכחתי סיסמה' }));
    expect(app.pathname()).toBe('/forgot-password');
    expect(app.searchParams()).toEqual({ email: 'mosheg@example.com' });
    expect(screen.getByTestId('forgot-email')).toHaveProp('value', 'mosheg@example.com');

    await act(async () => {
      router.back();
    });
    await fireEvent.press(screen.getByRole('button', { name: 'הרשמה' }));
    expect(app.pathname()).toBe('/register/fighter');
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await atLogin();
    expect(screen.getByRole('header', { name: 'Back to the arena' })).toBeOnTheScreen();
    expect(screen.getByText('Development mode')).toBeOnTheScreen();
    await submit();
    expect(screen.getByTestId('login-email-error')).toHaveTextContent('Enter your email');
    await type('login-email', TEST_PLAYER.email);
    await type('login-password', 'Wrong1234');
    await submit();
    expect(await screen.findByTestId('login-password-error')).toHaveTextContent(
      'Wrong password. Try again, or reset it.',
    );
  });
});

describe('Forgot password [D22]', () => {
  beforeEach(() => {
    auth = installTestAuth();
  });

  it('asks for the email, then says to check the inbox (the same for any address)', async () => {
    await initAuth();
    await renderAccount('/forgot-password');
    expect(screen.getByRole('header', { name: 'שכחתי סיסמה' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('forgot-submit'));
    expect(screen.getByTestId('forgot-email-error')).toHaveTextContent('כתוב את המייל שלך');
    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'nobody@example.com');
    await fireEvent.press(screen.getByTestId('forgot-submit'));
    expect(await screen.findByTestId('forgot-sent')).toHaveTextContent(
      new RegExp(`אם יש משתמש עם ${ltr('nobody@example.com')}, שלחנו אליו קישור`),
    );
    // Development mode: no email leaves the phone, and the screen says so.
    expect(screen.getByTestId('forgot-dev-note')).toHaveTextContent('במצב פיתוח לא נשלח מייל.');
    expect(screen.getByRole('button', { name: 'חזרה להתחברות' })).toBeOnTheScreen();
  });

  it('no network: says so, and stays', async () => {
    auth.provider.sendPasswordReset = async () => {
      throw new AuthError('network');
    };
    await initAuth();
    await renderAccount('/forgot-password?email=a%40b.co');
    await fireEvent.press(screen.getByTestId('forgot-submit'));
    expect(await screen.findByTestId('forgot-alert')).toHaveTextContent(/אין חיבור לאינטרנט/);
    expect(screen.queryByTestId('forgot-sent')).toBeNull();
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await initAuth();
    await renderAccount('/forgot-password');
    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'bad');
    await fireEvent.press(screen.getByTestId('forgot-submit'));
    expect(screen.getByTestId('forgot-email-error')).toHaveTextContent(
      "That email address doesn't look right",
    );
    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'a@b.co');
    await fireEvent.press(screen.getByTestId('forgot-submit'));
    expect(await screen.findByText('Check your inbox')).toBeOnTheScreen();
  });
});
