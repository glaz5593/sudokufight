import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ResultsRoute from '../../../../app/results/[id]';
import { useGameStore } from '../../../game/gameStore';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { lostDuel } from '../testing/duelGames';
import { endedPractice, move, savedPractice } from '../testing/practiceGames';

/** The /results/[id] route: reads the saved game (flushing the store's session first) and leaves the flow. */

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));
jest.mock('../../../game/storage', () => ({ practiceStorageOrNull: jest.fn() }));

const { router, useLocalSearchParams } = jest.requireMock<{
  router: { dismissTo: jest.Mock };
  useLocalSearchParams: jest.Mock;
}>('expo-router');
const storage = jest.requireMock<{ practiceStorageOrNull: jest.Mock }>('../../../game/storage');

const settle = () =>
  act(async () => {
    await new Promise((r) => setImmediate(r));
  });

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

afterEach(() => useGameStore.setState({ session: null, view: null, lastUpdate: null }));

it('shows the game that just ended once it is on disk; "לבית" leaves the flow', async () => {
  const game = await savedPractice();
  move(game, game.cells[0]!, 2_000);
  game.session.endPractice(); // still being written
  storage.practiceStorageOrNull.mockResolvedValue(game.repo);
  useGameStore.setState({ session: game.session, view: game.session.getView(), lastUpdate: null });
  useLocalSearchParams.mockReturnValue({ id: game.session.id });

  await render(<ResultsRoute />);
  await settle();
  expect(screen.getByRole('header', { name: 'האימון הסתיים' })).toBeOnTheScreen();
  expect(screen.getByLabelText('מהלכים נכונים: 1')).toBeOnTheScreen();
  expect((await game.repo.getGame(game.session.id))?.status).toBe('finished');

  await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
  expect(router.dismissTo).toHaveBeenCalledWith('/');
  expect(useGameStore.getState().session).toBeNull();
});

it('after a restart (no session) reads the database; "משחק חדש" goes to the game type, same type', async () => {
  const game = await endedPractice();
  storage.practiceStorageOrNull.mockResolvedValue(game.repo);
  useLocalSearchParams.mockReturnValue({ id: game.session.id });

  await render(<ResultsRoute />);
  await settle();
  expect(screen.getByLabelText('מהלכים נכונים: 2')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
  expect(router.dismissTo).toHaveBeenCalledWith({ pathname: '/game-type', params: { gameType: 'fast' } });
});

it('a practice against a bot: its headline, and "משחק חדש" keeps the bot mode', async () => {
  const game = await lostDuel();
  storage.practiceStorageOrNull.mockResolvedValue(game.repo);
  useLocalSearchParams.mockReturnValue({ id: game.id });

  await render(<ResultsRoute />);
  await settle();
  expect(screen.getByRole('header', { name: 'הפסד' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
  expect(router.dismissTo).toHaveBeenCalledWith({
    pathname: '/game-type',
    params: { gameType: 'fast', mode: 'bot' },
  });
});
