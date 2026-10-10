import type { SkCanvas, SkColor, SkPaint } from '@shopify/react-native-skia';

/**
 * The fireworks interference (spec §7.1 "זיקוקים מתפוצצים על המסך"; round 1 Hit-Fireworks; motion.md §4.4):
 * bursts bloom over the screen one after another, each in 1.6–2.2 s, embers fall from them and a few
 * sparkles twinkle. The plan (where and when every burst goes) is worked out once per hit, from a fixed seed,
 * so the reduced-motion picture shows the same bursts in the same places. Each frame, `drawFireworks` draws
 * the plan at one instant, on the UI thread.
 *
 * Limits: at most `MAX_PARTICLES` drawn at once; bursts start at least 350 ms apart, so no more than 3 bloom
 * per second (motion.md: no effect flashes more than 3 times a second), and nothing white fills the screen.
 */

/** Three colours, by index: 0 the sender's seat colour, 1 gold, 2 white (palette.ts `effectColors`). */
export type ColorSlot = 0 | 1 | 2;

export interface Ember {
  /** Direction, radians. */
  angle: number;
  /** Where on the radius it starts, 0–1. */
  at: number;
}

export interface Burst {
  /** Start, in ms from the hit's start; negative: already blooming when the hit begins. */
  at: number;
  /** How long it blooms and fades. */
  dur: number;
  /** Centre and full radius, in px of the region it covers. */
  x: number;
  y: number;
  r: number;
  /** Rotation of its rays, radians. */
  spin: number;
  /** Outer rays, inner rays, tips. */
  colors: readonly [ColorSlot, ColorSlot, ColorSlot];
  embers: readonly Ember[];
}

export interface Sparkle {
  x: number;
  y: number;
  size: number;
  color: ColorSlot;
  period: number;
  phase: number;
}

export interface FireworksPlan {
  width: number;
  height: number;
  bursts: readonly Burst[];
  sparkles: readonly Sparkle[];
}

/** Rays and dots of one burst: 16 outer rays, 8 inner ones, 8 tips, the core, 6 embers. */
export const RING_OUTER = 16;
export const RING_INNER = 8;
export const TIPS = 8;
export const EMBERS = 6;
export const PARTICLES_PER_BURST = RING_OUTER + RING_INNER + TIPS + 1 + EMBERS;
export const SPARKLES = 6;
/** Never more than this many particles on screen at once (a few hundred, spec §22 performance). */
export const MAX_PARTICLES = 300;

/** Bursts start every 380 ms, give or take 30: never closer than 350 ms. */
export const BURST_STEP_MS = 380;
const STEP_JITTER = 30;
export const MIN_BURST_GAP_MS = BURST_STEP_MS - STEP_JITTER;
/** A burst blooms and fades in 1600–2200 ms (motion.md: 1600–2300, trimmed to keep the particle budget). */
export const BURST_MIN_MS = 1600;
export const BURST_MAX_MS = 2200;
/** The first burst started this long before the hit, so the screen is full from its first frame. */
const LEAD_IN_MS = 1100;

/**
 * The instant the reduced-motion picture freezes (motion.md: "one frozen frame with the same bursts in the
 * same positions"): four or five bursts are well open then.
 */
export const STILL_AT_MS = 1300;

/**
 * Where bursts go, as fractions of the region (x of its width, y of its height), with their radius as a
 * fraction of the width. The first six are round 1's (Hit-Fireworks, over the board); the last three reach
 * the cards and the keypad, since the effect covers the whole screen [D35]. Taken in an order that swaps
 * sides each time.
 */
const SPOTS: readonly (readonly [x: number, y: number, r: number])[] = [
  [0.64, 0.45, 0.25],
  [0.25, 0.43, 0.19],
  [0.82, 0.64, 0.17],
  [0.38, 0.62, 0.23],
  [0.72, 0.2, 0.18],
  [0.59, 0.71, 0.14],
  [0.3, 0.18, 0.2],
  [0.85, 0.38, 0.12],
  [0.45, 0.86, 0.17],
];

/** Which colour each ring takes, in turn; the sender's colour is always on one of the two rings of rays. */
const COLOR_ORDERS: readonly (readonly [ColorSlot, ColorSlot, ColorSlot])[] = [
  [0, 1, 2],
  [1, 0, 2],
  [0, 2, 1],
  [2, 0, 1],
];

/** The sparkles' colours in turn: mostly white, some gold, one in the sender's colour (round 1's mix). */
const SPARKLE_COLORS: readonly ColorSlot[] = [2, 1, 0, 2, 1, 2];

/** A small seeded generator (mulberry32): the same plan every time, without Math.random. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bursts and sparkles of one hit of `totalMs`, over a region of `width` × `height`. */
export function fireworksPlan(totalMs: number, width: number, height: number, seed = 7): FireworksPlan {
  const rnd = seeded(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rnd();
  const bursts: Burst[] = [];
  let at = -LEAD_IN_MS;
  for (let k = 0; at < totalMs; k++) {
    const [fx, fy, fr] = SPOTS[k % SPOTS.length]!;
    const embers: Ember[] = [];
    for (let e = 0; e < EMBERS; e++) {
      embers.push({ angle: between(0, Math.PI * 2), at: between(0.3, 0.9) });
    }
    bursts.push({
      at: Math.round(at),
      dur: Math.round(between(BURST_MIN_MS, BURST_MAX_MS)),
      x: (fx + between(-0.04, 0.04)) * width,
      y: (fy + between(-0.03, 0.03)) * height,
      r: fr * between(0.9, 1.1) * width,
      spin: between(0, Math.PI / 4),
      colors: COLOR_ORDERS[k % COLOR_ORDERS.length]!,
      embers,
    });
    at += BURST_STEP_MS + between(-STEP_JITTER, STEP_JITTER);
  }

  const sparkles: Sparkle[] = [];
  for (let s = 0; s < SPARKLES; s++) {
    sparkles.push({
      x: between(0.08, 0.92) * width,
      y: between(0.15, 0.85) * height,
      size: between(12, 18),
      color: SPARKLE_COLORS[s % SPARKLE_COLORS.length]!,
      // Sparkles 900–1300 ms (motion.md §4.4).
      period: between(900, 1300),
      phase: between(0, 1300),
    });
  }
  return { width, height, bursts, sparkles };
}

/**
 * When the hit's rumble knocks (motion.md §7: "impact(Medium) per burst, ≥ 700 ms apart"): the bursts that
 * start inside the hit, thinned to one every 700 ms.
 */
export function fireworksRumble(plan: FireworksPlan, totalMs: number, minGapMs = 700): number[] {
  const times: number[] = [];
  for (const b of plan.bursts) {
    if (b.at <= 0 || b.at >= totalMs) continue;
    if (times.length && b.at - times[times.length - 1]! < minGapMs) continue;
    times.push(b.at);
  }
  return times;
}

/** What a frame needs to draw with: the three colours as Skia colours, and two paints. */
export interface FireworksInk {
  colors: readonly [SkColor, SkColor, SkColor];
  /** A stroke paint with round caps, and a fill paint (anti-aliased). */
  stroke: SkPaint;
  fill: SkPaint;
}

/**
 * Draws the plan at `t` ms into the hit, at `alpha` (the hit's fade), and returns how many particles it
 * drew. A worklet: it runs on the UI thread inside the frame's picture, once per frame.
 */
export function drawFireworks(
  canvas: Pick<SkCanvas, 'drawLine' | 'drawCircle'>,
  ink: FireworksInk,
  plan: FireworksPlan,
  t: number,
  alpha: number,
): number {
  'worklet';
  const { stroke, fill, colors } = ink;
  let drawn = 0;
  if (alpha <= 0) return 0;

  for (let k = 0; k < plan.bursts.length; k++) {
    const b = plan.bursts[k]!;
    const local = t - b.at;
    if (local < 0 || local >= b.dur) continue;
    const p = local / b.dur;
    // sf-bloom: opens to its full size by 55 %, then drifts on to 112 % while it fades.
    const open = 1 - (1 - Math.min(1, p / 0.55)) ** 3;
    const drift = p > 0.55 ? 1 + 0.12 * ((p - 0.55) / 0.45) : 1;
    const radius = b.r * (0.15 + 0.85 * open) * drift;
    const sag = b.r * 0.3 * p * p;
    const fade = p < 0.1 ? p / 0.1 : p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.45);
    const a = fade * alpha;
    // Long rays while it opens, short sparks once it is open.
    const streak = 0.06 + 0.3 * (1 - open);
    const width = Math.max(2, b.r * 0.05);

    stroke.setColor(colors[b.colors[0]]);
    stroke.setAlphaf(a);
    stroke.setStrokeWidth(width);
    for (let i = 0; i < RING_OUTER; i++) {
      const th = b.spin + (i * Math.PI * 2) / RING_OUTER;
      const cx = Math.cos(th);
      const cy = Math.sin(th);
      const tail = radius * (1 - streak);
      canvas.drawLine(
        b.x + cx * tail,
        b.y + cy * tail + sag * 0.85,
        b.x + cx * radius,
        b.y + cy * radius + sag,
        stroke,
      );
    }
    drawn += RING_OUTER;

    stroke.setColor(colors[b.colors[1]]);
    stroke.setStrokeWidth(width * 0.8);
    const inner = radius * 0.62;
    for (let i = 0; i < RING_INNER; i++) {
      const th = b.spin + ((i + 0.5) * Math.PI * 2) / RING_INNER;
      const cx = Math.cos(th);
      const cy = Math.sin(th);
      const tail = inner * (1 - streak);
      canvas.drawLine(
        b.x + cx * tail,
        b.y + cy * tail + sag * 0.85,
        b.x + cx * inner,
        b.y + cy * inner + sag,
        stroke,
      );
    }
    drawn += RING_INNER;

    fill.setColor(colors[b.colors[2]]);
    fill.setAlphaf(a);
    const tip = Math.max(1.5, b.r * 0.03) * (1 - 0.4 * p);
    for (let i = 0; i < TIPS; i++) {
      const th = b.spin + (i * Math.PI * 2) / TIPS;
      canvas.drawCircle(
        b.x + Math.cos(th) * radius * 1.08,
        b.y + Math.sin(th) * radius * 1.08 + sag,
        tip,
        fill,
      );
    }
    drawn += TIPS;

    // The core: a small white heart in its first 30 %, never a screen-wide flash.
    if (p < 0.3) {
      fill.setColor(colors[2]);
      fill.setAlphaf(a * (1 - p / 0.3));
      canvas.drawCircle(b.x, b.y, b.r * 0.08 * (1 - p / 0.3) + 1, fill);
      drawn += 1;
    }

    // Embers fall from 45 % on (sf-ember: 40 px down while they fade).
    if (p > 0.45) {
      const q = (p - 0.45) / 0.55;
      const s = b.r / 100;
      fill.setAlphaf(alpha * (1 - q));
      for (let e = 0; e < b.embers.length; e++) {
        const em = b.embers[e]!;
        fill.setColor(colors[b.colors[e % 3]!]);
        canvas.drawCircle(
          b.x + Math.cos(em.angle) * radius * em.at,
          b.y + Math.sin(em.angle) * radius * em.at + sag + 40 * s * q * q,
          Math.max(1.5, 2.2 * s),
          fill,
        );
      }
      drawn += b.embers.length;
    }
  }

  // Sparkles (sf-twinkle): a small cross that grows 0.6 → 1.15, turns 45° and brightens .5 → 1.
  stroke.setStrokeWidth(2);
  for (let k = 0; k < plan.sparkles.length; k++) {
    const s = plan.sparkles[k]!;
    const u = ((t + s.phase) % s.period) / s.period;
    const tw = 0.5 - 0.5 * Math.cos(u * Math.PI * 2);
    const half = (s.size * (0.6 + 0.55 * tw)) / 2;
    const th = (Math.PI / 4) * tw;
    const dx = Math.cos(th) * half;
    const dy = Math.sin(th) * half;
    stroke.setColor(colors[s.color]);
    stroke.setAlphaf((0.5 + 0.5 * tw) * alpha);
    canvas.drawLine(s.x - dx, s.y - dy, s.x + dx, s.y + dy, stroke);
    canvas.drawLine(s.x + dy, s.y - dx, s.x - dy, s.y + dx, stroke);
    drawn += 1;
  }
  return drawn;
}
