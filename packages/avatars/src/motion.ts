/**
 * Motions: the whole character moves, never the tile (docs/avatars/STYLE.md, "Motion").
 *
 * A motion is data: tracks of keyframes (time 0-1, translate, rotate, scale, and an optional face change) for
 * three groups of the rendered SVG (render.ts): `body` (the character), `face` (the features only, for a nod)
 * and `eyes` (blink). The same data plays in two players:
 *
 * - CSS, for the preview page and the admin site: `motionCss()` turns every track into @keyframes. Put the
 *   class `sfa-m-{motion id}` on the <svg> to play it. Face changes need a script: `faceChanges()` lists them
 *   with their times; replace g#face's content with renderFace() at each one.
 *
 * - Reanimated, in the app (later). Suggested wiring, one shared value per playing avatar:
 *     const progress = useSharedValue(0);
 *     progress.value = withTiming(1, { duration: motion.durationMs, easing: Easing.linear });
 *     const bodyProps = useAnimatedProps(() => ({
 *       matrix: poseMatrix(sampleTrack(track, progress.value, motion.ease), motionOrigin(def, track.origin)),
 *     }));
 *     <AnimatedG animatedProps={bodyProps}>…</AnimatedG>
 *   `sampleTrack`, `poseMatrix` and the easing are worklets (pure math, 'worklet' directive), so they run on the
 *   UI thread. Face changes: schedule `faceChanges()` with runOnJS, or keep one React state for the expression.
 *   The keyframe curves are linear progress mapped by `EASINGS` (docs/design/motion.md §3), so CSS and
 *   Reanimated play the same timing.
 *
 * Reduced motion (the OS setting or the app's "הפחתת תנועה"): play no tracks, only the face changes. motionCss()
 * does this with a prefers-reduced-motion media query; the app checks useReducedMotion() and skips the tracks.
 */

import { baseOf, eyeLineOf } from './render';
import { f } from './svg';
import type {
  AvatarDef,
  EasingName,
  Expression,
  MotionDef,
  MotionId,
  MotionKeyframe,
  MotionOrigin,
  MotionTrack,
  Point,
  Pose,
} from './types';
import { MOTION_IDS } from './types';

/** docs/design/motion.md §3, as cubic-bezier control points. */
export const EASINGS: Record<EasingName, readonly [number, number, number, number]> = {
  standard: [0.2, 0.8, 0.2, 1],
  emphasized: [0.34, 1.56, 0.64, 1],
  exit: [0.42, 0, 1, 1],
  loop: [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
};

export const IDENTITY: Pose = { x: 0, y: 0, rotate: 0, sx: 1, sy: 1 };

const track = (
  target: MotionTrack['target'],
  origin: MotionOrigin,
  keyframes: MotionKeyframe[],
): MotionTrack => ({ target, origin, keyframes });

export const MOTIONS: Record<MotionId, MotionDef> = {
  blink: {
    id: 'blink',
    name: { he: 'מצמוץ', en: 'Blink' },
    durationMs: 200,
    ease: 'loop',
    idle: true,
    tracks: [
      track('eyes', 'eyes', [
        { t: 0, sy: 1 },
        { t: 0.45, sy: 0.08 },
        { t: 0.6, sy: 0.08 },
        { t: 1, sy: 1 },
      ]),
    ],
  },
  bounce: {
    id: 'bounce',
    name: { he: 'קפיצה', en: 'Bounce' },
    durationMs: 1000,
    ease: 'standard',
    expression: 'laugh',
    tracks: [
      track('body', 'base', [
        { t: 0, expression: 'laugh' },
        { t: 0.28, y: -7, ease: 'exit' },
        { t: 0.52, y: 0 },
        { t: 0.68, y: -2.5, ease: 'exit' },
        { t: 0.82, y: 0 },
        { t: 1, y: 0, expression: 'base' },
      ]),
    ],
  },
  nod: {
    id: 'nod',
    name: { he: 'הנהון', en: 'Nod' },
    durationMs: 900,
    ease: 'loop',
    expression: 'smile',
    tracks: [
      track('body', 'pivot', [
        { t: 0, expression: 'smile' },
        { t: 0.2, y: 2.4, sy: 0.98 },
        { t: 0.4, y: -0.4 },
        { t: 0.6, y: 2.4, sy: 0.98 },
        { t: 0.8, y: 0 },
        { t: 1, y: 0, expression: 'base' },
      ]),
      track('face', 'pivot', [
        { t: 0 },
        { t: 0.2, y: 1.6 },
        { t: 0.4, y: -0.3 },
        { t: 0.6, y: 1.6 },
        { t: 0.8, y: 0 },
        { t: 1 },
      ]),
    ],
  },
  tilt: {
    id: 'tilt',
    name: { he: 'הטיית ראש', en: 'Tilt' },
    durationMs: 1400,
    ease: 'standard',
    expression: 'confused',
    tracks: [
      track('body', 'pivot', [
        { t: 0, expression: 'confused' },
        { t: 0.22, rotate: -11, x: -1 },
        { t: 0.45, rotate: -9, x: -1, ease: 'loop' },
        { t: 0.66, rotate: -11, x: -1 },
        { t: 0.88, rotate: 0, x: 0 },
        { t: 1, expression: 'base' },
      ]),
    ],
  },
  shake: {
    id: 'shake',
    name: { he: 'ניעור', en: 'Shake' },
    durationMs: 900,
    ease: 'loop',
    expression: 'sad',
    tracks: [
      track('body', 'pivot', [
        { t: 0, expression: 'sad' },
        { t: 0.09, x: -4.5, rotate: -2 },
        { t: 0.2, x: 4.5, rotate: 2 },
        { t: 0.31, x: -3.5, rotate: -1.5 },
        { t: 0.42, x: 3.5, rotate: 1.5 },
        { t: 0.53, x: -2, rotate: -0.5 },
        { t: 0.62, x: 1.2 },
        { t: 0.7, x: 0 },
        { t: 1, expression: 'base' },
      ]),
    ],
  },
  spin: {
    id: 'spin',
    name: { he: 'סיבוב', en: 'Spin' },
    durationMs: 1300,
    ease: 'standard',
    expression: 'laugh',
    tracks: [
      track('body', 'pivot', [
        { t: 0, expression: 'surprised' },
        { t: 0.12, rotate: -18, ease: 'exit' },
        { t: 0.42, rotate: 180, sx: 0.8, sy: 0.8, expression: 'laugh' },
        { t: 0.72, rotate: 368, sx: 1, sy: 1, ease: 'loop' },
        { t: 0.82, rotate: 360 },
        { t: 1, rotate: 360, expression: 'base' },
      ]),
    ],
  },
  flip: {
    id: 'flip',
    name: { he: 'הסתובבות', en: 'Turn around' },
    durationMs: 1200,
    ease: 'loop',
    expression: 'wink',
    tracks: [
      track('body', 'pivot', [
        { t: 0, expression: 'smile' },
        { t: 0.3, sx: -1, y: -3 },
        { t: 0.6, sx: 1, y: 0 },
        { t: 0.62, expression: 'wink' },
        { t: 1, expression: 'base' },
      ]),
    ],
  },
  squash: {
    id: 'squash',
    name: { he: 'מעיכה ומתיחה', en: 'Squash and stretch' },
    durationMs: 1100,
    ease: 'standard',
    expression: 'laugh',
    needsSquash: true,
    fallback: 'bounce',
    tracks: [
      track('body', 'base', [
        { t: 0, ease: 'loop' },
        { t: 0.13, sx: 1.14, sy: 0.86, expression: 'surprised' },
        { t: 0.3, sx: 0.94, sy: 1.07, y: -4 },
        { t: 0.44, y: -6, ease: 'exit' },
        { t: 0.58, sx: 0.96, sy: 1.05, y: 0, ease: 'loop' },
        { t: 0.66, sx: 1.16, sy: 0.84, y: 0, expression: 'laugh' },
        { t: 0.78, sx: 0.97, sy: 1.03, ease: 'loop' },
        { t: 0.88 },
        { t: 1, expression: 'base' },
      ]),
    ],
  },
  wobble: {
    id: 'wobble',
    name: { he: 'התנודדות', en: 'Wobble' },
    durationMs: 1600,
    ease: 'loop',
    expression: 'dizzy',
    tracks: [
      track('body', 'base', [
        { t: 0, expression: 'dizzy' },
        { t: 0.14, rotate: 7, x: 2 },
        { t: 0.32, rotate: -6, x: -2 },
        { t: 0.5, rotate: 5, x: 1.5 },
        { t: 0.66, rotate: -3, x: -1 },
        { t: 0.8, rotate: 1, x: 0 },
        { t: 0.88 },
        { t: 1, expression: 'base' },
      ]),
    ],
  },
};

/** The motion an avatar actually plays: one that needs squash falls back for avatars that may not squash. */
export function resolveMotion(def: AvatarDef, id: MotionId): MotionDef {
  const m = MOTIONS[id];
  return m.needsSquash && !def.squash && m.fallback ? MOTIONS[m.fallback] : m;
}

/** The point a track rotates and scales around. */
export function motionOrigin(def: AvatarDef, origin: MotionOrigin): Point {
  if (origin === 'eyes') return eyeLineOf(def);
  if (origin === 'base') return { x: def.pivot.x, y: baseOf(def) };
  return def.pivot;
}

// ---------------------------------------------------------------------------------------------------------
// Sampling (worklet-safe: plain math, no closures over mutable state)

/** y of a CSS cubic-bezier at progress x (0-1). */
export function cubicBezier(curve: readonly [number, number, number, number], x: number): number {
  'worklet';
  const [x1, y1, x2, y2] = curve;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 24; i++) {
    const v = bx(t);
    if (Math.abs(v - x) < 1e-5) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return by(t);
}

function poseOf(k: MotionKeyframe): Pose {
  'worklet';
  return { x: k.x ?? 0, y: k.y ?? 0, rotate: k.rotate ?? 0, sx: k.sx ?? 1, sy: k.sy ?? 1 };
}

/** The pose of a track at progress 0-1 of its motion. */
export function sampleTrack(tr: MotionTrack, progress: number, ease: EasingName = 'linear'): Pose {
  'worklet';
  const ks = tr.keyframes;
  const first = ks[0];
  if (!first) return IDENTITY;
  if (progress <= first.t) return poseOf(first);
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (!a || !b || progress > b.t) continue;
    const span = b.t - a.t;
    const u = span > 0 ? (progress - a.t) / span : 1;
    const e = cubicBezier(EASINGS[a.ease ?? ease], u);
    const pa = poseOf(a);
    const pb = poseOf(b);
    return {
      x: pa.x + (pb.x - pa.x) * e,
      y: pa.y + (pb.y - pa.y) * e,
      rotate: pa.rotate + (pb.rotate - pa.rotate) * e,
      sx: pa.sx + (pb.sx - pa.sx) * e,
      sy: pa.sy + (pb.sy - pa.sy) * e,
    };
  }
  const last = ks[ks.length - 1];
  return last ? poseOf(last) : IDENTITY;
}

/**
 * The pose as an affine matrix [a, b, c, d, e, f] around `origin`: translate(origin + offset) · rotate · scale ·
 * translate(−origin). The order matches the CSS transform `translate() rotate() scale()` with that origin.
 */
export function poseMatrix(pose: Pose, origin: Point): [number, number, number, number, number, number] {
  'worklet';
  const rad = (pose.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = cos * pose.sx;
  const b = sin * pose.sx;
  const c = -sin * pose.sy || 0; // never -0
  const d = cos * pose.sy;
  const e = origin.x + pose.x - (a * origin.x + c * origin.y);
  const ff = origin.y + pose.y - (b * origin.x + d * origin.y);
  return [a, b, c, d, e, ff];
}

/** The face changes of a motion, in time order: when (ms from the start) to show which expression. */
export function faceChanges(motion: MotionDef): { atMs: number; expression: Expression | 'base' }[] {
  const out: { atMs: number; expression: Expression | 'base' }[] = [];
  for (const tr of motion.tracks)
    for (const k of tr.keyframes)
      if (k.expression) out.push({ atMs: Math.round(k.t * motion.durationMs), expression: k.expression });
  return out.sort((a, b) => a.atMs - b.atMs);
}

// ---------------------------------------------------------------------------------------------------------
// CSS (preview page, admin site)

function cssPose(p: Pose): string {
  return `translate(${f(p.x)}px,${f(p.y)}px) rotate(${f(p.rotate)}deg) scale(${f(p.sx)},${f(p.sy)})`;
}

function bezier(name: EasingName): string {
  return `cubic-bezier(${EASINGS[name].join(',')})`;
}

/**
 * Every motion as CSS. Play one by adding `sfa-m-{id}` to the avatar's <svg> class (remove it and force a
 * reflow to replay). Transform origins come from the custom properties render.ts puts on the <svg>.
 * `scope` prefixes every selector (e.g. '.avatars-page').
 */
export function motionCss(scope = ''): string {
  const s = scope ? `${scope} ` : '';
  const out: string[] = [
    `${s}.sfa .sfa-body,${s}.sfa .sfa-face,${s}.sfa .sfa-eyes{transform-box:view-box;transform-origin:var(--sfa-pivot)}`,
  ];
  for (const id of MOTION_IDS) {
    const m = MOTIONS[id];
    for (const tr of m.tracks) {
      const name = `sfa-${id}-${tr.target}`;
      const frames = tr.keyframes
        .map(
          (k) =>
            `${f(k.t * 100)}%{transform:${cssPose(poseOf(k))};animation-timing-function:${bezier(k.ease ?? m.ease)}}`,
        )
        .join('');
      out.push(`@keyframes ${name}{${frames}}`);
      out.push(
        `${s}.sfa.sfa-m-${id} .sfa-${tr.target}{animation:${name} ${m.durationMs}ms both;transform-origin:var(--sfa-${tr.origin})}`,
      );
    }
  }
  out.push(
    `@media (prefers-reduced-motion:reduce){${s}.sfa .sfa-body,${s}.sfa .sfa-face,${s}.sfa .sfa-eyes{animation:none!important}}`,
  );
  return out.join('\n');
}
