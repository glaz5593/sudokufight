import 'react-native-reanimated';

import { cellName, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { AppStateSource } from '../../../game/backgroundPause';
import { puzzleById } from '../../../game/offlinePool';
import { type PracticeSession, startBotPractice, startPractice } from '../../../game/session';
import { emptyCellsOf, smallPool } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { GameScreen } from '../GameScreen';

/**
 * [D65, extended by Moshe 2026-10-18] The game screen of a solo practice and of a practice against a bot: away,
 * the board is covered (and hidden from screen readers); back, "3", "2", "1" over it (ResumeCountdown, as in the
 * stages), then the game goes on. Reduced Motion: the number just changes. An online game never shows it
 * (GameScreenOnline.test.tsx).
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));

const hidden = { includeHiddenElements: true };

function fakeAppState() {
  let listener: ((state: string) => void) | null = null;
  const source: AppStateSource = {
    addEventListener: (_type, l) => {
      listener = l;
      return { remove: () => (listener = null) };
    },
  };
  return { source, set: (state: string) => act(async () => listener?.(state)) };
}

let running: PracticeSession | null = null;

async function show(kind: 'solo' | 'bot') {
  const clock = new ManualClock(1_700_000_000_000);
  const scheduler = new ManualScheduler(clock);
  const app = fakeAppState();
  const deps = {
    repo: null,
    clock,
    scheduler,
    pool: smallPool(1),
    seed: 7,
    track: () => undefined,
    appState: app.source,
  };
  const session =
    kind === 'solo'
      ? await startPractice({ gameType: 'fast' }, deps)
      : await startBotPractice({ gameType: 'fast', level: 2 }, deps);
  running = session;
  await render(<GameScreen session={session} onEnded={jest.fn()} />);
  /** The game's clock and the phone's timers on together, inside act(). */
  const wait = (ms: number) =>
    act(async () => {
      scheduler.advance(ms);
      jest.advanceTimersByTime(ms);
    });
  return { session, app, wait, puzzle: puzzleById(session.puzzleId)! };
}

const contentA11y = () =>
  screen.getByTestId('game-content', hidden).props.importantForAccessibility as string | undefined;

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

afterEach(() => {
  running?.close();
  running = null;
  jest.useRealTimers();
});

describe('[D65] the game screen of a practice, frozen while the app is away', () => {
  it.each(['solo', 'bot'] as const)(
    '%s practice: covered while away; back, 3, 2, 1 over the board, then it goes on',
    async (kind) => {
      const s = await show(kind);
      const [a] = emptyCellsOf(s.puzzle);
      await fireEvent.press(screen.getByTestId(`cell-${cellName(a!)}`));
      await s.wait(2000);
      expect(screen.queryByTestId('resume-countdown')).toBeNull();
      expect(contentA11y()).toBe('auto');

      await s.app.set('background');
      expect(screen.getByTestId('resume-countdown')).toBeOnTheScreen();
      expect(screen.getByLabelText(i18n.t('board:resume.paused'))).toBeOnTheScreen();
      expect(s.session.getView().status).toBe('paused');
      // Under the cover the screen is hidden from screen readers too.
      expect(contentA11y()).toBe('no-hide-descendants');
      await s.wait(60_000);
      expect(s.session.getView().status).toBe('paused');

      await s.app.set('active');
      expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
      expect(screen.getByTestId('resume-countdown-number-animated')).toBeTruthy();
      await s.wait(1000);
      expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('2');
      await s.wait(1000);
      expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('1');
      await s.wait(1000);
      expect(screen.queryByTestId('resume-countdown')).toBeNull();
      expect(contentA11y()).toBe('auto');
      expect(s.session.getView().status).toBe('running');
      // My lock kept its time: fast is 8 s, 2 s were used before the freeze.
      const me = s.session.getView().players.find((p) => p.id === s.session.playerId)!;
      expect(me.lock).toMatchObject({ cell: a, remainingMs: 6000 });
    },
  );

  it('Reduced Motion: the number just changes, nothing animated', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const s = await show('solo');
    await s.app.set('background');
    await s.app.set('active');
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
    expect(screen.queryByTestId('resume-countdown-number-animated')).toBeNull();
    await s.wait(1000);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('2');
    expect(screen.queryByTestId('resume-countdown-number-animated')).toBeNull();
  });
});
