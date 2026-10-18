import { createRng, type Digit, type Rng } from '@sudoku-fight/engine';

import { SCRAMBLE } from './config';

/**
 * [D47] "מספרים מתערבלים" (`scramble`), the plan (Moshe 2026-10-17): every filled cell of the board I see gets a
 * tile that hides its real digit and rolls through digits, one per step of 400 ms (2.5 changes a second at
 * most). In about 30 % of the steps a cell shows its true digit; all of them, true or not, are drawn as a
 * segment display in the sender's colour, so nothing on the board looks like a real digit for 5 s. Visual only:
 * the engine's board, the taps and the keypad never change. Reduced motion: a "?" on every filled cell, still.
 *
 * Deterministic: the plan of a hit comes from its seed (the game and the interference's event, hitSeedOf), and
 * each cell's own draws come from the seed and the cell, so one cell filled during the hit changes no other.
 */

export type ScrambleConfig = typeof SCRAMBLE;

/** A filled cell the scramble covers. `background` is any tag the drawing maps to the cell's colour. */
export interface ScrambleCell {
  cell: number;
  digit: Digit;
  background: number;
}

export interface ScrambleTile extends ScrambleCell {
  /** Where its steps start, ms before the hit's start (0 … stepMs): the cells don't all change together. */
  phaseMs: number;
  /** What it shows in each step: the true digit or another one, never the same twice in a row. */
  digits: readonly Digit[];
}

export interface ScramblePlan {
  stepMs: number;
  rollMs: number;
  tiles: readonly ScrambleTile[];
}

const DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** A cell's own generator: the hit's seed and the cell, mixed (so the cells don't share a stream). */
function cellRng(seed: number, cell: number): Rng {
  return createRng((Math.imul(seed >>> 0, 31) + Math.imul(cell + 1, 0x9e3779b1)) >>> 0);
}

/** A digit other than the excluded ones. */
function otherDigit(rng: Rng, ...not: (Digit | null)[]): Digit {
  const choices = DIGITS.filter((d) => !not.includes(d));
  return choices[Math.floor(rng.next() * choices.length)]!;
}

/** The steps a tile needs to cover `totalMs` from its phase, plus the one it is in at the end. */
const stepsFor = (totalMs: number, phaseMs: number, stepMs: number): number =>
  Math.floor((totalMs + phaseMs) / stepMs) + 1;

/** The plan of one hit of `totalMs` over these cells (the filled ones, given or solved). */
export function scramblePlan(
  cells: readonly ScrambleCell[],
  seed: number,
  totalMs: number,
  cfg: Pick<ScrambleConfig, 'stepMs' | 'trueShare' | 'rollMs'> = SCRAMBLE,
): ScramblePlan {
  const tiles = cells.map((c): ScrambleTile => {
    const rng = cellRng(seed, c.cell);
    const phaseMs = Math.floor(rng.next() * cfg.stepMs);
    const digits: Digit[] = [];
    let last: Digit | null = null;
    // The truth never shows twice in a row (no digit does: a cell that stays put would give itself away), so
    // after a fake one it comes with the chance that keeps its share at `trueShare` over the whole hit.
    const afterFake = Math.min(1, cfg.trueShare / Math.max(1e-9, 1 - cfg.trueShare));
    for (let k = 0, n = stepsFor(totalMs, phaseMs, cfg.stepMs); k < n; k++) {
      const chance: number = last === null ? cfg.trueShare : afterFake;
      const truth: boolean = last !== c.digit && rng.next() < chance;
      const next: Digit = truth ? c.digit : otherDigit(rng, c.digit, last);
      digits.push(next);
      last = next;
    }
    return { ...c, phaseMs, digits };
  });
  return { stepMs: cfg.stepMs, rollMs: cfg.rollMs, tiles };
}

/** The step a tile is in at `t` ms into the hit. */
export function scrambleStep(
  tile: Pick<ScrambleTile, 'phaseMs' | 'digits'>,
  t: number,
  stepMs: number,
): number {
  'worklet';
  const k = Math.floor((Math.max(0, t) + tile.phaseMs) / stepMs);
  return Math.min(k, tile.digits.length - 1);
}

/** What a tile shows at `t`: its digit, and while it rolls in, the one it rolls from (p 0 → 1). */
export interface ScrambleFrame {
  digit: Digit;
  from: Digit | null;
  /** How far the roll is: 1 once the new digit is in place. */
  p: number;
}

export function scrambleFrame(
  tile: Pick<ScrambleTile, 'phaseMs' | 'digits'>,
  t: number,
  stepMs: number,
  rollMs: number,
): ScrambleFrame {
  'worklet';
  const k = scrambleStep(tile, t, stepMs);
  const digit = tile.digits[k]!;
  const into = Math.max(0, t) + tile.phaseMs - k * stepMs;
  const from = k > 0 ? tile.digits[k - 1]! : null;
  if (from === null || from === digit || into >= rollMs || t <= 0) return { digit, from: null, p: 1 };
  // Ease out (the 'standard' curve's feel): fast at first, settling into place.
  const x = into / rollMs;
  return { digit, from, p: 1 - (1 - x) * (1 - x) };
}

/** When a tile's shown digit changes, in ms from the hit's start (for the tests and the rate limit). */
export function scrambleChanges(tile: ScrambleTile, totalMs: number, stepMs: number): number[] {
  const times: number[] = [];
  for (let k = 1; k < tile.digits.length; k++) {
    const at = k * stepMs - tile.phaseMs;
    if (at > 0 && at < totalMs && tile.digits[k] !== tile.digits[k - 1]) times.push(at);
  }
  return times;
}

// ---------------------------------------------------------------------------------------------------------
// The glyphs: a segment display, drawn as lines, so the fake digits never look like the board's own font.

/** A line in a 1 × 1 box (x right, y down). */
export type Seg = readonly [x1: number, y1: number, x2: number, y2: number];

const A: Seg = [0, 0, 1, 0];
const B: Seg = [1, 0, 1, 0.5];
const C: Seg = [1, 0.5, 1, 1];
const D: Seg = [0, 1, 1, 1];
const E: Seg = [0, 0.5, 0, 1];
const F: Seg = [0, 0, 0, 0.5];
const G: Seg = [0, 0.5, 1, 0.5];

/** Digits 1–9 (index = digit), and "?" for reduced motion (with a dot under it, QUESTION_DOT). */
export const SEGMENTS: Readonly<Record<Digit, readonly Seg[]>> = {
  1: [B, C],
  2: [A, B, G, E, D],
  3: [A, B, G, C, D],
  4: [F, G, B, C],
  5: [A, F, G, C, D],
  6: [A, F, G, E, C, D],
  7: [A, B, C],
  8: [A, B, C, D, E, F, G],
  9: [A, B, C, D, F, G],
};
export const QUESTION: readonly Seg[] = [A, B, [1, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.72]];
export const QUESTION_DOT = { x: 0.5, y: 0.97 } as const;

/** What draws a glyph: a canvas with lines (Skia's, or the tests' recording one) and the pen. */
export interface GlyphCanvas<P> {
  drawLine(x1: number, y1: number, x2: number, y2: number, paint: P): void;
}

/**
 * Draws `segs` in the box (x, y, w, h), keeping only what lies between `top` and `bottom` (the tile: a digit
 * rolling in or out is cut at its edges). Every segment is horizontal or vertical, so the cut is exact.
 */
export function drawSegments<P>(
  canvas: GlyphCanvas<P>,
  paint: P,
  segs: readonly Seg[],
  x: number,
  y: number,
  w: number,
  h: number,
  top: number,
  bottom: number,
): number {
  'worklet';
  let drawn = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const x1 = x + s[0] * w;
    const x2 = x + s[2] * w;
    let y1 = y + s[1] * h;
    let y2 = y + s[3] * h;
    if (y1 > y2) {
      const swap = y1;
      y1 = y2;
      y2 = swap;
    }
    if (y2 < top || y1 > bottom) continue;
    canvas.drawLine(x1, Math.max(top, y1), x2, Math.min(bottom, y2), paint);
    drawn += 1;
  }
  return drawn;
}

/** A tile as the picture draws it: where, in which of the backgrounds, and its steps. */
export interface ScrambleDraw {
  x: number;
  y: number;
  width: number;
  height: number;
  background: number;
  phaseMs: number;
  digits: readonly Digit[];
}

/** The tiles of a plan where the board draws them: `cellAt` gives a cell's rect in the board's coordinates. */
export function scrambleDraws(
  plan: ScramblePlan,
  cellAt: (cell: number) => { x: number; y: number; width: number },
  tile: ScrambleConfig['tile'] = SCRAMBLE.tile,
): ScrambleDraw[] {
  return plan.tiles.map((t) => {
    const at = cellAt(t.cell);
    return {
      ...scrambleTileRect(at.x, at.y, at.width, tile),
      background: t.background,
      phaseMs: t.phaseMs,
      digits: t.digits,
    };
  });
}

/** The tile over a cell of `side` dp at (x, y), from SCRAMBLE.tile. */
export function scrambleTileRect(
  x: number,
  y: number,
  side: number,
  tile: ScrambleConfig['tile'] = SCRAMBLE.tile,
): { x: number; y: number; width: number; height: number } {
  return {
    x: x + side * tile.side,
    y: y + side * tile.top,
    width: side * (1 - 2 * tile.side),
    height: side * (1 - tile.top - tile.bottom),
  };
}

/** The rumble of a scramble hit: a light knock every 800 ms, from 400 ms in (the digits keep rolling). */
export function scrambleRumble(totalMs: number, everyMs = 800, firstMs = 400): number[] {
  const times: number[] = [];
  for (let at = firstMs; at < totalMs; at += everyMs) times.push(at);
  return times;
}
