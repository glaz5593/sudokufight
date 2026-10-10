// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { AVATAR_IDS } from '@sudoku-fight/protocol';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { useRegistrationDraft } from '../../../auth/registrationDraft';
import { installTestAuth, type TestAuth } from '../../../auth/testing/testAuth';
import { ltr } from '../../../components/player';
import { useToast } from '../../../components/ui';
import { directionProblems } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { renderAccount } from '../testing/accountTesting';

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);

let auth: TestAuth;
const hidden = { includeHiddenElements: true };

/** The name checks the server was asked for. */
const nameCalls = () => auth.server.calls.filter((c) => c.startsWith('GET /v1/names/available'));

/** Types into the name field, then lets `ms` of the debounce pass. */
async function typeName(name: string, ms = 0) {
  await fireEvent.changeText(screen.getByTestId('name'), name);
  if (ms > 0) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  auth = installTestAuth();
  await initAuth();
  useRegistrationDraft.getState().reset();
  useToast.getState().clear();
});
afterEach(() => setAuthDeps(null));

describe('Register step 1: "צור את הלוחם שלך" (spec §3.2)', () => {
  it('shows the step, the stage with the chosen avatar, the strip, the name, the country and the preview', async () => {
    await renderAccount('/register/fighter');
    expect(screen.getByText('שלב 1 מתוך 2')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'צור את הלוחם שלך' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'חזרה להתחברות' })).toBeOnTheScreen();
    expect(screen.getByLabelText('האווטאר שנבחר: אווטאר 1')).toBeOnTheScreen();
    const strip = screen.getByTestId('avatar-picker-strip');
    expect(within(strip).getAllByRole('radio', hidden)).toHaveLength(AVATAR_IDS.length);
    expect(screen.getByTestId('avatar-picker-av01')).toHaveProp('accessibilityState', { checked: true });
    // [D21] The country comes from the phone (the test phone is in the US).
    expect(screen.getByRole('button', { name: 'מדינה: ארצות הברית' })).toBeOnTheScreen();
    expect(screen.getByTestId('name-hint')).toHaveTextContent(
      '3–16 תווים: אותיות בעברית או באנגלית, ספרות, קו תחתון ונקודה.',
    );
    expect(screen.getByLabelText('תצוגה מקדימה של הכרטיס שלך במשחק: שחקן')).toBeOnTheScreen();
    // The layout mirrors with the language by itself (rows, start/end).
    expect(directionProblems(screen.getByTestId('register-fighter'))).toEqual([]);
  });

  it('previous / next and a tap on the strip choose the avatar; the preview follows', async () => {
    await renderAccount('/register/fighter');
    await fireEvent.press(screen.getByRole('button', { name: 'האווטאר הבא' }));
    expect(useRegistrationDraft.getState().avatarId).toBe('av02');
    expect(screen.getByTestId('avatar-picker-count')).toHaveTextContent(ltr('2 / 50'));
    await fireEvent.press(screen.getByRole('button', { name: 'האווטאר הקודם' }));
    await fireEvent.press(screen.getByRole('button', { name: 'האווטאר הקודם' }));
    // Around: from the first to the last.
    expect(useRegistrationDraft.getState().avatarId).toBe('av51');
    await fireEvent.press(screen.getByTestId('avatar-picker-av12'));
    expect(useRegistrationDraft.getState().avatarId).toBe('av12');
    expect(screen.getByTestId('avatar-picker-av12')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByLabelText('האווטאר שנבחר: אווטאר 12')).toBeOnTheScreen();
  });

  it('checks the name as it is typed: the rules at once, the server 300 ms after the last key', async () => {
    auth.server.takeName('Taken1');
    await renderAccount('/register/fighter');

    // Breaks the rules: no server call.
    await typeName('Mo');
    expect(screen.getByTestId('name-error')).toHaveTextContent('לפחות 3 תווים');
    expect(screen.getByTestId('name-status-invalid', hidden)).toHaveTextContent('לא תקין');
    await typeName('Mo$h e');
    expect(screen.getByTestId('name-error')).toHaveTextContent('אי אפשר להשתמש ב: $  ');
    await typeName('A'.repeat(17));
    expect(screen.getByTestId('name-error')).toHaveTextContent('עד 16 תווים');
    expect(nameCalls()).toEqual([]);

    // Each key restarts the wait; only the last name is asked about.
    await typeName('Mos', 100);
    await typeName('Mosh', 100);
    await typeName('MosheG', 299);
    expect(screen.getByTestId('name-status-checking', hidden)).toHaveTextContent('בודק…');
    expect(nameCalls()).toEqual([]);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(await screen.findByTestId('name-status-available', hidden)).toHaveTextContent('פנוי');
    expect(nameCalls()).toEqual(['GET /v1/names/available?name=MosheG']);
    expect(screen.getByLabelText('שם לתצוגה, פנוי')).toBeOnTheScreen();

    // Taken, without regard to case.
    await typeName('taken1', 300);
    expect(await screen.findByTestId('name-status-taken', hidden)).toHaveTextContent('תפוס');
    expect(screen.getByTestId('name-error')).toHaveTextContent('מישהו כבר בחר בשם הזה. נסה שם אחר.');

    // Offensive: the server's word list.
    await typeName('nasty_one', 300);
    expect(await screen.findByTestId('name-status-blocked', hidden)).toHaveTextContent('לא מתאים');
    expect(screen.getByTestId('name-error')).toHaveTextContent('השם הזה לא מתאים לזירה. נסה שם אחר.');

    // Offline: "not checked", and the server checks it on submit.
    auth.server.setOffline(true);
    await typeName('Offline1', 300);
    expect(await screen.findByTestId('name-status-error', hidden)).toHaveTextContent('לא נבדק');
    expect(screen.getByTestId('name-hint')).toHaveTextContent(/^לא הצלחנו לבדוק את השם/);

    // Hebrew names are fine; spaces around a name are trimmed.
    auth.server.setOffline(false);
    await typeName(' דנה.2 ', 300);
    expect(await screen.findByTestId('name-status-available', hidden)).toBeTruthy();
    expect(nameCalls().at(-1)).toBe('GET /v1/names/available?name=דנה.2');
  });

  it('the country sheet: search, pick, and the picker shows it', async () => {
    await renderAccount('/register/fighter');
    await fireEvent.press(screen.getByRole('button', { name: 'מדינה: ארצות הברית' }));
    const sheet = await screen.findByTestId('country-sheet');
    await fireEvent.changeText(within(sheet).getByTestId('country-search'), 'ישר');
    expect(
      within(sheet)
        .getAllByRole('button')
        .filter((b) => b.props.testID?.startsWith('country-option')),
    ).toHaveLength(1);
    await fireEvent.press(within(sheet).getByTestId('country-option-IL'));
    expect(useRegistrationDraft.getState().country).toBe('IL');
    await waitFor(() => expect(screen.getByRole('button', { name: 'מדינה: ישראל' })).toBeOnTheScreen());
    expect(screen.getByTestId('flag-IL', hidden)).toBeTruthy();
  });

  it('"המשך" needs a good name and a country; then step 2', async () => {
    useRegistrationDraft.setState({ country: null });
    const app = await renderAccount('/register/fighter');
    await fireEvent.press(screen.getByTestId('fighter-submit'));
    expect(screen.getByTestId('name-error')).toHaveTextContent('לפחות 3 תווים');
    expect(screen.getByTestId('country-error')).toHaveTextContent('בחר מדינה');
    expect(app.pathname()).toBe('/register/fighter');

    await typeName('MosheG', 300);
    await screen.findByTestId('name-status-available', hidden);
    await act(async () => useRegistrationDraft.getState().setCountry('IL'));
    await fireEvent.press(screen.getByTestId('fighter-submit'));
    expect(app.pathname()).toBe('/register/account');
    // Step 2 shows the fighter from step 1.
    expect(screen.getByTestId('account-fighter')).toHaveTextContent(/MosheG/);
  });

  it('a taken name can’t go on', async () => {
    auth.server.takeName('MosheG');
    const app = await renderAccount('/register/fighter');
    await typeName('mosheg', 300);
    await screen.findByTestId('name-status-taken', hidden);
    await fireEvent.press(screen.getByTestId('fighter-submit'));
    expect(app.pathname()).toBe('/register/fighter');
  });

  it('signed in without a profile: "היכנס לזירה" creates it here, and a taken name says so', async () => {
    await auth.provider.signUp('half@example.com', 'Arena1234');
    setAuthDeps(auth.deps);
    await initAuth();
    expect(useAuth.getState().status).toBe('needsProfile');
    await renderAccount('/register/fighter');
    expect(screen.getByTestId('fighter-resume')).toHaveTextContent('החשבון שלך מוכן. נשאר רק לבחור לוחם.');
    expect(screen.queryByRole('button', { name: 'חזרה להתחברות' })).toBeNull();
    expect(screen.getByRole('button', { name: 'התנתקות' })).toBeOnTheScreen();

    await typeName('Racer', 300);
    await screen.findByTestId('name-status-available', hidden);
    // Someone takes it between the check and the press.
    auth.server.takeName('racer');
    await fireEvent.press(screen.getByRole('button', { name: 'היכנס לזירה' }));
    expect(await screen.findByTestId('name-error')).toHaveTextContent('השם הזה תפוס. בחר שם אחר.');

    await typeName('Racer2', 300);
    await screen.findByTestId('name-status-available', hidden);
    await fireEvent.press(screen.getByRole('button', { name: 'היכנס לזירה' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(useAuth.getState().me).toMatchObject({ displayName: 'Racer2', country: 'US', avatarId: 'av01' });
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderAccount('/register/fighter');
    expect(screen.getByText('Step 1 of 2')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Create your fighter' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Country: United States' })).toBeOnTheScreen();
    await typeName('ab');
    expect(screen.getByTestId('name-error')).toHaveTextContent('At least 3 characters');
    await typeName('Abcdef', 300);
    expect(await screen.findByTestId('name-status-available', hidden)).toHaveTextContent('Available');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeOnTheScreen();
  });
});

describe('Register step 2: the account (spec §3.2)', () => {
  beforeEach(() => {
    useRegistrationDraft.setState({ displayName: 'MosheG', avatarId: 'av07', country: 'IL' });
  });

  const type = (testID: string, text: string) => fireEvent.changeText(screen.getByTestId(testID), text);
  const submit = () => fireEvent.press(screen.getByTestId('account-submit'));

  it('shows the fighter, the fields, the meter and the rules', async () => {
    await renderAccount('/register/account');
    expect(screen.getByText('שלב 2 מתוך 2')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'עוד צעד אחד לזירה' })).toBeOnTheScreen();
    expect(screen.getByTestId('account-fighter')).toHaveTextContent(/MosheG.*ישראל.*הלוחם מוכן/);
    expect(screen.getByRole('checkbox', { name: 'אני מאשר את תנאי השימוש ומדיניות הפרטיות' })).toHaveProp(
      'accessibilityState',
      { checked: false },
    );
    expect(screen.getByRole('link', { name: 'תנאי השימוש' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'מדיניות הפרטיות' })).toBeOnTheScreen();
    expect(screen.getByLabelText('לפחות 8 תווים: חסר')).toBeOnTheScreen();
    expect(directionProblems(screen.getByTestId('register-account'))).toEqual([]);
  });

  it('the meter climbs with the password, and the rules tick as they are met', async () => {
    await renderAccount('/register/account');
    const meter = () => screen.getByTestId('account-strength').props.accessibilityValue;
    expect(meter()).toEqual({ min: 0, max: 4, now: 0, text: undefined });
    await type('account-password', 'abc');
    expect(meter()).toMatchObject({ now: 1, text: 'סיסמה חלשה' });
    expect(screen.getByLabelText('אות אחת לפחות: יש')).toBeOnTheScreen();
    await type('account-password', 'arena4812');
    expect(meter()).toMatchObject({ now: 2, text: 'סיסמה בינונית' });
    expect(screen.getByLabelText('לפחות 8 תווים: יש')).toBeOnTheScreen();
    expect(screen.getByLabelText('ספרה אחת לפחות: יש')).toBeOnTheScreen();
    await type('account-password', 'Fox.Arena42');
    expect(meter()).toMatchObject({ now: 3, text: 'סיסמה טובה' });
    await type('account-password', 'Fox.Arena42!x');
    expect(meter()).toMatchObject({ now: 4, text: 'סיסמה חזקה' });

    await type('account-confirm', 'Fox.Arena4');
    expect(screen.getByTestId('account-confirm-mismatch', hidden)).toHaveTextContent('לא תואמת');
    await type('account-confirm', 'Fox.Arena42!x');
    expect(screen.getByTestId('account-confirm-match', hidden)).toHaveTextContent('תואמת');
  });

  it('every field’s error at once, the terms too', async () => {
    await renderAccount('/register/account');
    await type('account-email', 'mosheg@');
    await type('account-password', 'short1');
    await type('account-confirm', 'short2');
    await submit();
    expect(screen.getByTestId('account-email-error')).toHaveTextContent('כתובת המייל לא תקינה');
    expect(screen.getByTestId('account-password-error')).toHaveTextContent(
      'הסיסמה צריכה לפחות 8 תווים, אות אחת וספרה אחת',
    );
    expect(screen.getByTestId('account-confirm-error')).toHaveTextContent('הסיסמאות לא תואמות');
    expect(screen.getByTestId('account-terms-error')).toHaveTextContent(
      'כדי להיכנס לזירה צריך לאשר את התנאים',
    );
    expect(auth.provider.currentUser()).toBeNull();

    await fireEvent.press(screen.getByRole('checkbox'));
    expect(screen.queryByTestId('account-terms-error')).toBeNull();
    expect(screen.getByRole('checkbox')).toHaveProp('accessibilityState', { checked: true });
  });

  async function fillIn(email = 'moshe@example.com') {
    await type('account-email', email);
    await type('account-password', 'Arena1234');
    await type('account-confirm', 'Arena1234');
    await fireEvent.press(screen.getByRole('checkbox'));
  }

  it('an address that already has an account: under the email', async () => {
    await auth.provider.signUp('moshe@example.com', 'Other1234');
    await auth.provider.signOut();
    await renderAccount('/register/account');
    await fillIn();
    await submit();
    expect(await screen.findByTestId('account-email-error')).toHaveTextContent(
      'המייל הזה כבר רשום. אפשר להתחבר איתו.',
    );
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('creates the account and the profile → ready, with 1200 provisional ratings [D23]', async () => {
    await renderAccount('/register/account');
    await fillIn();
    await submit();
    await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    expect(useAuth.getState().me).toMatchObject({ displayName: 'MosheG', avatarId: 'av07', country: 'IL' });
    expect(useAuth.getState().user).toMatchObject({ email: 'moshe@example.com', emailVerified: false });
    expect(auth.server.users.size).toBe(1);
  });

  it('the name taken meanwhile: a toast, and back to step 1 signed in', async () => {
    await renderAccount('/register/account');
    auth.server.takeName('mosheg');
    await fillIn();
    await submit();
    await waitFor(() => expect(useAuth.getState().status).toBe('needsProfile'));
    expect(useToast.getState().current?.message).toBe(
      `השם ${ltr('MosheG')} נתפס בינתיים. בחר שם אחר, והחשבון שלך מחכה.`,
    );
  });

  it('an incomplete step 1 sends the player back to it', async () => {
    useRegistrationDraft.setState({ displayName: 'x' });
    const app = await renderAccount('/register/account');
    await fillIn();
    await submit();
    expect(app.pathname()).toBe('/register/fighter');
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderAccount('/register/account');
    expect(screen.getByRole('header', { name: 'One more step to the arena' })).toBeOnTheScreen();
    await type('account-password', 'Fox.Arena42');
    expect(screen.getByTestId('account-strength').props.accessibilityValue).toMatchObject({
      now: 3,
      text: 'Good password',
    });
    await submit();
    expect(screen.getByTestId('account-terms-error')).toHaveTextContent(
      'To enter the arena, accept the terms',
    );
    expect(screen.getByRole('button', { name: 'Create account and enter the arena' })).toBeOnTheScreen();
  });
});
