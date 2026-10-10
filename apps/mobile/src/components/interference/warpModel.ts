import type { InterferenceScope } from './config';

/**
 * The warp interference (spec §7.1 "המסך מתעוות: פרספקטיבה, גלים, היסט צבעים"; round 1 Hit-Warp; motion.md
 * §4.4). Two parts, both driven by the hit's clock on the UI thread:
 *
 * - The live screen itself tilts in perspective and wobbles (WarpFrame): Reanimated transforms on the view
 *   that holds the game, so the board stays live and playable under it, and nothing is re-rendered or
 *   re-laid out per frame (a transform is a property of the view's render node).
 * - An overlay (WarpOverlay, Skia) adds what a transform can't: wave lines running across, glitch bands that
 *   jump, a colour shift between the sender's colour and gold, a slow spiral, and an offset copy of the
 *   board's frame in the sender's colour at 50 %, jumping in steps.
 *
 * Round 1 also skews (skewX ±8°). Android views can't skew (React Native drops skew from a view's transform
 * there), so the tilt comes from rotateX / rotateY in perspective, which both platforms draw the same.
 */

/** The tilt swings there and back in 1300 ms; the wave runs in 1100 ms (motion.md §4.4). */
export const WARP_SWING_MS = 1300;
export const WARP_WAVE_MS = 1100;
/** The offset copy and the glitch bands jump every quarter of these (round 1: 1600 and 2100 ms, stepped). */
export const WARP_GLITCH_MS = [1600, 2100] as const;
/** The spiral turns once in 5 s. */
export const WARP_SPIRAL_MS = 5000;
/** The rumble: a light knock on every wave (motion.md §7: "Warp: impact(Light) every 1100 ms"). */
export const WARP_PULSE_MS = WARP_WAVE_MS;

export interface WarpPose {
  perspective: number;
  /** Degrees. */
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  scaleX: number;
  scaleY: number;
}

/**
 * How much of round 1's board tilt each region takes: the whole screen is tall, so the same angles would
 * throw its top and bottom far off; it tilts 60 % as much, with a longer perspective.
 */
const AMOUNT = { screen: 0.6, board: 1 } as const;
const PERSPECTIVE = { screen: 1000, board: 700 } as const;
/** The jelly of the wave: the content stretches across and squeezes down, and back, by 2.5 %. */
const SQUASH = 0.025;

export const NO_WARP: WarpPose = {
  perspective: PERSPECTIVE.screen,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  scaleX: 1,
  scaleY: 1,
};

/**
 * The tilt at `t` ms into the hit, at `strength` (0 … 1, the hit's fade, so it eases in and out). Round 1
 * `sf-warp`: rotateX 16° → −10°, rotateY −12° → 12°, rotateZ −3° → 2.5°, scale .92 → .94, there and back
 * with an ease-in-out. A worklet.
 */
export function warpPose(t: number, strength: number, scope: InterferenceScope): WarpPose {
  'worklet';
  const k = strength * AMOUNT[scope];
  const cycle = (t / WARP_SWING_MS) % 2;
  const u = cycle < 1 ? cycle : 2 - cycle;
  // motion.md `loop` (an ease-in-out), as a cosine.
  const s = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, u));
  const wave = Math.sin((t / WARP_WAVE_MS) * Math.PI * 2);
  const scale = 1 + (0.92 + 0.02 * s - 1) * k;
  return {
    perspective: PERSPECTIVE[scope],
    rotateX: (16 - 26 * s) * k,
    rotateY: (-12 + 24 * s) * k,
    rotateZ: (-3 + 5.5 * s) * k,
    scaleX: scale * (1 + SQUASH * wave * k),
    scaleY: scale * (1 - SQUASH * wave * k),
  };
}

/**
 * Reduced motion (spec §22, motion.md: "a fixed 6° skew, scale 1.04"): a still tilt, on for the hit's whole
 * time and off at its end, with no tween in between. A worklet.
 */
export function warpStill(on: boolean, scope: InterferenceScope): WarpPose {
  'worklet';
  if (!on) return { ...NO_WARP, perspective: PERSPECTIVE[scope] };
  return {
    perspective: PERSPECTIVE[scope],
    rotateX: 0,
    rotateY: -6 * AMOUNT[scope],
    rotateZ: -2,
    scaleX: 1.04,
    scaleY: 1.04,
  };
}

/** A pose as a React Native transform (perspective first, angles in degrees). A worklet. */
export function warpTransform(pose: WarpPose) {
  'worklet';
  return [
    { perspective: pose.perspective },
    { rotateX: `${pose.rotateX}deg` },
    { rotateY: `${pose.rotateY}deg` },
    { rotateZ: `${pose.rotateZ}deg` },
    { scaleX: pose.scaleX },
    { scaleY: pose.scaleY },
  ];
}

/** Which of its 4 steps a stepped loop of `period` is on at `t` (CSS `steps(1)` keyframes). A worklet. */
export function stepOf(t: number, period: number, lead = 0): number {
  'worklet';
  const u = ((((t + lead) % period) + period) % period) / period;
  return Math.min(3, Math.floor(u * 4));
}

/** Round 1 `sf-glitch`: where a glitch band is on each step, in px of the 374-high board area. */
export const GLITCH_STEPS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-6, 46],
  [5, 150],
  [-3, 92],
];
/** The two bands: top and height in the same px, colour slot, and when each starts its loop. */
export const GLITCH_BANDS = [
  { top: 96, height: 16, period: WARP_GLITCH_MS[0], lead: 0 },
  { top: 214, height: 10, period: WARP_GLITCH_MS[1], lead: 700 },
] as const;
export const GLITCH_FRAME = 374;

/** The offset copy of the board jumps between these offsets (round 1: −7 px and +7 px copies). */
export const GHOST_STEPS: readonly (readonly [number, number])[] = [
  [-7, 0],
  [6, 3],
  [-5, -3],
  [7, -2],
];

/**
 * A horizontal wave line across `width` (plus one wavelength, so it can run by one): quadratic humps up and
 * down, like round 1's "q20 -12 40 0 t40 0 …".
 */
export function wavePath(width: number, y: number, amp: number, wavelength: number): string {
  const half = wavelength / 2;
  let d = `M0 ${y} q${half / 2} ${-amp} ${half} 0`;
  for (let x = half; x < width + wavelength; x += half) d += ` t${half} 0`;
  return d;
}

/** The wave lines of a region: one every ~62 px down it (round 1: six over the 374 px board), 4 to 12. */
export function waveLines(width: number, height: number): { d: string; slot: 0 | 1 | 2; width: number }[] {
  const count = Math.max(4, Math.min(12, Math.round(height / 62)));
  const wavelength = waveLength(width);
  const widths = [3, 4, 2.5] as const;
  return Array.from({ length: count }, (_, i) => ({
    d: wavePath(width, ((i + 0.5) * height) / count, 6 + (i % 3), wavelength),
    slot: (i % 3) as 0 | 1 | 2,
    width: widths[i % 3]!,
  }));
}

/** Round 1's waves are 80 px long on a 374 px board: about a fifth of the width. */
export const waveLength = (width: number): number => Math.max(40, width / 4.7);

/** Round 1's spiral (220 × 220, centred on 110, 110), drawn at 59 % of the board's side. */
export const SPIRAL_PATH =
  'M110 110a6 6 0 0 1 12 0a12 12 0 0 1 -24 0a18 18 0 0 1 36 0a24 24 0 0 1 -48 0a30 30 0 0 1 60 0a36 36 0 0 1 -72 0a42 42 0 0 1 84 0a48 48 0 0 1 -96 0';
export const SPIRAL_BOX = 220;
export const SPIRAL_SHARE = 0.59;

/** The rumble's knocks: every 1100 ms inside the hit. */
export function warpRumble(totalMs: number): number[] {
  const times: number[] = [];
  for (let at = WARP_PULSE_MS; at < totalMs; at += WARP_PULSE_MS) times.push(at);
  return times;
}
