import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import GameRoute from '../../../../app/game';
import { useGameStore } from '../../../game/gameStore';
import { type PracticeSession, startPractice } from '../../../game/session';
import { smallPool } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { OnlineSession } from '../../../game/onlineSession';
import { elapse, FakeTable } from '../../../net/testing/fakeServer';
import { useSettings } from '../../../state/settings';
import { liveOnlineSession, onlineSession, OPP } from '../testing/online';

/** The /game route: the store's practice or online game, or home; its end opens /results/[id]. */

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), dismissTo: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  Stack: { Screen: () => null },
}));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));
const { router } = jest.requireMock<{
  router: { replace: jest.Mock; dismissTo: jest.Mock; back: jest.Mock };
}>('expo-router');

let session: PracticeSession | null = null;

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

afterEach(() => {
  session?.close();
  session = null;
  useGameStore.getState().online?.close();
  useGameStore.setState({ session: null, online: null, view: null, lastUpdate: null });
});

it('without a practice in the store, goes home', async () => {
  await render(<GameRoute />);
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(screen.queryByTestId('game')).toBeNull();
});

it('plays the store’s practice; "סיום אימון" → "כן, לסיים" opens its results', async () => {
  const clock = new ManualClock(1_700_000_000_000);
  session = await startPractice(
    { gameType: 'normal' },
    {
      repo: null,
      clock,
      scheduler: new ManualScheduler(clock),
      pool: smallPool(1, 'normal'),
      track: () => undefined,
    },
  );
  useGameStore.setState({ session, view: session.getView(), lastUpdate: null });
  await render(<GameRoute />);
  expect(screen.getByTestId('game')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'סיום אימון' }));
  await fireEvent.press(screen.getByRole('button', { name: 'כן, לסיים' }));
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/results/[id]', params: { id: session.id } });
});

describe('an online game', () => {
  it('its connecting and lobby; "יציאה מהחדר" goes back, and the session goes with the screen', async () => {
    const g = onlineSession();
    useGameStore.setState({ online: g.session, session: null, view: null, lastUpdate: null });
    const view = await render(<GameRoute />);
    expect(screen.getByTestId('connecting')).toBeOnTheScreen();
    await act(async () => {
      await g.session.ready;
      g.table.lobby();
      await elapse(g.table, 50);
    });
    expect(screen.getByTestId('lobby')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('lobby-leave'));
    expect(router.back).toHaveBeenCalled();
    // Still drawn under the transition; let go of as the screen goes.
    expect(useGameStore.getState().online).toBe(g.session);
    await view.unmount();
    expect(useGameStore.getState().online).toBeNull();
    expect(g.table.room.left).toBe(true);
    expect(router.replace).not.toHaveBeenCalledWith('/');
  });

  it('the game, and its end opens the results; the session stays for them', async () => {
    const g = await liveOnlineSession();
    useGameStore.setState({ online: g.session, session: null, view: null, lastUpdate: null });
    const view = await render(<GameRoute />);
    expect(screen.getByTestId('game')).toBeOnTheScreen();
    await act(async () => {
      g.table.opponent({ type: 'surrender' });
      await elapse(g.table, 100);
    });
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/results/[id]', params: { id: 'online-1' } });
    await view.unmount();
    expect(useGameStore.getState().online).toBe(g.session);
    expect(g.session.getView().players.find((p) => p.id === OPP)?.status).toBe('surrendered');
  });

  it('"חזרה לבית" on a refusal leaves for Home; "נסה שוב" joins again', async () => {
    const table = new FakeTable();
    table.offline = true;
    const g = {
      table,
      session: new OnlineSession({ host: table.host, request: { kind: 'join', code: 'ABC234' } }),
    };
    useGameStore.setState({ online: g.session, session: null, view: null, lastUpdate: null });
    const retry = jest.spyOn(useGameStore.getState(), 'retryOnline').mockReturnValue(null);
    await render(<GameRoute />);
    await act(async () => {
      await g.session.ready;
    });
    expect(screen.getByTestId('connection-error')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(retry).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה לבית' }));
    expect(router.dismissTo).toHaveBeenCalledWith('/');
    retry.mockRestore();
  });
});
