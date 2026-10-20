// The gesture handler's Jest mocks, before anything loads it (its native module does not exist under Jest).
import 'react-native-gesture-handler/jestSetup';

import { type AppLevelOf, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { gameEndConfig } from '../../../config/gameEnd';
import { LEVEL_UI, PUZZLE_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import { firstLevelOf, levelsOf } from '../../../levels/__tests__/helpers/levelsOf';
import {
  type AppStateSource,
  type LevelSession,
  type LevelSessionDeps,
  startLevel,
} from '../../../levels/levelSession';
import { cue } from '../../../services/feedback';
import { auditA11y } from '../../../testing/a11yAudit';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { puzzleCountsText } from '../hud/PuzzleHud';
import { levelEndDelayMs } from '../levelChrome';
import { PuzzleLevelScreen, puzzleEndDelayMs } from '../PuzzleLevelScreen';

/**
 * The puzzle's screen (levels-ui.md §4, §10 "PuzzleLevelScreen.test.tsx"): it draws only what the GameView says
 * (the HUD's task, counts and swaps; the nine boxes); a swap goes through the session to the host and comes back
 * as the engine's events (the live region says it, a wrong swap shows "‎+5 ש׳" and "עוד 5 שניות"); a fixed box
 * is the engine's refusal; the end is the engine's levelOver, held, then the result; the X asks first; the D65
 * freeze covers the board with its 3, 2, 1; and a way on if the result does not come.
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

const hidden = { includeHiddenElements: true };
const PUZZLE = firstLevelOf('puzzle');
/** The puzzle with the most moving boxes: one where a swap can put neither box home. */
const BIG = [...levelsOf('puzzle')].sort((a, b) => a.targets.fixed.length - b.targets.fixed.length)[0]!;

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

interface Shown {
  session: LevelSession;
  scheduler: ManualScheduler;
  clock: ManualClock;
  app: ReturnType<typeof fakeAppState>;
  onOver: jest.Mock;
  onLeave: jest.Mock;
}

let backs: jest.SpyInstance;
const sessions: LevelSession[] = [];

async function show(level: AppLevelOf<'puzzle'>, over: Partial<LevelSessionDeps> = {}): Promise<Shown> {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const app = fakeAppState();
  const session = await startLevel(
    level,
    {},
    {
      clock,
      scheduler,
      appState: app.source,
      finish: async () => null,
      track: jest.fn(),
      attemptOf: async () => 1,
      bestStarsOf: () => 0,
      ...over,
    },
  );
  sessions.push(session);
  const onOver = jest.fn();
  const onLeave = jest.fn();
  await render(<PuzzleLevelScreen session={session} onOver={onOver} onLeave={onLeave} />);
  return { session, scheduler, clock, app, onOver, onLeave };
}

/** The stage's clock and the phone's timers move on together. */
async function wait(s: Shown, ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      s.scheduler.advance(Math.min(step, ms - t));
      jest.advanceTimersByTime(Math.min(step, ms - t));
    });
  }
}

/** A screen reader's double tap on a place (the same choice and swap as a tap). */
const activate = async (place: number) => {
  await fireEvent(screen.getByTestId(`puzzle-slot-${place}`, hidden), 'accessibilityAction', {
    nativeEvent: { actionName: 'activate' },
  });
};
const swap = async (from: number, to: number) => {
  await activate(from);
  await activate(to);
};

/** Swaps that put every box home, from the arrangement at the start (one box home each). */
function solve(start: readonly number[]): [number, number][] {
  const moves: [number, number][] = [];
  const now = start.slice();
  for (let p = 0; p < 9; p++)
    while (now[p] !== p) {
      const q = now.indexOf(p);
      moves.push([p, q]);
      [now[p], now[q]] = [now[q]!, now[p]!];
    }
  return moves;
}

const live = () => String(screen.getByTestId('level-live', hidden).props.children ?? '');

async function pressBack() {
  const handlers = backs.mock.calls
    .filter(([event]) => event === 'hardwareBackPress')
    .map(([, handler]) => handler as () => boolean | null | undefined)
    .reverse();
  await act(async () => {
    for (const handler of handlers) if (handler()) return;
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.mocked(cue).mockClear();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  backs = jest.spyOn(BackHandler, 'addEventListener');
});
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
  backs.mockRestore();
  jest.useRealTimers();
});

describe('PuzzleLevelScreen: drawn from the GameView', () => {
  it('the HUD: the stage, "סדר את הריבועים", how many boxes move and stay, the swaps; the nine boxes; how to move', async () => {
    await show(PUZZLE);
    const moving = 9 - PUZZLE.targets.fixed.length;
    expect(screen.getByTestId('stage-sub')).toHaveTextContent('פאזל · פרק 1');
    expect(screen.getByTestId('puzzle-task')).toHaveTextContent('סדר את הריבועים');
    expect(screen.getByTestId('puzzle-counts')).toHaveTextContent(
      `${moving === 3 ? '3 ריבועים זזים' : `${moving} ריבועים זזים`} · ${9 - moving} ריבועים קבועים`,
    );
    expect(screen.getByTestId('puzzle-swaps')).toHaveTextContent('החלפות: 0');
    expect(screen.queryByTestId('puzzle-mistakes')).toBeNull();
    for (const p of PUZZLE.targets.fixed) expect(screen.getByTestId(`puzzle-lock-${p}`, hidden)).toBeTruthy();
    expect(screen.getByText('גרור ריבוע אל ריבוע אחר כדי להחליף ביניהם')).toBeOnTheScreen();
    expect(LEVEL_UI.puzzleTapSwap).toBe(true);
    expect(screen.getByTestId('puzzle-tap-hint')).toHaveTextContent('או: הקש על ריבוע, ואז על ריבוע אחר');
    expect(screen.getByTestId('puzzle-board').props.accessibilityLabel).toMatch(/^לוח הפאזל · /);
    // No keypad and no game board: the puzzle has its own.
    expect(screen.queryByTestId('keypad', hidden)).toBeNull();
  });

  it('a swap goes to the host and comes back: the boxes trade places, the live region says it, cellRelease', async () => {
    const s = await show(PUZZLE);
    const [from, to] = solve(PUZZLE.targets.start)[0]!;
    const host = jest.spyOn(s.session.host, 'swapBoxes');
    await swap(from, to);
    expect(host).toHaveBeenCalledWith(from, to);
    expect(cue).toHaveBeenCalledWith('cellRelease');
    expect(screen.getByTestId('puzzle-swaps')).toHaveTextContent('החלפות: 1');
    // Box `from` (by its stable id) now stands at `to`.
    expect(screen.getByTestId(`puzzle-slot-${to}`, hidden)).toBeTruthy();
    expect(s.session.getView().level?.puzzle?.slots[to]?.id).toBe(from);
    await wait(s, 1600);
    expect(live()).toContain(`ריבוע ${from + 1} וריבוע ${to + 1} התחלפו`);
  });

  it('a wrong swap: "‎+5 ש׳" by the clock, the mistakes chip, and "עוד 5 שניות" in the live region', async () => {
    const s = await show(BIG);
    const at = BIG.targets.start;
    const moving = [...Array(9).keys()].filter((p) => !BIG.targets.fixed.includes(p));
    const pair = moving
      .flatMap((p) => moving.map((q) => [p, q] as const))
      .find(([p, q]) => p < q && at[q] !== p && at[p] !== q);
    if (!pair) throw new Error(`${BIG.id}: every swap puts a box home`);
    await swap(pair[0], pair[1]);
    // "‎+5 ש׳": the signed number an LTR isolate in the Hebrew line (CLAUDE.md).
    expect(screen.getByTestId('penalty-chip', hidden)).toHaveTextContent('\u2066+5\u2069 ש׳');
    expect(screen.getByTestId('puzzle-mistakes')).toHaveTextContent('החלפה שגויה \u2066+5\u2069 ש׳');
    expect(s.session.levelView()?.penaltyMs).toBe(5000);
    await wait(s, 1600);
    expect(live()).toContain(`ריבוע ${pair[0] + 1} וריבוע ${pair[1] + 1} התחלפו. עוד 5 שניות`);
  });

  it('a fixed box is the engine’s to refuse (boxFixed): nothing moves, cellDenied, "הריבוע הזה קבוע"', async () => {
    const s = await show(PUZZLE);
    const movable = [...Array(9).keys()].find((p) => !PUZZLE.targets.fixed.includes(p))!;
    const fixed = PUZZLE.targets.fixed[0]!;
    const host = jest.spyOn(s.session.host, 'swapBoxes');
    await swap(movable, fixed);
    expect(host).toHaveBeenCalledWith(movable, fixed);
    expect(cue).toHaveBeenCalledWith('cellDenied');
    expect(s.session.getView().level?.puzzle?.swaps).toBe(0);
    await wait(s, 1600);
    expect(live()).toContain('הריבוע הזה קבוע');
  });

  it('solved: the end is the engine’s levelOver; "correct", the hold, then the result once', async () => {
    const s = await show(PUZZLE);
    for (const [from, to] of solve(PUZZLE.targets.start)) await swap(from, to);
    expect(s.session.over).toMatchObject({ reason: 'targetReached' });
    expect(cue).toHaveBeenCalledWith('correct');
    const hold = puzzleEndDelayMs({ reason: 'targetReached' }, false);
    await wait(s, hold - 100);
    expect(s.onOver).not.toHaveBeenCalled();
    await wait(s, 200);
    expect(s.onOver).toHaveBeenCalledTimes(1);
    expect(live()).toContain('כל השורות וכל העמודות תקינות');
    // Over: nothing moves any more.
    const host = jest.spyOn(s.session.host, 'swapBoxes');
    await swap(0, 1);
    expect(host).not.toHaveBeenCalled();
  });

  it('time up: the engine ends it; the result after the board’s hold', async () => {
    const s = await show(PUZZLE);
    await wait(s, PUZZLE.timeLimitMs + 50, 500);
    expect(s.session.over).toMatchObject({ reason: 'timeUp', stars: 0 });
    await wait(s, levelEndDelayMs('boardComplete', false) + 100);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });
});

describe('LEVEL_UI.puzzleTapSwap (D78a)', () => {
  it('off: no "או: הקש על ריבוע…" and a tap does nothing; a screen reader still swaps', async () => {
    LEVEL_UI.puzzleTapSwap = false;
    try {
      const s = await show(PUZZLE);
      expect(screen.queryByTestId('puzzle-tap-hint')).toBeNull();
      expect(screen.getByText('גרור ריבוע אל ריבוע אחר כדי להחליף ביניהם')).toBeOnTheScreen();
      const host = jest.spyOn(s.session.host, 'swapBoxes');
      const [from, to] = solve(PUZZLE.targets.start)[0]!;
      await swap(from, to);
      expect(host).toHaveBeenCalledWith(from, to);
    } finally {
      LEVEL_UI.puzzleTapSwap = true;
    }
  });
});

describe('PuzzleLevelScreen: accessibility', () => {
  it.each(['he', 'en'] as const)(
    '%s: the audit finds nothing; every box a labelled button with its hint',
    async (lang) => {
      await i18n.changeLanguage(lang);
      await show(PUZZLE);
      expect(auditA11y(screen.container)).toEqual([]);
      for (let p = 0; p < 9; p++) {
        const slot = screen.getByTestId(`puzzle-slot-${p}`, hidden);
        expect(slot.props.accessibilityRole).toBe('button');
        expect(slot.props.accessibilityLabel).toMatch(
          lang === 'he' ? new RegExp(`^ריבוע ${p + 1}, `) : new RegExp(`^Box ${p + 1}, `),
        );
        expect(slot.props.accessibilityActions).toEqual([{ name: 'activate' }]);
      }
      expect(screen.getByTestId('level-live', hidden).props.accessibilityLiveRegion).toBe('polite');
    },
  );
});

describe('PuzzleLevelScreen: the shell (useStageShell)', () => {
  it('the X: "לצאת מהשלב?", and "יציאה" quits, the result once the dialog is gone', async () => {
    const s = await show(PUZZLE);
    await fireEvent.press(screen.getByTestId('stage-exit'));
    await wait(s, motion.duration.sheetIn + 50);
    expect(screen.getByText('לצאת מהשלב?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('level-exit-confirm'));
    expect(s.session.over).toMatchObject({ reason: 'quit', stars: 0 });
    await wait(s, motion.duration.sheetOut + 300);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });

  it('Android back asks the same; "המשך לשחק" keeps the puzzle going', async () => {
    const s = await show(PUZZLE);
    await pressBack();
    await wait(s, motion.duration.sheetIn + 50);
    expect(screen.getByText('לצאת מהשלב?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('level-exit-cancel'));
    await wait(s, motion.duration.sheetOut + 100);
    expect(s.session.over).toBeNull();
  });

  it('[D65] the app away: the board covered, "3, 2, 1", then the same time left; no swap meanwhile', async () => {
    const s = await show(PUZZLE);
    await wait(s, 2000);
    await s.app.set('background');
    expect(screen.getByTestId('resume-countdown')).toBeTruthy();
    expect(screen.getByTestId('puzzle-level-content', hidden)).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    const host = jest.spyOn(s.session.host, 'swapBoxes');
    await swap(...solve(PUZZLE.targets.start)[0]!);
    expect(host).not.toHaveBeenCalled();
    await wait(s, 30_000, 1000);
    await s.app.set('active');
    await wait(s, LEVEL_UI.resumeCountdownMs);
    expect(screen.queryByTestId('resume-countdown')).toBeNull();
    expect(s.session.levelView()!.elapsedMs).toBe(2000);
  });

  it('the result does not come: a way on after the watchdog; "לבית" leaves the stage', async () => {
    const s = await show(PUZZLE);
    for (const [from, to] of solve(PUZZLE.targets.start)) await swap(from, to);
    await wait(s, puzzleEndDelayMs({ reason: 'targetReached' }, false) + 100);
    expect(s.onOver).toHaveBeenCalledTimes(1);
    await wait(s, gameEndConfig.resultsWatchdogMs + 100);
    expect(screen.getByTestId('results-fallback')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('results-fallback-results'));
    expect(s.onOver).toHaveBeenCalledTimes(2);
    await wait(s, gameEndConfig.resultsWatchdogMs + 100);
    await fireEvent.press(screen.getByTestId('results-fallback-home'));
    expect(s.onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('puzzleEndDelayMs', () => {
  it('solved: the gold flash and the board’s hold; time up: the hold; a quit: none', () => {
    const hold = levelEndDelayMs('boardComplete', false);
    expect(puzzleEndDelayMs({ reason: 'targetReached' }, false)).toBe(
      Math.max(hold, PUZZLE_UI.solvedFlashMs),
    );
    expect(puzzleEndDelayMs({ reason: 'targetReached' }, true)).toBe(
      Math.max(levelEndDelayMs('boardComplete', true), PUZZLE_UI.solvedReducedMs),
    );
    expect(puzzleEndDelayMs({ reason: 'timeUp' }, false)).toBe(hold);
    expect(puzzleEndDelayMs({ reason: 'quit' }, false)).toBe(0);
  });
});

describe('puzzleCountsText: how many boxes move and stay (Hebrew plurals)', () => {
  it('one, two, many, and "כל הריבועים זזים" with nothing fixed', () => {
    const t = i18n.getFixedT('he', 'levels');
    expect(puzzleCountsText({ moving: 3 }, t)).toBe('3 ריבועים זזים · 6 ריבועים קבועים');
    expect(puzzleCountsText({ moving: 7 }, t)).toBe('7 ריבועים זזים · שני ריבועים קבועים');
    expect(puzzleCountsText({ moving: 8 }, t)).toBe('8 ריבועים זזים · ריבוע אחד קבוע');
    expect(puzzleCountsText({ moving: 2 }, t)).toBe('שני ריבועים זזים · 7 ריבועים קבועים');
    expect(puzzleCountsText({ moving: 9 }, t)).toBe('כל הריבועים זזים');
    expect(puzzleCountsText({ moving: 3 }, i18n.getFixedT('en', 'levels'))).toBe(
      '3 boxes move · 6 boxes are fixed',
    );
  });
});
