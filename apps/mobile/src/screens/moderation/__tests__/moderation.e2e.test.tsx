// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Linking, Text } from 'react-native';

import RootLayout from '../../../../app/_layout';
import AccountSuspendedRoute from '../../../../app/account-suspended';
import BlockedPlayersRoute from '../../../../app/blocked-players';
import ChooseNameRoute from '../../../../app/choose-name';
import EditProfileRoute from '../../../../app/edit-profile';
import GameTypeRoute from '../../../../app/game-type';
import Index from '../../../../app/index';
import LoginRoute from '../../../../app/login';
import ModesRoute from '../../../../app/modes';
import PlayerRoute from '../../../../app/player/[id]';
import SettingsRoute from '../../../../app/settings';
import { useAuth } from '../../../auth/authStore';
import { installSignedInPlayer, type TestAuth } from '../../../auth/testing/testAuth';
import { useToast } from '../../../components/ui';
import { memoryDb, type SqlJsDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { startRankedAndOpen } from '../../home/startGame';

/**
 * What an admin's actions do in the app (spec §3.5), through the real routes and the root layout's gate:
 *
 * - A name reset: the app opens on "בחר שם חדש" and keeps the player there (any other screen leads back) until a
 *   new name is saved, free of the 30-day rule; then Home, with the new name.
 * - A suspension: Home's banner, the ranked cards dimmed with "החשבון מושעה", a ranked start refused with a line,
 *   and the suspension's screen with what still works, how to reach us, sign out and delete.
 */

const mockApp: { db: SqlJsDb | null } = { db: null };

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockApp.db }));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
type NativeMocks = typeof import('../../home/testing/nativeMocks');
jest.mock('expo-audio', () => jest.requireActual<NativeMocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock(
  'expo-haptics',
  () => jest.requireActual<NativeMocks>('../../home/testing/nativeMocks').expoHaptics,
);

jest.setTimeout(60_000);

const Stub = ({ name }: { name: string }) => <Text testID={`stub-${name}`}>{name}</Text>;

const ROUTES = {
  _layout: RootLayout,
  index: Index,
  modes: ModesRoute,
  'game-type': GameTypeRoute,
  settings: SettingsRoute,
  login: LoginRoute,
  'edit-profile': EditProfileRoute,
  'choose-name': ChooseNameRoute,
  'account-suspended': AccountSuspendedRoute,
  'blocked-players': BlockedPlayersRoute,
  'player/[id]': PlayerRoute,
  'register/fighter': () => <Stub name="register" />,
  game: () => <Stub name="game" />,
  match: () => <Stub name="match" />,
  'verify-email': () => <Stub name="verify" />,
  // The root layout names these screens (their transitions).
  'results/[id]': () => <Stub name="results" />,
  leaderboard: () => <Stub name="leaderboard" />,
  history: () => <Stub name="history" />,
  achievements: () => <Stub name="achievements" />,
};

let auth: TestAuth;
const hidden = { includeHiddenElements: true };
const uid = () => [...auth.server.users.keys()][0]!;
const latestToast = () => {
  const { current, queue } = useToast.getState();
  return (queue.at(-1) ?? current)?.message;
};

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function start(url = '/') {
  const app = renderRouter(ROUTES, { initialUrl: url });
  await app;
  return { pathname: () => app.getPathname() };
}

beforeAll(async () => {
  mockApp.db = await memoryDb();
});

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'on', sound: true, haptics: true });
  useProfile.setState({ name: null, avatarId: 'av00', country: null, lastPlay: null, botLevel: null });
  useToast.getState().clear();
  auth = await installSignedInPlayer({ displayName: 'RudeName' });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a name an admin reset (spec §3.5)', () => {
  it('opens on "בחר שם חדש", holds the player there, and goes home once a new name is saved (no 30 days)', async () => {
    // Renamed a day ago: the 30-day rule would hold the name, but not after a reset.
    auth.server.users.get(uid())!.me.nextRenameAt = Date.now() + 29 * 24 * 3600_000;
    auth.server.resetName(uid(), 'שחקן48213');
    const app = await start();
    await waitFor(() => expect(app.pathname()).toBe('/choose-name'));
    expect(await screen.findByRole('header', { name: 'בחר שם חדש' })).toBeOnTheScreen();
    expect(screen.getByText(/השם הקודם שלך הוחלף בשם זמני, ⁨שחקן48213⁩/)).toBeOnTheScreen();
    expect(screen.getByTestId('choose-name-field-hint')).toHaveTextContent(
      'הפעם לא צריך לחכות 30 יום: אפשר לבחור שם עכשיו.',
    );

    // Nothing else until then.
    await act(async () => router.push('/modes'));
    await waitFor(() => expect(app.pathname()).toBe('/choose-name'));

    // The temporary name is not a choice.
    await fireEvent.changeText(screen.getByTestId('choose-name-field'), 'שחקן48213');
    await fireEvent.press(screen.getByTestId('choose-name-save'));
    expect(screen.getByTestId('choose-name-field-error')).toHaveTextContent('זה השם הזמני. בחר שם משלך.');

    await fireEvent.changeText(screen.getByTestId('choose-name-field'), 'KindName');
    await wait(300);
    await screen.findByTestId('choose-name-field-status-available', hidden);
    await fireEvent.press(screen.getByTestId('choose-name-save'));
    await waitFor(() => expect(app.pathname()).toBe('/'));
    expect(useAuth.getState().me).toMatchObject({ displayName: 'KindName', nameResetRequired: false });
    expect(latestToast()).toBe('השם החדש נשמר.');
    expect(auth.server.calls).toContain('PATCH /v1/me {"displayName":"KindName"}');
  });

  it('meanwhile practice (it works offline) and the settings stay open; "התנתקות" signs out', async () => {
    auth.server.resetName(uid(), 'שחקן48213');
    const app = await start();
    await waitFor(() => expect(app.pathname()).toBe('/choose-name'));
    await fireEvent.press(await screen.findByTestId('choose-name-practice'));
    await waitFor(() => expect(app.pathname()).toBe('/game-type'));
    await act(async () => router.back());
    await waitFor(() => expect(app.pathname()).toBe('/choose-name'));
    // The settings: where the account can be deleted instead; its profile editing leads back to the name.
    await fireEvent.press(screen.getByTestId('choose-name-settings'));
    await waitFor(() => expect(app.pathname()).toBe('/settings'));
    await act(async () => router.push('/edit-profile'));
    await waitFor(() => expect(app.pathname()).toBe('/choose-name'));
    await fireEvent.press(await screen.findByTestId('choose-name-sign-out'));
    await fireEvent.press(
      within(await screen.findByTestId('choose-name-sign-out-confirm')).getByTestId(
        'choose-name-sign-out-confirm-confirm',
      ),
    );
    await waitFor(() => expect(app.pathname()).toBe('/login'));
  });
});

describe('a suspended account (spec §3.5)', () => {
  beforeEach(() => auth.server.suspend(uid(), true));

  it("Home's banner leads to the suspension: what it means, what still works, contact, sign out and delete", async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const app = await start();
    await waitFor(() => expect(app.pathname()).toBe('/'));
    const banner = await screen.findByTestId('suspended-banner');
    expect(banner).toHaveTextContent(/החשבון מושעה: אין משחקים מדורגים/);
    await fireEvent.press(banner);
    await waitFor(() => expect(app.pathname()).toBe('/account-suspended'));
    expect(screen.getByRole('header', { name: 'החשבון מושעה' })).toBeOnTheScreen();
    expect(screen.getByText(/עדיין אפשר להתאמן לבד או מול בוט/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'פרטי קשר' }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/legal\/terms\?lang=he#contact$/));
    // The account's own actions, as in the settings; the profile can't be changed meanwhile.
    expect(screen.getByTestId('settings-sign-out')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-delete')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-edit-profile')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true }),
    );
    expect(screen.getByTestId('settings-edit-profile')).toHaveTextContent(/אי אפשר לשנות את הפרופיל/);
    open.mockRestore();
  });

  it('the ranked cards are dimmed with "החשבון מושעה"; a ranked start is refused with a line', async () => {
    const app = await start('/modes');
    await waitFor(() => expect(app.pathname()).toBe('/modes'));
    const ranked = await screen.findByTestId('mode-ranked2');
    expect(ranked).toHaveProp('accessibilityState', expect.objectContaining({ disabled: true }));
    expect(ranked).toHaveProp('accessibilityLabel', expect.stringContaining('לא זמין: החשבון מושעה'));
    expect(screen.getByTestId('suspended-ranked2')).toHaveTextContent('החשבון מושעה');
    expect(screen.getByTestId('mode-solo')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false }),
    );

    let started = true;
    await act(async () => {
      started = startRankedAndOpen({ gameType: 'normal', players: 2 }, 'push');
    });
    expect(started).toBe(false);
    await waitFor(() => expect(app.pathname()).toBe('/account-suspended'));
    expect(latestToast()).toBe('החשבון שלך מושעה, ולכן אין משחקים מדורגים כרגע.');
  });

  it("the profile can't be edited from anywhere: my card offers no edit, /edit-profile shows the suspension", async () => {
    const me = auth.server.users.get(uid())!.me;
    const app = await start(`/player/${me.id}`);
    await waitFor(() => expect(app.pathname()).toBe(`/player/${me.id}`));
    expect(await screen.findByRole('header', { name: 'כרטיס שחקן' })).toBeOnTheScreen();
    expect(screen.queryByTestId('player-card-edit')).toBeNull();
    await act(async () => router.push('/edit-profile'));
    await waitFor(() => expect(app.pathname()).toBe('/account-suspended'));
    // Lifted: the card offers the edit again.
    auth.server.suspend(uid(), false);
    await act(async () => useAuth.setState({ me: { ...useAuth.getState().me!, suspended: false } }));
    await act(async () => router.push(`/player/${me.id}`));
    expect(await screen.findByTestId('player-card-edit')).toBeOnTheScreen();
  });

  it("suspended with a reset name too: no forced rename (the account can't change), the suspension shows", async () => {
    auth.server.resetName(uid(), 'שחקן48213');
    const app = await start();
    await waitFor(() => expect(app.pathname()).toBe('/'));
    expect(await screen.findByTestId('suspended-banner')).toBeOnTheScreen();
  });

  it('lifted: the banner goes once the profile is read again', async () => {
    auth.server.suspend(uid(), false);
    const app = await start();
    await waitFor(() => expect(app.pathname()).toBe('/'));
    await screen.findByTestId('profile-card');
    expect(screen.queryByTestId('suspended-banner')).toBeNull();
  });
});
