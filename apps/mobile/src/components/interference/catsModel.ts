import type { Transforms3d } from '@shopify/react-native-skia';

import type { InterferenceScope } from './config';
import type { CatPaletteName } from './palette';

/**
 * The cats interference (spec §7.1 "חתולים מצוירים רצים על המסך"; round 1 Hit-Cats; motion.md §4.4): five
 * cartoon cats of different sizes gallop diagonally across, from the top end to the bottom start, each at its
 * own speed (2.0–3.1 s a crossing), bobbing every 220–340 ms, two of them shouting "מיאו!". At the hit's
 * start each one is halfway across (round 1 starts them at −dur/2), so the board is covered from the first
 * frame. Pure numbers; the poses are worklets, computed on the UI thread every frame.
 */

export interface CatRun {
  /** Top-left of its box at the middle of its run, in Hit-Cats' px (a band 390 wide and 470 high). */
  x: number;
  y: number;
  /** Width in the same px; the art is 190 × 90. */
  w: number;
  /** Tilt along its run, degrees (negative: head down towards where it runs). */
  tilt: number;
  /** One crossing, ms. */
  runMs: number;
  /** One bob (and half a stride), ms. */
  bobMs: number;
  palette: CatPaletteName;
  caption: 'meow' | 'mew' | null;
}

/** Round 1's five cats (Hit-Cats.dc.html `effect()`), with C's palettes. */
export const CAT_RUNS: readonly CatRun[] = [
  { x: 146, y: 135, w: 168, tilt: -28, runMs: 2800, bobMs: 300, palette: 'tabby', caption: 'meow' },
  { x: 46, y: 238, w: 132, tilt: -26, runMs: 2300, bobMs: 260, palette: 'black', caption: null },
  { x: 242, y: 272, w: 116, tilt: -30, runMs: 3100, bobMs: 340, palette: 'gray', caption: null },
  { x: 118, y: 350, w: 124, tilt: -27, runMs: 2500, bobMs: 280, palette: 'snow', caption: null },
  { x: 288, y: 130, w: 84, tilt: -24, runMs: 2000, bobMs: 220, palette: 'ginger', caption: 'mew' },
];

/** The art's box (catArt.tsx). */
export const CAT_ART = { width: 190, height: 90 } as const;

/** Hit-Cats' frame: the band is 390 × 470, from y 190 to 660 of the 844-high screen (around the board). */
const DESIGN = { width: 390, band: 470, screen: 844, bandTop: 190 } as const;
/** One crossing moves the box this far: from (+330, −200) to (−330, +200) (round 1 `sf-run`). */
const RUN = { dx: 660, dy: 400 } as const;
/** Bob height (sf-bob) and leg swing. */
const BOB_PX = 4;
const SWING_RAD = (16 * Math.PI) / 180;
/** The speech bubble sits 6 px before and 30 px above the box. */
export const CAPTION_OFFSET = { x: -6, y: -30 } as const;

/** The region the cats run in: px per design px, and where the band of the design lies in it. */
export interface CatField {
  scale: number;
  bandTop: number;
  bandHeight: number;
}

/**
 * The whole screen keeps round 1's band around the board; on the board alone [D35] the band is the board.
 * Sizes and runs scale with the width, so the cats keep their proportions on any phone.
 */
export function catField(width: number, height: number, scope: InterferenceScope): CatField {
  const scale = width / DESIGN.width;
  if (scope === 'board') return { scale, bandTop: 0, bandHeight: height };
  return {
    scale,
    bandTop: (DESIGN.bandTop / DESIGN.screen) * height,
    bandHeight: (DESIGN.band / DESIGN.screen) * height,
  };
}

/** Where a cat is at `t`: its box's centre, size, tilt, bob and leg swing. */
export interface CatPose {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Art px → region px. */
  scale: number;
  tilt: number;
  bob: number;
  swing: number;
}

/** A cat's pose at `t` ms into the hit. A worklet. */
export function catPose(run: CatRun, field: CatField, t: number): CatPose {
  'worklet';
  const k = field.scale;
  const w = run.w * k;
  const h = (run.w * CAT_ART.height * k) / CAT_ART.width;
  // Halfway across at t = 0, then on at its own speed, round and round.
  const p = (((t / run.runMs + 0.5) % 1) + 1) % 1;
  const dx = (RUN.dx / 2 - RUN.dx * p) * k;
  const dy = (-RUN.dy / 2 + RUN.dy * p) * k;
  const anchorY = field.bandTop + (run.y / DESIGN.band) * field.bandHeight;
  const bobPhase = (t / run.bobMs) * Math.PI * 2;
  return {
    cx: run.x * k + w / 2 + dx,
    cy: anchorY + h / 2 + dy,
    w,
    h,
    scale: w / CAT_ART.width,
    tilt: (run.tilt * Math.PI) / 180,
    bob: -BOB_PX * k * (0.5 - 0.5 * Math.cos(bobPhase)),
    // A stride takes two bobs.
    swing: SWING_RAD * Math.sin(bobPhase / 2),
  };
}

/** The Skia transform that draws the 190 × 90 art at a pose. A worklet. */
export function catTransform(pose: CatPose): Transforms3d {
  'worklet';
  return [
    { translateX: pose.cx },
    { translateY: pose.cy + pose.bob },
    { rotate: pose.tilt },
    { scale: pose.scale },
    { translateX: -CAT_ART.width / 2 },
    { translateY: -CAT_ART.height / 2 },
  ];
}

/** Where a cat's speech bubble goes at a pose (its top-left), not tilted and not bobbing. A worklet. */
export function captionAt(pose: CatPose): { x: number; y: number } {
  'worklet';
  return { x: pose.cx - pose.w / 2 + CAPTION_OFFSET.x, y: pose.cy - pose.h / 2 + CAPTION_OFFSET.y };
}

/**
 * When the rumble knocks (motion.md §7: "impact(Light) as each cat enters"): each time a cat starts a new
 * crossing inside the hit, at least `minGapMs` apart.
 */
export function catsRumble(totalMs: number, minGapMs = 250): number[] {
  const entries: number[] = [];
  for (const run of CAT_RUNS) {
    // p wraps to 0 when t / runMs + 0.5 is a whole number.
    for (let n = 1; (n - 0.5) * run.runMs < totalMs; n++) entries.push(Math.round((n - 0.5) * run.runMs));
  }
  entries.sort((a, b) => a - b);
  const times: number[] = [];
  for (const at of entries) {
    if (times.length && at - times[times.length - 1]! < minGapMs) continue;
    times.push(at);
  }
  return times;
}

/** Paw prints left on the way: along the runs of the two biggest cats, at these points of their crossing. */
export const PAW_TRAILS: readonly { cat: number; steps: readonly number[] }[] = [
  { cat: 0, steps: [0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76] },
  { cat: 3, steps: [0.25, 0.33, 0.41, 0.49, 0.57, 0.65, 0.73] },
];

/** A paw print: where, turned along the run, and how faint (round 1: .2–.38). */
export interface PawPrint {
  x: number;
  y: number;
  angle: number;
  opacity: number;
  size: number;
}

export function pawPrints(field: CatField): PawPrint[] {
  const prints: PawPrint[] = [];
  for (const trail of PAW_TRAILS) {
    const run = CAT_RUNS[trail.cat]!;
    trail.steps.forEach((p, i) => {
      // The pose at the moment it was there, its feet under its body (left and right paws in turn).
      const pose = catPose(run, field, (p - 0.5) * run.runMs);
      const side = i % 2 === 0 ? 1 : -1;
      prints.push({
        x: pose.cx + Math.sin(pose.tilt) * 6 * side * field.scale,
        y: pose.cy + pose.h * 0.45 + Math.cos(pose.tilt) * 6 * side * field.scale,
        angle: pose.tilt - Math.PI / 2,
        opacity: 0.2 + (i % 4) * 0.06,
        size: 14 * field.scale,
      });
    });
  }
  return prints;
}
