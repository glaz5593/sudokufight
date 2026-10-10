import { cellName, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { formatScore, ltr, scoreText, signedText } from '../../../components/player';
import { puzzleById } from '../../../game/offlinePool';
import { type PracticeSession, startPractice } from '../../../game/session';
import { answerIn, emptyCellsOf, smallPool, wrongIn } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { GameScreen } from '../GameScreen';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
// The cues are the feedback service's business (sound + haptic, own tests); here: which ones the screen plays.
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));
const feedback = jest.requireMock<{ cue: jest.Mock; preloadCues: jest.Mock; cueCountUp: jest.Mock }>(
  '../../../services/feedback',
);
const cues = (): string[] => feedback.cue.mock.calls.map((c: unknown[]) => String(c[0]));

const hidden = { includeHiddenElements: true };

/** A solo practice on a manual clock, on the pool's first puzzle, not saved. */
async function practice() {
  const clock = new ManualClock(1_700_000_000_000);
  const scheduler = new ManualScheduler(clock);
  const session = await startPractice(
    { gameType: 'fast' },
    { repo: null, clock, scheduler, pool: smallPool(1), seed: 7, track: () => undefined },
  );
  const puzzle = puzzleById(session.puzzleId)!;
  const [a, b] = emptyCellsOf(puzzle);
  return { session, clock, scheduler, puzzle, a: a!, b: b! };
}

let running: PracticeSession | null = null;
async function show(onEnded = jest.fn()) {
  const game = await practice();
  running = game.session;
  await render(<GameScreen session={game.session} onEnded={onEnded} />);
  return { ...game, onEnded };
}

/** Moves the phone's timers on in frames, so every step of a count or a flight renders. */
async function frames(ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}

const press = async (testID: string) => fireEvent.press(screen.getByTestId(testID));
const score = () => screen.getByTestId('solo-hud-score', hidden);
const myScore = (session: PracticeSession) => session.getView().players[0]!.score;

/** The layouts the flights need (a 390 × 844 screen as on Dir-C-Game). */
async function layOut() {
  const layout = (testID: string, x: number, y: number, width: number, height: number) =>
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x, y, width, height } } });
  await layout('solo-hud', 16, 48, 358, 140);
  await layout('solo-hud-score-row', 0, 58, 200, 56);
  await layout('solo-hud-delta-slot', 70, 10, 44, 18);
  await layout('board-room', 0, 288, 390, 358);
  await layout('board-slot', 16, 0, 358, 358);
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

afterEach(() => {
  running?.close();
  running = null;
  jest.useRealTimers();
});

describe('GameScreen (solo practice)', () => {
  it('shows the practice, my card, the progress, an idle strip, the board and the keypad', async () => {
    const { puzzle } = await show();
    const givens = 81 - emptyCellsOf(puzzle).length;
    expect(screen.getByTestId('solo-hud-title', hidden)).toHaveTextContent('אימון לבד · מהיר');
    expect(screen.getByLabelText('אני · 0 נקודות · אין טעויות')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'סיום אימון' })).toBeEnabled();
    expect(screen.getByTestId('board-progress-value', hidden)).toHaveTextContent(ltr(`${givens}/81`));
    expect(screen.getByLabelText('בחר משבצת')).toBeOnTheScreen();
    expect(screen.getByTestId('board')).toBeOnTheScreen();
    expect(screen.getByTestId('keypad')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'ביטול בחירה' })).toBeDisabled();
    expect(feedback.preloadCues).toHaveBeenCalledTimes(1);
  });

  it('a tap locks the cell: the lock strip shows it, with the selection cue', async () => {
    const { a } = await show();
    const name = cellName(a);
    await press(`cell-${name}`);
    expect(cues()).toEqual(['cellSelect']);
    expect(screen.getByLabelText(`המשבצת שלך ${name}, נותרו 8 שניות`)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `ביטול בחירה, ${name}` })).toBeEnabled();

    await press('cancel-selection');
    expect(cues()).toEqual(['cellSelect', 'cellRelease']);
    expect(screen.getByLabelText('בחר משבצת')).toBeOnTheScreen();
  });

  it('ticks once a second in the lock’s last 3 seconds, then lets it go with no penalty', async () => {
    const { a, scheduler, session } = await show();
    await press(`cell-${cellName(a)}`);
    for (const ms of [5_000, 1_000, 1_000]) {
      await act(async () => scheduler.advance(ms));
      await frames(250);
    }
    expect(cues().filter((c) => c === 'lockTick')).toHaveLength(3);
    await act(async () => scheduler.advance(1_000));
    await frames(1_600); // the live region speaks at most every 1.5 s
    expect(cues()).toContain('lockExpired');
    expect(screen.getByLabelText('בחר משבצת')).toBeOnTheScreen();
    expect(myScore(session)).toBe(0);
    expect(screen.getByTestId('game-live')).toHaveTextContent(`הזמן נגמר, ${ltr(cellName(a))} שוחררה`);
  });

  it('a correct digit: the chip flies to my card, then the score counts up to it', async () => {
    const { a, puzzle, session } = await show();
    await layOut();
    await press(`cell-${cellName(a)}`);
    await press(`key-${answerIn(puzzle, a)}`);

    const points = myScore(session);
    expect(points).toBeGreaterThan(0);
    expect(cues()).toEqual(['cellSelect', 'correct']);
    const seq = session.events.find((e) => e.type === 'placedCorrect')!.seq;
    expect(screen.getByTestId(`flight-${seq}`, hidden)).toHaveTextContent(signedText(points));
    // The cell takes my colour at once; the card keeps the old score until the chip lands (R + 660).
    expect(screen.getByTestId(`cell-${cellName(a)}`)).toHaveProp(
      'accessibilityLabel',
      `${cellName(a)}, ${answerIn(puzzle, a)}, נפתרה על ידיך`,
    );
    expect(score()).toHaveTextContent('0');
    await frames(650);
    expect(score()).toHaveTextContent('0');
    expect(feedback.cueCountUp).not.toHaveBeenCalled();

    await frames(50);
    expect(feedback.cueCountUp).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('solo-hud-delta', hidden)).toHaveTextContent(signedText(points));
    await frames(700);
    expect(score()).toHaveTextContent(formatScore(points));
    expect(screen.queryByTestId(`flight-${seq}`, hidden)).toBeNull();
    expect(screen.getByLabelText(`אני · ${formatScore(points)} נקודות · אין טעויות`)).toBeOnTheScreen();
    expect(screen.getByTestId('game-live')).toHaveTextContent(
      `נכון: ${answerIn(puzzle, a)} ב־${ltr(cellName(a))}, ${signedText(points)}`,
    );
  });

  it('a wrong digit: red penalty, the small red digit stays, the mistake counts', async () => {
    const { b, puzzle, session } = await show();
    await layOut();
    const name = cellName(b);
    const digit = wrongIn(puzzle, b);
    await press(`cell-${name}`);
    await press(`key-${digit}`);

    expect(cues()).toEqual(['cellSelect', 'wrong']);
    expect(myScore(session)).toBe(-1);
    const cell = screen.getByTestId(`cell-${name}`);
    expect(cell).toHaveProp('accessibilityLabel', `${name}, ריקה, ספרות שגויות: ${digit}`);
    expect(screen.getByTestId('cell-wrong', hidden)).toHaveTextContent(String(digit));
    expect(screen.getByTestId('cell-flash-digit', hidden)).toHaveTextContent(String(digit));
    // The cell is let go of after a mistake [D3].
    expect(screen.getByLabelText('בחר משבצת')).toBeOnTheScreen();
    const seq = session.events.find((e) => e.type === 'placedWrong')!.seq;
    expect(screen.getByTestId(`flight-${seq}`, hidden)).toHaveTextContent(signedText(-1));

    await frames(1_500);
    expect(score()).toHaveTextContent(scoreText(-1));
    expect(screen.getByTestId('solo-hud-delta', hidden)).toHaveTextContent(signedText(-1));
    expect(screen.getByTestId('mistakes', hidden)).toHaveTextContent('1 טעות');
    expect(feedback.cueCountUp).not.toHaveBeenCalled(); // count ticks are for gains only
    expect(screen.getByTestId('game-live')).toHaveTextContent(
      `טעות: ${digit} לא מתאימה ל־${ltr(name)}, ${signedText(-1)}`,
    );
  });

  it('with reduced motion nothing flies: the delta shows beside the score, which jumps', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const { a, puzzle, session } = await show();
    await layOut();
    await press(`cell-${cellName(a)}`);
    await press(`key-${answerIn(puzzle, a)}`);
    const points = myScore(session);
    expect(screen.queryByTestId(/^flight-\d+$/, hidden)).toBeNull();
    expect(score()).toHaveTextContent(formatScore(points));
    expect(screen.getByTestId('solo-hud-delta', hidden)).toHaveTextContent(signedText(points));
    expect(cues()).toEqual(['cellSelect', 'correct']);
  });

  it('a digit with no cell selected nudges the strip', async () => {
    await show();
    await press('key-5');
    expect(cues()).toEqual(['nudge']);
  });

  it('a tap on my cell during its re-lock wait is refused, with the "taken" buzz and shake', async () => {
    const { a } = await show();
    const name = cellName(a);
    await press(`cell-${name}`);
    await press('cancel-selection');
    await press(`cell-${name}`);
    expect(cues()).toEqual(['cellSelect', 'cellRelease', 'cellDenied']);
    expect(screen.getByLabelText('בחר משבצת')).toBeOnTheScreen();
  });

  it('"סיום אימון" asks first; "ביטול" keeps playing, "כן, לסיים" ends and opens the results', async () => {
    const { session, onEnded } = await show();
    await fireEvent.press(screen.getByRole('button', { name: 'סיום אימון' }));
    expect(screen.getByRole('header', { name: 'לסיים את האימון?' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('end-practice-cancel'));
    expect(session.getView().status).toBe('running');

    await fireEvent.press(screen.getByRole('button', { name: 'סיום אימון' }));
    await fireEvent.press(screen.getByRole('button', { name: 'כן, לסיים' }));
    expect(cues()).toEqual(['surrender']);
    expect(session.getView().status).toBe('over');
    expect(session.getView().result?.reason).toBe('practiceEnded');
    expect(onEnded).toHaveBeenCalledWith(session.id);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('a full board holds the last flash before the results', async () => {
    // All but the last cell are filled before the screen opens; the screen plays the last one.
    const { session, puzzle } = await practice();
    running = session;
    const cells = emptyCellsOf(puzzle);
    for (const c of cells.slice(0, -1)) {
      session.host.select(c);
      session.host.place(c, answerIn(puzzle, c));
    }
    const onEnded = jest.fn();
    await render(<GameScreen session={session} onEnded={onEnded} />);
    const last = cells.at(-1)!;
    await press(`cell-${cellName(last)}`);
    await press(`key-${answerIn(puzzle, last)}`);
    expect(session.getView().result?.reason).toBe('boardComplete');
    expect(onEnded).not.toHaveBeenCalled();
    await frames(1_100);
    expect(onEnded).toHaveBeenCalledWith(session.id);
  });

  it('speaks English too, and the board stays LTR', async () => {
    await i18n.changeLanguage('en');
    const { a } = await show();
    expect(screen.getByTestId('solo-hud-title', hidden)).toHaveTextContent('Solo practice · Fast');
    expect(screen.getByLabelText('Me · 0 points · No mistakes')).toBeOnTheScreen();
    expect(screen.getByTestId('board')).toHaveStyle({ direction: 'ltr' });
    expect(screen.getByTestId('keypad')).toHaveStyle({ direction: 'ltr' });
    await press(`cell-${cellName(a)}`);
    expect(screen.getByRole('button', { name: 'End practice' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'End practice' }));
    expect(screen.getByRole('header', { name: 'End the practice?' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Yes, end it' })).toBeOnTheScreen();
  });

  it('a game already over goes straight to its results', async () => {
    const game = await practice();
    running = game.session;
    game.session.endPractice();
    const onEnded = jest.fn();
    await render(<GameScreen session={game.session} onEnded={onEnded} />);
    expect(onEnded).toHaveBeenCalledWith(game.session.id);
  });
});
