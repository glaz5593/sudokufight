// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Text } from 'react-native';

import RootLayout from '../../app/_layout';
import AchievementsRoute from '../../app/achievements';
import EditProfileRoute from '../../app/edit-profile';
import PlayerRoute from '../../app/player/[id]';
import ForgotPasswordRoute from '../../app/forgot-password';
import HistoryRoute from '../../app/history';
import Index from '../../app/index';
import LeaderboardRoute from '../../app/leaderboard';
import LoginRoute from '../../app/login';
import ModesRoute from '../../app/modes';
import RegisterAccountRoute from '../../app/register/account';
import RegisterFighterRoute from '../../app/register/fighter';
import SettingsRoute from '../../app/settings';
import VerifyEmailRoute from '../../app/verify-email';
import { setAuthDeps, useAuth } from '../auth/authStore';
import { installTestAuth, type TestAuth } from '../auth/testing/testAuth';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { track } from '../services/analytics';
import { chooseAvatar } from '../screens/account/testing/avatarGrid';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';

/**
 * Work plan stage 8, "סיום", end to end through the app's real routes (the root layout and its auth gate
 * included), with the development sign-in and an in-memory account server standing in for Firebase and the
 * game server:
 *
 * the Splash → login → "הרשמה" → step 1 (avatar, name checked live, country) → step 2 (email, password,
 * terms) → Home shows the card (1200, provisional) → edit the avatar → Settings → delete the account
 * (password) → back on the login screen → register again with the same name → Home.
 */

const mockApp: { db: SqlJsDb | null } = { db: null };

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockApp.db }));
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
type NativeMocks = typeof import('../screens/home/testing/nativeMocks');
jest.mock(
  'expo-audio',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoAudio,
);
jest.mock(
  'expo-haptics',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoHaptics,
);

jest.setTimeout(60_000);

const Stub = ({ name }: { name: string }) => <Text testID={`stub-${name}`}>{name}</Text>;

const ROUTES = {
  _layout: RootLayout,
  index: Index,
  modes: ModesRoute,
  settings: SettingsRoute,
  leaderboard: LeaderboardRoute,
  history: HistoryRoute,
  achievements: AchievementsRoute,
  login: LoginRoute,
  'forgot-password': ForgotPasswordRoute,
  'register/fighter': RegisterFighterRoute,
  'register/account': RegisterAccountRoute,
  'verify-email': VerifyEmailRoute,
  'edit-profile': EditProfileRoute,
  'player/[id]': PlayerRoute,
  game: () => <Stub name="game" />,
  'results/[id]': () => <Stub name="results" />,
};

const hidden = { includeHiddenElements: true };
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const type = (testID: string, text: string) => fireEvent.changeText(screen.getByTestId(testID), text);

let auth: TestAuth;

/** The registration funnel's analytics (spec §22: register_step{step}, register_complete), in order. */
const funnel = () =>
  jest.mocked(track).mock.calls.filter(([name]) => name === 'register_step' || name === 'register_complete');

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** Step 1 and step 2 of the registration, from the login screen. */
async function register(app: { pathname(): string }, name: string, email: string) {
  await fireEvent.press(screen.getByRole('button', { name: 'הרשמה' }));
  await waitFor(() => expect(app.pathname()).toBe('/register/fighter'));

  await chooseAvatar('maya');
  await type('name', name);
  await wait(300);
  expect(await screen.findByTestId('name-status-available', hidden)).toHaveTextContent('פנוי');

  await fireEvent.press(screen.getByRole('button', { name: 'מדינה: ארצות הברית' }));
  const sheet = await screen.findByTestId('country-sheet');
  await fireEvent.changeText(within(sheet).getByTestId('country-search'), 'ישראל');
  await fireEvent.press(within(sheet).getByTestId('country-option-IL'));
  expect(screen.getByLabelText(`תצוגה מקדימה של הכרטיס שלך במשחק: ${name}`)).toBeOnTheScreen();

  await press('fighter-submit');
  await waitFor(() => expect(app.pathname()).toBe('/register/account'));
  expect(screen.getByTestId('account-fighter')).toHaveTextContent(new RegExp(`${name}.*ישראל`));
  await type('account-email', email);
  await type('account-password', 'Arena1234');
  await type('account-confirm', 'Arena1234');
  await fireEvent.press(screen.getByRole('checkbox'));
  await press('account-submit');
  await waitFor(() => expect(app.pathname()).toBe('/'));
}

beforeAll(async () => {
  mockApp.db = await memoryDb();
});

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'off', sound: true, haptics: true });
  useProfile.setState({ name: null, avatarId: 'av00', country: null, lastPlay: null, botLevel: null });
  auth = installTestAuth();
  jest.mocked(track).mockClear();
});

afterEach(() => {
  setAuthDeps(null);
  jest.useRealTimers();
});

describe('accounts, end to end (work plan stage 8 "סיום")', () => {
  it('register → the card → edit the avatar → delete → login → register again with the same name', async () => {
    const app = renderRouter(ROUTES, { initialUrl: '/' });
    await app;
    const nav = { pathname: () => app.getPathname() };

    // Nobody signed in: the Splash, then the login screen (never Home).
    await waitFor(() => expect(nav.pathname()).toBe('/login'));
    expect(await screen.findByRole('header', { name: 'חוזרים לזירה' })).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByTestId('splash')).toBeNull());

    // ---- register ----
    await register(nav, 'MosheG', 'moshe@example.com');
    // Spec §22: each step once as it opens, and the completion once.
    expect(funnel()).toEqual([
      ['register_step', { step: 'fighter' }],
      ['register_step', { step: 'account' }],
      ['register_complete'],
    ]);
    expect(useAuth.getState()).toMatchObject({
      status: 'ready',
      me: { displayName: 'MosheG', avatarId: 'maya', country: 'IL' }, // chosen in the avatar sheet
    });
    // A fresh stack: no way back to the registration.
    expect(router.canGoBack()).toBe(false);

    // ---- Home shows the card ----
    const card = await screen.findByTestId('profile-card');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('MosheG');
    expect(within(card).getByTestId('flag-IL', hidden)).toBeTruthy();
    expect(within(card).getByTestId('rating-normal')).toHaveTextContent(/1200זמני$/);
    // [D22] Not verified yet: the banner, which never blocks "שחק".
    expect(screen.getByTestId('verify-banner')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'שחק' })).toBeOnTheScreen();

    // ---- edit the avatar: from my player card (stage 12) ----
    await fireEvent.press(card);
    await waitFor(() => expect(nav.pathname()).toBe(`/player/${useAuth.getState().me!.id}`));
    await press('player-card-edit');
    await waitFor(() => expect(nav.pathname()).toBe('/edit-profile'));
    await chooseAvatar('sufganiya');
    await press('edit-save');
    await waitFor(() => expect(nav.pathname()).toBe(`/player/${useAuth.getState().me!.id}`));
    await press('back');
    await waitFor(() => expect(nav.pathname()).toBe('/'));
    expect(useAuth.getState().me?.avatarId).toBe('sufganiya');
    expect(useProfile.getState().avatarId).toBe('sufganiya');
    expect(auth.server.calls).toContain('PATCH /v1/me {"avatarId":"sufganiya"}');

    // ---- delete the account ----
    await fireEvent.press(screen.getByRole('button', { name: 'הגדרות' }));
    await waitFor(() => expect(nav.pathname()).toBe('/settings'));
    await fireEvent.press(screen.getByRole('button', { name: 'מחיקת חשבון' }));
    await fireEvent.press(
      within(await screen.findByTestId('delete-confirm')).getByTestId('delete-confirm-confirm'),
    );
    const ask = await screen.findByTestId('delete-password');
    await fireEvent.changeText(within(ask).getByTestId('delete-password-input'), 'Arena1234');
    await fireEvent.press(within(ask).getByTestId('delete-password-confirm'));

    // The sign-in is gone on the provider, the profile on the server; back on the login screen.
    await waitFor(() => expect(nav.pathname()).toBe('/login'));
    expect(useAuth.getState()).toMatchObject({ status: 'signedOut', me: null, user: null });
    expect(auth.server.users.size).toBe(0);
    expect(auth.provider.currentUser()).toBeNull();
    expect(router.canGoBack()).toBe(false);
    await wait(300);

    // ---- the same name (and address) again ----
    await register(nav, 'MosheG', 'moshe@example.com');
    expect(useAuth.getState().me).toMatchObject({ displayName: 'MosheG', id: 'user-2' });
    expect(await screen.findByTestId('profile-name')).toHaveTextContent('MosheG');
  });

  it('a returning player signs in from the login screen and lands on Home', async () => {
    await auth.provider.signUp('back@example.com', 'Arena1234');
    await auth.server.api.createUser({ displayName: 'Returner', avatarId: 'pencil', country: 'IL' });
    await auth.provider.signOut();

    const app = renderRouter(ROUTES, { initialUrl: '/' });
    await app;
    await waitFor(() => expect(app.getPathname()).toBe('/login'));
    await type('login-email', 'back@example.com');
    await type('login-password', 'Arena1234');
    await press('login-submit');
    await waitFor(() => expect(app.getPathname()).toBe('/'));
    expect(await screen.findByTestId('profile-name')).toHaveTextContent('Returner');

    // Sign out from the settings: the login screen again.
    await fireEvent.press(screen.getByRole('button', { name: 'הגדרות' }));
    await press('settings-sign-out');
    await fireEvent.press(
      within(await screen.findByTestId('sign-out-confirm')).getByTestId('sign-out-confirm-confirm'),
    );
    await waitFor(() => expect(app.getPathname()).toBe('/login'));
  });

  it('a sign-in without a profile resumes the registration at step 1', async () => {
    await auth.provider.signUp('half@example.com', 'Arena1234');

    const app = renderRouter(ROUTES, { initialUrl: '/' });
    await app;
    await waitFor(() => expect(app.getPathname()).toBe('/register/fighter'));
    expect(await screen.findByTestId('fighter-resume')).toBeOnTheScreen();
    await type('name', 'Halfway');
    await wait(300);
    await screen.findByTestId('name-status-available', hidden);
    await fireEvent.press(screen.getByRole('button', { name: 'היכנס לזירה' }));
    await waitFor(() => expect(app.getPathname()).toBe('/'));
    expect(await screen.findByTestId('profile-name')).toHaveTextContent('Halfway');
    // Resumed at step 1, finished there: no account step.
    expect(funnel()).toEqual([['register_step', { step: 'fighter' }], ['register_complete']]);
  });
});
