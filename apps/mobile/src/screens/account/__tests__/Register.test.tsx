// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { useRegistrationDraft } from '../../../auth/registrationDraft';
import { installTestAuth, type TestAuth } from '../../../auth/testing/testAuth';
import { avatarIdsIn } from '../../../avatars/testing/avatarTesting';
import { ltr } from '../../../components/player';
import { useToast } from '../../../components/ui';
import { LARGE_TEXT_SCALE } from '../../../components/ui/Button';
import { directionProblems, PHONE, setWindow } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { track } from '../../../services/analytics';
import { useSettings } from '../../../state/settings';
import { measuredWidth } from '../../../testing/fontMetrics';
import { size, space, text } from '../../../theme';
import { GUTTER } from '../../home/parts';
import { renderAccount } from '../testing/accountTesting';
import { chooseAvatar } from '../testing/avatarGrid';

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);

let auth: TestAuth;
const hidden = { includeHiddenElements: true };
type Node = ReturnType<typeof screen.getByTestId>;
const styleOf = (node: Node) => StyleSheet.flatten(node.props.style as object) as Record<string, unknown>;

/** The testIDs of the host elements under an element, in the order they are drawn. */
function testIDsIn(node: Node, out: string[] = []): string[] {
  if (typeof node.type === 'string' && typeof node.props.testID === 'string') out.push(node.props.testID);
  for (const child of node.children) if (typeof child !== 'string') testIDsIn(child, out);
  return out;
}

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
  jest.mocked(track).mockClear();
  await i18n.changeLanguage('he');
  auth = installTestAuth();
  await initAuth();
  useRegistrationDraft.getState().reset();
  useToast.getState().clear();
});
afterEach(() => setAuthDeps(null));

describe('Register step 1: "צור את הלוחם שלך" (spec §3.2)', () => {
  it('shows the step, three fields (avatar, name, country) and the preview of my card', async () => {
    await renderAccount('/register/fighter');
    expect(screen.getByText('שלב 1 מתוך 2')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'צור את הלוחם שלך' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'חזרה להתחברות' })).toBeOnTheScreen();
    // The avatar is a field like the others (Moshe's device test): no stage, no tabs, no strip.
    expect(screen.getByRole('button', { name: 'האווטאר שנבחר: נועם' })).toHaveTextContent('נועםשינוי');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryAllByRole('radio', hidden)).toHaveLength(0);
    // [D21] The country comes from the phone (the test phone is in the US), by its full name.
    expect(screen.getByRole('button', { name: 'מדינה: ארצות הברית' })).toHaveTextContent(
      '🇺🇸ארצות הבריתשינוי',
    );
    const order = testIDsIn(screen.getByTestId('register-fighter')).filter((id) =>
      ['avatar-picker', 'name', 'country', 'fighter-preview'].includes(id),
    );
    expect(order).toEqual(['avatar-picker', 'name', 'country', 'fighter-preview']);
    expect(screen.getByTestId('name-hint')).toHaveTextContent(
      // The range is isolated (LRI…PDI): bare, '3–16' reads '16–3' in a right-to-left line.
      '\u20663–16\u2069 תווים: אותיות בעברית או באנגלית, ספרות, קו תחתון ונקודה.',
    );
    expect(screen.getByLabelText('תצוגה מקדימה של הכרטיס שלך במשחק: שחקן')).toBeOnTheScreen();
    // The layout mirrors with the language by itself (rows, start/end).
    expect(directionProblems(screen.getByTestId('register-fighter'))).toEqual([]);
  });

  it('the avatar field opens the grid; a tap chooses, and the field and the preview follow', async () => {
    // Still avatars, so the test can read which one each draws.
    useSettings.setState({ reduceMotion: 'on' });
    await renderAccount('/register/fighter');
    await chooseAvatar('punk');
    expect(useRegistrationDraft.getState().avatarId).toBe('punk');
    expect(screen.getByRole('button', { name: 'האווטאר שנבחר: מיקה' })).toBeOnTheScreen();
    expect(avatarIdsIn(screen.getByTestId('fighter-preview-me-avatar', hidden))).toEqual(['punk']);
    // Any kind: the grid holds all of them.
    await chooseAvatar('sufganiya');
    expect(useRegistrationDraft.getState().avatarId).toBe('sufganiya');
    expect(avatarIdsIn(screen.getByTestId('fighter-preview-me-avatar', hidden))).toEqual(['sufganiya']);
    expect(screen.queryByTestId('avatar-picker-sheet')).toBeNull();
    await act(async () => useSettings.setState({ reduceMotion: 'system' }));
  });

  it('the preview is my card alone, as step 2 shows it: no VS, no opponent, the whole name', async () => {
    useRegistrationDraft.setState({ country: 'IL' });
    await renderAccount('/register/fighter');
    await typeName('Abcdefghijklmnop');
    const preview = screen.getByTestId('fighter-preview');
    expect(within(preview).getByText('ככה יראו אותך בזירה')).toBeOnTheScreen();
    expect(screen.getByLabelText('תצוגה מקדימה של הכרטיס שלך במשחק: Abcdefghijklmnop')).toBeOnTheScreen();
    expect(screen.getByTestId('fighter-preview-me-name', hidden)).toHaveTextContent('Abcdefghijklmnop');
    expect(within(preview).getByTestId('flag-IL', hidden)).toBeTruthy();
    expect(within(preview).getByText('ישראל', hidden)).toBeTruthy();
    expect(within(preview).getByText('חדש', hidden)).toBeTruthy();
    expect(within(preview).queryByText('VS', hidden)).toBeNull();
    expect(within(preview).queryByText('???', hidden)).toBeNull();
    expect(
      within(preview)
        .getAllByTestId(/^glyph-/, hidden)
        .map((g) => g.props.testID),
    ).toEqual(['glyph-circle']);
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

  it('the country sheet: flags and full names, a search in Hebrew or in English, and a pick', async () => {
    await renderAccount('/register/fighter');
    await fireEvent.press(screen.getByRole('button', { name: 'מדינה: ארצות הברית' }));
    const sheet = await screen.findByTestId('country-sheet');
    const options = () =>
      within(sheet)
        .queryAllByRole('button')
        .filter((b) => String(b.props.testID).startsWith('country-option'));
    // It opens on the chosen country: its flag and its whole name, not "US".
    const us = within(sheet).getByTestId('country-option-US');
    expect(us).toHaveProp('accessibilityState', { selected: true });
    expect(us).toHaveTextContent('🇺🇸ארצות הברית');
    // Every row a name, none a two-letter code.
    expect(options().length).toBeGreaterThan(5);
    expect(options().filter((o) => /^[A-Z]{2}$/.test(String(o.props.accessibilityLabel)))).toEqual([]);

    await fireEvent.changeText(within(sheet).getByTestId('country-search'), 'ישר');
    expect(options().map((o) => o.props.testID)).toEqual(['country-option-IL']);
    // In Latin letters too, while the app speaks Hebrew.
    await fireEvent.changeText(within(sheet).getByTestId('country-search'), 'israel');
    expect(options().map((o) => o.props.testID)).toEqual(['country-option-IL']);
    expect(within(sheet).getByTestId('country-option-IL')).toHaveTextContent('🇮🇱ישראל');
    await fireEvent.press(within(sheet).getByTestId('country-option-IL'));
    expect(useRegistrationDraft.getState().country).toBe('IL');
    await waitFor(() => expect(screen.getByRole('button', { name: 'מדינה: ישראל' })).toBeOnTheScreen());
    // The preview's flag and country follow.
    const preview = screen.getByTestId('fighter-preview');
    expect(within(preview).getByTestId('flag-IL', hidden)).toBeTruthy();
    expect(within(preview).getByText('ישראל', hidden)).toBeTruthy();
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
    expect(useAuth.getState().me).toMatchObject({ displayName: 'Racer2', country: 'US', avatarId: 'noam' });
    // Spec §22: the step, then the registration's end (once, after the taken name).
    expect(jest.mocked(track).mock.calls).toEqual([
      ['register_step', { step: 'fighter' }],
      ['register_complete'],
    ]);
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
    useRegistrationDraft.setState({ displayName: 'MosheG', avatarId: 'lava-lamp', country: 'IL' });
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
    // One rule: at least 8 characters (Moshe: "not a bank account").
    expect(screen.getByLabelText('לפחות 8 תווים: חסר')).toBeOnTheScreen();
    expect(within(screen.getByTestId('account-rules')).getAllByLabelText(/: (יש|חסר)$/)).toHaveLength(1);
    expect(directionProblems(screen.getByTestId('register-account'))).toEqual([]);
  });

  it('the meter climbs with the password, and the rules tick as they are met', async () => {
    await renderAccount('/register/account');
    const meter = () => screen.getByTestId('account-strength').props.accessibilityValue;
    expect(meter()).toEqual({ min: 0, max: 4, now: 0, text: undefined });
    await type('account-password', 'abc');
    expect(meter()).toMatchObject({ now: 1, text: 'סיסמה חלשה' });
    expect(screen.getByLabelText('לפחות 8 תווים: חסר')).toBeOnTheScreen();
    await type('account-password', 'arena4812');
    expect(meter()).toMatchObject({ now: 2, text: 'סיסמה בינונית' });
    expect(screen.getByLabelText('לפחות 8 תווים: יש')).toBeOnTheScreen();
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
    expect(screen.getByTestId('account-password-error')).toHaveTextContent('הסיסמה צריכה לפחות 8 תווים');
    expect(screen.getByTestId('account-confirm-error')).toHaveTextContent('הסיסמאות לא תואמות');
    expect(screen.getByTestId('account-terms-error')).toHaveTextContent(
      'כדי להיכנס לזירה צריך לאשר את התנאים',
    );
    expect(auth.provider.currentUser()).toBeNull();

    await fireEvent.press(screen.getByRole('checkbox'));
    expect(screen.queryByTestId('account-terms-error')).toBeNull();
    expect(screen.getByRole('checkbox')).toHaveProp('accessibilityState', { checked: true });
  });

  async function fillIn(email = 'moshe@example.com', password = 'Arena1234') {
    await type('account-email', email);
    await type('account-password', password);
    await type('account-confirm', password);
    await fireEvent.press(screen.getByRole('checkbox'));
  }

  it.each(['mosheglz', '20262026', 'סיסמהלזירה'])(
    'any 8 characters will do: "%s" makes the account (no letter, digit or case rules)',
    async (password) => {
      await renderAccount('/register/account');
      await fillIn('moshe@example.com', password);
      await submit();
      expect(screen.queryByTestId('account-password-error')).toBeNull();
      await waitFor(() => expect(useAuth.getState().status).toBe('ready'));
    },
  );

  it('"צור משתמש והיכנס לזירה": the normal button size, on one line on the phone in both languages', async () => {
    const restore = setWindow(PHONE);
    try {
      await renderAccount('/register/account');
      expect(styleOf(screen.getByTestId('account-submit')).height).toBe(size.buttonMd);
      const label = screen.getByTestId('account-submit-label');
      // The design's words (Register-Account), at the smaller size Moshe asked for (bug 6).
      expect(label).toHaveTextContent('צור משתמש והיכנס לזירה');
      expect(label).toHaveProp('numberOfLines', 1);
      const { fontSize, fontFamily } = styleOf(label) as { fontSize: number; fontFamily: string };
      expect(fontSize).toBeLessThan(text('screenTitle').fontSize!);
      // The phone's width (360 dp, the S22's), less the screen's gutters and the button's own padding; the
      // words measured in the font the app ships.
      const room = PHONE.width - 2 * GUTTER.screen - 2 * space[10];
      for (const lng of ['he', 'en'] as const) {
        const words = i18n.getFixedT(lng, 'account')('account.submit');
        // Up to the text scale where the label may take a second line (LARGE_TEXT_SCALE).
        for (const fontScale of [1, 1.1]) {
          const fits = measuredWidth(words, fontFamily, fontSize, { fontScale }) <= room;
          expect([lng, fontScale, fits]).toEqual([lng, fontScale, true]);
        }
      }
      // What the phone showed: the same words at the large size could not fit.
      const before = measuredWidth('צור משתמש והיכנס לזירה', fontFamily, text('screenTitle').fontSize!);
      expect(before).toBeGreaterThan(room);
    } finally {
      await restore();
    }
  });

  it('at large system text sizes the label may take a second line, and the button grows with it', async () => {
    const large = setWindow({ ...PHONE, fontScale: 2 });
    try {
      await renderAccount('/register/account');
      expect(screen.getByTestId('account-submit-label')).toHaveProp('numberOfLines', 2);
      const button = styleOf(screen.getByTestId('account-submit'));
      expect(button.height).toBeUndefined();
      expect(button.minHeight).toBe(size.buttonMd);
    } finally {
      await large();
    }
  });

  it('just below the large text sizes it keeps to one line', async () => {
    const below = setWindow({ ...PHONE, fontScale: LARGE_TEXT_SCALE - 0.05 });
    try {
      await renderAccount('/register/account');
      expect(screen.getByTestId('account-submit-label')).toHaveProp('numberOfLines', 1);
      expect(styleOf(screen.getByTestId('account-submit')).height).toBe(size.buttonMd);
    } finally {
      await below();
    }
  });

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
    expect(useAuth.getState().me).toMatchObject({
      displayName: 'MosheG',
      avatarId: 'lava-lamp',
      country: 'IL',
    });
    // Spec §22: this step was seen, and the registration completed.
    expect(track).toHaveBeenCalledWith('register_step', { step: 'account' });
    expect(track).toHaveBeenLastCalledWith('register_complete');
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
    expect(screen.getByRole('button', { name: 'Create account' })).toBeOnTheScreen();
  });
});
