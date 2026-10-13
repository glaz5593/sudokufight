// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { render } from '@testing-library/react-native';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { useRegistrationDraft } from '../../../auth/registrationDraft';
import {
  installSignedInPlayer,
  installTestAuth,
  TEST_PLAYER,
  type TestAuth,
} from '../../../auth/testing/testAuth';
import { AuthError } from '../../../auth/types';
import { useToast } from '../../../components/ui';
import i18n from '../../../i18n';
import { renderAccount } from '../testing/accountTesting';
import { VerifyBanner } from '../VerifyEmailScreen';

/**
 * The error states of signing in and registering (work plan stage 13; spec §4.1 "מצבי שגיאה: התחברות (סיסמה
 * שגויה, מייל לא מאומת), הרשמה"), each in Hebrew and English: a wrong password under its field, no network
 * over the form, an address not verified yet (the sign-in works [D22]; Home's banner says so), a name taken
 * (as it is typed, and when the server takes it meanwhile), and no network while registering.
 */

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);

let auth: TestAuth;
const hidden = { includeHiddenElements: true };

const type = (testID: string, text: string) => fireEvent.changeText(screen.getByTestId(testID), text);

/** A registered player (verified or not), signed out, on the login screen. */
async function atLogin(emailVerified = true) {
  auth = await installSignedInPlayer({ emailVerified });
  await auth.provider.signOut();
  await initAuth();
  return renderAccount('/login');
}

async function signInAs(password: string = TEST_PLAYER.password) {
  await type('login-email', TEST_PLAYER.email);
  await type('login-password', password);
  await fireEvent.press(screen.getByTestId('login-submit'));
}

afterEach(() => setAuthDeps(null));

describe.each([
  {
    lang: 'he',
    wrong: 'הסיסמה שגויה. נסה שוב, או אפס אותה.',
    network: 'אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב.',
    unverified: 'המייל שלך עוד לא מאומת',
    serverDown: 'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.',
  },
  {
    lang: 'en',
    wrong: 'Wrong password. Try again, or reset it.',
    network: 'No internet connection. Check it and try again.',
    unverified: "Your email isn't verified yet",
    serverDown: "Can't reach the server. Check your internet and try again.",
  },
])('account errors in $lang (stage 13)', (words) => {
  beforeEach(async () => {
    await i18n.changeLanguage(words.lang);
    useRegistrationDraft.getState().reset();
    useToast.getState().clear();
  });

  it('login: a wrong password under its field; no network over the form', async () => {
    await atLogin();
    await signInAs('Wrong1234');
    expect(await screen.findByTestId('login-password-error')).toHaveTextContent(words.wrong);
    expect(useAuth.getState().status).toBe('signedOut');

    auth.provider.signIn = async () => {
      throw new AuthError('network');
    };
    await signInAs();
    expect(await screen.findByTestId('login-alert')).toHaveTextContent(words.network);
    expect(screen.queryByTestId('login-password-error')).toBeNull();
  });

  it('login with an address not verified yet: signed in (practice is open [D22]), and the banner says so', async () => {
    await atLogin(false);
    await signInAs();
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(useAuth.getState().user?.emailVerified).toBe(false);
    expect(screen.queryByTestId('login-alert')).toBeNull();
    await render(<VerifyBanner />);
    expect(screen.getByTestId('verify-banner')).toHaveTextContent(new RegExp(words.unverified));
  });

  it('register step 1: a taken name says so as it is typed, and can’t go on', async () => {
    auth = installTestAuth();
    await initAuth();
    auth.server.takeName('MosheG');
    const app = await renderAccount('/register/fighter');
    await fireEvent.changeText(screen.getByTestId('name'), 'mosheg');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await screen.findByTestId('name-status-taken', hidden);
    await fireEvent.press(screen.getByTestId('fighter-submit'));
    expect(app.pathname()).toBe('/register/fighter');
  });

  it('register step 2: no network says so over the form, and nothing is created', async () => {
    auth = installTestAuth();
    await initAuth();
    useRegistrationDraft.setState({ displayName: 'MosheG', avatarId: 'lava-lamp', country: 'IL' });
    auth.provider.signUp = async () => {
      throw new AuthError('network');
    };
    await renderAccount('/register/account');
    await type('account-email', 'moshe@example.com');
    await type('account-password', 'Arena1234');
    await type('account-confirm', 'Arena1234');
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByTestId('account-submit'));
    expect(await screen.findByTestId('account-alert')).toHaveTextContent(words.network);
    expect(useAuth.getState().status).toBe('signedOut');
    expect(auth.server.users.size).toBe(0);
  });

  it('register step 1 after the account: the server unreachable says so over the form', async () => {
    auth = installTestAuth();
    await auth.provider.signUp('half@example.com', 'Arena1234');
    setAuthDeps(auth.deps);
    await initAuth();
    await renderAccount('/register/fighter');
    await fireEvent.changeText(screen.getByTestId('name'), 'Racer');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await screen.findByTestId('name-status-available', hidden);
    auth.server.setOffline(true);
    await fireEvent.press(screen.getByTestId('fighter-submit'));
    expect(await screen.findByTestId('fighter-alert')).toHaveTextContent(words.serverDown);
    expect(useAuth.getState().status).toBe('needsProfile');
  });
});
