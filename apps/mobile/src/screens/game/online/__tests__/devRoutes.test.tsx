// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { act, fireEvent, screen } from 'expo-router/testing-library';

import DevMetricsRoute from '../../../../../app/dev/metrics';
import DevOnlineRoute from '../../../../../app/dev/online';
import { useGameStore } from '../../../../game/gameStore';
import i18n from '../../../../i18n';
import { renderApp } from '../../../home/testing/homeTesting';

/**
 * Stage 7's dev routes, from Home's dev row: /dev/online (a private room by code) and /dev/metrics (the five
 * network measures). The SDK is a stub here: creating a room goes to the game screen, where the refusal shows.
 */

type Mocks = typeof import('../../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('@colyseus/sdk', () => ({ Client: jest.fn(() => ({ auth: {} })) }));
jest.mock(
  '../../../../game/storage',
  () => jest.requireActual<Mocks>('../../../home/testing/nativeMocks').practiceStorage,
);
jest.mock('../../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../../home/testing/nativeMocks').expoHaptics);

const routes = {
  'dev/online': DevOnlineRoute,
  'dev/metrics': DevMetricsRoute,
};

beforeEach(async () => {
  await i18n.changeLanguage('he');
});

afterEach(() => {
  useGameStore.getState().clear();
  jest.useRealTimers();
});

it('Home’s dev row opens the online game and the network measures', async () => {
  const app = await renderApp('/', routes);
  await fireEvent.press(await screen.findByRole('button', { name: 'משחק מקוון' }));
  expect(app.pathname()).toBe('/dev/online');
  expect(await screen.findByRole('header', { name: 'משחק מקוון' })).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'מדדי רשת' }));
  expect(app.pathname()).toBe('/dev/metrics');
  expect(await screen.findByTestId('dev-metrics-screen-none')).toBeTruthy();
});

it('"צור חדר" starts an online game of the chosen type for 2 players and opens the game screen', async () => {
  const app = await renderApp('/dev/online', routes);
  await fireEvent.press(await screen.findByRole('button', { name: 'רגיל' }));
  await fireEvent.press(screen.getByRole('button', { name: 'צור חדר' }));
  expect(app.pathname()).toBe('/game');
  const online = useGameStore.getState().online;
  expect(online?.request).toEqual({ kind: 'create', options: { gameType: 'normal', playerCount: 2 } });
  await act(async () => {
    await online?.ready;
  });
  // The stub SDK can't create a room: the session says so (the game screen shows it).
  expect(online?.online.closeReason).toBe('refused');
});

it('"הצטרף" joins the code as typed, normalized', async () => {
  await renderApp('/dev/online', routes);
  await fireEvent.changeText(await screen.findByTestId('dev-online-code'), 'abc 234');
  await fireEvent.press(screen.getByRole('button', { name: 'הצטרף' }));
  expect(useGameStore.getState().online?.request).toEqual({ kind: 'join', code: 'ABC234' });
});
