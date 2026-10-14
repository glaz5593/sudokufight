import { cellName, type HostUpdate } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { answerIn } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { GameScreen } from '../GameScreen';
import { BOT, type Duel, duel, ME } from '../testing/duel';

/**
 * The end of a practice against a bot (bug 9: "כן, לסיים", then a black screen on the phone). On the phone a
 * throw out of a press handler or a timer is fatal; the host hands its listeners' errors to whoever acted
 * (packages/engine host.ts). So: the game ends at once, the results open once the dialog has left the screen
 * (its onExited: never while its native window is still closing), and whatever fails on the way is reported
 * to Crashlytics while the end still reaches the results.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));
jest.mock('../../../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});
const crash = jest
  .requireMock<{ crashReporter: () => { recordError: jest.Mock; log: jest.Mock } }>(
    '../../../services/crashlytics',
  )
  .crashReporter();
const breadcrumbs = (): string[] => crash.log.mock.calls.map((c: unknown[]) => String(c[0]));

let game: Duel | null = null;
/** Whether the end dialog was still in the tree each time the results were opened. */
let dialogAtResults: boolean[] = [];
/** onEnded that notes whether the end dialog was still there. */
const watchingDialog = () =>
  jest.fn(() => {
    dialogAtResults.push(screen.queryByTestId('end-practice') !== null);
  });

async function show(onEnded: jest.Mock = watchingDialog()) {
  game = duel();
  await render(<GameScreen session={game.session} onEnded={onEnded} />);
  return { ...game, onEnded };
}

async function frames(ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}

/** "סיום אימון" on my card; the dialog slides up. */
async function openEnd() {
  await fireEvent.press(within(screen.getByTestId('card-me')).getByTestId('surrender'));
  await frames(motion.duration.sheetIn + 50);
}

/** "סיום אימון" on my card, then (the dialog up) "כן, לסיים". */
async function endIt() {
  await openEnd();
  await fireEvent.press(screen.getByTestId('end-practice-confirm'));
}

/** A listener at the table that fails when the game ends (what a failing listener did to the phone). */
function failAtTheEnd(g: Duel, error: Error) {
  g.host.subscribe((u: HostUpdate) => {
    if (u.kind === 'events' && u.events.some((e) => e.type === 'gameOver')) throw error;
  });
}

let warn: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  dialogAtResults = [];
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

afterEach(() => {
  game?.session.close();
  game = null;
  warn.mockRestore();
  jest.useRealTimers();
});

describe('"כן, לסיים" against a bot (spec §6.6)', () => {
  it('ends the game at once (the bot wins); the results replace it once the dialog has left the screen', async () => {
    const g = await show();
    await endIt();
    // The dialog is still sliding away.
    expect(screen.getByTestId('end-practice')).toBeOnTheScreen();
    const result = g.session.getView().result!;
    expect(g.session.getView().status).toBe('over');
    expect(result.ranking.find((r) => r.playerId === BOT.id)?.place).toBe(1);
    expect(result.ranking.find((r) => r.playerId === ME)?.status).toBe('surrendered');

    expect(g.onEnded).not.toHaveBeenCalled();
    await frames(motion.duration.sheetOut - 50);
    expect(g.onEnded).not.toHaveBeenCalled();
    await frames(100);
    expect(g.onEnded).toHaveBeenCalledWith(g.session.id);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    // Not a fixed wait that races the dialog: when the results opened, its window was already gone.
    expect(dialogAtResults).toEqual([false]);
    // Nothing failed; the end left its breadcrumbs for a crash report.
    expect(crash.recordError).not.toHaveBeenCalled();
    expect(breadcrumbs()).toEqual([
      'game: end of practice confirmed',
      'game: game over (practiceEnded)',
      'game: opening the results',
    ]);
  });

  it('with reduced motion: after the dialog’s 200 ms fade', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const g = await show();
    await endIt();
    await frames(motion.duration.reducedFade - 50);
    expect(g.onEnded).not.toHaveBeenCalled();
    await frames(100);
    expect(g.onEnded).toHaveBeenCalledWith(g.session.id);
    expect(dialogAtResults).toEqual([false]);
  });

  it('a slow game-over render on the phone: the results wait for the dialog itself, not a fixed time', async () => {
    const g = await show();
    // On the phone the dialog starts to slide away only once the heavy game-over render is committed. Here
    // that render is "slow": time runs on, past sheet.out, inside the press, before React gets to render.
    g.host.subscribe((u: HostUpdate) => {
      if (u.kind === 'events' && u.events.some((e) => e.type === 'gameOver'))
        jest.advanceTimersByTime(motion.duration.sheetOut + 100);
    });
    await endIt();
    expect(g.session.getView().status).toBe('over');
    expect(g.onEnded).not.toHaveBeenCalled();
    await frames(motion.duration.sheetOut + 100);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(dialogAtResults).toEqual([false]);
  });

  it('a full board while the dialog is open: the dialog closes, and the results wait for the hold and for it', async () => {
    const g = await show();
    const [last, ...rest] = [...g.cells].reverse();
    await act(async () => {
      for (const c of rest) {
        g.host.select(c);
        g.host.place(c, answerIn(g.puzzle, c));
      }
    });
    await openEnd();
    await act(async () => g.bot.solve(last!));
    expect(g.session.getView().result?.reason).toBe('boardComplete');
    await frames(motion.duration.sheetOut + 100);
    expect(screen.queryByTestId('end-practice')).toBeNull();
    expect(g.onEnded).not.toHaveBeenCalled();
    await frames(motion.duration.correctFlash + 400);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(dialogAtResults).toEqual([false]);
  });

  it('a listener that fails at the end: no throw out of the press, reported, and the results still open', async () => {
    const boom = new Error('a listener failed');
    const g = await show();
    failAtTheEnd(g, boom);
    await expect(endIt()).resolves.not.toThrow();
    expect(g.session.getView().status).toBe('over');
    expect(crash.recordError).toHaveBeenCalledWith(boom, 'game: ending the game');
    await frames(motion.duration.sheetOut + 50);
    expect(g.onEnded).toHaveBeenCalledWith(g.session.id);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
  });

  it('a failure to open the results is reported, never thrown out of the timer', async () => {
    const boom = new Error('navigation failed');
    const onEnded = jest.fn(() => {
      throw boom;
    });
    await show(onEnded);
    await endIt();
    await frames(motion.duration.sheetOut + 50);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(crash.recordError).toHaveBeenCalledWith(boom, 'game: opening the results');
  });
});

describe('the last digit of the board', () => {
  it('a listener that fails as it ends the game: no throw out of the press; the results after the hold', async () => {
    const boom = new Error('a listener failed');
    const g = await show();
    const [last, ...rest] = [...g.cells].reverse();
    await act(async () => {
      for (const c of rest) {
        g.host.select(c);
        g.host.place(c, answerIn(g.puzzle, c));
      }
    });
    failAtTheEnd(g, boom);
    await fireEvent.press(screen.getByTestId(`cell-${cellName(last!)}`));
    await expect(
      fireEvent.press(screen.getByTestId(`key-${answerIn(g.puzzle, last!)}`)),
    ).resolves.not.toThrow();
    expect(g.session.getView().result?.reason).toBe('boardComplete');
    expect(crash.recordError).toHaveBeenCalledWith(boom, 'game: place');
    expect(g.onEnded).not.toHaveBeenCalled();
    await frames(motion.duration.correctFlash + 400 + 50);
    expect(g.onEnded).toHaveBeenCalledWith(g.session.id);
  });
});
