// The gesture handler's Jest mocks, before anything loads it (its native module does not exist under Jest).
import 'react-native-gesture-handler/jestSetup';

import type { PuzzleSlotView } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { getAnimatedStyle } from 'react-native-reanimated';
import * as worklets from 'react-native-worklets';

import { LEVEL_UI, PUZZLE_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import { cue } from '../../../services/feedback';
import { useSettings } from '../../../state/settings';
import { color } from '../../../theme';
import { PuzzleBoard, type PuzzleBoardProps, type PuzzleRefusal } from '../PuzzleBoard';
import { boxCellsAt, puzzleGeometry, slotOrigin } from '../puzzleGeometry';

/**
 * The puzzle's board (levels-ui.md §4, §10 "PuzzleBoard.test.tsx"): nine places LTR in Hebrew too; a fixed box
 * grey with a lock; a drag from place 4 to place 7 asks the host for swap(3, 6); a drag onto a fixed box asks
 * too, and the engine's refusal sends the box home with cellDenied; a drop off the board or on its own place asks
 * nothing; tap then tap swaps, the same box twice lets go, LEVEL_UI.puzzleTapSwap off turns the taps off; a
 * screen reader's activate swaps either way; Reduced Motion: no lift, an instant swap; each place's label reads
 * its digits and says `selected`; a box at its home is never marked; repeated digits only as the engine lists.
 */

jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));

const WIDTH = 300;
const G = puzzleGeometry(WIDTH);
/** A solved grid (any: the board only draws it). */
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const GRID = [...SOLUTION].map(Number);
const hidden = { includeHiddenElements: true };
/** One frame: the animated styles are drawn on the next one. */
const FRAME = 20;

/** The nine places, the boxes as they started (id = place), these fixed. */
const slotsOf = (fixed: readonly number[]): PuzzleSlotView[] =>
  Array.from({ length: 9 }, (_, p) => ({ id: p, state: fixed.includes(p) ? 'fixed' : 'movable' }));

/** The centre of a place, in the board's own coordinates. */
const centre = (place: number) => {
  const o = slotOrigin(G, place);
  return { x: o.x + G.slot / 2, y: o.y + G.slot / 2 };
};

/** Where the box with this id is drawn now (its tile's translate). */
function drawnAt(place: number) {
  const style = getAnimatedStyle(screen.getByTestId(`puzzle-slot-${place}`, hidden)) as ViewStyle;
  const t = (style.transform ?? []) as { translateX?: number; translateY?: number; scale?: number }[];
  return {
    x: t.find((x) => x.translateX !== undefined)?.translateX ?? NaN,
    y: t.find((x) => x.translateY !== undefined)?.translateY ?? NaN,
    scale: t.find((x) => x.scale !== undefined)?.scale ?? 1,
  };
}

/** A whole drag from one point to another (through the half-way point), and what the board makes of it. */
async function drag(from: { x: number; y: number }, to: { x: number; y: number }, end: State = State.END) {
  const half = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  await fireDrag([from, half, to], end);
  await jsThread();
}

async function tapAt(p: { x: number; y: number }) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId('puzzle-tap'), [{ x: p.x, y: p.y }]);
  });
  await jsThread();
}

const activate = async (place: number) => {
  await fireEvent(screen.getByTestId(`puzzle-slot-${place}`, hidden), 'accessibilityAction', {
    nativeEvent: { actionName: 'activate' },
  });
};

/**
 * The drag's worklets hand the board their news on the JS thread (scheduleOnRN). Here they wait in a queue, so a
 * test can look at the board between them: the lift, each new place under the finger, the drop.
 */
const jsQueue: (() => void)[] = [];

/** Every call waiting for the JS thread. */
async function jsThread() {
  await act(async () => {
    while (jsQueue.length) jsQueue.shift()!();
  });
}

/** The next `n` of them, alone. */
async function jsStep(n = 1) {
  for (let i = 0; i < n; i++)
    await act(async () => {
      jsQueue.shift()?.();
    });
}

/** The events of a drag, as the gesture handler reports them (it always ends them itself). */
function dragEvents(points: readonly { x: number; y: number }[], end: State = State.END) {
  const [first, ...rest] = points;
  const at = (p: { x: number; y: number }) => ({
    x: p.x,
    y: p.y,
    translationX: p.x - first!.x,
    translationY: p.y - first!.y,
  });
  const last = points[points.length - 1]!;
  return [
    { state: State.BEGAN, ...at(first!) },
    ...rest.map((p, i) => (i === 0 ? { state: State.ACTIVE, ...at(p) } : at(p))),
    { state: end, ...at(last) },
  ];
}

async function fireDrag(points: readonly { x: number; y: number }[], end: State = State.END) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId('puzzle-drag'), dragEvents(points, end));
  });
}

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function show(props: Partial<PuzzleBoardProps> & { slots?: PuzzleSlotView[] } = {}) {
  const onSwap = jest.fn();
  const onFixed = jest.fn();
  const all: PuzzleBoardProps = {
    grid: GRID,
    slots: slotsOf([1, 5]),
    width: WIDTH,
    enabled: true,
    onSwap,
    onFixed,
    label: 'board',
    ...props,
  };
  const view = await render(<PuzzleBoard {...all} />);
  const rerender = async (p: Partial<PuzzleBoardProps>) => {
    await view.rerender(<PuzzleBoard {...all} {...p} />);
  };
  return { onSwap, onFixed, rerender };
}

/**
 * A stand-in for the screen and its host: swaps the ids at two places unless one is fixed, else refuses
 * ('boxFixed'), as the engine does. The board never decides.
 */
function Hosted({ fixed, onAsk }: { fixed: readonly number[]; onAsk: (from: number, to: number) => void }) {
  const [slots, setSlots] = useState(() => slotsOf(fixed));
  const [grid, setGrid] = useState(GRID);
  const [refusal, setRefusal] = useState<PuzzleRefusal | null>(null);
  const onSwap = (from: number, to: number) => {
    onAsk(from, to);
    if (slots[from]!.state !== 'movable' || slots[to]!.state !== 'movable') {
      setRefusal((r) => ({ key: (r?.key ?? 0) + 1, from, to }));
      return;
    }
    const next = slots.slice();
    [next[from], next[to]] = [next[to]!, next[from]!];
    setSlots(next);
    const cells = grid.slice();
    boxCellsAt(from).forEach((c, k) => {
      const d = boxCellsAt(to)[k]!;
      [cells[c], cells[d]] = [cells[d]!, cells[c]!];
    });
    setGrid(cells);
  };
  return (
    <PuzzleBoard
      grid={grid}
      slots={slots}
      width={WIDTH}
      enabled
      onSwap={onSwap}
      refusal={refusal}
      label="board"
    />
  );
}

beforeEach(async () => {
  jest.useFakeTimers();
  jsQueue.length = 0;
  jest.spyOn(worklets, 'scheduleOnRN').mockImplementation(((
    fn: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => {
    jsQueue.push(() => fn(...args));
  }) as typeof worklets.scheduleOnRN);
  jest.mocked(cue).mockClear();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('PuzzleBoard: the nine places', () => {
  it('lies LTR in Hebrew too: box 1 at the top-left, 3 at the top-right, 9 at the bottom-right', async () => {
    await show();
    expect(StyleSheet.flatten(screen.getByTestId('puzzle-board').props.style).direction).toBe('ltr');
    expect(drawnAt(0)).toMatchObject({ x: 0, y: 0 });
    expect(drawnAt(2)).toMatchObject({ x: 2 * G.pitch, y: 0 });
    expect(drawnAt(3)).toMatchObject({ x: 0, y: G.pitch });
    expect(drawnAt(8)).toMatchObject({ x: 2 * G.pitch, y: 2 * G.pitch });
  });

  it('a fixed box is grey (board.outCell) with a lock; a moving one warm (board.focusCell), no lock', async () => {
    await show();
    expect(screen.getByTestId('puzzle-lock-1', hidden)).toBeTruthy();
    expect(screen.getByTestId('puzzle-lock-5', hidden)).toBeTruthy();
    expect(screen.queryByTestId('puzzle-lock-0', hidden)).toBeNull();
    const bg = (place: number) =>
      StyleSheet.flatten(screen.getByTestId(`puzzle-cell-${place}-4`, hidden).props.style).backgroundColor;
    expect(bg(1)).toBe(color.board.outCell);
    expect(bg(0)).toBe(color.board.focusCell);
    expect(screen.getByTestId('puzzle-box-1-fixed', hidden)).toBeTruthy();
    expect(screen.getByTestId('puzzle-box-0-movable', hidden)).toBeTruthy();
  });

  it('each place is a button labelled with its digits, row by row, LTR; a box at home is not marked', async () => {
    await show({ slots: slotsOf([1, 5]) });
    const box0 = boxCellsAt(0).map((c) => GRID[c]);
    expect(screen.getByTestId('puzzle-slot-0', hidden).props.accessibilityLabel).toBe(
      `ריבוע 1, אפשר להזיז: ${box0.slice(0, 3).join(' ')}, ${box0.slice(3, 6).join(' ')}, ${box0.slice(6).join(' ')}`,
    );
    expect(screen.getByTestId('puzzle-slot-1', hidden).props.accessibilityLabel).toMatch(/^ריבוע 2, קבוע: /);
    expect(screen.getByTestId('puzzle-slot-0', hidden).props.accessibilityRole).toBe('button');
    // Every box here is at its home (id = place): nothing says so, and no "placed" look.
    expect(screen.queryAllByTestId(/placed/, hidden)).toHaveLength(0);
  });

  it('repeated digits only as the engine lists them (none by default, D78b)', async () => {
    const { rerender } = await show();
    expect(screen.queryAllByTestId(/^puzzle-conflict-/, hidden)).toHaveLength(0);
    await rerender({ conflicts: [0, 80] });
    const red = screen.getByTestId('puzzle-conflict-0-0', hidden);
    expect(StyleSheet.flatten(red.props.style).color).toBe(color.board.wrongDigit);
    expect(screen.getByTestId('puzzle-conflict-8-8', hidden)).toBeTruthy();
  });
});

describe('PuzzleBoard: the drag', () => {
  it('a drag from place 4 to place 7 asks for swap(3, 6): the held box is lifted, its place a hole', async () => {
    const { onSwap } = await show();
    const from = centre(3);
    await fireDrag([from, { x: from.x, y: from.y + 20 }, centre(6)]);
    await jsStep(); // the lift
    expect(screen.getByTestId('puzzle-held', hidden)).toBeTruthy();
    expect(screen.getByTestId('puzzle-hole', hidden)).toBeTruthy();
    expect(cue).toHaveBeenCalledWith('cellSelect');
    // The box follows the finger, on the UI thread (the animated style is drawn on the next frame).
    await wait(FRAME);
    expect(drawnAt(3).y).toBeCloseTo(2 * G.pitch);
    await jsThread(); // the drop
    expect(onSwap).toHaveBeenLastCalledWith(3, 6);
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('puzzle-hole', hidden)).toBeNull();
  });

  it('over another moving box: the gold frame; over a fixed one: its lock turns red, no frame', async () => {
    await show();
    const from = centre(3);
    await fireDrag([from, { x: from.x + 10, y: from.y }, centre(4), centre(5), { x: WIDTH + 30, y: 10 }]);
    await jsStep(); // the lift
    await jsStep(); // over place 4
    expect(screen.getByTestId('puzzle-target-4', hidden)).toBeTruthy();
    await jsStep(); // over place 5, fixed
    expect(screen.getByTestId('puzzle-lock-5-hot', hidden)).toBeTruthy();
    expect(screen.queryByTestId('puzzle-target-5', hidden)).toBeNull();
    expect(screen.queryByTestId('puzzle-target-4', hidden)).toBeNull();
    await jsThread(); // off the board, and the drop there
    expect(screen.queryByTestId('puzzle-lock-5-hot', hidden)).toBeNull();
  });

  it('onto a fixed box: still asked; the engine refuses (boxFixed), the box goes home, cellDenied plays', async () => {
    const asked = jest.fn();
    await render(<Hosted fixed={[1, 5]} onAsk={asked} />);
    await drag(centre(4), centre(5));
    expect(asked).toHaveBeenCalledWith(4, 5);
    expect(cue).toHaveBeenCalledWith('cellDenied');
    // The fixed box's lock shakes, and the held box slides home.
    await wait(PUZZLE_UI.homeMs + 50);
    expect(drawnAt(4)).toMatchObject({ x: slotOrigin(G, 4).x, y: slotOrigin(G, 4).y });
    expect(screen.queryByTestId('puzzle-held', hidden)).toBeNull();
    expect(screen.getByTestId('puzzle-box-4-movable', hidden)).toBeTruthy();
  });

  it('off the board, or back on its own place: nothing is asked, and the box goes home', async () => {
    const { onSwap } = await show();
    await drag(centre(3), { x: WIDTH + 40, y: centre(3).y });
    await drag(centre(3), { x: centre(3).x + 10, y: centre(3).y + 10 });
    await drag(centre(3), centre(6), State.CANCELLED);
    expect(onSwap).not.toHaveBeenCalled();
    await wait(PUZZLE_UI.homeMs + 50);
    expect(drawnAt(3)).toMatchObject({ x: 0, y: G.pitch, scale: 1 });
    expect(screen.queryByTestId('puzzle-held', hidden)).toBeNull();
  });

  it('the drag takes one finger only: a second one cancels it, so the target is always under the tile', async () => {
    await show();
    expect(getByGestureTestId('puzzle-drag').config.maxPointers).toBe(1);
  });

  it('a fixed box does not lift: cellDenied, and the screen hears of it', async () => {
    const { onSwap, onFixed } = await show();
    await drag(centre(1), centre(0));
    expect(onSwap).not.toHaveBeenCalled();
    expect(onFixed).toHaveBeenCalledWith(1);
    expect(cue).toHaveBeenCalledWith('cellDenied');
    expect(screen.queryByTestId('puzzle-held', hidden)).toBeNull();
  });

  it('a swap moves each box by its own id: the held one from where it was dropped, both slide in', async () => {
    await render(<Hosted fixed={[1, 5]} onAsk={jest.fn()} />);
    await drag(centre(3), centre(6));
    // Box 3 now stands at place 6 (dropped right there) and box 6 at place 3, sliding up from where it was.
    expect(screen.getByTestId('puzzle-box-3-movable', hidden)).toBeTruthy();
    await wait(2 * FRAME);
    const early = drawnAt(3);
    expect(early.x).toBe(0);
    expect(early.y).toBeGreaterThan(G.pitch);
    expect(early.y).toBeLessThan(2 * G.pitch);
    await wait(Math.max(PUZZLE_UI.swapMs, PUZZLE_UI.swapOtherMs) + 50);
    expect(drawnAt(6)).toMatchObject({ x: 0, y: 2 * G.pitch });
    expect(drawnAt(3)).toMatchObject({ x: 0, y: G.pitch });
    // Its digits went with it: place 7 now reads box 4's.
    expect(screen.getByTestId('puzzle-slot-6', hidden).props.accessibilityLabel).toContain(
      boxCellsAt(3)
        .slice(0, 3)
        .map((c) => GRID[c])
        .join(' '),
    );
  });

  it('nothing moves while the board takes no moves (frozen, over)', async () => {
    const { onSwap } = await show({ enabled: false });
    await drag(centre(3), centre(6));
    await tapAt(centre(3));
    await activate(3);
    expect(onSwap).not.toHaveBeenCalled();
    expect(screen.queryByTestId('puzzle-held', hidden)).toBeNull();
  });
});

describe('PuzzleBoard: tap, then tap (D78a)', () => {
  it('chooses a box, swaps with the next one; the same box twice lets go', async () => {
    const { onSwap } = await show();
    await tapAt(centre(3));
    expect(screen.getByTestId('puzzle-selected-3', hidden)).toBeTruthy();
    expect(screen.getByTestId('puzzle-slot-3', hidden).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('puzzle-slot-3', hidden).props.accessibilityLabel).toMatch(/^ריבוע 4, נבחר: /);
    await tapAt(centre(3));
    expect(screen.queryByTestId('puzzle-selected-3', hidden)).toBeNull();
    expect(onSwap).not.toHaveBeenCalled();
    await tapAt(centre(3));
    await tapAt(centre(6));
    expect(onSwap).toHaveBeenCalledWith(3, 6);
    expect(screen.queryByTestId('puzzle-selected-3', hidden)).toBeNull();
  });

  it('a fixed box first: cellDenied and the screen hears of it; chosen, then a fixed one: the engine is asked', async () => {
    const { onSwap, onFixed } = await show();
    await tapAt(centre(5));
    expect(onFixed).toHaveBeenCalledWith(5);
    expect(cue).toHaveBeenCalledWith('cellDenied');
    expect(screen.queryByTestId('puzzle-selected-5', hidden)).toBeNull();
    await tapAt(centre(4));
    await tapAt(centre(5));
    expect(onSwap).toHaveBeenCalledWith(4, 5);
    // The choice stays, so another box can be tried after the refusal.
    expect(screen.getByTestId('puzzle-selected-4', hidden)).toBeTruthy();
  });

  it('LEVEL_UI.puzzleTapSwap off: a tap does nothing (the drag and a screen reader still work)', async () => {
    expect(LEVEL_UI.puzzleTapSwap).toBe(true);
    const { onSwap } = await show({ tapSwap: false });
    await tapAt(centre(3));
    expect(screen.queryByTestId('puzzle-selected-3', hidden)).toBeNull();
    await activate(3);
    await activate(6);
    expect(onSwap).toHaveBeenCalledWith(3, 6);
  });

  it('a screen reader: activate on box 4, then on box 7, swaps them', async () => {
    const { onSwap } = await show();
    const slot = screen.getByTestId('puzzle-slot-3', hidden);
    expect(slot.props.accessibilityActions).toEqual([{ name: 'activate' }]);
    expect(slot.props.accessibilityHint).toBe('הקש כדי לבחור, ואז הקש על ריבוע אחר');
    await activate(3);
    expect(screen.getByTestId('puzzle-slot-3', hidden).props.accessibilityState).toMatchObject({
      selected: true,
    });
    await activate(6);
    expect(onSwap).toHaveBeenCalledWith(3, 6);
  });
});

describe('PuzzleBoard: Reduced Motion', () => {
  beforeEach(() => useSettings.setState({ reduceMotion: 'on' }));

  it('no lift (the P1 frame stays), the box follows the finger, and the swap is instant', async () => {
    await render(<Hosted fixed={[1, 5]} onAsk={jest.fn()} />);
    const from = centre(3);
    await fireDrag([from, { x: from.x, y: from.y + 30 }, centre(6)]);
    await jsStep(); // the lift
    await wait(PUZZLE_UI.swapMs);
    expect(screen.getByTestId('puzzle-held', hidden)).toBeTruthy();
    expect(drawnAt(3)).toMatchObject({ scale: 1 });
    expect(drawnAt(3).y).toBeCloseTo(2 * G.pitch);
    await jsThread(); // the drop, and the swap
    // At once: one frame later, with no slide.
    await wait(FRAME);
    expect(drawnAt(6)).toMatchObject({ x: 0, y: 2 * G.pitch, scale: 1 });
    expect(drawnAt(3)).toMatchObject({ x: 0, y: G.pitch });
  });

  it('full motion: the held box grows to the lift scale', async () => {
    useSettings.setState({ reduceMotion: 'off' });
    await show();
    const from = centre(3);
    await fireDrag([from, { x: from.x, y: from.y + 30 }]);
    await jsStep(); // the lift
    await wait(300);
    expect(drawnAt(3).scale).toBeCloseTo(PUZZLE_UI.liftScale);
    await jsThread(); // back on its own place: home
    await wait(PUZZLE_UI.homeMs + 50);
    expect(drawnAt(3)).toMatchObject({ x: 0, y: G.pitch, scale: 1 });
  });

  it('solved: a still gold frame on every box for a moment, then gone', async () => {
    const { rerender } = await show();
    await rerender({ solved: true });
    await wait(10);
    expect(screen.getAllByTestId(/^puzzle-solved-/, hidden)).toHaveLength(9);
    await wait(PUZZLE_UI.solvedReducedMs);
    expect(screen.queryAllByTestId(/^puzzle-solved-/, hidden)).toHaveLength(0);
  });

  it('a fixed box touched: its lock frame lights instead of the shake', async () => {
    await show();
    await tapAt(centre(1));
    expect(screen.getByTestId('puzzle-lock-1-lit', hidden)).toBeTruthy();
    await wait(PUZZLE_UI.deniedReducedMs + 10);
    expect(screen.queryByTestId('puzzle-lock-1-lit', hidden)).toBeNull();
  });
});
