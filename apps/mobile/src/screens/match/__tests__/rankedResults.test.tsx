import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ResultsRoute from '../../../../app/results/[id]';
import { refreshMe, useAuth } from '../../../auth/authStore';
import { OnlineSession } from '../../../game/onlineSession';
import { useGameStore } from '../../../game/gameStore';
import i18n from '../../../i18n';
import { deviceMatchmakingDeps } from '../../../net/matchmakingDevice';
import { FakeMatchmaking, RESERVATION } from '../../../net/testing/fakeMatchmaking';
import { elapse, FakeTable } from '../../../net/testing/fakeServer';
import { useSettings } from '../../../state/settings';

/**
 * After a ranked game from matchmaking (stage 9): the results' "משחק חדש" searches the same queue again,
 * and leaving the results reads the account's ratings again (GET /v1/me), so Home shows the new one.
 */

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), dismissTo: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../game/storage', () => ({ practiceStorageOrNull: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../../net/matchmakingDevice', () => ({ deviceMatchmakingDeps: jest.fn() }));
jest.mock('../../../auth/authStore', () => ({
  ...jest.requireActual<object>('../../../auth/authStore'),
  refreshMe: jest.fn(() => Promise.resolve()),
}));

const { router, useLocalSearchParams } = jest.requireMock<{
  router: { replace: jest.Mock; dismissTo: jest.Mock };
  useLocalSearchParams: jest.Mock;
}>('expo-router');

const settle = () =>
  act(async () => {
    await new Promise((r) => setImmediate(r));
  });

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  useAuth.setState({
    status: 'ready',
    user: { uid: 'u1', email: 'moshe@example.com', emailVerified: true },
  });
});

afterEach(() => {
  useGameStore.getState().clear();
  useAuth.setState({ status: 'loading', user: null, me: null });
});

/** A ranked game from the queue fast-2p, over (I surrendered). */
async function finishedMatch() {
  const table = new FakeTable();
  const session = new OnlineSession({
    host: table.host,
    request: { kind: 'match', queueKey: 'fast-2p', matchId: 'match-1', reservation: RESERVATION },
  });
  await session.ready;
  table.lobby();
  table.startGame();
  await elapse(table, 300);
  session.endPractice();
  await elapse(table, 200);
  expect(session.getView().status).toBe('over');
  return { table, session };
}

it('"משחק חדש" after a ranked game searches the same queue, and the ratings are read again', async () => {
  const { session } = await finishedMatch();
  const clock = new ManualClock(1_000_000);
  const mm = new FakeMatchmaking(clock, new ManualScheduler(clock));
  jest.mocked(deviceMatchmakingDeps).mockReturnValue({
    connector: mm,
    clock,
    scheduler: mm.scheduler,
    makeHost: () => new FakeTable().host,
  });
  useGameStore.setState({ online: session, session: null });
  useLocalSearchParams.mockReturnValue({ id: session.id });

  await render(<ResultsRoute />);
  await settle();
  expect(screen.getByRole('header', { name: 'הפסד' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
  expect(refreshMe).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/match');
  expect(useGameStore.getState().match?.queueKey).toBe('fast-2p');
  expect(useGameStore.getState().online).toBeNull();
  expect(session.online.status).toBe('closed');
  await settle();
  expect(mm.joins).toEqual(['fast-2p']);
});

it('"לבית" after a ranked game reads the ratings again too', async () => {
  const { session } = await finishedMatch();
  useGameStore.setState({ online: session, session: null });
  useLocalSearchParams.mockReturnValue({ id: session.id });
  await render(<ResultsRoute />);
  await settle();
  await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
  expect(router.dismissTo).toHaveBeenCalledWith('/');
  expect(refreshMe).toHaveBeenCalledTimes(1);
});
