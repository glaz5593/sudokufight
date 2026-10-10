// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { useAuth } from '../../../auth/authStore';
import { useToast } from '../../../components/ui';
import { useGameStore } from '../../../game/gameStore';
import { openPracticeRepo } from '../../../game/practiceRepo';
import { practiceStorageOrNull } from '../../../game/storage';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { setHealthCheck, useConnectivity } from '../../../net/connectivity';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { renderApp } from '../testing/homeTesting';

/**
 * No connection before a game (work plan stage 13; spec §16.1; the Offline board) beyond Modes: a ranked
 * game's type screen (the banner, "עבור לאימון" to a solo practice of the chosen type, "בדוק שוב", the
 * background check, and the search back with the connection), and Home (the banner, a ranked "עוד סיבוב"
 * dimmed with "דורש חיבור"). A practice never asks. Hebrew and English.
 */

type Mocks = typeof import('../testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../game/storage', () => jest.requireActual<Mocks>('../testing/nativeMocks').practiceStorage);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoHaptics);
jest.mock('../../../net/matchmakingDevice', () => ({ deviceMatchmakingDeps: jest.fn() }));

const storage = jest.mocked(practiceStorageOrNull);

/** The server's health check: offline until `online` turns true; counts the checks. */
function server() {
  const state = { online: false, checks: 0 };
  setHealthCheck(async () => {
    state.checks++;
    return state.online;
  });
  return state;
}

beforeEach(async () => {
  jest.useRealTimers();
  const repo = await openPracticeRepo(await memoryDb());
  storage.mockImplementation(async () => repo);
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null, botLevel: null });
  useSettings.setState({ reduceMotion: 'on' });
  useToast.getState().clear();
  await i18n.changeLanguage('he');
});

afterEach(() => {
  useGameStore.getState().clear();
  setHealthCheck(null);
  useAuth.setState({ status: 'loading', user: null, me: null });
  jest.useRealTimers();
});

describe('a ranked game’s type screen offline (spec §16.1)', () => {
  it('the banner, "עבור לאימון" and "בדוק שוב" in place of the search; the search comes back online', async () => {
    const net = server();
    await renderApp('/game-type?mode=ranked&players=2&gameType=hard');
    await screen.findByTestId('offline-banner');
    expect(screen.getByTestId('offline-banner')).toHaveAccessibleName(
      'אין חיבור לאינטרנט. משחקים מדורגים לא זמינים',
    );
    expect(screen.queryByRole('button', { name: 'מצא יריב' })).toBeNull();
    expect(screen.getByTestId('game-type-live')).toHaveTextContent('אין חיבור לאינטרנט');
    // The types can still be chosen (for the practice, or for later).
    expect(screen.getByTestId('type-hard')).toHaveProp('accessibilityState', { checked: true });

    await fireEvent.press(screen.getByRole('button', { name: 'בדוק שוב' }));
    await screen.findByTestId('still-offline');
    expect(screen.getByTestId('still-offline')).toHaveTextContent('עדיין אין חיבור · ניסיון 2');

    net.online = true;
    await fireEvent.press(screen.getByRole('button', { name: 'בדוק שוב' }));
    await waitFor(() => expect(screen.queryByTestId('offline-banner')).toBeNull());
    expect(screen.getByRole('button', { name: 'מצא יריב' })).toBeOnTheScreen();
    expect(net.checks).toBe(3);
  });

  it('"עבור לאימון": a solo practice of the type chosen here', async () => {
    server();
    const app = await renderApp('/game-type?mode=ranked&players=3&gameType=normal');
    await screen.findByTestId('offline-banner');
    await fireEvent.press(screen.getByTestId('type-fast'));
    await fireEvent.press(screen.getByRole('button', { name: 'עבור לאימון' }));
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'solo', gameType: 'fast' });
    expect(screen.getByRole('button', { name: 'התחל אימון' })).toBeOnTheScreen();
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('checks again in the background while offline', async () => {
    jest.useFakeTimers();
    const net = server();
    await renderApp('/game-type?mode=ranked');
    await act(async () => {
      await Promise.resolve();
    });
    expect(net.checks).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(net.checks).toBe(2);
  });

  it('a practice never asks: no banner, no check', async () => {
    const net = server();
    await renderApp('/game-type?mode=solo');
    await act(async () => {
      await Promise.resolve();
    });
    expect(net.checks).toBe(0);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(screen.getByRole('button', { name: 'התחל אימון' })).toBeOnTheScreen();
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    server();
    await renderApp('/game-type?mode=ranked&players=2');
    await screen.findByTestId('offline-banner');
    expect(screen.getByTestId('offline-banner')).toHaveAccessibleName(
      "No internet connection. Ranked games aren't available",
    );
    expect(screen.getByRole('button', { name: 'Go to practice' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Find an opponent' })).toBeNull();
  });
});

describe('Home offline (spec §16.1)', () => {
  it('the banner under the card; a ranked "עוד סיבוב" dimmed with "דורש חיבור"; both go online', async () => {
    const net = server();
    useProfile.setState({ lastPlay: { mode: 'ranked', gameType: 'hard', players: 2 } });
    await renderApp('/');
    await screen.findByTestId('home-offline');
    expect(screen.getByTestId('home-offline')).toHaveAccessibleName(
      'אין חיבור לאינטרנט. משחקים מדורגים לא זמינים',
    );
    const again = screen.getByTestId('play-again');
    expect(again).toHaveProp('accessibilityState', expect.objectContaining({ disabled: true }));
    expect(again).toHaveTextContent(/מדורג · 2 שחקנים · קשה · דורש חיבור/);
    // "שחק" still opens the modes (practice works offline).
    expect(screen.getByTestId('play')).not.toBeDisabled();

    net.online = true;
    await act(async () => {
      await useConnectivity.getState().check();
    });
    await waitFor(() => expect(screen.queryByTestId('home-offline')).toBeNull());
    expect(screen.getByTestId('play-again')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false }),
    );
    expect(screen.getByTestId('play-again')).not.toHaveTextContent(/דורש חיבור/);
  });

  it('a practice "עוד סיבוב" stays open offline', async () => {
    server();
    useProfile.setState({ lastPlay: { mode: 'solo', gameType: 'normal' } });
    await renderApp('/');
    await screen.findByTestId('home-offline');
    expect(screen.getByTestId('play-again')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false }),
    );
    expect(screen.getByTestId('play-again')).not.toHaveTextContent(/דורש חיבור/);
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    server();
    useProfile.setState({ lastPlay: { mode: 'ranked', gameType: 'normal', players: 2 } });
    await renderApp('/');
    await screen.findByTestId('home-offline');
    expect(screen.getByTestId('home-offline')).toHaveAccessibleName(
      "No internet connection. Ranked games aren't available",
    );
    expect(screen.getByTestId('play-again')).toHaveTextContent(/Needs connection/);
  });
});
