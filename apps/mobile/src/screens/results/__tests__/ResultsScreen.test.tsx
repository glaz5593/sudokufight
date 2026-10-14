import { formatScoreLine } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { formatScore, ltr, scoreText, signedText } from '../../../components/player';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { formatClock } from '../../game/model';
import { loadPracticeResults, type ResultsLoad } from '../resultsModel';
import { ResultsScreen, type ResultsScreenProps } from '../ResultsScreen';
import {
  completedPractice,
  endedPractice,
  interruptedPractice,
  type SavedPractice,
} from '../testing/practiceGames';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../services/feedback');
jest.mock('../../../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});
const crash = jest
  .requireMock<{ crashReporter: () => { recordError: jest.Mock } }>('../../../services/crashlytics')
  .crashReporter();

const hidden = { includeHiddenElements: true };

/** Reads the saved game from the practice's database, as after a restart (no session around). */
const fromDisk = (game: SavedPractice) => (id: string) =>
  loadPracticeResults(id, { repo: async () => game.repo, session: () => null });

async function show(
  load: (id: string) => Promise<ResultsLoad>,
  id: string,
  props: Partial<ResultsScreenProps> = {},
) {
  const onNewGame = jest.fn();
  const onHome = jest.fn();
  await render(<ResultsScreen gameId={id} load={load} onNewGame={onNewGame} onHome={onHome} {...props} />);
  // The load resolves on the next turns.
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  return { onNewGame, onHome };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

describe('ResultsScreen (solo practice, spec §12)', () => {
  it('a practice ended early: score, mistakes, the move of the game with its calculation, time, moves, think time', async () => {
    const game = await endedPractice();
    const me = game.session.getView().players[0]!;
    const best = me.bestMove!;
    await show(fromDisk(game), game.session.id);

    expect(screen.getByRole('header', { name: 'האימון הסתיים' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-end')).toHaveTextContent(
      'איך זה נגמר: סיימת את האימון לפני שהלוח התמלא',
    );
    expect(screen.getByText('אימון לבד · מהיר')).toBeOnTheScreen();
    expect(screen.getByTestId('results-score', hidden)).toHaveTextContent(scoreText(me.score));
    expect(screen.getByLabelText(`ניקוד סופי: ${scoreText(me.score)} נקודות`)).toBeOnTheScreen();

    expect(screen.getByTestId('results-best-line', hidden)).toHaveTextContent(
      ltr(formatScoreLine(best.breakdown)),
    );
    expect(screen.getByTestId('results-best', hidden)).toHaveTextContent(signedText(best.points), {
      exact: false,
    });
    expect(screen.getByTestId('results-best')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`מהלך המשחק: ${ltr(formatScore(best.points))} נקודות`),
    );

    expect(screen.getByLabelText(`זמן משחק: ${formatClock(10_000)}`)).toBeOnTheScreen();
    expect(screen.getByLabelText('טעויות: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('מהלכים נכונים: 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('זמן חשיבה ממוצע: 2.5 ש׳')).toBeOnTheScreen();
    expect(feedback.cue).not.toHaveBeenCalled();
  });

  it('an interrupted practice says so, with the numbers its log reached', async () => {
    const game = await interruptedPractice();
    await show(fromDisk(game), game.session.id);
    expect(screen.getByRole('header', { name: 'האימון נקטע' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-end')).toHaveTextContent(
      'איך זה נגמר: האימון נעצר באמצע, למשל כשהאפליקציה נסגרה',
    );
    expect(screen.getByLabelText('טעויות: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('מהלכים נכונים: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('זמן חשיבה ממוצע: 2.5 ש׳')).toBeOnTheScreen();
    expect(screen.getByTestId('results-best-line', hidden)).toHaveTextContent(/points = 9 −/);
  });

  it('a full board just played gets its title and its fanfare', async () => {
    jest.useFakeTimers();
    try {
      const game = await completedPractice();
      await render(
        <ResultsScreen
          gameId={game.session.id}
          load={fromDisk(game)}
          celebrate
          onNewGame={jest.fn()}
          onHome={jest.fn()}
        />,
      );
      await act(async () => {
        await jest.runOnlyPendingTimersAsync();
      });
      expect(screen.getByRole('header', { name: 'הלוח הושלם!' })).toBeOnTheScreen();
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      expect(feedback.cue).toHaveBeenCalledWith('practiceDone');
    } finally {
      jest.useRealTimers();
    }
  });

  it('the buttons: a new game of the same type, home, and the replay of this game (stage 11)', async () => {
    const game = await endedPractice();
    const onReplay = jest.fn();
    const { onNewGame, onHome } = await show(fromDisk(game), game.session.id, { onReplay });
    await fireEvent.press(screen.getByRole('button', { name: 'משחק חדש' }));
    expect(onNewGame).toHaveBeenCalledWith('fast');
    const replay = screen.getByRole('button', { name: 'צפייה חוזרת' });
    expect(replay).toBeEnabled();
    expect(replay).toHaveProp('accessibilityHint', 'המשחק מההתחלה, שלב אחרי שלב, עם הסבר לכל מהלך');
    await fireEvent.press(replay);
    expect(onReplay).toHaveBeenCalledWith(game.session.id, 'solo');
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    const game = await endedPractice();
    await show(fromDisk(game), game.session.id);
    expect(screen.getByRole('header', { name: 'Practice ended' })).toBeOnTheScreen();
    expect(screen.getByText('Solo practice · Fast')).toBeOnTheScreen();
    expect(screen.getByLabelText('Mistakes: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Avg. think time: 2.5 s')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'New game' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Home' })).toBeOnTheScreen();
  });

  it('an interrupted practice in English', async () => {
    await i18n.changeLanguage('en');
    const game = await interruptedPractice();
    await show(fromDisk(game), game.session.id);
    expect(screen.getByRole('header', { name: 'Practice interrupted' })).toBeOnTheScreen();
  });

  it('shows a loading state, then a missing or unreadable game with a way home', async () => {
    let resolve: (r: ResultsLoad) => void = () => undefined;
    const pending = new Promise<ResultsLoad>((r) => (resolve = r));
    const onHome = jest.fn();
    await render(<ResultsScreen gameId="x" load={() => pending} onNewGame={jest.fn()} onHome={onHome} />);
    expect(screen.getByText('טוען את התוצאה…')).toBeOnTheScreen();
    await act(async () => resolve({ kind: 'missing' }));
    expect(screen.getByRole('header', { name: 'לא מצאנו את האימון הזה' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(onHome).toHaveBeenCalled();

    await render(
      <ResultsScreen
        gameId="y"
        load={async () => ({ kind: 'unavailable' })}
        onNewGame={jest.fn()}
        onHome={onHome}
      />,
    );
    await act(async () => undefined);
    expect(screen.getByRole('header', { name: 'לא הצלחנו לקרוא את האימונים השמורים' })).toBeOnTheScreen();
  });

  it('a load that fails is reported, and says so with a way home: never a spinner for ever (bug 9)', async () => {
    const boom = new Error('could not read');
    const onHome = jest.fn();
    await render(
      <ResultsScreen gameId="z" load={() => Promise.reject(boom)} onNewGame={jest.fn()} onHome={onHome} />,
    );
    await act(async () => undefined);
    expect(screen.getByRole('header', { name: 'לא הצלחנו לקרוא את האימונים השמורים' })).toBeOnTheScreen();
    expect(crash.recordError).toHaveBeenCalledWith(boom, 'results: could not load');
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(onHome).toHaveBeenCalled();
  });
});
