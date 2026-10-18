import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import GameRoute from '../../../../app/game';
import { useGameStore } from '../../../game/gameStore';
import { type PracticeSession, startPractice } from '../../../game/session';
import { smallPool } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { OnlineSession } from '../../../game/onlineSession';
import { elapse, FakeTable } from '../../../net/testing/fakeServer';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { FALLBACK_ACTIONS_MS } from '../../FlowFallback';
import { RESULTS_WATCHDOG_MS } from '../model';
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

it('without a practice in the store, goes home (a spinner meanwhile, never an empty screen)', async () => {
  await render(<GameRoute />);
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(screen.queryByTestId('game')).toBeNull();
  expect(screen.getByTestId('flow-fallback')).toBeOnTheScreen();
  expect(screen.getByText('רגע…')).toBeOnTheScreen();
});

it('without a game, should Home not come: "לבית" after a moment', async () => {
  jest.useFakeTimers();
  try {
    await render(<GameRoute />);
    router.replace.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(FALLBACK_ACTIONS_MS);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(router.replace).toHaveBeenCalledWith('/');
  } finally {
    jest.useRealTimers();
  }
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
  // The dialog slides up (as a player sees it before tapping "כן, לסיים").
  await act(() => new Promise((resolve) => setTimeout(resolve, motion.duration.sheetIn + 50)));
  await fireEvent.press(screen.getByRole('button', { name: 'כן, לסיים' }));
  // Only once the dialog has left the screen (its onExited), never while it still slides away.
  expect(router.replace).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/results/[id]' }));
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/results/[id]', params: { id: session!.id } }),
  );
});

it('the practice’s game screen has a way home ("לבית" should its results not open): Home, the session let go', async () => {
  jest.useFakeTimers();
  const clock = new ManualClock(1_700_000_000_000);
  try {
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
    session.endPractice();
    useGameStore.setState({ session, view: session.getView(), lastUpdate: null });
    const view = await render(<GameRoute />);
    // The results are asked for, and (router mocked) never come: the watchdog's way out.
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/results/[id]', params: { id: session.id } });
    await act(async () => {
      jest.advanceTimersByTime(RESULTS_WATCHDOG_MS);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(router.dismissTo).toHaveBeenCalledWith('/');
    await view.unmount();
    expect(useGameStore.getState().session).toBeNull();
  } finally {
    jest.useRealTimers();
  }
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
    // The final board holds first (motion.md game.end), and the results open from a timer.
    expect(router.replace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({ pathname: '/results/[id]', params: { id: 'online-1' } }),
    );
    expect(router.replace).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(useGameStore.getState().online).toBe(g.session);
    expect(g.session.getView().players.find((p) => p.id === OPP)?.status).toBe('surrendered');
  });

  it('"לבית" on a refusal leaves for Home; "נסה שוב" joins again', async () => {
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
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(router.dismissTo).toHaveBeenCalledWith('/');
    retry.mockRestore();
  });
});
