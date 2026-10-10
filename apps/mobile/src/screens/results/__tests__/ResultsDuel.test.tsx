import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { formatScore, ltr, scoreText } from '../../../components/player';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { formatSeconds } from '../../game/model';
import { BOT } from '../../game/testing/duel';
import { loadPracticeResults, type ResultsLoad, resultsModel } from '../resultsModel';
import { ResultsScreen, type ResultsScreenProps } from '../ResultsScreen';
import { endedDuel, lostDuel, type SavedDuel, tiedRecord, wonDuel } from '../testing/duelGames';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../services/feedback');

const hidden = { includeHiddenElements: true };

/** Reads the saved game from the practice's database, as after a restart. */
const fromDisk = (game: SavedDuel) => (id: string) =>
  loadPracticeResults(id, { repo: async () => game.repo, session: () => null });

async function show(
  load: (id: string) => Promise<ResultsLoad>,
  id: string,
  props: Partial<ResultsScreenProps> = {},
) {
  const onNewGame = jest.fn();
  const onHome = jest.fn();
  await render(<ResultsScreen gameId={id} load={load} onNewGame={onNewGame} onHome={onHome} {...props} />);
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  return { onNewGame, onHome };
}

/** A tie, from a won game's record (see tiedRecord). */
async function tiedLoad(game: SavedDuel) {
  const saved = (await game.repo.getGame(game.id))!;
  const events = await game.repo.loadEvents(game.id);
  const model = resultsModel(tiedRecord(saved, BOT.id), events);
  return async (): Promise<ResultsLoad> => ({ kind: 'found', model });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

describe('ResultsScreen against a bot (spec §12)', () => {
  it('a win: the headline, how it ended, my numbers, the bot’s row, the awards, and no rating change', async () => {
    const game = await wonDuel();
    const view = game.host.getView();
    const me = view.players[0]!;
    const result = view.result!;
    await show(fromDisk(game), game.id);

    expect(screen.getByRole('header', { name: 'ניצחון!' })).toBeOnTheScreen();
    expect(screen.getByText('אימון מול בוט · מהיר')).toBeOnTheScreen();
    expect(screen.getByTestId('results-end')).toHaveTextContent('איך זה נגמר: הלוח התמלא');
    expect(screen.getByLabelText(`ניקוד סופי: ${scoreText(me.score)} נקודות`)).toBeOnTheScreen();
    expect(screen.getByLabelText('טעויות: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText(`מהלכים נכונים: ${game.cells.length}`)).toBeOnTheScreen();
    expect(screen.getByTestId('results-best-line', hidden)).toHaveTextContent(/points = 9 −/);

    // The opponent: avatar (with the bot chip), name, score, mistakes.
    const row = screen.getByTestId(`results-opponent-${BOT.id}`);
    expect(row).toHaveProp('accessibilityLabel', 'Mr. Hoot · 0 נקודות · אין טעויות');
    expect(within(row).getByTestId('bot-chip', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId(`results-opponent-${BOT.id}-score`, hidden)).toHaveTextContent('0');

    // The awards: mine say "אני", the bot's its name.
    const best = result.awards.find((a) => a.kind === 'bestMove')!;
    expect(screen.getByTestId('results-award-bestMove')).toHaveProp(
      'accessibilityLabel',
      `המהלך הטוב ביותר: אני, ${ltr(formatScore(best.value))} נק׳. הניקוד הגבוה ביותר במהלך בודד`,
    );
    expect(screen.getByTestId('results-award-fewestMistakes')).toHaveProp(
      'accessibilityLabel',
      'הכי מעט טעויות: Mr. Hoot, טעויות: 0. הכי מעט טעויות. בתיקו, הניקוד הגבוה יותר',
    );
    const fastest = result.awards.find((a) => a.kind === 'fastest')!;
    expect(screen.getByTestId('results-award-fastest')).toHaveProp(
      'accessibilityLabel',
      `הכי מהיר: אני, ${formatSeconds(fastest.value)} ש׳ למהלך. זמן החשיבה הממוצע הנמוך ביותר למהלך נכון (לפחות 5 מהלכים)`,
    );
    expect(screen.getByTestId('results-unrated')).toHaveTextContent('אימון: אין שינוי בדירוג');
    expect(feedback.cue).not.toHaveBeenCalled();
  });

  it('a loss: "הפסד", and the bot’s winning score in its row', async () => {
    const game = await lostDuel();
    const bot = game.host.getView().players[1]!;
    await show(fromDisk(game), game.id);
    expect(screen.getByRole('header', { name: 'הפסד' })).toBeOnTheScreen();
    expect(screen.getByTestId(`results-opponent-${BOT.id}`)).toHaveProp(
      'accessibilityLabel',
      `Mr. Hoot · ${scoreText(bot.score)} נקודות · אין טעויות`,
    );
    expect(screen.getByLabelText('מהלכים נכונים: 1')).toBeOnTheScreen();
  });

  it('a practice I ended: a loss, said as "סיימת את האימון…"', async () => {
    const game = await endedDuel();
    await show(fromDisk(game), game.id);
    expect(screen.getByRole('header', { name: 'הפסד' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-end')).toHaveTextContent(
      'איך זה נגמר: סיימת את האימון לפני שהלוח התמלא',
    );
  });

  it('a tie: "תיקו"', async () => {
    const game = await wonDuel();
    await show(await tiedLoad(game), game.id);
    expect(screen.getByRole('header', { name: 'תיקו' })).toBeOnTheScreen();
    expect(screen.queryByTestId('results-awards')).toBeNull();
  });

  it('just played: a win sounds the win, a loss the loss', async () => {
    jest.useFakeTimers();
    try {
      const won = await wonDuel();
      await render(
        <ResultsScreen
          gameId={won.id}
          load={fromDisk(won)}
          celebrate
          onNewGame={jest.fn()}
          onHome={jest.fn()}
        />,
      );
      await act(async () => {
        await jest.runOnlyPendingTimersAsync();
      });
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      expect(feedback.cue).toHaveBeenCalledWith('win');

      feedback.cue.mockClear();
      const lost = await lostDuel();
      await render(
        <ResultsScreen
          gameId={lost.id}
          load={fromDisk(lost)}
          celebrate
          onNewGame={jest.fn()}
          onHome={jest.fn()}
        />,
      );
      await act(async () => {
        await jest.runOnlyPendingTimersAsync();
      });
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      expect(feedback.cue).toHaveBeenCalledWith('lose');
    } finally {
      jest.useRealTimers();
    }
  });

  it('"משחק חדש" asks for the same kind of game: the type and the bot mode', async () => {
    const game = await lostDuel();
    const { onNewGame } = await show(fromDisk(game), game.id);
    await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
    expect(onNewGame).toHaveBeenCalledWith('fast', 'bot');
  });
});

describe('ResultsScreen against a bot, in English', () => {
  it('win, loss and tie headlines; the opponent, the awards and the rating note', async () => {
    await i18n.changeLanguage('en');
    const won = await wonDuel();
    await show(fromDisk(won), won.id);
    expect(screen.getByRole('header', { name: 'Victory!' })).toBeOnTheScreen();
    expect(screen.getByText('Practice vs bot · Fast')).toBeOnTheScreen();
    expect(screen.getByTestId('results-end')).toHaveTextContent('How it ended: The board filled up');
    expect(screen.getByRole('header', { name: 'Opponent' })).toBeOnTheScreen();
    expect(screen.getByTestId(`results-opponent-${BOT.id}`)).toHaveProp(
      'accessibilityLabel',
      'Mr. Hoot · 0 points · No mistakes',
    );
    expect(screen.getByRole('header', { name: 'Game awards' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-award-fewestMistakes')).toHaveProp(
      'accessibilityLabel',
      'Fewest mistakes: Mr. Hoot, Mistakes: 0. The fewest mistakes. On a tie, the higher score',
    );
    expect(screen.getByTestId('results-unrated')).toHaveTextContent('Practice: your rating does not change');

    const lost = await lostDuel();
    await show(fromDisk(lost), lost.id);
    expect(screen.getByRole('header', { name: 'Defeat' })).toBeOnTheScreen();

    await show(await tiedLoad(won), won.id);
    expect(screen.getByRole('header', { name: 'Draw' })).toBeOnTheScreen();
  });
});
