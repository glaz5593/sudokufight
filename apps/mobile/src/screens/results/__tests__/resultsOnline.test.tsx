import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ResultsRoute from '../../../../app/results/[id]';
import { useGameStore } from '../../../game/gameStore';
import i18n from '../../../i18n';
import { elapse } from '../../../net/testing/fakeServer';
import { useSettings } from '../../../state/settings';
import { liveOnlineSession, OPP } from '../../game/testing/online';
import { loadOnlineResults } from '../resultsModel';
import { ResultsScreen } from '../ResultsScreen';

/**
 * The results of an online (ranked) game (work plan stage 7, spec §12): from the store's online session (the
 * phone saves nothing), with the win by abandonment's "ניצחת בנטישה" tag, and no rating change yet (stage 9).
 */

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../game/storage', () => ({ practiceStorageOrNull: jest.fn(() => Promise.resolve(null)) }));

const { router, useLocalSearchParams } = jest.requireMock<{
  router: { dismissTo: jest.Mock };
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
});

afterEach(() => useGameStore.getState().clear());

/** A ranked game the opponent left: they drop and stay away past the (short) grace. */
async function wonByAbandonment() {
  const game = await liveOnlineSession({ rules: { graceMs: 1000 } });
  game.table.game!.apply({ type: 'disconnect', playerId: OPP });
  await elapse(game.table, 1500);
  expect(game.session.getView().status).toBe('over');
  return game;
}

/** A ranked game I surrendered. */
async function surrendered() {
  const game = await liveOnlineSession();
  game.session.endPractice();
  await elapse(game.table, 200);
  expect(game.session.getView().status).toBe('over');
  return game;
}

describe('loadOnlineResults', () => {
  it('the session’s game once it is over; anything else is missing', async () => {
    const running = await liveOnlineSession();
    expect(loadOnlineResults('online-1', running.session)).toEqual({ kind: 'missing' });
    expect(loadOnlineResults('online-1', null)).toEqual({ kind: 'missing' });
    running.session.close();

    const { session } = await wonByAbandonment();
    expect(loadOnlineResults('another-game', session)).toEqual({ kind: 'missing' });
    const found = loadOnlineResults('online-1', session);
    expect(found).toMatchObject({
      kind: 'found',
      model: {
        mode: 'ranked',
        players: 2,
        outcome: 'win',
        place: 1,
        end: 'opponentLeft',
        abandonWin: true,
        saved: false,
      },
    });
    session.close();
  });
});

describe('ResultsScreen, ranked', () => {
  it('a win by abandonment: "ניצחון!" with the "ניצחת בנטישה" tag, and no rating change yet', async () => {
    const { session } = await wonByAbandonment();
    await render(
      <ResultsScreen
        gameId="online-1"
        load={(id) => Promise.resolve(loadOnlineResults(id, session))}
        onNewGame={jest.fn()}
        onHome={jest.fn()}
      />,
    );
    await settle();
    expect(screen.getByRole('header', { name: 'ניצחון!' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-abandon-win')).toHaveTextContent('ניצחת בנטישה');
    // Results-Victory: the mode, the type and the number of players; my place (spec §12 "מקום סופי").
    expect(screen.getByText('משחק מדורג · מהיר · 2 שחקנים')).toBeOnTheScreen();
    expect(screen.getByTestId('results-place')).toHaveTextContent('מקום 1 מתוך 2');
    expect(screen.getByTestId('results-end')).toHaveTextContent('איך זה נגמר: היריב איבד חיבור ולא חזר בזמן');
    expect(screen.getByTestId('results-unrated')).toHaveTextContent('חדר פרטי: הדירוג עוד לא מתעדכן');
    expect(screen.queryByText('האימון הזה לא נשמר במכשיר')).toBeNull();
    expect(screen.getByTestId(`results-opponent-${OPP}`)).toHaveTextContent(/Rival/);
    session.close();
  });

  it('my surrender: "הפסד", no tag (English too)', async () => {
    const { session } = await surrendered();
    const load = (id: string) => Promise.resolve(loadOnlineResults(id, session));
    const view = await render(
      <ResultsScreen gameId="online-1" load={load} onNewGame={jest.fn()} onHome={jest.fn()} />,
    );
    await settle();
    expect(screen.getByRole('header', { name: 'הפסד' })).toBeOnTheScreen();
    expect(screen.queryByTestId('results-abandon-win')).toBeNull();
    expect(screen.getByTestId('results-end')).toHaveTextContent('איך זה נגמר: נכנעת לפני שהלוח התמלא');
    await view.unmount();

    await i18n.changeLanguage('en');
    await render(<ResultsScreen gameId="online-1" load={load} onNewGame={jest.fn()} onHome={jest.fn()} />);
    await settle();
    expect(screen.getByRole('header', { name: 'Defeat' })).toBeOnTheScreen();
    expect(screen.getByText('Ranked game · Fast · 2 players')).toBeOnTheScreen();
    expect(screen.getByTestId('results-place')).toHaveTextContent('Place 2 of 2');
    expect(screen.getByTestId('results-unrated')).toHaveTextContent("Private room: ratings don't change yet");
    session.close();
  });
});

describe('/results/[id] after an online game', () => {
  it('reads the store’s online session; "משחק חדש" goes back to the dev rooms, "לבית" lets it go', async () => {
    const game = await wonByAbandonment();
    useGameStore.setState({ online: game.session, session: null });
    useLocalSearchParams.mockReturnValue({ id: 'online-1' });

    const view = await render(<ResultsRoute />);
    await settle();
    expect(screen.getByRole('header', { name: 'ניצחון!' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
    expect(router.dismissTo).toHaveBeenCalledWith('/dev/online');
    expect(useGameStore.getState().online).toBeNull();
    expect(game.session.online.status).toBe('closed');
    await view.unmount();

    const again = await surrendered();
    useGameStore.setState({ online: again.session, session: null });
    await render(<ResultsRoute />);
    await settle();
    expect(screen.getByRole('header', { name: 'הפסד' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(router.dismissTo).toHaveBeenLastCalledWith('/');
    expect(useGameStore.getState().online).toBeNull();
  });
});
