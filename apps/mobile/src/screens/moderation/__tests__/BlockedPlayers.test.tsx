// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { Text } from 'react-native';

import BlockedPlayersRoute from '../../../../app/blocked-players';
import SettingsRoute from '../../../../app/settings';
import { ModerationApiError } from '../../../api/moderationApi';
import { createFakeModeration, type FakeModeration } from '../../../api/testing/fakeModeration';
import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { installSignedInPlayer } from '../../../auth/testing/testAuth';
import { useToast } from '../../../components/ui';
import i18n from '../../../i18n';
import { blockPlayer, resetBlocks, setModerationApi } from '../../../moderation/moderation';
import { useSettings } from '../../../state/settings';
import { blockedSince } from '../BlockedPlayersScreen';

/**
 * Settings → "שחקנים חסומים" (spec §3.5): the players I blocked, newest first, with their avatar, name and date,
 * and "בטל חסימה" after a confirmation; the empty state; no connection with "נסה שוב".
 */

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);

const NOW = 1_760_000_000_000;
let server: FakeModeration;

const ROUTES = {
  index: () => <Text testID="stub-home">home</Text>,
  settings: SettingsRoute,
  'blocked-players': BlockedPlayersRoute,
};

async function open(url = '/blocked-players') {
  const app = renderRouter(ROUTES, { initialUrl: url });
  await app;
  await settle();
  // Not the render itself: it is a thenable, and an async function would unwrap it.
  return { pathname: () => app.getPathname() };
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  useToast.getState().clear();
  await installSignedInPlayer();
  await initAuth();
  server = createFakeModeration({ me: useAuth.getState().me!.id, now: NOW });
  server.addPlayer({ id: 'nina', displayName: 'NinaVolt', country: 'DE' });
  server.addPlayer({ id: 'pip', displayName: 'Pip', country: 'IL' });
  setModerationApi(() => server.api);
  resetBlocks();
});

afterEach(() => {
  setModerationApi(null);
  setAuthDeps(null);
});

describe('blocked players (spec §3.5)', () => {
  it('from the settings: the list, newest first, with the date; "בטל חסימה" after a confirmation', async () => {
    await blockPlayer('pip');
    await blockPlayer('nina');
    const app = await open('/settings');
    await fireEvent.press(screen.getByRole('button', { name: 'שחקנים חסומים' }));
    await settle();
    expect(app.pathname()).toBe('/blocked-players');
    expect(screen.getByRole('header', { name: 'שחקנים חסומים' })).toBeOnTheScreen();
    expect(screen.getByTestId('blocked-count')).toHaveTextContent('2 מתוך 100');
    const rows = within(screen.getByTestId('blocked-list')).getAllByTestId(/^blocked-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual(['blocked-row-nina', 'blocked-row-pip']);
    const since = blockedSince(NOW + 1, 'he');
    expect(screen.getByLabelText(`⁨NinaVolt⁩, חסום מאז ${since}`)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'בטל את החסימה של ⁨NinaVolt⁩' }));
    expect(screen.getByText('לבטל את החסימה של ⁨NinaVolt⁩?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('unblock-confirm-confirm'));
    await settle();
    expect(server.blockedBy(useAuth.getState().me!.id)).toEqual(['pip']);
    expect(screen.queryByTestId('blocked-row-nina')).toBeNull();
    expect(screen.getByTestId('blocked-count')).toHaveTextContent('1 מתוך 100');
  });

  it('nobody blocked: says so, and where blocking is done', async () => {
    await open();
    expect(screen.getByTestId('blocked-empty')).toHaveTextContent(/אין שחקנים חסומים/);
    expect(screen.getByTestId('blocked-empty')).toHaveTextContent(/מהכרטיס שלו/);
  });

  it('no connection: says so with "נסה שוב", which reads the list again', async () => {
    server.setOffline(true);
    await open();
    expect(screen.getByTestId('blocked-offline')).toHaveTextContent(/אין חיבור לשרת/);
    server.setOffline(false);
    await blockPlayer('pip');
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    await settle();
    expect(screen.getByTestId('blocked-row-pip')).toBeOnTheScreen();
  });

  it('a list that fails otherwise shows the code for support; English too', async () => {
    server.failNext('blocks', new ModerationApiError('badRequest', 400));
    await i18n.changeLanguage('en');
    await open();
    expect(screen.getByTestId('blocked-error')).toHaveTextContent(/We couldn't load the list/);
    expect(screen.getByTestId('blocked-error')).toHaveTextContent(/badRequest/);
    expect(screen.getByRole('header', { name: 'Blocked players' })).toBeOnTheScreen();
  });
});
