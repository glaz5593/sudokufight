import 'react-native-reanimated';

import {
  type AppLevel,
  attemptLevel,
  boxOf,
  cellName,
  drawBotPlan,
  findBotRng,
  type LevelSpecOf,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler, Dimensions, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { boardGeometry, cellRect } from '../../../components/board/geometry';
import { regionCellsOf } from '../../../components/levels/MiniRegion';

import { gameEndConfig } from '../../../config/gameEnd';
import { LEVEL_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import {
  type AppStateSource,
  type LevelSession,
  type LevelSessionDeps,
  startLevel,
} from '../../../levels/levelSession';
import { useSettings } from '../../../state/settings';
import { firstBossOf, firstLevelOf, levelsOf } from '../../../levels/__tests__/helpers/levelsOf';
import { color, text, tokens } from '../../../theme';
import { motion } from '../../../theme/motion';
import { boardSide } from '../../game/geometry';
import { levelEndDelayMs } from '../levelChrome';
import { ANSWER_HOLD_MS, TapLevelScreen } from '../TapLevelScreen';

/**
 * The tap stages' screen (dev-plan §2ח, §3.1; Lv-Find, Lv-Race): no keypad; find's big digit and "הקש איפה ה־7
 * חייב להיות" under the board; the race's task line; a wrong tap's red X and "‎+5 ש׳"; a right one's digit falling
 * into its cell (in place under Reduced Motion) and the result after the hold, in the route; the X and Android
 * back asking "לצאת מהשלב?" and quitting; the race's 3 s freeze; the bot's "מחפש…" and 😂; and [D65] the freeze
 * while the app is away, its 3-2-1 over the covered board, the same time left after it.
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
/** A RegionFrame's parts, inside out (they carry no ids): the region's gold band, an answer's white line. */
const frameParts = (el: unknown) =>
  (el as { children: unknown[] }).children as { props: { style?: unknown }; children: unknown[] }[];
// Picked by kind, never by id (a rebuild may give an id another kind): helpers/levelsOf.
const FIND = firstLevelOf('find', 1) as LevelSpecOf<'find'>; // chapter 1's first stage: a digit in a box
const RACE = firstLevelOf('findDuel') as LevelSpecOf<'findDuel'>; // the first race (not a boss): against Pip

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
  app: ReturnType<typeof fakeAppState>;
  onOver: jest.Mock;
  onLeave: jest.Mock;
}

let shown: Shown | null = null;
let backs: jest.SpyInstance;

async function show(level: AppLevel, over: Partial<LevelSessionDeps> = {}): Promise<Shown> {
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
  const onOver = jest.fn();
  const onLeave = jest.fn();
  await render(<TapLevelScreen session={session} onOver={onOver} onLeave={onLeave} />);
  shown = { session, scheduler, app, onOver, onLeave };
  return shown;
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

const tap = (index: number) => fireEvent.press(screen.getByTestId(`cell-${cellName(index)}`));
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID, hidden));

/** An empty cell of a box that is not the target. */
function wrongIn(level: AppLevel, box: number, accept: readonly number[]): number {
  for (let i = 0; i < 81; i++)
    if (boxOf(i) === box && level.board.grid[i] === '0' && !accept.includes(i)) return i;
  throw new Error('no wrong cell');
}

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
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  backs = jest.spyOn(BackHandler, 'addEventListener');
});
afterEach(() => {
  shown?.session.close();
  shown = null;
  backs.mockRestore();
  jest.useRealTimers();
});

describe('find (kind 1)', () => {
  const target = FIND.targets.target;
  const answer = target.accept[0]!;
  const wrong = wrongIn(FIND, boxOf(target.cell!), target.accept);
  const digit = String(target.digit);

  it('no keypad; under the board the big digit and "הקש איפה ה־7 חייב להיות" (its digit)', async () => {
    await show(FIND);
    expect(screen.queryByTestId('key-1')).toBeNull();
    expect(screen.queryByTestId('keypad')).toBeNull();
    expect(screen.getByTestId('find-digit', hidden)).toHaveTextContent(digit);
    expect(screen.getByTestId('find-tap', hidden)).toHaveTextContent(`הקש איפה ה־${digit} חייב להיות`);
    // [D75] The region's words stand out in the card (the row title's type, in the text colour); the rest of the
    // line stays the muted label.
    const scope = screen.getByTestId('find-scope', hidden);
    expect(scope).toHaveTextContent(/^בריבוע \d$/);
    expect(StyleSheet.flatten(scope.props.style as TextStyle)).toMatchObject({
      ...text('rowTitle'),
      color: color.text,
    });
    const where = screen.getByTestId('find-where', hidden);
    expect(where).toHaveTextContent(/^בריבוע \d · בלי מקלדת, רק הקשה$/);
    expect(StyleSheet.flatten(where.props.style as TextStyle).color).toBe(color.textMuted);
    expect(screen.getByTestId('stage-title')).toHaveTextContent('שלב 1');
    // The region in its one look [D75a] (the gold frame with its dark lines), every 7 a chip; the board reads LTR.
    const frame = screen.getByTestId('region-frame', hidden);
    expect(StyleSheet.flatten(frameParts(frame)[0]!.props.style as ViewStyle).borderColor).toBe(
      color.focusRing,
    );
    expect(screen.getByTestId(`cell-${cellName(answer)}`)).toHaveProp(
      'accessibilityHint',
      'הקשה על המשבצת היא המהלך',
    );
    expect(screen.getAllByTestId('cell-target', hidden).length).toBeGreaterThan(0);
  });

  it('a wrong tap: the red X and "⁦+5⁩ ש׳"', async () => {
    const s = await show(FIND);
    await tap(wrong);
    expect(screen.getByTestId('cell-flash-miss-cross', hidden)).toBeTruthy();
    expect(screen.getByTestId('penalty-chip', hidden)).toHaveTextContent('⁦+5⁩ ש׳');
    expect(s.session.levelView()!.penaltyMs).toBe(5000);
  });

  it('a right tap: the digit falls into the cell, and the result comes after the hold, in the route', async () => {
    const s = await show(FIND);
    await wait(s, 2000);
    await tap(answer);
    expect(screen.getByTestId('digit-drop', hidden)).toBeTruthy();
    expect(s.session.over).toMatchObject({ reason: 'targetReached' });
    await wait(s, levelEndDelayMs('boardComplete', false) - 100);
    expect(s.onOver).not.toHaveBeenCalled();
    await wait(s, 200);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });

  it('a right tap under Reduced Motion: the digit appears in place, nothing falls', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const s = await show(FIND);
    await tap(answer);
    expect(screen.queryByTestId('digit-drop', hidden)).toBeNull();
    expect(screen.getByTestId(`cell-${cellName(answer)}`)).toHaveTextContent(digit);
    await wait(s, levelEndDelayMs('boardComplete', true) + 50);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });

  it('time runs out: the answer shows, held a moment before the result', async () => {
    const s = await show(FIND);
    await wait(s, FIND.timeLimitMs - 500, 500);
    expect(s.session.over).toBeNull();
    await wait(s, 500);
    expect(s.session.over).toMatchObject({ reason: 'timeUp' });
    // The answer in its own look: the dark ring and the digit in its dark chip, never the region's gold.
    expect(screen.getByTestId('answer-frame', hidden)).toBeTruthy();
    expect(screen.getByTestId('answer-frame', hidden)).toHaveTextContent(digit);
    await wait(s, ANSWER_HOLD_MS - 200);
    expect(s.onOver).not.toHaveBeenCalled();
    await wait(s, 300);
    expect(s.onOver).toHaveBeenCalledTimes(1);
  });

  it('the X: "לצאת מהשלב?", and "יציאה" quits, the result once the dialog is gone', async () => {
    const s = await show(FIND);
    await fireEvent.press(screen.getByTestId('stage-exit'));
    await wait(s, motion.duration.sheetIn + 50);
    expect(screen.getByText('לצאת מהשלב?')).toBeOnTheScreen();
    expect(screen.getByText('תקבל 0 כוכבים, והשלב הבא ייפתח.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('level-exit-confirm'));
    expect(s.session.over).toMatchObject({ reason: 'quit', stars: 0 });
    await wait(s, motion.duration.sheetOut + 300);
    expect(s.onOver).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('לצאת מהשלב?')).toBeNull();
  });

  it('the result does not come (levels.db stuck): a way on after the watchdog; "לבית" and back leave the stage', async () => {
    const s = await show(FIND);
    await tap(answer);
    await wait(s, levelEndDelayMs('boardComplete', false) + 100);
    expect(s.onOver).toHaveBeenCalledTimes(1);
    await wait(s, gameEndConfig.resultsWatchdogMs - 200);
    expect(screen.queryByTestId('results-fallback')).toBeNull();
    await wait(s, 200);
    expect(screen.getByTestId('results-fallback')).toBeOnTheScreen();
    // "לתוצאות" asks for the result again (and watches it again).
    await fireEvent.press(screen.getByTestId('results-fallback-results'));
    expect(s.onOver).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('results-fallback')).toBeNull();
    await wait(s, gameEndConfig.resultsWatchdogMs);
    await fireEvent.press(screen.getByTestId('results-fallback-home'));
    expect(s.onLeave).toHaveBeenCalledTimes(1);
    await pressBack();
    expect(s.onLeave).toHaveBeenCalledTimes(2);
  });

  it('Android back asks the same, and "המשך לשחק" keeps the stage going', async () => {
    const s = await show(FIND);
    await pressBack();
    await wait(s, motion.duration.sheetIn + 50);
    expect(screen.getByText('לצאת מהשלב?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('level-exit-cancel'));
    await wait(s, motion.duration.sheetOut + 100);
    expect(s.session.over).toBeNull();
    await pressBack();
    await wait(s, motion.duration.sheetIn + 50);
    await fireEvent.press(screen.getByTestId('level-exit-confirm'));
    expect(s.session.over).toMatchObject({ reason: 'quit' });
  });
});

describe('[D75] the region (levels-ui.md §2): one look for every kind and shape', () => {
  const ROW_FIND = levelsOf('find').find((l) => l.targets.target.scope.kind === 'row')!;
  const face = (cell: number) => screen.getByTestId(`cell-${cellName(cell)}-face`);
  const bg = (cell: number) => StyleSheet.flatten(face(cell).props.style as ViewStyle).backgroundColor;
  const frameStyle = () =>
    StyleSheet.flatten(screen.getByTestId('region-frame', hidden).props.style as ViewStyle);
  /** The region frame's whole thickness: a dark line, the gold band, a dark line. */
  const THICK = 2 * tokens.border.regionKeyline + tokens.border.regionFrame;

  it('a find in a row: the gold frame with its dark lines (not 1.0.2’s light ring) across the row', async () => {
    expect(ROW_FIND).toBeDefined();
    await show(ROW_FIND);
    const scope = ROW_FIND.targets.target.scope;
    if (scope.kind !== 'row') throw new Error('a row find');
    const gold = StyleSheet.flatten(
      frameParts(screen.getByTestId('region-frame', hidden))[0]!.props.style as ViewStyle,
    );
    expect(gold.borderColor).toBe(color.focusRing);
    expect(gold.borderColor).not.toBe(color.text);
    const g = boardGeometry(boardSide(Dimensions.get('window').width, null));
    // Nine cells across, one high (the frame's whole thickness on each side).
    expect(frameStyle().height).toBeCloseTo(g.cell + 2 * THICK);
    // Cream inside the row, blue-grey outside it.
    const inRow = scope.index * 9;
    const outRow = ((scope.index + 3) % 9) * 9;
    expect([color.board.focusCell, color.board.focusCellAlt]).toContain(bg(inRow));
    expect([color.board.outCell, color.board.outCellAlt]).toContain(bg(outRow));
  });

  it('a tap outside the region never reaches the host', async () => {
    const s = await show(FIND);
    const scope = FIND.targets.target.scope;
    if (scope.kind !== 'box') throw new Error('a box find');
    const outside = Array.from({ length: 81 }, (_, i) => i).find(
      (i) => boxOf(i) !== scope.index && FIND.board.grid[i] === '0',
    )!;
    const taps = jest.spyOn(s.session, 'tap');
    await tap(outside);
    expect(taps).not.toHaveBeenCalled();
    expect(s.session.levelView()!.penaltyMs).toBe(0);
    expect(s.session.getView().level!.find!.wrongTaps).toBe(0);
  });

  it('the race: on a new spot the frame moves to the new region (and its band flashes again)', async () => {
    const s = await show(RACE);
    const before = frameStyle();
    expect(screen.getByTestId('region-frame-band', hidden)).toBeTruthy();
    await wait(s, 100);
    await tap(RACE.targets.spots[0]!.accept[0]!);
    const next = RACE.targets.spots[1]!.scope;
    expect(s.session.getView().level!.find!.spotIndex).toBe(1);
    const after = frameStyle();
    expect([after.left, after.top, after.width, after.height]).not.toEqual([
      before.left,
      before.top,
      before.width,
      before.height,
    ]);
    if (next.kind !== 'board') {
      const first = regionCellsOf({ unit: next.kind, index: next.index })[0]!;
      const g = boardGeometry(boardSide(Dimensions.get('window').width, null));
      expect(after.left).toBeCloseTo(cellRect(g, first).x - THICK);
    }
    expect(screen.getByTestId('region-frame-band', hidden)).toBeTruthy();
  });

  it('a missed find: the answer ring differs from the region frame (dark, a white line, the digit’s chip)', async () => {
    const s = await show(FIND);
    await wait(s, FIND.timeLimitMs + 100, 500);
    const ring = StyleSheet.flatten(screen.getByTestId('answer-frame', hidden).props.style as ViewStyle);
    expect(ring.borderColor).toBe(color.board.given);
    expect(ring.borderColor).not.toBe(color.focusRing);
    const [keyline] = frameParts(screen.getByTestId('answer-frame', hidden));
    expect(StyleSheet.flatten(keyline!.props.style as ViewStyle).borderColor).toBe(color.board.answerKeyline);
    // The region keeps its gold frame beside it.
    const regionGold = frameParts(screen.getByTestId('region-frame', hidden))[0]!;
    expect(StyleSheet.flatten(regionGold.props.style as ViewStyle).borderColor).toBe(color.focusRing);
  });

  it('a find that hit its target: no answer ring over my digit', async () => {
    const s = await show(FIND);
    await tap(FIND.targets.target.accept[0]!);
    expect(s.session.over).toMatchObject({ reason: 'targetReached' });
    expect(screen.queryByTestId('answer-frame', hidden)).toBeNull();
  });

  it('[D75c] the coordinate rails: off by default; on, a row or a column gets them (a box does not)', async () => {
    const scope = ROW_FIND.targets.target.scope;
    if (scope.kind !== 'row') throw new Error('a row find');
    await show(ROW_FIND);
    expect(screen.queryByTestId('board-with-coordinates')).toBeNull();
    shown?.session.close();
    await screen.unmount();
    LEVEL_UI.regionRails = true;
    try {
      await show(ROW_FIND);
      expect(screen.getByTestId('board-with-coordinates')).toBeTruthy();
      expect(screen.getByTestId(`rail-row-${'ABCDEFGHI'[scope.index]}`, hidden)).toBeTruthy();
      shown?.session.close();
      await screen.unmount();
      await show(FIND);
      expect(screen.queryByTestId('board-with-coordinates')).toBeNull();
    } finally {
      LEVEL_UI.regionRails = false;
    }
  });
});

describe('the race (kind 2)', () => {
  const spots = RACE.targets.spots;
  const boxOfSpot = (k: number) => (spots[k]!.scope.kind === 'box' ? spots[k]!.scope.index : -1);
  const wrong = wrongIn(RACE, boxOfSpot(0), spots[0]!.accept);
  /** "מצא את ה־6 בריבוע 1": the spot's digit and box (a chapter-2 race keeps to boxes). */
  const task = (k: number) => `מקום ${k + 1} מתוך 5 · מצא את ה־${spots[k]!.digit} בריבוע ${boxOfSpot(k) + 1}`;

  it('the task line names the spot, its digit and its box: "מקום 4 מתוך 5 · מצא את ה־5 בריבוע 9"', async () => {
    const s = await show(RACE);
    expect(screen.getByTestId('race-task')).toHaveTextContent(task(0));
    for (const spot of spots.slice(0, 3)) {
      await wait(s, 100);
      await tap(spot.accept[0]!);
    }
    expect(screen.getByTestId('race-task')).toHaveTextContent(task(3));
    expect(screen.getByTestId('race-me-spots')).toHaveTextContent('3');
    expect(screen.getByTestId('race-left')).toHaveTextContent('עוד 30 ש׳');
    expect(screen.queryByTestId('key-1')).toBeNull();
  });

  it('a wrong tap freezes my taps for 3 s: the right cell is refused meanwhile', async () => {
    const s = await show(RACE);
    await tap(wrong);
    expect(screen.getByTestId('board-freeze')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'מוקפא, 3 שניות');
    await wait(s, 1000);
    await tap(spots[0]!.accept[0]!);
    expect(s.session.getView().level!.find!.spots[0]).toEqual({ state: 'open' });
    await wait(s, 2100);
    expect(screen.queryByTestId('board-freeze')).toBeNull();
    await tap(spots[0]!.accept[0]!);
    expect(s.session.getView().level!.find!.spots[0]).toMatchObject({ state: 'won', playerId: 'me' });
  });

  it('the bot’s card says "מחפש…", and 😂 after my wrong tap when its plan says so', async () => {
    // An attempt whose bot reacts on the first spot (its plan is drawn from the stage and the attempt).
    const attempt = Array.from({ length: 200 }, (_, k) => k + 1).find((a) => {
      const played = attemptLevel(RACE, a);
      return drawBotPlan(played, findBotRng(played, a))[0]!.react;
    })!;
    expect(attempt).toBeDefined();
    const s = await show(RACE, { attemptOf: async () => attempt });
    expect(screen.getByTestId('race-bot-searching')).toHaveTextContent('מחפש…');
    const first = (s.session.played as LevelSpecOf<'findDuel'>).targets.spots[0]!;
    const box = first.scope.kind === 'box' ? first.scope.index : 0;
    await tap(wrongIn(s.session.played, box, first.accept));
    expect(screen.queryByTestId('race-bot-reaction')).toBeNull();
    await wait(s, 1100);
    expect(screen.getByTestId('race-bot-reaction')).toHaveTextContent('😂');
  });

  it('[D77] a boss race: the arena’s four gold corners around its board; a regular race has none', async () => {
    const s = await show(firstBossOf('findDuel'));
    const arena = screen.getByTestId('boss-frame', hidden);
    for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'])
      expect(screen.getByTestId(`boss-frame-${corner}`, hidden)).toBeTruthy();
    // Decorative: the band says "boss" (and the bot's crown).
    expect(arena).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(screen.getByTestId('stage-boss', hidden)).toBeTruthy();
    // Not a whole frame: the region keeps its own (RegionFrame), apart from the corners.
    expect(screen.getByTestId('region-frame', hidden)).toBeTruthy();
    s.session.close();
    shown = null;
    await show(RACE);
    expect(screen.queryByTestId('boss-frame', hidden)).toBeNull();
  });

  it('my card in P1 with ●, the bot’s in P2 with ▲', async () => {
    await show(RACE);
    expect(screen.getAllByTestId('glyph-circle', hidden).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('glyph-triangle', hidden).length).toBeGreaterThan(0);
    expect(screen.getByTestId('race-bot-who')).toHaveProp(
      'accessibilityLabel',
      'Pip, בוט רמה 1, טירון, 0 מקומות',
    );
  });

  it('no reactions button (D62); LEVEL_UI.reactions brings it back', async () => {
    await show(RACE);
    expect(LEVEL_UI.reactions).toBe(false);
    expect(screen.queryByTestId('race-reactions')).toBeNull();
    expect(screen.queryByTestId('reaction-picker')).toBeNull();
    shown!.session.close();
    await screen.unmount();

    LEVEL_UI.reactions = true;
    try {
      const s = await show(RACE);
      await fireEvent.press(screen.getByTestId('race-reactions'));
      await wait(s, 400);
      await press('reaction-picker-0');
      // The tap engine took it (with the switch on it lists the reactions): its cooldown started.
      expect(s.session.getView().reactionReadyAt).toBeGreaterThan(0);
    } finally {
      LEVEL_UI.reactions = false;
    }
  });
});

describe('[D65] the app away mid-stage', () => {
  it('freezes once; back, "3, 2, 1" over the covered board, then the stage goes on with the same time left', async () => {
    const s = await show(FIND);
    const pause = jest.spyOn(s.session.host, 'pause');
    const resume = jest.spyOn(s.session.host, 'resume');
    await wait(s, 3000);
    const before = screen.getByTestId('find-elapsed', hidden).props.children;
    await s.app.set('background');
    await s.app.set('inactive');
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('resume-countdown')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'המשחק עצור');
    // The board is covered: hidden from screen readers too.
    expect(screen.getByTestId('tap-level-content', hidden)).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    await wait(s, 60_000, 1000);
    await s.app.set('active');
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
    await wait(s, 1000);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('2');
    await wait(s, 1000);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('1');
    expect(resume).not.toHaveBeenCalled();
    await wait(s, LEVEL_UI.resumeCountdownMs - 2000);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('resume-countdown')).toBeNull();
    expect(screen.getByTestId('find-elapsed', hidden).props.children).toBe(before);
    expect(s.session.levelView()!.elapsedMs).toBe(3000);
  });

  it('Reduced Motion: the number just changes (nothing animated)', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const s = await show(FIND);
    await s.app.set('background');
    await s.app.set('active');
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
    expect(screen.queryByTestId('resume-countdown-number-animated')).toBeNull();
    await wait(s, 1000);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('2');
  });

  it('LEVEL_UI.backgroundPause off: no freeze, no cover', async () => {
    const s = await show(FIND, { settings: { ...LEVEL_UI, backgroundPause: false } });
    const pause = jest.spyOn(s.session.host, 'pause');
    await s.app.set('background');
    expect(pause).not.toHaveBeenCalled();
    expect(screen.queryByTestId('resume-countdown')).toBeNull();
    expect(s.session.getView().status).toBe('running');
  });
});
