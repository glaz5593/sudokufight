/**
 * Gimmicks: a character's own moving parts (types.ts GimmickDef), declared as data like the motions: the
 * kettle's steam, the rain cloud's drops, the toaster's toast, the washing machine's drum.
 *
 * The data contract, for every player:
 * - A gimmick is drawn once, in its rest pose, as `<g class="sfa-gimmick sfa-g-{id}">` inside the body group,
 *   at its `z` (render.ts); the one with z `face` holds the face group after its markup. `rest: 'hidden'`
 *   draws it with opacity 0.
 * - Each anim says what plays it (`trigger`) and how it moves: keyframes of translate, rotate, scale and
 *   opacity around `origin`, over `durationMs`, after `delayMs`, once or in a `loop`.
 * - Which anim plays (playingGimmicks): none under 48 px or with reduced motion; otherwise one per gimmick,
 *   the first that matches in this order: the motion playing, the expression showing, then `idle` (only where
 *   the player allows idling: a big stage view, never a grid). A non-loop anim plays once when its trigger
 *   starts and holds its last pose while the trigger lasts; when the trigger ends the gimmick snaps back to
 *   rest.
 *
 * Players:
 * - CSS (preview page, admin site): `gimmickCss(avatars)` has one @keyframes per anim and rules keyed on the
 *   <svg>'s `data-avatar`, `data-expression`, its motion class `sfa-m-{id}` and `sfa-idle`. render.ts marks
 *   renders under 48 px with `sfa-small`, where nothing plays.
 * - Reanimated (the app, later), per playing gimmick group:
 *     const progress = useSharedValue(0);
 *     progress.value = withDelay(anim.delayMs ?? 0,
 *       withRepeat(withTiming(1, { duration: anim.durationMs, easing: Easing.linear }), anim.loop ? -1 : 1));
 *     const props = useAnimatedProps(() => {
 *       const p = sampleGimmick(anim, progress.value);
 *       return { matrix: poseMatrix(p, anim.origin), opacity: p.opacity };
 *     });
 *   When playingGimmicks() no longer lists it: cancelAnimation(progress) and show the rest pose (identity,
 *   opacity 0 when `rest` is 'hidden'). `sampleGimmick` is a worklet, like motion.ts's sampleTrack.
 */

import { cubicBezier, EASINGS } from './motion';
import { GIMMICK_MIN_SIZE } from './render';
import { f } from './svg';
import type {
  AvatarDef,
  EasingName,
  Expression,
  GimmickAnim,
  GimmickDef,
  GimmickKeyframe,
  GimmickPose,
  GimmickTrigger,
  MotionId,
} from './types';
import { EXPRESSIONS, MOTION_IDS } from './types';

export const GIMMICK_IDENTITY: GimmickPose = { x: 0, y: 0, rotate: 0, sx: 1, sy: 1, opacity: 1 };

/** The default curve between a gimmick's keyframes. */
export const GIMMICK_EASE: EasingName = 'loop';

/** A gimmick's anims as a list (it may declare one or several). */
export function gimmickAnims(g: GimmickDef): readonly GimmickAnim[] {
  const a = g.anim;
  return 'keyframes' in a ? [a] : a;
}

const isExpression = (t: GimmickTrigger): t is Exclude<Expression, 'neutral'> =>
  (EXPRESSIONS as readonly string[]).includes(t);
const isMotion = (t: GimmickTrigger): t is Exclude<MotionId, 'blink'> =>
  (MOTION_IDS as readonly string[]).includes(t);

/** True if `anim` plays on `what` (an expression, a motion or 'idle'). */
export function triggeredBy(anim: GimmickAnim, what: Expression | MotionId | 'idle'): boolean {
  return (anim.trigger as readonly string[]).includes(what);
}

// ---------------------------------------------------------------------------------------------------------
// Sampling (worklet-safe)

function poseOf(k: GimmickKeyframe): GimmickPose {
  'worklet';
  return {
    x: k.x ?? 0,
    y: k.y ?? 0,
    rotate: k.rotate ?? 0,
    sx: k.sx ?? 1,
    sy: k.sy ?? 1,
    opacity: k.opacity ?? 1,
  };
}

/** The pose of an anim at progress 0-1 of its duration. Rotate and scale are around `anim.origin`. */
export function sampleGimmick(anim: GimmickAnim, progress: number): GimmickPose {
  'worklet';
  const ks = anim.keyframes;
  const first = ks[0];
  if (!first) return GIMMICK_IDENTITY;
  if (progress <= first.t) return poseOf(first);
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (!a || !b || progress > b.t) continue;
    const span = b.t - a.t;
    const u = span > 0 ? (progress - a.t) / span : 1;
    const e = cubicBezier(EASINGS[a.ease ?? anim.ease ?? GIMMICK_EASE], u);
    const pa = poseOf(a);
    const pb = poseOf(b);
    return {
      x: pa.x + (pb.x - pa.x) * e,
      y: pa.y + (pb.y - pa.y) * e,
      rotate: pa.rotate + (pb.rotate - pa.rotate) * e,
      sx: pa.sx + (pb.sx - pa.sx) * e,
      sy: pa.sy + (pb.sy - pa.sy) * e,
      opacity: pa.opacity + (pb.opacity - pa.opacity) * e,
    };
  }
  const last = ks[ks.length - 1];
  return last ? poseOf(last) : GIMMICK_IDENTITY;
}

// ---------------------------------------------------------------------------------------------------------
// Which anim plays

export interface GimmickState {
  /** The face showing now. */
  expression: Expression;
  /** The motion playing now, as resolved for this avatar (motion.ts resolveMotion), if any. */
  motion?: MotionId | null;
  /** True where idling is allowed: a big stage view, never a grid. */
  idle?: boolean;
  /** On-screen size of the tile, px. */
  size: number;
  reducedMotion?: boolean;
}

export interface PlayingGimmick {
  gimmick: GimmickDef;
  anim: GimmickAnim;
  /** The anim's index in the gimmick's list. */
  index: number;
}

/** The anim each gimmick plays in this state (at most one per gimmick): motion, then expression, then idle. */
export function playingGimmicks(def: AvatarDef, st: GimmickState): PlayingGimmick[] {
  if (st.reducedMotion || st.size < GIMMICK_MIN_SIZE) return [];
  const out: PlayingGimmick[] = [];
  for (const gimmick of def.gimmicks ?? []) {
    const anims = gimmickAnims(gimmick);
    const find = (want: Expression | MotionId | 'idle' | null | undefined) =>
      want ? anims.findIndex((a) => triggeredBy(a, want)) : -1;
    let index = find(st.motion);
    if (index < 0) index = find(st.expression);
    if (index < 0 && st.idle) index = find('idle');
    const anim = anims[index];
    if (anim) out.push({ gimmick, anim, index });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// CSS (preview page, admin site)

function cssPose(p: GimmickPose): string {
  return (
    `transform:translate(${f(p.x)}px,${f(p.y)}px) rotate(${f(p.rotate)}deg) scale(${f(p.sx)},${f(p.sy)});` +
    `opacity:${f(p.opacity)}`
  );
}

/** The @keyframes name of one anim. */
export function gimmickAnimName(avatarId: string, gimmickId: string, index: number): string {
  return `sfa-g-${avatarId}-${gimmickId}-${index}`;
}

/**
 * Every gimmick of `avatars` as CSS, with playingGimmicks' order of precedence (every rule has the same
 * specificity, so a later rule wins): idle rules, then expressions, then motions, and within each the
 * gimmick's first matching anim last. Put `sfa-idle` on a big stage view's <svg> to let it idle (renderAvatar
 * option `idle`). `scope` prefixes every selector (e.g. '.avatars-page').
 */
export function gimmickCss(avatars: readonly AvatarDef[], scope = ''): string {
  const s = scope ? `${scope} ` : '';
  const frames: string[] = [];
  const idle: string[] = [];
  const faces: string[] = [];
  const motions: string[] = [];
  for (const a of avatars)
    for (const g of a.gimmicks ?? [])
      [...gimmickAnims(g).entries()].reverse().forEach(([i, anim]) => {
        const name = gimmickAnimName(a.id, g.id, i);
        const ease = anim.ease ?? GIMMICK_EASE;
        frames.push(
          `@keyframes ${name}{${anim.keyframes
            .map(
              (k) =>
                `${f(k.t * 100)}%{${cssPose(poseOf(k))};animation-timing-function:cubic-bezier(${EASINGS[
                  k.ease ?? ease
                ].join(',')})}`,
            )
            .join('')}}`,
        );
        const play =
          `{animation:${name} ${anim.durationMs}ms ${anim.delayMs ?? 0}ms ${anim.loop ? 'infinite' : '1'} both;` +
          `transform-origin:${f(anim.origin.x)}px ${f(anim.origin.y)}px}`;
        const svg = `${s}.sfa[data-avatar="${a.id}"]:not(.sfa-small)`;
        const part = ` .sfa-g-${g.id}`;
        for (const t of anim.trigger) {
          if (t === 'idle') idle.push(`${svg}.sfa-idle${part}${play}`);
          else if (isExpression(t)) faces.push(`${svg}[data-expression="${t}"]${part}${play}`);
          else if (isMotion(t)) motions.push(`${svg}.sfa-m-${t}${part}${play}`);
        }
      });
  return [
    `${s}.sfa .sfa-gimmick{transform-box:view-box}`,
    ...frames,
    ...idle,
    ...faces,
    ...motions,
    `@media (prefers-reduced-motion:reduce){${s}.sfa .sfa-gimmick{animation:none!important}}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// Recipes: tested keyframe data for the common gimmicks. Spread one into an anim and add the rest:
//   anim: { ...GIMMICK_RECIPES.steam({ rise: 12 }), trigger: ['laugh', 'idle'], origin: { x: 46, y: 22 } }

/** What a recipe gives: everything in an anim except what is yours (when it plays and where it pivots). */
export type GimmickRecipe = Omit<GimmickAnim, 'trigger' | 'origin'>;

export const GIMMICK_RECIPES = {
  /** A puff of steam or smoke rises, grows and fades. Loop; `rest: 'hidden'`; stagger 2-3 puffs by delayMs. */
  steam: ({ rise = 12, ms = 1800 } = {}): GimmickRecipe => ({
    durationMs: ms,
    loop: true,
    ease: 'linear',
    keyframes: [
      { t: 0, sx: 0.6, sy: 0.6, opacity: 0 },
      { t: 0.2, y: -0.2 * rise, sx: 0.8, sy: 0.8, opacity: 0.9 },
      { t: 0.7, y: -0.7 * rise, sx: 1.1, sy: 1.1, opacity: 0.6 },
      { t: 1, y: -rise, sx: 1.3, sy: 1.3, opacity: 0 },
    ],
  }),
  /** A drop forms, falls `fall` units and splats out (tears from a cloud, a tap). Loop; `rest: 'hidden'`. */
  drip: ({ fall = 16, ms = 1400 } = {}): GimmickRecipe => ({
    durationMs: ms,
    loop: true,
    keyframes: [
      { t: 0, sx: 0.3, sy: 0.3, opacity: 0, ease: 'standard' },
      { t: 0.25, opacity: 1, ease: 'exit' },
      { t: 0.85, y: fall, sy: 1.15 },
      { t: 1, y: 1.08 * fall, sx: 1.4, sy: 0.4, opacity: 0 },
    ],
  }),
  /** Pops up `height` units, hangs, and drops back with a bump (a toast, a cuckoo). Once; `z: 'behind'`. */
  popUp: ({ height = 16, ms = 1300 } = {}): GimmickRecipe => ({
    durationMs: ms,
    keyframes: [
      { t: 0, ease: 'emphasized' },
      { t: 0.22, y: -height },
      { t: 0.68, y: -0.94 * height, ease: 'exit' },
      { t: 0.86, y: 0.6, ease: 'standard' },
      { t: 1 },
    ],
  }),
  /** Turns round and round (a drum, a fan, the reels of a cassette). Loop; origin = the axle. */
  spin: ({ turns = 1, ms = 1200, reverse = false } = {}): GimmickRecipe => ({
    durationMs: ms,
    loop: true,
    ease: 'linear',
    keyframes: [{ t: 0 }, { t: 1, rotate: (reverse ? -360 : 360) * turns }],
  }),
  /** Swells by `scale` and settles back (a balloon, a puffed cheek). Once; origin = where it is tied. */
  inflate: ({ scale = 1.25, ms = 1100 } = {}): GimmickRecipe => ({
    durationMs: ms,
    keyframes: [
      { t: 0, ease: 'emphasized' },
      { t: 0.35, sx: scale, sy: scale },
      { t: 0.72, sx: scale, sy: scale, ease: 'standard' },
      { t: 1 },
    ],
  }),
  /** Loses air: shrinks and sags `droop` units, and stays so while the trigger lasts. Once. */
  deflate: ({ scale = 0.85, droop = 4, ms = 1400 } = {}): GimmickRecipe => ({
    durationMs: ms,
    keyframes: [
      { t: 0, ease: 'standard' },
      { t: 0.55, y: 0.7 * droop, sx: 1.04 * scale, sy: 0.96 * scale },
      { t: 1, y: droop, sx: scale, sy: 0.92 * scale },
    ],
  }),
  /** Flashes on and off (sparks, a zap, a glint). Loop; `rest: 'hidden'`. */
  sparks: ({ ms = 900 } = {}): GimmickRecipe => ({
    durationMs: ms,
    loop: true,
    ease: 'linear',
    keyframes: [
      { t: 0, sx: 0.6, sy: 0.6, opacity: 0 },
      { t: 0.08, sx: 1.15, sy: 1.15 },
      { t: 0.18, sx: 0.9, sy: 0.9, opacity: 0.15 },
      { t: 0.26, sx: 1.05, sy: 1.05 },
      { t: 0.42, sx: 0.8, sy: 0.8, opacity: 0 },
      { t: 1, sx: 0.6, sy: 0.6, opacity: 0 },
    ],
  }),
  /** A bubble rises `rise` units with a side-to-side wobble and pops. Loop; `rest: 'hidden'`. */
  bubble: ({ rise = 18, ms = 2000 } = {}): GimmickRecipe => ({
    durationMs: ms,
    loop: true,
    ease: 'linear',
    keyframes: [
      { t: 0, sx: 0.5, sy: 0.5, opacity: 0 },
      { t: 0.15, y: -0.12 * rise, sx: 1, sy: 1 },
      { t: 0.4, x: 1.5, y: -0.4 * rise },
      { t: 0.65, x: -1.5, y: -0.66 * rise },
      { t: 0.88, x: 0.8, y: -0.9 * rise },
      { t: 0.94, y: -0.95 * rise, sx: 1.35, sy: 1.35, opacity: 0.6 },
      { t: 1, y: -rise, sx: 1.6, sy: 1.6, opacity: 0 },
    ],
  }),
  /** A lid lifts on its hinge, rattles and drops back (a pot, a box, a hat). Once; origin = the hinge. */
  lid: ({ angle = -28, lift = 3, ms = 1200 } = {}): GimmickRecipe => ({
    durationMs: ms,
    keyframes: [
      { t: 0, ease: 'emphasized' },
      { t: 0.2, rotate: angle, y: -lift },
      { t: 0.34, rotate: 0.72 * angle, y: -lift },
      { t: 0.48, rotate: angle, y: -lift, ease: 'exit' },
      { t: 0.72, rotate: 0, y: 0 },
      { t: 0.84, rotate: 0.12 * angle, y: -0.3 * lift },
      { t: 1 },
    ],
  }),
  /** Sways gently (an idle loop: an antenna, a leaf, a flag). Loop; origin = where it is fixed. */
  sway: ({ angle = 6, ms = 2400 } = {}): GimmickRecipe => ({
    durationMs: ms,
    loop: true,
    keyframes: [{ t: 0 }, { t: 0.25, rotate: angle }, { t: 0.75, rotate: -angle }, { t: 1 }],
  }),
} as const;

export type GimmickRecipeName = keyof typeof GIMMICK_RECIPES;
