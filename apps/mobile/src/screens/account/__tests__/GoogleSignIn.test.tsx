// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { useRegistrationDraft } from '../../../auth/registrationDraft';
import { fakeGoogleIdToken } from '../../../auth/testing/fakeFirebase';
import {
  addGooglePlayer,
  type FirebaseTestAuth,
  installFirebaseTestAuth,
  installSignedInPlayer,
  installTestAuth,
} from '../../../auth/testing/testAuth';
import { ltr } from '../../../components/player';
import { LARGE_TEXT_SCALE, useToast } from '../../../components/ui';
import { directionProblems, PHONE, setWindow } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { track } from '../../../services/analytics';
import { size } from '../../../theme';
import { GOOGLE_BRAND } from '../../../theme/google';
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

/**
 * "המשך עם Google" on the screens (Moshe, 14.10.2026): shown only in a Firebase build with Google (never with the
 * development sign-in), Google's look in both languages, and the flows: login, registration step 2, step 1 for a
 * Google account new to the game, and the settings (the sign-in method, deletion with Google).
 */

const hidden = { includeHiddenElements: true };
type Node = ReturnType<typeof screen.getByTestId>;
const styleOf = (node: Node) => StyleSheet.flatten(node.props.style as object) as Record<string, unknown>;
const GOOGLE = 'המשך עם Google';

let auth: FirebaseTestAuth;

/** A Firebase build with Google, nobody signed in. */
async function firebaseBuild(options?: Parameters<typeof installFirebaseTestAuth>[0]) {
  auth = installFirebaseTestAuth(options);
  await initAuth();
}

/** The host elements under `node`, in drawing order. */
function hosts(node: Node, out: Node[] = []): Node[] {
  if (typeof node.type === 'string') out.push(node);
  for (const child of node.children) if (typeof child !== 'string') hosts(child, out);
  return out;
}

/** The fills of the SVG paths under `node` (the G: four, one per Google colour). */
const pathFills = (node: Node) =>
  hosts(node)
    .filter((n) => n.type === 'RNSVGPath')
    .map((n) => JSON.stringify((n.props as { fill?: unknown }).fill));

beforeEach(async () => {
  jest.mocked(track).mockClear();
  await i18n.changeLanguage('he');
  useRegistrationDraft.getState().reset();
  useToast.getState().clear();
});
afterEach(() => setAuthDeps(null));

describe('the button (Google branding guidelines, Android)', () => {
  it('the development sign-in shows no Google button on the login screen', async () => {
    installTestAuth();
    await initAuth();
    await renderAccount('/login');
    expect(screen.queryByRole('button', { name: GOOGLE })).toBeNull();
    expect(screen.queryByTestId('login-or')).toBeNull();
    expect(screen.getByTestId('dev-mode-badge')).toBeOnTheScreen();
  });

  it("a Firebase build without Google's client id shows none either", async () => {
    await firebaseBuild({ google: false });
    await renderAccount('/login');
    expect(screen.queryByRole('button', { name: GOOGLE })).toBeNull();
  });

  it("Google's dark button: the G at the start, the approved words, the app's button height", async () => {
    await firebaseBuild();
    await renderAccount('/login');
    const button = screen.getByRole('button', { name: GOOGLE });
    expect(button).toBe(screen.getByTestId('login-google'));
    expect(styleOf(button)).toMatchObject({
      minHeight: size.buttonMd,
      backgroundColor: GOOGLE_BRAND.dark.fill,
      borderColor: GOOGLE_BRAND.dark.stroke,
      borderWidth: 1,
    });
    expect(screen.getByTestId('login-google-label')).toHaveTextContent(GOOGLE);
    expect(styleOf(screen.getByTestId('login-google-label'))).toMatchObject({
      color: GOOGLE_BRAND.dark.text,
    });
    // The logo first (a plain row: the start, so the right in Hebrew), drawn in Google's four colours.
    const types = hosts(button).map((n) => String(n.type));
    const logo = types.findIndex((type) => type.startsWith('RNSVG'));
    expect(logo).toBeGreaterThanOrEqual(0);
    expect(logo).toBeLessThan(types.indexOf('Text'));
    expect(new Set(pathFills(button)).size).toBe(4);
    expect(directionProblems(screen.getByTestId('login'))).toEqual([]);
    // "או עם מייל" between Google and the form.
    expect(screen.getByTestId('login-or')).toHaveTextContent('או עם מייל');
  });

  it.each([
    [1, 1],
    [1.1, 1],
    [LARGE_TEXT_SCALE, 2],
    [2, 2],
  ] as const)(
    "at system text scale %d the words take up to %d line(s): never cut, as with the app's buttons",
    async (fontScale, lines) => {
      const restore = setWindow({ ...PHONE, fontScale });
      try {
        await i18n.changeLanguage('en');
        await firebaseBuild();
        await renderAccount('/login');
        const label = screen.getByTestId('login-google-label');
        expect(label).toHaveProp('numberOfLines', lines);
        expect(styleOf(label).textAlign).toBe(lines === 2 ? 'center' : undefined);
        // The app's button height stays the minimum; two lines make the button taller.
        const button = styleOf(screen.getByTestId('login-google'));
        expect(button.minHeight).toBe(size.buttonMd);
        expect(button.height).toBeUndefined();
      } finally {
        await restore();
      }
    },
  );

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await firebaseBuild();
    await renderAccount('/login');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeOnTheScreen();
    expect(screen.getByTestId('login-or')).toHaveTextContent('or with email');
  });
});

describe('login → "המשך עם Google"', () => {
  it('a Google account new to the game: signed in, on to step 1 (status needsProfile)', async () => {
    await firebaseBuild();
    await renderAccount('/login');
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    await waitFor(() => expect(useAuth.getState().status).toBe('needsProfile'));
    expect(useAuth.getState().user).toMatchObject({ email: 'gamer@gmail.com', methods: ['google'] });
    // Busy while it works: the button says so, and a second tap does nothing.
    expect(screen.getByTestId('login-google')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ busy: true }),
    );
  });

  it('a Google account with a fighter: ready (the root layout goes home)', async () => {
    await firebaseBuild();
    await addGooglePlayer(auth, { displayName: 'Veteran' });
    await renderAccount('/login');
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(useAuth.getState().me).toMatchObject({ displayName: 'Veteran' });
  });

  it('closing the chooser says nothing, and the button is ready again', async () => {
    await firebaseBuild();
    await renderAccount('/login');
    auth.google.state.next = 'cancel';
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    await waitFor(() =>
      expect(screen.getByTestId('login-google')).toHaveProp(
        'accessibilityState',
        expect.objectContaining({ busy: false }),
      ),
    );
    expect(screen.queryByTestId('login-alert')).toBeNull();
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it("a build Google doesn't know (DEVELOPER_ERROR): a plain message for the player, a report for the developer", async () => {
    await firebaseBuild();
    await renderAccount('/login');
    auth.google.state.next = { code: '10' };
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    expect(await screen.findByTestId('login-alert')).toHaveTextContent(
      'הכניסה עם Google לא זמינה כרגע בגרסה הזו של האפליקציה (DEVELOPER_ERROR). בינתיים אפשר להמשיך עם מייל וסיסמה.',
    );
    expect(screen.getByTestId('login-alert')).not.toHaveTextContent(/SHA-1|Firebase|מפתח/);
    // Crashlytics hears of it, with Google's own code: every player of such a build fails.
    expect(auth.reports.map(([where]) => where)).toEqual(['google.signIn: googleConfig (10)']);
  });

  it('an address with a password account: sign in with the password (nothing merged, nothing lost)', async () => {
    await firebaseBuild();
    await renderAccount('/login');
    auth.firebase.state.nextCredentialError = 'auth/account-exists-with-different-credential';
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    expect(await screen.findByTestId('login-alert')).toHaveTextContent(
      'למייל הזה כבר יש חשבון עם סיסמה. התחבר עם המייל והסיסמה.',
    );
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('a wrong password points at Google too (an address that signed up with Google has none)', async () => {
    await firebaseBuild();
    await renderAccount('/login');
    await fireEvent.changeText(screen.getByTestId('login-email'), 'gamer@gmail.com');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'Wrong1234');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('login-password-error')).toHaveTextContent(
      'הסיסמה שגויה. נסה שוב, או אפס אותה. נרשמת עם Google? לחץ על "המשך עם Google".',
    );
  });
});

describe('registration step 2 → "המשך עם Google"', () => {
  beforeEach(() => {
    useRegistrationDraft.setState({ displayName: 'Gamer', avatarId: 'fox', country: 'IL' });
  });

  it('the terms first (a dialog when unticked); then Google and the fighter of step 1', async () => {
    await firebaseBuild();
    await renderAccount('/register/account');
    expect(screen.getByTestId('account-or')).toHaveTextContent('או עם מייל וסיסמה');
    expect(directionProblems(screen.getByTestId('register-account'))).toEqual([]);

    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    const terms = await screen.findByTestId('terms-modal');
    expect(within(terms).getByRole('header', { name: 'תנאים ופרטיות' })).toBeOnTheScreen();
    expect(within(terms).getByRole('link', { name: 'תנאי השימוש' })).toBeOnTheScreen();
    expect(within(terms).getByRole('link', { name: 'מדיניות הפרטיות' })).toBeOnTheScreen();
    // "ביטול": nothing happens.
    await fireEvent.press(within(terms).getByTestId('terms-modal-cancel'));
    expect(auth.google.mod.GoogleSignin.signIn).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    await fireEvent.press(
      within(await screen.findByTestId('terms-modal')).getByTestId('terms-modal-confirm'),
    );
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(useAuth.getState().me).toMatchObject({ displayName: 'Gamer', avatarId: 'fox', country: 'IL' });
    expect(screen.getByRole('checkbox', hidden)).toHaveProp('accessibilityState', { checked: true });
    expect(track).toHaveBeenLastCalledWith('register_complete');
    // Verified by Google: no verification email.
    expect(auth.firebase.mod.sendEmailVerification).not.toHaveBeenCalled();
  });

  it("a second tap on the dialog's confirm (it stays pressable while it fades out) starts nothing", async () => {
    await firebaseBuild();
    await renderAccount('/register/account');
    // Google's chooser stays open until the player picks the account.
    let pick: (result: unknown) => void = () => undefined;
    auth.google.mod.GoogleSignin.signIn.mockImplementationOnce(
      () => new Promise((resolve) => (pick = resolve)) as never,
    );
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    const confirm = within(await screen.findByTestId('terms-modal')).getByTestId('terms-modal-confirm');
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    // Still the first attempt, busy, and nothing to say (no "already open" over the form).
    expect(screen.queryByTestId('account-alert')).toBeNull();
    expect(screen.getByTestId('account-google')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ busy: true }),
    );
    expect(auth.google.mod.GoogleSignin.signIn).toHaveBeenCalledTimes(1);
    await act(async () =>
      pick({
        type: 'success',
        data: {
          user: { id: 'google-1', email: 'gamer@gmail.com' },
          idToken: fakeGoogleIdToken('gamer@gmail.com'),
        },
      }),
    );
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(auth.server.calls.filter((call) => call === 'POST /v1/users')).toHaveLength(1);
  });

  it('with the terms ticked already, straight to Google', async () => {
    await firebaseBuild();
    await renderAccount('/register/account');
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(screen.queryByTestId('terms-modal')).toBeNull();
  });

  it('a Google account that already has a fighter: signed in, and a toast says so', async () => {
    await firebaseBuild();
    await addGooglePlayer(auth, { displayName: 'Veteran' });
    await renderAccount('/register/account');
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(useAuth.getState().me).toMatchObject({ displayName: 'Veteran' });
    // The toast names the fighter: one someone else made on this address (spec §3.3) doesn't pass as the player's.
    expect(useToast.getState().current).toMatchObject({
      variant: 'info',
      message: `לחשבון Google הזה כבר יש לוחם, ${ltr('Veteran')}. נכנסת אליו.`,
    });
    expect(track).not.toHaveBeenCalledWith('register_complete');
  });

  it('the name taken meanwhile: signed in with Google, back to step 1 with the same toast as email', async () => {
    await firebaseBuild();
    auth.server.takeName('gamer');
    await renderAccount('/register/account');
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    await waitFor(() => expect(useAuth.getState().status).toBe('needsProfile'));
    expect(useToast.getState().current?.message).toBe(
      `השם ${ltr('Gamer')} נתפס בינתיים. בחר שם אחר, והחשבון שלך מחכה.`,
    );
  });

  it('no server: nothing changed, and the form says so', async () => {
    await firebaseBuild();
    await renderAccount('/register/account');
    auth.server.setOffline(true);
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: GOOGLE }));
    expect(await screen.findByTestId('account-alert')).toHaveTextContent(
      'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.',
    );
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('an address that signed up with Google, typed with a password: "already in use" points at Google', async () => {
    await firebaseBuild();
    await renderAccount('/register/account');
    await fireEvent.changeText(screen.getByTestId('account-email'), 'taken@example.com');
    await fireEvent.changeText(screen.getByTestId('account-password'), 'Arena1234');
    await fireEvent.changeText(screen.getByTestId('account-confirm'), 'Arena1234');
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByTestId('account-submit'));
    expect(await screen.findByTestId('account-email-error')).toHaveTextContent(
      'המייל הזה כבר רשום. אפשר להתחבר איתו. אם נרשמת עם Google, לחץ על "המשך עם Google".',
    );
  });

  it('the development sign-in: no Google here either', async () => {
    installTestAuth();
    await initAuth();
    await renderAccount('/register/account');
    expect(screen.queryByRole('button', { name: GOOGLE })).toBeNull();
    expect(screen.queryByTestId('account-or')).toBeNull();
  });
});

describe('step 1 for a Google account new to the game (signed in from the login screen)', () => {
  async function typeName(name: string) {
    await fireEvent.changeText(screen.getByTestId('name'), name);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await screen.findByTestId('name-status-available', hidden);
  }

  it('says it is signed in with Google, asks for the terms once, then creates the fighter', async () => {
    await firebaseBuild();
    await auth.provider.google!.signIn();
    setAuthDeps(auth.deps);
    await initAuth();
    expect(useAuth.getState().status).toBe('needsProfile');
    await renderAccount('/register/fighter');
    expect(screen.getByTestId('fighter-resume')).toHaveTextContent('נכנסת עם Google. נשאר רק לבחור לוחם.');
    // This screen finishes the registration: no "step 1 of 2".
    expect(screen.queryByText(/שלב \d מתוך/)).toBeNull();

    await typeName('Gamer');
    await fireEvent.press(screen.getByRole('button', { name: 'היכנס לזירה' }));
    const terms = await screen.findByTestId('fighter-terms');
    expect(auth.server.users.size).toBe(0);
    await fireEvent.press(within(terms).getByTestId('fighter-terms-confirm'));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(useAuth.getState().me).toMatchObject({ displayName: 'Gamer' });
    expect(track).toHaveBeenLastCalledWith('register_complete');
  });

  /** A Google account new to the game, signed in from the login screen (status needsProfile). */
  async function signedInWithoutFighter() {
    await firebaseBuild();
    await auth.provider.google!.signIn();
    setAuthDeps(auth.deps);
    await initAuth();
    expect(useAuth.getState()).toMatchObject({ status: 'needsProfile', user: { uid: 'fbg-1' } });
  }

  it('this account accepted the terms already (step 2, just before a fighter that failed): no dialog', async () => {
    await signedInWithoutFighter();
    useRegistrationDraft.getState().acceptTermsFor('fbg-1');
    await renderAccount('/register/fighter');
    await typeName('Gamer');
    await fireEvent.press(screen.getByRole('button', { name: 'היכנס לזירה' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(screen.queryByTestId('fighter-terms')).toBeNull();
  });

  it("someone else's acceptance on this phone (another account, or none made) doesn't count", async () => {
    await signedInWithoutFighter();
    useRegistrationDraft.getState().acceptTermsFor('fb-uid-2');
    await renderAccount('/register/fighter');
    await typeName('Gamer');
    await fireEvent.press(screen.getByRole('button', { name: 'היכנס לזירה' }));
    expect(await screen.findByTestId('fighter-terms')).toBeOnTheScreen();
    expect(auth.server.users.size).toBe(0);
  });

  it("a second tap on the dialog's confirm creates the fighter once", async () => {
    await signedInWithoutFighter();
    await renderAccount('/register/fighter');
    await typeName('Gamer');
    await fireEvent.press(screen.getByRole('button', { name: 'היכנס לזירה' }));
    const confirm = within(await screen.findByTestId('fighter-terms')).getByTestId('fighter-terms-confirm');
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(auth.server.calls.filter((call) => call === 'POST /v1/users')).toHaveLength(1);
    expect(useRegistrationDraft.getState().termsAcceptedBy).toBeNull();
  });

  it('"התנתקות" without a fighter deletes the Google sign-in (its Google details stay nowhere)', async () => {
    await signedInWithoutFighter();
    await renderAccount('/register/fighter');
    await fireEvent.press(screen.getByRole('button', { name: 'התנתקות' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
    expect(auth.firebase.mod.deleteUser).toHaveBeenCalledTimes(1);
    expect(auth.google.mod.GoogleSignin.revokeAccess).toHaveBeenCalledTimes(1);
    expect(auth.provider.currentUser()).toBeNull();
    expect(auth.reports).toEqual([]);
  });

  it('a password account that left at step 1 keeps its account: "התנתקות" only signs out', async () => {
    await firebaseBuild();
    await auth.provider.signUp('new@example.com', 'Arena1234');
    setAuthDeps(auth.deps);
    await initAuth();
    expect(useAuth.getState()).toMatchObject({ status: 'needsProfile', user: { methods: ['password'] } });
    await renderAccount('/register/fighter');
    expect(screen.getByTestId('fighter-resume')).toHaveTextContent('החשבון שלך מוכן. נשאר רק לבחור לוחם.');
    await fireEvent.press(screen.getByRole('button', { name: 'התנתקות' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
    expect(auth.firebase.mod.deleteUser).not.toHaveBeenCalled();
    expect(auth.firebase.mod.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('settings: the sign-in method, and deletion with Google', () => {
  async function signedInWithGoogle() {
    await firebaseBuild();
    await addGooglePlayer(auth, { displayName: 'Gamer' });
    await auth.provider.google!.signIn();
    setAuthDeps(auth.deps);
    await initAuth();
    expect(useAuth.getState().status).toBe('ready');
  }

  it('shows "כניסה עם Google" with the G', async () => {
    await signedInWithGoogle();
    await renderAccount('/settings');
    const method = screen.getByTestId('account-settings-method');
    expect(method).toHaveTextContent('כניסה עם Google');
    expect(pathFills(method)).toHaveLength(4);
  });

  it('an email account: "כניסה עם מייל וסיסמה"', async () => {
    await installSignedInPlayer();
    await initAuth();
    await renderAccount('/settings');
    expect(screen.getByTestId('account-settings-method')).toHaveTextContent('כניסה עם מייל וסיסמה');
  });

  it('delete: the warning, then Google instead of a password (closing it deletes nothing), then gone', async () => {
    await signedInWithGoogle();
    await renderAccount('/settings');
    await fireEvent.press(screen.getByRole('button', { name: 'מחיקת חשבון' }));
    await fireEvent.press(
      within(await screen.findByTestId('delete-confirm')).getByTestId('delete-confirm-confirm'),
    );
    const ask = await screen.findByTestId('delete-google');
    expect(
      within(ask).getByText(`כדי למחוק את החשבון, בחר שוב את חשבון Google ‏${ltr('gamer@gmail.com')}.`),
    ).toBeOnTheScreen();
    // No password to type for a Google account.
    expect(screen.queryByTestId('delete-password-input')).toBeNull();

    auth.google.state.next = 'cancel';
    await fireEvent.press(within(ask).getByTestId('delete-google-confirm'));
    await waitFor(() => expect(auth.google.mod.GoogleSignin.signIn).toHaveBeenCalledTimes(3));
    expect(within(ask).queryByTestId('delete-google-alert')).toBeNull();
    expect(auth.server.users.size).toBe(1);

    await fireEvent.press(within(ask).getByTestId('delete-google-confirm'));
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
    expect(auth.server.users.size).toBe(0);
    expect(auth.google.mod.GoogleSignin.revokeAccess).toHaveBeenCalledTimes(1);
    expect(useToast.getState().current).toMatchObject({ variant: 'success', message: 'החשבון נמחק' });
    expect(jest.mocked(track).mock.calls.filter(([name]) => name === 'account_delete')).toHaveLength(1);
  });

  it('an account with Google and a password may confirm with the password instead (Google may fail here)', async () => {
    await firebaseBuild();
    await auth.provider.signUp('both@gmail.com', 'Arena1234');
    // A verified Gmail password account that later signed in with Google: Firebase linked the two.
    auth.firebase.state.currentUser!.emailVerified = true;
    auth.firebase.state.currentUser!.providerData.push({ providerId: 'google.com' });
    await auth.server.api.createUser({ displayName: 'Both', avatarId: 'sun', country: 'IL' });
    setAuthDeps(auth.deps);
    await initAuth();
    expect(useAuth.getState().user?.methods).toEqual(['password', 'google']);
    await renderAccount('/settings');
    expect(screen.getByTestId('account-settings-method')).toHaveTextContent(
      'כניסה עם Google, או עם מייל וסיסמה',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'מחיקת חשבון' }));
    await fireEvent.press(
      within(await screen.findByTestId('delete-confirm')).getByTestId('delete-confirm-confirm'),
    );
    const ask = await screen.findByTestId('delete-google');
    // Google refuses this build: the player isn't stuck.
    auth.google.state.next = { code: '10' };
    await fireEvent.press(within(ask).getByTestId('delete-google-confirm'));
    expect(await within(ask).findByTestId('delete-google-alert')).toHaveTextContent(/DEVELOPER_ERROR/);
    await fireEvent.press(within(ask).getByRole('button', { name: 'אישור עם הסיסמה במקום' }));
    const password = await screen.findByTestId('delete-password');
    await fireEvent.changeText(within(password).getByTestId('delete-password-input'), 'Arena1234');
    await fireEvent.press(within(password).getByTestId('delete-password-confirm'));
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
    expect(auth.server.users.size).toBe(0);
    expect(auth.firebase.mod.deleteUser).toHaveBeenCalledTimes(1);
  });

  it('a Google-only account has no password to fall back on', async () => {
    await signedInWithGoogle();
    await renderAccount('/settings');
    await fireEvent.press(screen.getByRole('button', { name: 'מחיקת חשבון' }));
    await fireEvent.press(
      within(await screen.findByTestId('delete-confirm')).getByTestId('delete-confirm-confirm'),
    );
    const ask = await screen.findByTestId('delete-google');
    expect(within(ask).queryByTestId('delete-google-use-password')).toBeNull();
  });

  it('delete: another Google account chosen says so, and deletes nothing', async () => {
    await signedInWithGoogle();
    await renderAccount('/settings');
    await fireEvent.press(screen.getByRole('button', { name: 'מחיקת חשבון' }));
    await fireEvent.press(
      within(await screen.findByTestId('delete-confirm')).getByTestId('delete-confirm-confirm'),
    );
    const ask = await screen.findByTestId('delete-google');
    auth.google.state.account = { email: 'other@gmail.com' };
    await fireEvent.press(within(ask).getByTestId('delete-google-confirm'));
    expect(await within(ask).findByTestId('delete-google-alert')).toHaveTextContent(
      'זה חשבון Google אחר. בחר את החשבון שאיתו נכנסת.',
    );
    expect(auth.server.users.size).toBe(1);
  });
});
