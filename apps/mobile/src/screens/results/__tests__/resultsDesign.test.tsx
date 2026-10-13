import { toView } from '@sudoku-fight/engine';
import { act, render, screen, within } from '@testing-library/react-native';

import { paletteAt } from '../../../components/player';
import i18n from '../../../i18n';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { BOT } from '../../game/testing/duel';
import { fourPlayerGame, type Table } from '../../replay/testing/games';
import { loadPracticeResults, type ResultsSession, sessionResultsModel } from '../resultsModel';
import { ResultsScreen } from '../ResultsScreen';
import { lostDuel } from '../testing/duelGames';

/**
 * Stage 13 design QA of the results (Results-Victory, Results-Defeat, Results-4P; spec §12): the headline of a
 * 3–4 player game behind the winner is the place ("מקום 2!"), the final place is always said ("מקום 1 מתוך
 * 2", "מתוך 4 שחקנים"), the header names the number of players, and every name in the ranking has its seat
 * shape (● ▲ ■ ◆, spec §22), in Hebrew and in English.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));

const hidden = { includeHiddenElements: true };

const sessionOf = (table: Table, me: string): ResultsSession => ({
  id: table.config.id,
  mode: table.config.mode,
  gameType: table.config.gameType,
  playerId: me,
  getView: () => toView(table.state, me, table.now),
});

async function show(table: Table, me: string) {
  const model = sessionResultsModel(sessionOf(table, me))!;
  await render(
    <ResultsScreen
      gameId={model.gameId}
      load={async () => ({ kind: 'found', model })}
      onNewGame={jest.fn()}
      onHome={jest.fn()}
    />,
  );
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  return model;
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  useProfile.setState({ avatarId: 'lava-lamp' });
});

describe('Results-4P: the place is the headline behind the winner', () => {
  const table = fourPlayerGame();
  const ranking = table.state.result!.ranking;
  const winner = ranking.find((r) => r.place === 1)!.playerId;
  const second = ranking.find((r) => r.place === 2)!.playerId;
  const type = (lng: 'he' | 'en') => i18n.t(`game:type.${table.config.gameType}`, { lng });

  it('first: "ניצחון!" and "מקום 1 מתוך 4"', async () => {
    await show(table, winner);
    expect(screen.getByRole('header', { name: 'ניצחון!' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-place')).toHaveTextContent('מקום 1 מתוך 4');
    expect(screen.getByText(`משחק מדורג · ${type('he')} · 4 שחקנים`)).toBeOnTheScreen();
  });

  it('second: "מקום 2!" (not "הפסד"), "מתוך 4 שחקנים"', async () => {
    await show(table, second);
    expect(screen.getByRole('header', { name: 'מקום 2!' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'הפסד' })).toBeNull();
    expect(screen.getByTestId('results-place')).toHaveTextContent('מתוך 4 שחקנים');
  });

  it('in English: "Place 2!", "out of 4 players", and the header with the players', async () => {
    await i18n.changeLanguage('en');
    await show(table, second);
    expect(screen.getByRole('header', { name: 'Place 2!' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-place')).toHaveTextContent('out of 4 players');
    expect(screen.getByText(`Ranked game · ${type('en')} · 4 players`)).toBeOnTheScreen();
  });

  it('every player in the podium and the 4th row has their seat shape; mine is the ●', async () => {
    const model = await show(table, second);
    for (const r of model.ranking) {
      const row = screen.getByTestId(
        r.place === 4 ? `results-ranking-4-${r.playerId}` : `results-podium-${r.place}-${r.playerId}`,
      );
      expect(within(row).getByTestId(`glyph-${paletteAt(r.colorIndex).shapeName}`, hidden)).toBeTruthy();
    }
    const mine = model.ranking.find((r) => r.isMe)!;
    expect(paletteAt(mine.colorIndex).shapeName).toBe('circle');
  });

  it('the two actions sit side by side: "משחק חדש" (the gold one) and "צפייה חוזרת"', async () => {
    await show(table, winner);
    const newGame = screen.getByTestId('results-new-game');
    const replay = screen.getByTestId('results-replay');
    // The primary draws its hard shadow; the secondary is an outline.
    expect(screen.getByTestId('results-new-game-shadow', hidden)).toBeTruthy();
    expect(screen.queryByTestId('results-replay-shadow', hidden)).toBeNull();
    expect(newGame.parent?.parent).toBe(replay.parent?.parent);
  });
});

describe('Results-Defeat against a bot', () => {
  it('"הפסד", "מקום 2 מתוך 2" in plain (not gold), and the bot’s ▲ before its name', async () => {
    const game = await lostDuel();
    await render(
      <ResultsScreen
        gameId={game.id}
        load={(id) => loadPracticeResults(id, { repo: async () => game.repo, session: () => null })}
        onNewGame={jest.fn()}
        onHome={jest.fn()}
      />,
    );
    await act(async () => {
      await new Promise((r) => setImmediate(r));
    });
    expect(screen.getByRole('header', { name: 'הפסד' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-place')).toHaveTextContent('מקום 2 מתוך 2');
    const row = screen.getByTestId(`results-opponent-${BOT.id}`);
    expect(within(row).getByTestId('glyph-triangle', hidden)).toBeTruthy();
  });
});
