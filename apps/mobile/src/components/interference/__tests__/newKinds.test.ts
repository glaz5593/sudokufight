import { type Digit, ManualClock } from '@sudoku-fight/engine';

import { color, size, tokens } from '../../../theme';
import { boardGeometry, cellRect } from '../../board/geometry';
import { HIT_DIM, INK, KEYPAD, SCRAMBLE } from '../config';
import { inkCoverage, inkPlan, inkPose, inkRumble } from '../inkModel';
import {
  keypadOrderAt,
  keypadPlan,
  keypadRumble,
  KeypadShuffler,
  NATURAL_ORDER,
  slotOf,
  STUCK_FINGERS_MS,
} from '../keypadModel';
import { HIT_DIM_COLOR, solidOf } from '../palette';
import {
  drawSegments,
  QUESTION,
  type ScrambleCell,
  scrambleChanges,
  scrambleDraws,
  scrambleFrame,
  scramblePlan,
  scrambleRumble,
  scrambleStep,
  scrambleTileRect,
  SEGMENTS,
} from '../scrambleModel';
import { recordingCanvas } from '../testing/skiaMock';

/** The interference improvements of 2026-10-17: the board's dim [D46] and the three new kinds [D47]. */

/** A full-ish board: 50 filled cells with their digits and backgrounds. */
const FILLED: ScrambleCell[] = Array.from({ length: 50 }, (_, k) => ({
  cell: (k * 7) % 81,
  digit: ((k % 9) + 1) as Digit,
  background: k % 3,
}));

describe('[D46] the board’s dim', () => {
  it('is 60 % of the solid scrim colour, for every kind, in over 240 ms (200 reduced) and out over 240 ms', () => {
    expect(HIT_DIM.opacity).toBe(0.6);
    expect(tokens.opacity.hitDim).toBe(0.6);
    expect(HIT_DIM.fadeInMs).toBe(240);
    expect(HIT_DIM.fadeInReducedMs).toBe(200);
    expect(HIT_DIM.fadeOutMs).toBe(240);
    expect(HIT_DIM_COLOR).toBe('#07090c');
  });

  it('takes the scrim’s colour without its own alpha', () => {
    expect(solidOf(color.scrim)).toBe('#07090c');
    expect(solidOf('rgba(255, 0, 16, 0.5)')).toBe('#ff0010');
    expect(solidOf('#123456')).toBe('#123456');
  });
});

describe('[D47] scramble: the plan', () => {
  const plan = scramblePlan(FILLED, 1234, 5000);

  it('is the same for the same seed, another for another seed', () => {
    expect(scramblePlan(FILLED, 1234, 5000)).toEqual(plan);
    expect(scramblePlan(FILLED, 1235, 5000)).not.toEqual(plan);
  });

  it('covers exactly the cells it is given, and a cell filled later changes no other cell', () => {
    expect(plan.tiles.map((t) => t.cell)).toEqual(FILLED.map((c) => c.cell));
    const more = scramblePlan([...FILLED, { cell: 80, digit: 5, background: 0 }], 1234, 5000);
    expect(more.tiles.slice(0, FILLED.length)).toEqual(plan.tiles);
  });

  it('never shows one digit twice in a row, and every step to the end of the hit has a digit', () => {
    for (const tile of plan.tiles) {
      expect(tile.digits.every((d, k) => k === 0 || d !== tile.digits[k - 1])).toBe(true);
      expect(scrambleStep(tile, 5000, plan.stepMs)).toBeLessThan(tile.digits.length);
      expect(tile.digits.every((d) => d >= 1 && d <= 9)).toBe(true);
    }
  });

  it('shows the truth in about 30 % of the steps (all in the sender’s colour)', () => {
    const steps = plan.tiles.flatMap((t) => t.digits.map((d) => d === t.digit));
    const share = steps.filter(Boolean).length / steps.length;
    expect(SCRAMBLE.trueShare).toBe(0.3);
    expect(share).toBeGreaterThan(0.24);
    expect(share).toBeLessThan(0.36);
  });

  it('changes a cell at most 2.5 times a second: never twice within 400 ms (photosensitivity)', () => {
    expect(1000 / SCRAMBLE.stepMs).toBeLessThanOrEqual(2.5);
    for (const tile of plan.tiles) {
      const changes = scrambleChanges(tile, 5000, plan.stepMs);
      expect(changes.length).toBeGreaterThan(5);
      expect(changes.every((t, k) => k === 0 || t - changes[k - 1]! >= plan.stepMs)).toBe(true);
    }
    // And the cells don't all change at once: their steps start at different times.
    expect(new Set(plan.tiles.map((t) => t.phaseMs)).size).toBeGreaterThan(20);
  });

  it('rolls from the last digit into the next at a step, and stands still after the roll', () => {
    const tile = plan.tiles[0]!;
    const boundary = plan.stepMs - tile.phaseMs + plan.stepMs; // step 2 starts here
    const rolling = scrambleFrame(tile, boundary + 40, plan.stepMs, plan.rollMs);
    expect(rolling).toMatchObject({ digit: tile.digits[2], from: tile.digits[1] });
    expect(rolling.p).toBeGreaterThan(0);
    expect(rolling.p).toBeLessThan(1);
    expect(scrambleFrame(tile, boundary + plan.rollMs + 1, plan.stepMs, plan.rollMs)).toEqual({
      digit: tile.digits[2],
      from: null,
      p: 1,
    });
    expect(scrambleFrame(tile, 0, plan.stepMs, plan.rollMs).from).toBeNull();
  });

  it('knocks every 800 ms', () => {
    expect(scrambleRumble(5000)).toEqual([400, 1200, 2000, 2800, 3600, 4400]);
  });
});

describe('[D47] scramble: on the board', () => {
  const g = boardGeometry(358);

  it('places each tile on its cell, LTR: column 1 on the left, boxes with their gaps', () => {
    expect(cellRect(g, 0)).toEqual({ x: 0, y: 0, width: g.cell, height: g.cell });
    const last = cellRect(g, 80);
    expect(last.x + last.width).toBeCloseTo(358, 5);
    expect(last.y + last.height).toBeCloseTo(358, 5);
    // D5 (row 3, column 4): one box and one cell in, from the left.
    const d5 = cellRect(g, 3 * 9 + 4);
    const box = 3 * g.cell + 2 * tokens.border.grid + tokens.border.boxGap;
    expect(d5.x).toBeCloseTo(box + g.cell + tokens.border.grid, 5);
    expect(d5.y).toBeCloseTo(box, 5);
  });

  it('hides the digit but leaves the solver’s glyph and the wrong digits in their corners (they are untouched)', () => {
    const cell = g.cell;
    const tile = scrambleTileRect(0, 0, cell);
    // The big digit (Rubik 22 at a 38 dp cell, centred): its box is inside the tile.
    const digit = (tokens.type.digitCell.size * cell) / size.boardCell;
    expect(tile.x).toBeLessThan(cell / 2 - digit * 0.3);
    expect(tile.x + tile.width).toBeGreaterThan(cell / 2 + digit * 0.3);
    expect(tile.y).toBeLessThan(cell / 2 - digit * 0.35);
    expect(tile.y + tile.height).toBeGreaterThan(cell / 2 + digit * 0.3);
    // The solver's glyph, top-left: clear of the tile.
    const glyphEnd = ((size.solverGlyph.inset + size.solverGlyph.size) * cell) / size.boardCell;
    expect(tile.x >= glyphEnd || tile.y >= glyphEnd).toBe(true);
    // The wrong digits, bottom-right: their glyphs start below the tile.
    const wrongTop =
      cell -
      ((size.wrongDigitInset.bottom + tokens.type.wrongDigit.lineHeight * 0.85) * cell) / size.boardCell;
    expect(tile.y + tile.height).toBeLessThanOrEqual(wrongTop);
  });

  it('draws the tiles where the cells are', () => {
    const plan = scramblePlan(FILLED.slice(0, 3), 1, 5000);
    const draws = scrambleDraws(plan, (cell) => cellRect(g, cell));
    expect(draws[1]).toMatchObject(scrambleTileRect(cellRect(g, 7).x, cellRect(g, 7).y, g.cell));
    expect(draws[1]!.digits).toBe(plan.tiles[1]!.digits);
  });

  it('draws digits as a segment display cut to the tile (a rolling digit never spills over its cell)', () => {
    const canvas = recordingCanvas();
    const drawn = drawSegments(canvas, 'pen', SEGMENTS[8], 0, 0, 10, 20, 0, 20);
    expect(drawn).toBe(7);
    const cut = recordingCanvas();
    // Half of an 8 rolled down out of the tile: only the top half's segments, clipped.
    drawSegments(cut, 'pen', SEGMENTS[8], 0, 10, 10, 20, 0, 20);
    for (const call of cut.calls) {
      const [, y1, , y2] = call.args as number[];
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(y2).toBeLessThanOrEqual(20);
    }
    expect(cut.calls.length).toBeLessThan(7);
    // Reduced motion: a "?" (and its dot) on every filled cell.
    expect(QUESTION.length).toBeGreaterThan(2);
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) expect(SEGMENTS[d].length).toBeGreaterThan(1);
  });
});

describe('[D47] ink', () => {
  const board = { x: 16, y: 288, width: 358, height: 358 };

  it('plans five blots inside the board, from the seed, landing one after another', () => {
    const plan = inkPlan(77, board);
    expect(inkPlan(77, board)).toEqual(plan);
    expect(inkPlan(78, board)).not.toEqual(plan);
    expect(plan.blots).toHaveLength(INK.blots);
    for (const b of plan.blots) {
      expect(b.x).toBeGreaterThan(board.x);
      expect(b.x).toBeLessThan(board.x + board.width);
      expect(b.y).toBeGreaterThan(board.y);
      expect(b.y).toBeLessThan(board.y + board.height);
      expect(b.r).toBeGreaterThanOrEqual(board.width * INK.radius[0] - 0.1);
      expect(b.r).toBeLessThanOrEqual(board.width * INK.radius[1] + 0.1);
      expect(b.path).toMatch(/^M[\d. -]+(Q[\d. -]+)+Z$/);
      expect(b.drops).toHaveLength(INK.droplets);
    }
    const at = plan.blots.map((b) => b.at);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at[at.length - 1]).toBeLessThan(1000);
  });

  it('covers about 40 % of the board', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const cover = inkCoverage(inkPlan(seed, board), board);
      expect({ seed, enough: cover > 0.25, notAll: cover < 0.55 }).toEqual({
        seed,
        enough: true,
        notAll: true,
      });
    }
  });

  it('splashes in, holds, and is wiped away over the last 1.5 s, gone at the end', () => {
    const blot = { at: 100 };
    expect(inkPose(blot, 50, 5000)).toEqual({ scale: 0.25, opacity: 0 });
    expect(inkPose(blot, 100 + INK.splatMs * 0.65, 5000).scale).toBeCloseTo(1.08, 2);
    expect(inkPose(blot, 2000, 5000)).toEqual({ scale: 1, opacity: 1 });
    const fading = inkPose(blot, 5000 - INK.fadeMs / 2, 5000);
    expect(fading.opacity).toBeCloseTo(0.5, 2);
    expect(fading.scale).toBeLessThan(1);
    expect(inkPose(blot, 5000, 5000).opacity).toBe(0);
  });

  it('knocks as each blot lands', () => {
    expect(inkRumble(5000)).toEqual(inkPlan(1, board).blots.map((b) => b.at));
  });
});

describe('[D47] keypad: the orders', () => {
  const plan = keypadPlan(42, 5000);

  it('one order per 1.5 s step, from the seed; every key moves at every step', () => {
    expect(keypadPlan(42, 5000)).toEqual(plan);
    expect(keypadPlan(43, 5000)).not.toEqual(plan);
    expect(plan.orders).toHaveLength(4);
    let last = NATURAL_ORDER;
    for (const order of plan.orders) {
      expect([...order].sort()).toEqual([...NATURAL_ORDER]);
      expect(order.every((d, slot) => last[slot] !== d)).toBe(true);
      last = order;
    }
  });

  it('is at step k from k × 1.5 s; reduced motion keeps the first order for the whole hit', () => {
    expect(keypadOrderAt(plan, 0, false)).toBe(plan.orders[0]);
    expect(keypadOrderAt(plan, 1499, false)).toBe(plan.orders[0]);
    expect(keypadOrderAt(plan, 1500, false)).toBe(plan.orders[1]);
    expect(keypadOrderAt(plan, 4999, false)).toBe(plan.orders[3]);
    expect(keypadOrderAt(plan, 4000, true)).toBe(plan.orders[0]);
  });

  it('finds a key’s slot', () => {
    expect(slotOf(null, 5)).toBe(4);
    expect(slotOf([9, 8, 7, 6, 5, 4, 3, 2, 1], 9)).toBe(0);
  });

  it('knocks each time the keys trade places', () => {
    expect(keypadRumble(5000)).toEqual([1500, 3000, 4500]);
  });
});

describe('[D47] keypad: the shuffler (the game clock, fingers and guards)', () => {
  const START = 100_000;
  let clock: ManualClock;
  let shuffler: KeypadShuffler;
  let seen: number;
  const hit = (over: Partial<Parameters<KeypadShuffler['update']>[0] & object> = {}) => ({
    endsAt: START + 5000,
    remainingMs: 5000,
    totalMs: 5000,
    seed: 42,
    ...over,
  });
  const plan = keypadPlan(42, 5000);
  /** The game clock and the phone's timers move on together. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      clock.advance(50);
      jest.advanceTimersByTime(50);
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    clock = new ManualClock(START);
    shuffler = new KeypadShuffler(clock);
    seen = 0;
    shuffler.subscribe(() => (seen += 1));
  });
  afterEach(() => {
    shuffler.dispose();
    jest.useRealTimers();
  });

  it('takes the first order at once, a new one every 1.5 s, and 1–9 again exactly at the end', () => {
    expect(shuffler.order()).toBeNull();
    shuffler.update(hit(), false);
    expect(shuffler.order()).toEqual(plan.orders[0]);
    advance(1450);
    expect(shuffler.order()).toEqual(plan.orders[0]);
    advance(100);
    expect(shuffler.order()).toEqual(plan.orders[1]);
    advance(1500);
    expect(shuffler.order()).toEqual(plan.orders[2]);
    advance(1500);
    expect(shuffler.order()).toEqual(plan.orders[3]);
    advance(400); // 4950 ms in
    expect(shuffler.order()).toEqual(plan.orders[3]);
    advance(50); // 5000: the hit is over
    expect(shuffler.order()).toBeNull();
    expect(seen).toBe(5);
  });

  it('never moves a key under a finger: it waits for the lift, and a moment after it', () => {
    shuffler.update(hit(), false);
    advance(1400);
    shuffler.fingers(1);
    advance(600); // past the 1.5 s step
    expect(shuffler.order()).toEqual(plan.orders[0]);
    shuffler.fingers(0);
    advance(KEYPAD.freezeMs - 100);
    expect(shuffler.order()).toEqual(plan.orders[0]);
    advance(150);
    expect(shuffler.order()).toEqual(plan.orders[1]);
    // Two fingers: both must lift.
    shuffler.fingers(2);
    advance(1200);
    shuffler.fingers(1);
    advance(500);
    expect(shuffler.order()).toEqual(plan.orders[1]);
    shuffler.fingers(0);
    advance(KEYPAD.freezeMs + 50);
    expect(shuffler.order()).toEqual(plan.orders[2]);
  });

  it('takes the count the keypad gives as it is: the same count heard twice is not more fingers', () => {
    shuffler.update(hit(), false);
    advance(1400);
    // iOS sends one event per key for touches of one frame; the keypad counts by id and says 2 each time.
    shuffler.fingers(2);
    shuffler.fingers(2);
    shuffler.fingers(1);
    shuffler.fingers(0);
    advance(KEYPAD.freezeMs + 150);
    expect(shuffler.order()).toEqual(plan.orders[1]);
  });

  it('does not count a press that starts while the keys move into place, nor just after', () => {
    shuffler.update(hit(), false);
    expect(shuffler.settled()).toBe(false);
    advance(KEYPAD.moveMs);
    expect(shuffler.settled()).toBe(false);
    advance(KEYPAD.guardMs);
    expect(shuffler.settled()).toBe(true);
    advance(1500 - KEYPAD.moveMs - KEYPAD.guardMs); // the next move
    expect(shuffler.settled()).toBe(false);
  });

  it('with reduced motion: one order for the whole hit (a fade in and out), no further moves', () => {
    shuffler.update(hit(), true);
    expect(shuffler.order()).toEqual(plan.orders[0]);
    advance(4900);
    expect(shuffler.order()).toEqual(plan.orders[0]);
    expect(seen).toBe(1);
    advance(150);
    expect(shuffler.order()).toBeNull();
    expect(shuffler.settled()).toBe(false); // the fade back
    advance(KEYPAD.fadeMs + KEYPAD.guardMs);
    expect(shuffler.settled()).toBe(true);
  });

  it('stands still while the game is frozen, and goes on from there', () => {
    shuffler.update(hit({ endsAt: null, remainingMs: 3000 }), false);
    // 2 s in: the second order, then nothing moves however long the freeze lasts.
    expect(shuffler.order()).toEqual(plan.orders[1]);
    advance(10_000);
    expect(shuffler.order()).toEqual(plan.orders[1]);
    shuffler.update(hit({ endsAt: clock.now() + 3000 }), false);
    advance(1000);
    expect(shuffler.order()).toEqual(plan.orders[2]);
  });

  it('goes back to 1–9 when the hit ends early (the view dropped it)', () => {
    shuffler.update(hit(), false);
    advance(500);
    shuffler.update(null, false);
    expect(shuffler.order()).toBeNull();
  });

  it('a lift it never heard can’t freeze the keys for good', () => {
    shuffler.update(hit({ endsAt: START + 60_000, totalMs: 60_000, remainingMs: 60_000 }), false);
    const first = shuffler.order();
    shuffler.fingers(1);
    advance(STUCK_FINGERS_MS - 1000);
    expect(shuffler.order()).toBe(first);
    advance(2000);
    expect(shuffler.order()).not.toEqual(first);
  });
});
