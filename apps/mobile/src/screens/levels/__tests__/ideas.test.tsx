// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';

import {
  type AppLevel,
  cellName,
  type Digit,
  DIGITS,
  LEVEL_RULES,
  type LevelRules,
  type LevelSpecOf,
  levelIdOf,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import LevelsRoute from '../../../../app/levels/index';
import LevelPlayRoute from '../../../../app/levels/play';
import { useAuth } from '../../../auth/authStore';
import { signedText } from '../../../components/player/format';
import { useToast } from '../../../components/ui/toastStore';
import { LEVEL_UI } from '../../../config/levels';
import type { SqlJsDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { type LevelSession, type LevelSessionDeps, startLevel } from '../../../levels/levelSession';
import { levelById, levelsOfChapter } from '../../../levels/levelsData';
import { openLevelsStorage } from '../../../levels/levelsStorage';
import { firstLevelOf, levelsOf } from '../../../levels/__tests__/helpers/levelsOf';
import { forgetLevels, refreshLevels } from '../../../levels/levelsStore';
import { useSettings } from '../../../state/settings';
import { color } from '../../../theme';
import { GameScreen } from '../../game/GameScreen';
import { renderApp } from '../../home/testing/homeTesting';
import { HowToPlay, useTutorials } from '../HowToPlay';
import { renderTutorialPanel } from '../HowToPlayPanels';
import { IDEA_TUTORIALS, tutorialPicture } from '../howToPlayFixtures';
import { huntMovesBetween, moveDots } from '../hud/PointHunterHud';
import { kindTipShown, spotTipShown } from '../hud/SpotErrorHud';
import { levelChrome, levelPlayedOf } from '../levelChrome';
import { LevelResultView } from '../LevelResultView';
import type { LevelsT } from '../levelWording';
import { TapLevelScreen } from '../TapLevelScreen';

/**
 * The three ideas (dev-plan §2ט, §3.1; the Idea-1, Idea-2 and Idea-3 boards):
 * - spot the error: the goal line and its grey note; "mine" digits in P1 with ●; a found error struck, the
 *   right digit small and a green ring; a tap on a right digit's "‎+5 ש׳"; the tip card in the kind's first 3
 *   stages, which closes; a tap on a given does nothing (LEVEL_RULES.tapOnFilled 'ignore');
 * - the point hunter: "‎+6.5" on the played cell; "שווה 6" from view.level.selectedWorth, absent when the view
 *   has none; a wrong digit's "‎−6" and its burned move dot; the result's points and their share of the best;
 * - the chain: its tip card in the kind's first 3 stages, which closes; 'accept' (the original §14, the
 *   default while D64 waits for Moshe) places a right digit off the chain with no toast; 'penalty' [D64]
 *   flashes the guess, shows "‎+5 ש׳" and a toast with the cell in an LTR isolate; a link fills at once under
 *   Reduced Motion; the view never says which cell is next;
 * - "איך משחקים"'s pictures of the three;
 * - end to end through the app's routes, with Reduced Motion, in Hebrew and English: the first stage of each
 *   idea from its "איך משחקים" to its result, and chapters 4, 7 and 9 (the first of each) through "לשלב הבא".
 */

const mockDbs = new Map<string, Promise<SqlJsDb>>();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => {
    let db = mockDbs.get(name);
    if (!db) {
      db = jest
        .requireActual<typeof import('../../../game/testing/sqlJsDb')>('../../../game/testing/sqlJsDb')
        .memoryDb();
      mockDbs.set(name, db);
    }
    return db;
  },
}));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
type Mocks = typeof import('../../home/testing/nativeMocks');
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);
// The app's stages run on this test's manual clock; a test that starts its own session gives its own.
const mockRun: { clock: ManualClock | null; scheduler: ManualScheduler | null } = {
  clock: null,
  scheduler: null,
};
type SessionModule = typeof import('../../../levels/levelSession');
jest.mock('../../../levels/levelSession', () => {
  const actual = jest.requireActual<SessionModule>('../../../levels/levelSession');
  const startLevel: SessionModule['startLevel'] = (level, options, deps) =>
    actual.startLevel(
      level,
      options,
      deps?.clock ? deps : { ...deps, clock: mockRun.clock!, scheduler: mockRun.scheduler!, appState: null },
    );
  return { ...actual, startLevel };
});

jest.setTimeout(600_000);

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;
const LRI = '⁦';
const PDI = '⁩';

// Picked by kind, never by id (a rebuild may give an id another kind): helpers/levelsOf.
const SPOT_FIRST = levelsOf('spotError')[0] as LevelSpecOf<'spotError'>; // one error; the kind's first stage
const SPOT_TWO = firstLevelOf('spotError', 8) as LevelSpecOf<'spotError'>; // two errors; past the first three
const HUNTER_FIRST = levelsOf('pointHunter')[0] as LevelSpecOf<'pointHunter'>; // the kind's first: "שווה 6" on
const HUNTER_THIRD = levelsOf('pointHunter')[2] as LevelSpecOf<'pointHunter'>; // the kind's third: no hint
const CHAIN_FIRST = levelsOf('chain')[0] as LevelSpecOf<'chain'>; // 3 steps

const answer = (level: AppLevel, cell: number) => Number(level.board.solution[cell]) as Digit;

// ---------------------------------------------------------------------------------------------------------
// A stage on its screen, on a clock of the test's own

interface Shown {
  session: LevelSession;
  scheduler: ManualScheduler;
  onOver: jest.Mock;
}

let shown: Shown[] = [];

async function sessionOf(level: AppLevel, over: Partial<LevelSessionDeps> = {}) {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const session = await startLevel(
    level,
    {},
    {
      clock,
      scheduler,
      appState: null,
      finish: async () => null,
      track: jest.fn(),
      attemptOf: async () => 1,
      bestStarsOf: () => 0,
      ...over,
    },
  );
  const s = { session, scheduler, onOver: jest.fn() };
  shown.push(s);
  return s;
}

/** A tap stage on its screen (spot the error). */
async function showTap(level: AppLevel): Promise<Shown> {
  const s = await sessionOf(level);
  await render(<TapLevelScreen session={s.session} onOver={s.onOver} onLeave={jest.fn()} />);
  return s;
}

/** A digit stage on the game screen with its chrome, as the route draws it. */
async function showGame(level: AppLevel, rules: LevelRules = LEVEL_RULES): Promise<Shown> {
  const s = await sessionOf(level, { rules });
  const t = i18n.getFixedT(i18n.language, 'levels') as LevelsT;
  const chrome = levelChrome(s.session.played, t, { onOver: s.onOver, rules })!;
  await render(<GameScreen session={s.session} onEnded={jest.fn()} level={chrome} />);
  return s;
}

/** The stage's clock and the phone's timers move on together. */
async function wait(s: Pick<Shown, 'scheduler'>, ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      s.scheduler.advance(Math.min(step, ms - t));
      jest.advanceTimersByTime(Math.min(step, ms - t));
    });
  }
}

const pressCell = (cell: number) => fireEvent.press(screen.getByTestId(`cell-${cellName(cell)}`, hidden));
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID, hidden));
/** A puzzle's place chosen as a screen reader does (its activate: the same choice and swap as a tap). */
const activatePlace = (place: number) =>
  fireEvent(screen.getByTestId(`puzzle-slot-${place}`, hidden), 'accessibilityAction', {
    nativeEvent: { actionName: 'activate' },
  });

/** Lock `cell` and type `digit` on the game screen. */
async function play(cell: number, digit: Digit) {
  await pressCell(cell);
  await press(`key-${digit}`);
}

/** A digit the keypad still offers that is not `cell`'s answer. */
function wrongFor(session: LevelSession, cell: number): Digit {
  const view = session.getView();
  return DIGITS.find((d) => d !== answer(session.played, cell) && view.keypad.remaining[d - 1]! > 0)!;
}

const emptyCells = (level: AppLevel) => [...level.board.grid].flatMap((d, i) => (d === '0' ? [i] : []));

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off', language: 'he' });
  useToast.getState().clear();
});
afterEach(() => {
  for (const s of shown) s.session.close();
  shown = [];
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------------------------------------

describe('spot the error', () => {
  const mineRight = (level: LevelSpecOf<'spotError'>) =>
    [...level.board.mine!].findIndex((d, i) => d !== '0' && !level.targets.errors.some((e) => e.cell === i));

  it('the goal line, and under it in grey "הספרות הכהות הן של הלוח, והן תמיד נכונות."', async () => {
    await showTap(SPOT_TWO);
    expect(screen.getByTestId('spot-goal')).toHaveTextContent('בלוח מסתתרות 2 ספרות שגויות. הקש עליהן.');
    expect(screen.getByTestId('spot-note')).toHaveTextContent('הספרות הכהות הן של הלוח, והן תמיד נכונות.');
    expect(styleOf(screen.getByTestId('spot-note')).color).toBe(color.textMuted);
    expect(screen.getByTestId('spot-found-count')).toHaveTextContent(`${LRI}0/2${PDI}`);
    // No keypad: a tap is the move.
    expect(screen.queryByTestId('keypad')).toBeNull();
    await screen.unmount();
    await showTap(SPOT_FIRST);
    expect(screen.getByTestId('spot-goal')).toHaveTextContent('בלוח מסתתרת ספרה שגויה אחת. הקש עליה.');
  });

  it('"mine" digits in P1 with the ● in the corner; the board’s own stay dark, with none', async () => {
    await showTap(SPOT_TWO);
    const mine = mineRight(SPOT_TWO);
    const cell = screen.getByTestId(`cell-${cellName(mine)}`);
    expect(within(cell).getByTestId('cell-glyph-circle', hidden)).toBeTruthy();
    expect(cell).toHaveProp('accessibilityLabel', expect.stringContaining('שלך'));
    // An error looks like any digit of mine until it is found.
    const error = SPOT_TWO.targets.errors[0]!.cell;
    expect(
      within(screen.getByTestId(`cell-${cellName(error)}`)).getByTestId('cell-glyph-circle', hidden),
    ).toBeTruthy();
    const given = [...SPOT_TWO.board.grid].findIndex((d) => d !== '0');
    expect(
      within(screen.getByTestId(`cell-${cellName(given)}`)).queryByTestId('cell-glyph-circle', hidden),
    ).toBeNull();
  });

  it('a found error: the wrong digit struck, the right one small, a green ring; its magnifier fills', async () => {
    const s = await showTap(SPOT_TWO);
    const [error] = SPOT_TWO.targets.errors;
    await pressCell(error!.cell);
    const cell = screen.getByTestId(`cell-${cellName(error!.cell)}`);
    expect(within(cell).getByTestId('cell-correction-wrong', hidden)).toHaveTextContent(String(error!.digit));
    expect(within(cell).getByTestId('cell-correction-strike', hidden)).toBeTruthy();
    expect(within(cell).getByTestId('cell-correction-right', hidden)).toHaveTextContent(
      String(answer(SPOT_TWO, error!.cell)),
    );
    expect(styleOf(within(cell).getByTestId('cell-correction-ring', hidden)).borderColor).toBe(color.success);
    expect(screen.getByTestId('spot-lens-0-found', hidden)).toBeTruthy();
    expect(screen.getByTestId('spot-lens-1-open', hidden)).toBeTruthy();
    expect(screen.getByTestId('spot-found-count')).toHaveTextContent(`${LRI}1/2${PDI}`);
    expect(screen.getByTestId('spot-found')).toHaveProp('accessibilityLabel', 'נמצאו 1 מתוך 2');
    await wait(s, 50);
    expect(screen.getByTestId('level-live', hidden)).toHaveTextContent(
      `מצאת טעות ב־${LRI}${cellName(error!.cell)}${PDI}: לא ${error!.digit} אלא ${answer(SPOT_TWO, error!.cell)}`,
    );
    expect(s.session.over).toBeNull();
  });

  it('a tap on a right digit of mine: the red X, and "⁦+5⁩ ש׳" by the clock', async () => {
    const s = await showTap(SPOT_TWO);
    const mine = mineRight(SPOT_TWO);
    await pressCell(mine);
    expect(screen.getByTestId('cell-flash-miss-cross', hidden)).toBeTruthy();
    expect(screen.getByTestId('penalty-chip', hidden)).toHaveTextContent(`${signedText(5)} ש׳`);
    expect(s.session.levelView()!.penaltyMs).toBe(5000);
    // The stage's clock took the 5 s.
    expect(screen.getByTestId('spot-clock-value')).toHaveTextContent('5');
    await wait(s, 50);
    expect(screen.getByTestId('level-live', hidden)).toHaveTextContent(
      `ב־${LRI}${cellName(mine)}${PDI} הספרה נכונה. ${signedText(5)} ש׳`,
    );
  });

  it('a tap on a given does nothing (LEVEL_RULES.tapOnFilled "ignore")', async () => {
    expect(LEVEL_RULES.tapOnFilled).toBe('ignore');
    const s = await showTap(SPOT_TWO);
    const given = [...SPOT_TWO.board.grid].findIndex((d) => d !== '0');
    // The board offers no tap there, and the engine takes none.
    expect(screen.getByTestId(`cell-${cellName(given)}`)).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true }),
    );
    await act(async () => s.session.tap(given));
    expect(s.session.levelView()!.penaltyMs).toBe(0);
    expect(s.session.levelView()!.find!.wrongTaps).toBe(0);
    expect(screen.queryByTestId('penalty-chip', hidden)).toBeNull();
  });

  it('with LEVEL_RULES.tapOnFilled "penalty", a tap on a given is a wrong tap: "⁦+5⁩ ש׳"', async () => {
    LEVEL_RULES.tapOnFilled = 'penalty';
    try {
      const s = await showTap(SPOT_TWO);
      const given = [...SPOT_TWO.board.grid].findIndex((d) => d !== '0');
      await pressCell(given);
      expect(s.session.levelView()!.penaltyMs).toBe(5000);
      expect(screen.getByTestId('penalty-chip', hidden)).toHaveTextContent(`${signedText(5)} ש׳`);
    } finally {
      LEVEL_RULES.tapOnFilled = 'ignore';
    }
  });

  it('the tip card in the kind’s first 3 stages only, and it closes', async () => {
    const [first, second, third, fourth] = levelsOf('spotError').slice(0, 4);
    for (const level of [first!, second!, third!]) expect(spotTipShown(level)).toBe(true);
    expect(spotTipShown(fourth!)).toBe(false);
    await showTap(SPOT_FIRST);
    expect(screen.getByTestId('spot-tip-text')).toHaveProp(
      'accessibilityLabel',
      'טיפ: חפש ספרה שמופיעה פעמיים באותה שורה, עמודה או ריבוע.',
    );
    await press('spot-tip-close');
    expect(screen.queryByTestId('spot-tip')).toBeNull();
    await screen.unmount();
    await showTap(SPOT_TWO);
    expect(screen.queryByTestId('spot-tip')).toBeNull();
  });

  it('LEVEL_UI.tipLevels decides how many stages show it', async () => {
    expect(LEVEL_UI.tipLevels).toBe(3);
    LEVEL_UI.tipLevels = 0;
    try {
      expect(spotTipShown(SPOT_FIRST)).toBe(false);
      await showTap(SPOT_FIRST);
      expect(screen.queryByTestId('spot-tip')).toBeNull();
      LEVEL_UI.tipLevels = 4;
      expect(spotTipShown(levelsOf('spotError')[3]!)).toBe(true);
    } finally {
      LEVEL_UI.tipLevels = 3;
    }
  });

  it('time runs out: the errors not found are framed, held a moment, then the result', async () => {
    const s = await showTap(SPOT_TWO);
    await pressCell(SPOT_TWO.targets.errors[0]!.cell);
    await wait(s, SPOT_TWO.timeLimitMs, 500);
    expect(s.session.over).toMatchObject({ reason: 'timeUp', found: 1 });
    // The answer's own ring (levels-ui.md §2.2), no digit chip: the cell shows its own wrong digit.
    expect(screen.getAllByTestId('answer-frame', hidden)).toHaveLength(1);
    expect(
      (screen.getByTestId('answer-frame', hidden) as unknown as { children: unknown[] }).children,
    ).toHaveLength(1);
    expect(screen.getByTestId('level-live', hidden)).toHaveTextContent(
      `טעויות שלא נמצאו: ${LRI}${cellName(SPOT_TWO.targets.errors[1]!.cell)}${PDI}`,
    );
    await wait(s, 2000);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });

  it('in English', async () => {
    await act(async () => void (await i18n.changeLanguage('en')));
    await showTap(SPOT_TWO);
    expect(screen.getByTestId('spot-goal')).toHaveTextContent('2 wrong digits hide on the board. Tap them.');
    expect(screen.getByTestId('spot-note')).toHaveTextContent(
      'The dark digits are the board’s, and they are always right.',
    );
    expect(screen.getByTestId('stage-title')).toHaveTextContent(`Stage ${Number(SPOT_TWO.id.slice(1))}`);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the point hunter', () => {
  it('its HUD: the goal, three move dots, the clock, and the points bar to the board’s best', async () => {
    await showGame(HUNTER_FIRST);
    expect(screen.getByTestId('hunt-goal')).toHaveTextContent(`אסוף ${LRI}17.5${PDI} נקודות ב־3 מהלכים.`);
    expect(screen.getByTestId('hunt-dot-0-now')).toBeTruthy();
    expect(screen.getByTestId('hunt-dot-1-left')).toBeTruthy();
    expect(screen.getByTestId('hunt-dot-2-left')).toBeTruthy();
    expect(screen.getByTestId('hunt-move-text')).toHaveTextContent('מהלך 1 מתוך 3');
    expect(screen.getByTestId('hunt-clock-value')).toHaveTextContent('0:30');
    expect(screen.getByTestId('hunt-max')).toHaveTextContent(`המקסימום בלוח: ${LRI}18${PDI}`);
    // The marks at 70, 85 and 95 % of 18 (the engine's star rule of the stage).
    expect(screen.getByTestId('hunt-bar-number-1', hidden)).toHaveTextContent('13');
    expect(screen.getByTestId('hunt-bar-number-2', hidden)).toHaveTextContent('15.5');
    expect(screen.getByTestId('hunt-bar-number-3', hidden)).toHaveTextContent('17.5');
    // Locks have no timer: no lock strip; the keypad stays.
    expect(screen.queryByTestId('lock-strip')).toBeNull();
    expect(screen.getByTestId('keypad')).toBeTruthy();
  });

  it('a move’s points as a chip on the played cell', async () => {
    const s = await showGame(HUNTER_FIRST);
    const first = HUNTER_FIRST.targets.best[0]!;
    await play(first.cell, first.digit);
    const points = s.session.getView().players[0]!.score;
    expect(points).toBe(first.points);
    expect(screen.getByTestId(`hunt-chips-${first.cell}`, hidden)).toHaveTextContent(signedText(points));
    expect(screen.getByTestId('hunt-score-value')).toHaveTextContent(String(points));
    expect(screen.getByTestId('hunt-dot-0-used')).toBeTruthy();
    expect(screen.getByTestId('hunt-dot-1-now')).toBeTruthy();
  });

  it('"שווה 6" over my locked cell from view.level.selectedWorth, and nothing when the view has none', async () => {
    const s = await showGame(HUNTER_FIRST);
    const cell = HUNTER_FIRST.targets.best[0]!.cell;
    await pressCell(cell);
    const worth = s.session.levelView()!.selectedWorth;
    expect(worth).toBeDefined();
    expect(screen.getByTestId(`hunt-chips-${cell}`, hidden)).toHaveTextContent(`שווה ${worth}`);
    expect(screen.getByTestId('hunt-score')).toHaveProp(
      'accessibilityLabel',
      `0 נקודות. המשבצת שבחרת שווה ${worth}`,
    );
    await screen.unmount();

    const t = await showGame(HUNTER_THIRD);
    await pressCell(HUNTER_THIRD.targets.best[0]!.cell);
    expect(t.session.levelView()!.selectedWorth).toBeUndefined();
    expect(screen.queryByTestId(`hunt-chips-${HUNTER_THIRD.targets.best[0]!.cell}`, hidden)).toBeNull();
  });

  it('a wrong digit: "⁦−6⁩" by the points, and a burned move dot', async () => {
    const s = await showGame(HUNTER_FIRST);
    const first = HUNTER_FIRST.targets.best[0]!;
    await play(first.cell, first.digit);
    const cell = HUNTER_FIRST.targets.best[1]!.cell;
    await play(cell, wrongFor(s.session, cell));
    const me = s.session.getView().players[0]!;
    const penalty = me.mistakePenalties[0]!;
    expect(penalty).toBeGreaterThan(0);
    expect(screen.getByTestId('hunt-lost-text')).toHaveTextContent(signedText(-penalty));
    expect(screen.getByTestId('hunt-dot-0-used')).toBeTruthy();
    expect(screen.getByTestId('hunt-dot-1-burnt')).toBeTruthy();
    expect(screen.getByTestId('hunt-move-text')).toHaveTextContent('מהלך 2 נשרף');
    expect(styleOf(screen.getByTestId('hunt-move-text')).color).toBe(color.danger);
    // A burned move scores no chip: the lock stays, and over it only what its right digit is still worth.
    expect(screen.getByTestId(`hunt-chips-${cell}`, hidden)).toHaveTextContent(
      `שווה ${s.session.levelView()!.selectedWorth}`,
    );
  });

  it('two views read as my moves: the points, the burned one, and the dots in order', async () => {
    const { session } = await sessionOf(HUNTER_FIRST);
    const before = session.getView();
    const first = HUNTER_FIRST.targets.best[0]!;
    session.host.select(first.cell);
    session.host.place(first.cell, first.digit);
    const after = session.getView();
    expect(huntMovesBetween(before, after)).toEqual([
      expect.objectContaining({ kind: 'right', cell: first.cell, points: first.points }),
    ]);
    expect(huntMovesBetween(after, after)).toEqual([]);
    const wrong = { kind: 'wrong', id: 'w', cell: 1, penalty: 6 } as const;
    expect(moveDots([wrong], { used: 1, mistakes: 1, max: 3, running: true })).toEqual([
      'burnt',
      'now',
      'left',
    ]);
    // Moves the HUD did not see: by the view's counts, the burned ones last.
    expect(moveDots([], { used: 3, mistakes: 1, max: 3, running: false })).toEqual(['used', 'used', 'burnt']);
  });

  it('the result: my points, and their share of the board’s best in "למה?"', async () => {
    const s = await showGame(HUNTER_FIRST);
    const [a, b] = HUNTER_FIRST.targets.best;
    await play(a!.cell, a!.digit);
    await play(b!.cell, b!.digit);
    // A right digit somewhere else: fewer points than the best line's third.
    const other = emptyCells(HUNTER_FIRST).find((c) => !HUNTER_FIRST.targets.best.some((m) => m.cell === c))!;
    await play(other, answer(HUNTER_FIRST, other));
    const r = await s.session.result;
    expect(r.outcome.reason).toBe('completed');
    const score = r.view.players[0]!.score;
    const played = levelPlayedOf(s.session, r, 'he');
    // My best move of the three (the engine's), as in the duel.
    const mine = r.view.players[0]!.bestMove!;
    expect(played.bestMove).toEqual({ cell: mine.cell, digit: mine.digit, points: mine.points });
    await screen.unmount();
    await render(
      <LevelResultView
        level={HUNTER_FIRST}
        played={played}
        chapter={null}
        next={null}
        onNext={jest.fn()}
        onAgain={jest.fn()}
        onMap={jest.fn()}
      />,
    );
    expect(screen.getByTestId('level-result-metric')).toHaveProp(
      'accessibilityLabel',
      `${LRI}${score}${PDI} נקודות`,
    );
    expect(screen.getByTestId('level-result-why')).toHaveTextContent(
      new RegExp(`צברת ${score} מתוך 18 נקודות, ${LRI}${Math.round((score / 18) * 100)}%${PDI}`),
    );
    expect(screen.getByTestId('level-result-best-move')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the chain', () => {
  const accept: LevelRules = { ...LEVEL_RULES, chainNotYet: 'accept' };
  const penalty: LevelRules = { ...LEVEL_RULES, chainNotYet: 'penalty' };
  const [step1, step2] = CHAIN_FIRST.targets.cells;
  const offChain = emptyCells(CHAIN_FIRST).find((c) => !CHAIN_FIRST.targets.cells.includes(c))!;

  it('its HUD: the links, "צעד 1 מתוך 3", the clock and the time bar; no lock strip', async () => {
    await showGame(CHAIN_FIRST, accept);
    expect(screen.getByTestId('chain-goal')).toHaveTextContent(
      'בכל רגע רק משבצת אחת בלוח פתירה. מצא אותה ומלא, והיא תפתח את הבאה.',
    );
    expect(screen.getByTestId('chain-step')).toHaveTextContent('צעד 1 מתוך 3');
    expect(screen.getByTestId('chain-link-0-now', hidden)).toBeTruthy();
    expect(screen.getByTestId('chain-link-1-todo', hidden)).toBeTruthy();
    expect(screen.getByTestId('chain-link-2-todo', hidden)).toBeTruthy();
    expect(screen.getByTestId('chain-clock-value')).toHaveTextContent('0');
    expect(screen.queryByTestId('lock-strip')).toBeNull();
    expect(screen.getByTestId('keypad')).toBeTruthy();
  });

  it('the tip card in the kind’s first 3 stages only, and it closes [D64]', async () => {
    const [first, second, third, fourth] = levelsOf('chain').slice(0, 4);
    for (const level of [first!, second!, third!]) expect(kindTipShown('chain', level)).toBe(true);
    expect(kindTipShown('chain', fourth!)).toBe(false);
    expect(kindTipShown('chain', SPOT_FIRST)).toBe(false);
    await showGame(CHAIN_FIRST);
    expect(screen.getByTestId('chain-tip-text')).toHaveProp(
      'accessibilityLabel',
      'טיפ: בכל צעד יש בדיוק משבצת אחת שאפשר להוכיח. אם אתה בטוח בספרה, זו המשבצת.',
    );
    await press('chain-tip-close');
    expect(screen.queryByTestId('chain-tip')).toBeNull();
    await screen.unmount();
    await showGame(fourth!);
    expect(screen.queryByTestId('chain-tip')).toBeNull();
    // LEVEL_UI.tipLevels decides how many.
    LEVEL_UI.tipLevels = 4;
    try {
      expect(kindTipShown('chain', fourth!)).toBe(true);
    } finally {
      LEVEL_UI.tipLevels = 3;
    }
  });

  it('the default is the original §14 (LEVEL_RULES.chainNotYet "accept", D64 waiting for Moshe)', async () => {
    expect(LEVEL_RULES.chainNotYet).toBe('accept');
    const s = await showGame(CHAIN_FIRST);
    await play(offChain, answer(CHAIN_FIRST, offChain));
    expect(s.session.getView().grid[offChain]).toBe(answer(CHAIN_FIRST, offChain));
    expect(useToast.getState().current).toBeNull();
    expect(screen.getByTestId('chain-note')).toHaveTextContent(`ספרה שגויה: ${signedText(5)} ש׳.`);
  });

  it('"accept" (the original §14): a right digit off the chain is placed, as in a game, with no toast', async () => {
    const s = await showGame(CHAIN_FIRST, accept);
    expect(screen.getByTestId('chain-note')).toHaveTextContent(`ספרה שגויה: ${signedText(5)} ש׳.`);
    await play(offChain, answer(CHAIN_FIRST, offChain));
    expect(s.session.getView().grid[offChain]).toBe(answer(CHAIN_FIRST, offChain));
    expect(s.session.levelView()!.penaltyMs).toBe(0);
    expect(useToast.getState().current).toBeNull();
    expect(screen.queryByTestId('chain-not-yet-fill', hidden)).toBeNull();
    expect(screen.queryByTestId('penalty-chip', hidden)).toBeNull();
    // It is no step of the chain.
    expect(screen.getByTestId('chain-step')).toHaveTextContent('צעד 1 מתוך 3');
  });

  it('"penalty" [D64]: a guess flashes red, "⁦+5⁩ ש׳" by the clock, and a toast names the cell in an LTR isolate', async () => {
    const s = await showGame(CHAIN_FIRST, penalty);
    expect(screen.getByTestId('chain-note')).toHaveTextContent(
      `ספרה במשבצת שעוד אי אפשר לדעת מה נכנס בה: ${signedText(5)} ש׳.`,
    );
    // The second step's right digit, before the first: it cannot be known yet.
    await play(step2!, answer(CHAIN_FIRST, step2!));
    expect(s.session.getView().grid[step2!]).toBe(0);
    expect(s.session.levelView()!.penaltyMs).toBe(5000);
    expect(screen.getByTestId('chain-not-yet-fill', hidden)).toBeTruthy();
    expect(screen.getByTestId('penalty-chip', hidden)).toHaveTextContent(`${signedText(5)} ש׳`);
    expect(useToast.getState().current?.message).toBe(
      `עוד אי אפשר לדעת מה נכנס ב־${LRI}${cellName(step2!)}${PDI} · ${signedText(5)} ש׳`,
    );
    expect(useToast.getState().current?.variant).toBe('error');
    // Reduced Motion: a still red frame in place of the fading wash.
    await screen.unmount();
    useSettings.setState({ reduceMotion: 'on' });
    useToast.getState().clear();
    await showGame(CHAIN_FIRST, penalty);
    await play(offChain, answer(CHAIN_FIRST, offChain));
    expect(screen.getByTestId('chain-not-yet-frame', hidden)).toBeTruthy();
    expect(useToast.getState().current?.message).toContain(`${LRI}${cellName(offChain)}${PDI}`);
  });

  it('a wrong digit costs 5 s in both modes: its chip, and no toast', async () => {
    for (const rules of [accept, penalty]) {
      useToast.getState().clear();
      const s = await showGame(CHAIN_FIRST, rules);
      await play(step1!, wrongFor(s.session, step1!));
      expect(s.session.levelView()!.penaltyMs).toBe(5000);
      expect(screen.getByTestId('penalty-chip', hidden)).toHaveTextContent(`${signedText(5)} ש׳`);
      expect(useToast.getState().current).toBeNull();
      expect(screen.queryByTestId('chain-not-yet-fill', hidden)).toBeNull();
      await screen.unmount();
    }
  });

  it('a step fills its link over 240 ms; with Reduced Motion at once', async () => {
    await showGame(CHAIN_FIRST, penalty);
    await play(step1!, answer(CHAIN_FIRST, step1!));
    expect(screen.getByTestId('chain-step')).toHaveTextContent('צעד 2 מתוך 3');
    expect(screen.getByTestId('chain-link-0-done', hidden)).toBeTruthy();
    expect(screen.getByTestId('chain-link-1-now', hidden)).toBeTruthy();
    expect(screen.getByTestId('chain-link-0-fill', hidden)).not.toHaveAnimatedStyle({ width: '100%' });
    await act(async () => void jest.advanceTimersByTime(400));
    expect(screen.getByTestId('chain-link-0-fill', hidden)).toHaveAnimatedStyle({ width: '100%' });
    await screen.unmount();

    useSettings.setState({ reduceMotion: 'on' });
    await showGame(CHAIN_FIRST, penalty);
    await play(step1!, answer(CHAIN_FIRST, step1!));
    await act(async () => void jest.advanceTimersByTime(16));
    expect(screen.getByTestId('chain-link-0-fill', hidden)).toHaveAnimatedStyle({ width: '100%' });
  });

  it('the view never says which cell is next, and the board marks none', async () => {
    const s = await showGame(CHAIN_FIRST, penalty);
    const progress = s.session.levelView()!.progress!;
    expect(Object.keys(progress).sort()).toEqual(['done', 'kind', 'total']);
    const sep = i18n.t('board:separator.list');
    const empty = i18n.t('board:cell.empty');
    // The next step reads like any other empty cell.
    for (const c of [step1!, offChain])
      expect(screen.getByTestId(`cell-${cellName(c)}`)).toHaveProp(
        'accessibilityLabel',
        `${cellName(c)}${sep}${empty}`,
      );
    expect(screen.queryAllByTestId(/^region-frame/, hidden)).toHaveLength(0);
    expect(screen.queryAllByTestId('cell-target', hidden)).toHaveLength(0);
    expect(JSON.stringify(s.session.levelView())).not.toContain(`"cell":${step1}`);
  });

  it('every step played: the chain is done, and the stage ends', async () => {
    const s = await showGame(CHAIN_FIRST, penalty);
    for (const cell of CHAIN_FIRST.targets.cells) await play(cell, answer(CHAIN_FIRST, cell));
    expect((await s.session.result).outcome).toMatchObject({ reason: 'completed', stars: 3 });
    expect(screen.getByTestId('chain-step')).toHaveTextContent('צעד 3 מתוך 3');
  });

  it('in English', async () => {
    await act(async () => void (await i18n.changeLanguage('en')));
    await showGame(CHAIN_FIRST, accept);
    expect(screen.getByTestId('chain-step')).toHaveTextContent('Step 1 of 3');
    expect(screen.getByTestId('chain-note')).toHaveTextContent(`A wrong digit: ${signedText(5)} s.`);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('"איך משחקים" of the ideas', () => {
  const STAGE = { spotError: SPOT_FIRST, pointHunter: HUNTER_FIRST, chain: CHAIN_FIRST } as const;

  it.each(IDEA_TUTORIALS)(
    '%s: three pictures on the real board, LTR, each panel with its line',
    async (kind) => {
      await render(
        <HowToPlay kind={kind} level={STAGE[kind]} onDone={jest.fn()} renderPanel={renderTutorialPanel} />,
      );
      for (const n of [1, 2, 3]) {
        const panel = screen.getByTestId(`how-to-play-panel-${n}`);
        expect(panel).toHaveProp(
          'accessibilityLabel',
          expect.stringMatching(new RegExp(`^תמונה ${n} מתוך 3: .+`)),
        );
        const board = within(panel).getByTestId(`tutorial-board-${n}`, hidden);
        expect(styleOf(board).direction).toBe('ltr');
        expect(within(board).getAllByTestId(/^cell-[A-I][1-9]$/, hidden)).toHaveLength(81);
        expect(screen.getByTestId(`how-to-play-board-${kind}-${n}`, hidden)).toBeTruthy();
      }
      for (const i of [0, 1, 2])
        expect(tutorialPicture(kind, i)!.cells.some((c) => c.interactive)).toBe(false);
    },
  );

  it('the pictures: "mine" digits with ●, the error found, the "⁦+5⁩"; points on my moves; the chain’s cell', () => {
    const [hidden1, found, tapped] = [0, 1, 2].map((i) => tutorialPicture('spotError', i)!);
    expect(hidden1!.cells.filter((c) => c.mine).length).toBeGreaterThan(5);
    expect(hidden1!.cells.every((c) => !c.mine || c.player?.isMe)).toBe(true);
    expect(found!.cells.find((c) => c.correction)).toMatchObject({ name: 'E5', correction: { wrong: 9 } });
    expect(tapped!.chips).toEqual([expect.objectContaining({ text: signedText(5), tone: 'penalty' })]);
    const hunt = tutorialPicture('pointHunter', 2)!;
    expect(hunt.chips.map((c) => c.tone)).toEqual(['gain', 'gain', 'gain']);
    expect(tutorialPicture('chain', 0)!.cells.find((c) => c.name === 'E4')).toMatchObject({ kind: 'myLock' });
  });
});

// ---------------------------------------------------------------------------------------------------------
// End to end, through the app's routes

const ROUTES = { 'levels/index': LevelsRoute, 'levels/play': LevelPlayRoute };
/** A new player for every test: levels.db is opened once per run (levelsStorage), its rows stay. */
let runs = 0;
let owner = 'ideas-e2e';
/** The app's stage clock (the session's mock above). */
const run = () => ({ scheduler: mockRun.scheduler! });

/** Plays a stage on the screen as a player would (the stored board: every attempt here is the first). */
async function playStage(level: AppLevel) {
  switch (level.kind) {
    case 'find':
      await wait(run(), 1000);
      await pressCell(level.targets.target.accept[0]!);
      return;
    case 'findDuel':
      for (const spot of level.targets.spots) {
        await wait(run(), 200);
        await pressCell(spot.accept[0]!);
      }
      return;
    case 'fillBox':
    case 'fillRow':
    case 'fillCol':
      for (const cell of level.targets.cells) {
        await play(cell, answer(level, cell));
        await wait(run(), 200);
      }
      return;
    case 'puzzle': {
      // On its own screen (PuzzleLevelScreen): a place, then another; each swap puts one box home (no penalty).
      const now = level.targets.start.slice();
      for (let p = 0; p < 9; p++)
        while (now[p] !== p) {
          const q = now.indexOf(p);
          await activatePlace(p);
          await activatePlace(q);
          [now[p], now[q]] = [now[q]!, now[p]!];
          await wait(run(), 200);
        }
      return;
    }
    case 'duel': {
      // Lock an empty cell nobody holds, its right digit; the next. The bot plays meanwhile; the first to 30
      // (or the 30 s) ends it.
      const tried = new Set<number>();
      const sep = i18n.t('board:separator.list');
      const empty = i18n.t('board:cell.empty');
      for (let k = 0; k < 120 && !screen.queryByTestId('level-result'); k++) {
        const cell = emptyCells(level).find((i) => {
          if (tried.has(i)) return false;
          const label = String(screen.getByTestId(`cell-${cellName(i)}`, hidden).props.accessibilityLabel);
          return label === `${cellName(i)}${sep}${empty}`;
        });
        if (cell === undefined) break;
        tried.add(cell);
        await pressCell(cell);
        if (screen.queryByTestId('level-result')) break;
        await press(`key-${answer(level, cell)}`);
        await wait(run(), 250);
      }
      return;
    }
    case 'spotError':
      for (const e of level.targets.errors) {
        await wait(run(), 300);
        await pressCell(e.cell);
      }
      return;
    case 'pointHunter':
      for (const m of level.targets.best) {
        await play(m.cell, m.digit);
        await wait(run(), 200);
      }
      return;
    case 'chain':
      for (const cell of level.targets.cells) {
        await play(cell, answer(level, cell));
        await wait(run(), 200);
      }
      return;
  }
}

/** Waits (moving both clocks on a little) until `ok`, at most `ms`. */
async function until(ok: () => boolean, ms = 5000) {
  for (let t = 0; t < ms && !ok(); t += 20) await wait(run(), 20, 20);
  if (!ok()) throw new Error('timed out');
}

/** From "מוכן?" to the stage's result: its 2 s, the stage played, the hold. */
async function stageToResult(id: string) {
  const level = levelById(id)!;
  await until(() => screen.queryByTestId('level-ready') !== null);
  await wait(run(), LEVEL_UI.readyMs + 50);
  await until(
    () =>
      screen.queryByTestId('tap-level') !== null ||
      screen.queryByTestId('level-game') !== null ||
      screen.queryByTestId('puzzle-level') !== null,
  );
  await playStage(level);
  await until(() => screen.queryByTestId('level-result') !== null, 40_000);
}

describe('end to end, with Reduced Motion', () => {
  beforeEach(async () => {
    mockRun.clock = new ManualClock(1_000_000);
    mockRun.scheduler = new ManualScheduler(mockRun.clock);
    owner = `ideas-e2e-${++runs}`;
    useSettings.setState({ reduceMotion: 'on' });
    useTutorials.setState({ seen: {} });
    await act(async () =>
      useAuth.setState({
        status: 'ready',
        user: { uid: owner, email: null, emailVerified: true, methods: [] },
      }),
    );
  });
  afterEach(async () => {
    await act(async () => useAuth.setState({ status: 'loading', user: null }));
    forgetLevels();
    mockDbs.clear();
  });

  it.each(['he', 'en'] as const)(
    'the first stage of each idea, from its "איך משחקים" to its result with "למה?" (%s)',
    async (lang) => {
      await act(async () => void (await i18n.changeLanguage(lang)));
      useSettings.setState({ language: lang });
      for (const level of [SPOT_FIRST, HUNTER_FIRST, CHAIN_FIRST]) {
        await renderApp(`/levels/play?id=${level.id}`, ROUTES);
        await screen.findByTestId('how-to-play');
        expect(screen.getByTestId(`how-to-play-board-${level.kind}-1`, hidden)).toBeTruthy();
        await press('how-to-play-got');
        await stageToResult(level.id);
        const n = Number(level.id.slice(1));
        expect(screen.getByTestId('level-result-title')).toHaveTextContent(
          lang === 'he' ? `שלב ${n} הושלם` : `Stage ${n} complete`,
        );
        expect(screen.getByTestId('level-result-stars', hidden)).toHaveProp(
          'accessibilityLabel',
          expect.stringContaining(lang === 'he' ? 'שלושה כוכבים' : 'three stars'),
        );
        expect(screen.getByTestId('level-result-why')).toHaveTextContent(/\S/);
        // Reduced Motion: no confetti.
        expect(screen.queryByTestId('level-result-confetti')).toBeNull();
        await screen.unmount();
      }
      const progress = await (await openLevelsStorage()).progress(owner);
      for (const level of [SPOT_FIRST, HUNTER_FIRST, CHAIN_FIRST])
        expect(progress[level.id]).toMatchObject({ stars: 3, plays: 1 });
    },
  );

  it.each([4, 7, 9])(
    'chapter %i end to end: every stage through its result and "לשלב הבא"',
    async (chapter) => {
      useTutorials.setState({
        seen: {
          find: true,
          findDuel: true,
          fillBox: true,
          duel: true,
          boss: true,
          spotError: true,
          pointHunter: true,
          chain: true,
          fillRow: true,
          fillCol: true,
          puzzle: true,
        },
      });
      // The chapters before it played with 3 stars each (its gate open), as another phone would have them.
      const repo = await openLevelsStorage();
      const before = Array.from({ length: (chapter - 1) * 10 }, (_, k) => ({
        id: levelIdOf(k + 1),
        stars: 3 as const,
        plays: 1,
      }));
      await repo.mergeFromServer(owner, before, 1_000_000);
      await act(async () => refreshLevels({ owner }));
      const stages = levelsOfChapter(chapter);
      expect(stages).toHaveLength(10);
      const ideas = stages.filter(
        (l) => l.kind === 'spotError' || l.kind === 'pointHunter' || l.kind === 'chain',
      );
      expect(ideas.length).toBeGreaterThan(0);
      const app = await renderApp(`/levels/play?id=${stages[0]!.id}`, ROUTES);
      for (const [k, level] of stages.entries()) {
        await stageToResult(level.id);
        expect(screen.getByTestId('level-result-title')).toHaveTextContent(
          new RegExp(`^שלב ${Number(level.id.slice(1))}( |$)`),
        );
        if (k === stages.length - 1) break;
        await press('level-result-next');
        await until(() => app.searchParams().id === stages[k + 1]!.id);
      }
      const progress = await repo.progress(owner);
      for (const level of stages) expect(progress[level.id]).toMatchObject({ plays: 1 });
      // Every idea played perfectly: 3 stars.
      for (const level of ideas) expect(progress[level.id]).toMatchObject({ stars: 3 });
    },
  );
});
