// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { RENAME_COOLDOWN_MS } from '@sudoku-fight/protocol';
import { render } from '@testing-library/react-native';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { AccountApiError } from '../../../api/accountApi';
import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { installSignedInPlayer, TEST_PLAYER, type TestAuth } from '../../../auth/testing/testAuth';
import { AuthError } from '../../../auth/types';
import { ltr } from '../../../components/player';
import { useToast } from '../../../components/ui';
import i18n from '../../../i18n';
import { renameDate } from '../EditProfileScreen';
import { SplashScreen } from '../SplashScreen';
import { renderAccount } from '../testing/accountTesting';

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };
let auth: TestAuth;

async function signedIn(player: Parameters<typeof installSignedInPlayer>[0] = {}) {
  auth = await installSignedInPlayer(player);
  await initAuth();
  expect(useAuth.getState().status).toBe('ready');
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useToast.getState().clear();
});
afterEach(() => setAuthDeps(null));

describe('Edit profile [D20, D21]', () => {
  it('the avatar any time: only what changed is sent, then a toast and back', async () => {
    await signedIn();
    await renderAccount('/edit-profile');
    expect(screen.getByRole('header', { name: 'עריכת פרופיל' })).toBeOnTheScreen();
    expect(screen.getByTestId('edit-name')).toHaveProp('value', 'Tester');
    expect(screen.getByRole('button', { name: 'מדינה: ישראל' })).toBeOnTheScreen();
    // Nothing changed yet.
    expect(screen.getByTestId('edit-save')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true }),
    );

    await fireEvent.press(screen.getByTestId('avatar-picker-av09'));
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(useAuth.getState().me?.avatarId).toBe('av09'));
    expect(auth.server.calls.at(-1)).toBe('PATCH /v1/me {"avatarId":"av09"}');
    expect(useToast.getState().current?.message).toBe('הפרופיל נשמר');
  });

  it('the name: once, then locked with the date of the next change', async () => {
    await signedIn();
    await renderAccount('/edit-profile');
    expect(screen.getByTestId('edit-name-hint')).toHaveTextContent('אפשר לשנות שם פעם ב־30 יום.');
    // The own name needs no check.
    expect(screen.getByTestId('edit-name-status-current', hidden)).toHaveTextContent('השם שלך');
    await fireEvent.changeText(screen.getByTestId('edit-name'), 'NewName');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await screen.findByTestId('edit-name-status-available', hidden);
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(useAuth.getState().me?.displayName).toBe('NewName'));
    const next = useAuth.getState().me!.nextRenameAt!;
    expect(next - useAuth.getState().me!.displayNameChangedAt!).toBe(RENAME_COOLDOWN_MS);
  });

  it('a locked name shows until when', async () => {
    await signedIn();
    // The server renames on the app's clock (Jest's fake Date).
    auth.server.setNow(Date.now());
    await auth.server.api.updateMe({ displayName: 'Renamed' });
    await act(async () => {
      await useAuth.setState({ me: await auth.server.api.getMe() });
    });
    await renderAccount('/edit-profile');
    const next = useAuth.getState().me!.nextRenameAt!;
    expect(screen.getByTestId('edit-name-locked')).toHaveProp('editable', false);
    expect(screen.getByTestId('edit-name-locked-hint')).toHaveTextContent(
      `אפשר לשנות שם פעם ב־30 יום. השינוי הבא: ${renameDate(next, 'he')}.`,
    );
  });

  it('a name taken meanwhile and the server unreachable each say so', async () => {
    await signedIn();
    await renderAccount('/edit-profile');
    await fireEvent.changeText(screen.getByTestId('edit-name'), 'Fresh1');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await screen.findByTestId('edit-name-status-available', hidden);
    auth.server.takeName('fresh1');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-name-error')).toHaveTextContent('השם הזה תפוס. בחר שם אחר.');

    await fireEvent.press(screen.getByTestId('avatar-picker-av03'));
    await fireEvent.changeText(screen.getByTestId('edit-name'), 'Tester');
    auth.server.setOffline(true);
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-alert')).toHaveTextContent(
      'אין חיבור לשרת. אפשר לערוך כשיהיה חיבור.',
    );
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await signedIn();
    await renderAccount('/edit-profile');
    expect(screen.getByRole('header', { name: 'Edit profile' })).toBeOnTheScreen();
    expect(screen.getByTestId('edit-name-hint')).toHaveTextContent(
      'You can change your name once every 30 days.',
    );
    expect(screen.getByRole('button', { name: 'Country: Israel' })).toBeOnTheScreen();
  });
});

describe('Verify email [D22]', () => {
  it('says where the link went, sends it again, and "I verified" checks', async () => {
    await signedIn({ emailVerified: false });
    const app = await renderAccount('/verify-email');
    expect(screen.getByTestId('verify-body')).toHaveTextContent(
      `שלחנו קישור אימות אל ${ltr(TEST_PLAYER.email)}. פתח אותו, וחזור לכאן.`,
    );
    expect(screen.getByText('האימון זמין גם בלי אימות. משחק מדורג ידרוש מייל מאומת.')).toBeOnTheScreen();
    expect(screen.getByTestId('verify-dev-note')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'שלח שוב' }));
    expect(await screen.findByTestId('verify-note')).toHaveTextContent('שלחנו קישור חדש');

    await fireEvent.press(screen.getByRole('button', { name: 'אימתתי' }));
    await waitFor(() => expect(useAuth.getState().user?.emailVerified).toBe(true));
    expect(useToast.getState().current?.message).toBe('המייל אומת. תודה!');
    expect(app.pathname()).toBe('/');
  });

  it('not verified yet: says so and stays', async () => {
    await signedIn({ emailVerified: false });
    auth.provider.reloadUser = async () => auth.provider.currentUser()!;
    await renderAccount('/verify-email');
    await fireEvent.press(screen.getByRole('button', { name: 'אימתתי' }));
    expect(await screen.findByTestId('verify-note')).toHaveTextContent('המייל עוד לא אומת. פתחת את הקישור?');
  });

  it('a failure to send: says why', async () => {
    await signedIn({ emailVerified: false });
    auth.provider.sendEmailVerification = async () => {
      throw new AuthError('tooManyRequests');
    };
    await renderAccount('/verify-email');
    await fireEvent.press(screen.getByRole('button', { name: 'שלח שוב' }));
    expect(await screen.findByTestId('verify-alert')).toHaveTextContent(/יותר מדי ניסיונות/);
  });
});

describe('Settings: the account (spec §3.3, §23)', () => {
  it('shows who is signed in, and opens the profile', async () => {
    await signedIn();
    const app = await renderAccount('/settings');
    expect(screen.getByTestId('account-settings-email')).toHaveTextContent(
      `מחובר כ־${ltr(TEST_PLAYER.email)}`,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'עריכת פרופיל' }));
    expect(app.pathname()).toBe('/edit-profile');
  });

  it('"התנתקות" asks first, then signs out', async () => {
    await signedIn();
    await renderAccount('/settings');
    await fireEvent.press(screen.getByTestId('settings-sign-out'));
    const dialog = await screen.findByTestId('sign-out-confirm');
    expect(within(dialog).getByRole('header', { name: 'להתנתק?' })).toBeOnTheScreen();
    await fireEvent.press(within(dialog).getByTestId('sign-out-confirm-cancel'));
    expect(useAuth.getState().status).toBe('ready');

    await fireEvent.press(screen.getByTestId('settings-sign-out'));
    await fireEvent.press(
      within(await screen.findByTestId('sign-out-confirm')).getByTestId('sign-out-confirm-confirm'),
    );
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
  });

  it('"מחיקת חשבון": the warning, the password (a wrong one deletes nothing), then the deletion', async () => {
    await signedIn();
    await renderAccount('/settings');
    await fireEvent.press(screen.getByRole('button', { name: 'מחיקת חשבון' }));
    const warning = await screen.findByTestId('delete-confirm');
    expect(within(warning).getByText(/אי אפשר לבטל את זה/)).toBeOnTheScreen();
    await fireEvent.press(within(warning).getByTestId('delete-confirm-confirm'));

    const ask = await screen.findByTestId('delete-password');
    expect(
      within(ask).getByText(`כדי למחוק את החשבון, כתוב את הסיסמה של ${ltr(TEST_PLAYER.email)}.`),
    ).toBeOnTheScreen();
    await fireEvent.press(within(ask).getByTestId('delete-password-confirm'));
    expect(within(ask).getByTestId('delete-password-input-error')).toHaveTextContent('כתוב את הסיסמה');

    await fireEvent.changeText(within(ask).getByTestId('delete-password-input'), 'Wrong1234');
    await fireEvent.press(within(ask).getByTestId('delete-password-confirm'));
    expect(await within(ask).findByTestId('delete-password-input-error')).toHaveTextContent(/הסיסמה שגויה/);
    expect(auth.server.users.size).toBe(1);

    await fireEvent.changeText(within(ask).getByTestId('delete-password-input'), TEST_PLAYER.password);
    await fireEvent.press(within(ask).getByTestId('delete-password-confirm'));
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
    expect(auth.server.users.size).toBe(0);
    expect(useToast.getState().current).toMatchObject({ variant: 'success', message: 'החשבון נמחק' });
  });

  it('the server unreachable: nothing is deleted, and the dialog says so', async () => {
    await signedIn();
    await renderAccount('/settings');
    auth.server.failNext('deleteMe', new AccountApiError('unavailable', 503));
    await fireEvent.press(screen.getByRole('button', { name: 'מחיקת חשבון' }));
    await fireEvent.press(
      within(await screen.findByTestId('delete-confirm')).getByTestId('delete-confirm-confirm'),
    );
    const ask = await screen.findByTestId('delete-password');
    await fireEvent.changeText(within(ask).getByTestId('delete-password-input'), TEST_PLAYER.password);
    await fireEvent.press(within(ask).getByTestId('delete-password-confirm'));
    expect(await within(ask).findByTestId('delete-alert')).toHaveTextContent(
      'השרת לא זמין כרגע. נסה שוב בעוד רגע.',
    );
    expect(useAuth.getState().status).toBe('ready');
    expect(auth.server.users.size).toBe(1);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await signedIn();
    await renderAccount('/settings');
    expect(screen.getByText('Account')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen();
  });
});

describe('Splash (spec §4.1 #1)', () => {
  it('loading: the brand, the tagline, the progress and a tip that changes', async () => {
    await signedIn();
    jest.useFakeTimers();
    await render(<SplashScreen />);
    expect(screen.getByRole('header', { name: 'סודוקו פייט' })).toBeOnTheScreen();
    expect(screen.getByText('לוח אחד. כולם פותרים. רק אחד מנצח.')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'טוען את הזירה…' })).toBeOnTheScreen();
    const first = screen.getByTestId('splash-tip').props.children as string;
    await act(async () => {
      jest.advanceTimersByTime(4_000);
    });
    expect(screen.getByTestId('splash-tip').props.children).not.toBe(first);
    jest.useRealTimers();
  });

  it('a profile that could not load: the reason, "נסה שוב" and "התנתקות"', async () => {
    auth = await installSignedInPlayer();
    auth.server.setOffline(true);
    await initAuth();
    await render(<SplashScreen />);
    expect(screen.getByTestId('splash-error')).toHaveTextContent(/לא הצלחנו לטעון את הלוחם שלך/);
    expect(screen.getByText('אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.')).toBeOnTheScreen();
    auth.server.setOffline(false);
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
  });

  it('…or sign out from there', async () => {
    auth = await installSignedInPlayer();
    auth.server.setOffline(true);
    await initAuth();
    await render(<SplashScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'התנתקות' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
  });
});
