/**
 * What an avatar is made of (docs/avatars/STYLE.md).
 *
 * Every coordinate is in the avatar's 100 x 100 viewBox: x grows to the right, y grows down, and the tile is
 * the rounded square (0, 0)-(100, 100). "Left" and "right" are the viewer's left and right.
 *
 * An avatar is a ready-made character: static artwork (`layers`) plus a face that the shared rig draws
 * (`face`). The rig draws the eyes, brows and mouth for every expression from the anchors, so every expression
 * works on every avatar: people, animals and objects alike.
 */

export type AvatarKind = 'person' | 'animal' | 'object';
export const AVATAR_KINDS: readonly AvatarKind[] = ['person', 'animal', 'object'];

export interface Localized {
  he: string;
  en: string;
}

export interface Point {
  x: number;
  y: number;
}

/** A square: top-left corner and side. */
export interface Box extends Point {
  size: number;
}

/** The faces the rig can draw. `neutral` is the resting face. */
export const EXPRESSIONS = [
  'neutral',
  'smile',
  'laugh',
  'wink',
  'surprised',
  'sad',
  'confused',
  'dizzy',
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const EXPRESSION_NAMES: Record<Expression, Localized> = {
  neutral: { he: 'רגיל', en: 'Neutral' },
  smile: { he: 'חיוך', en: 'Smile' },
  laugh: { he: 'צחוק', en: 'Laugh' },
  wink: { he: 'קריצה', en: 'Wink' },
  surprised: { he: 'הפתעה', en: 'Surprised' },
  sad: { he: 'עצב', en: 'Sad' },
  confused: { he: 'בלבול', en: 'Confused' },
  dizzy: { he: 'סחרחורת', en: 'Dizzy' },
};

/**
 * How the eyes are drawn.
 * - `dot`: a solid ink oval with a small highlight. The default for people.
 * - `round`: a white eyeball with an ink pupil. Reads on any colour, including dark skin, fur and objects.
 * - `oval`: like `round` but taller. Cute animals.
 * - `button`: a solid ink circle with a big shine. Plush toys, small animals.
 */
export const EYE_STYLES = ['dot', 'round', 'oval', 'button'] as const;
export type EyeStyle = (typeof EYE_STYLES)[number];

export interface EyesDef {
  /** Eye centres (the viewer's left and right eye). */
  left: Point;
  right: Point;
  /** Eye radius: half the eye's height. People 3.4-4.2, animals and objects up to 8. */
  r: number;
  style: EyeStyle;
  /** Pupil / dot colour. Default: `face.ink`. */
  ink?: string;
  /** Eyeball colour for `round` and `oval`. Default: white. */
  white?: string;
}

export interface BrowsDef {
  /** Distance from the eye centre to the brow, in eye radii. Default 1.8. */
  lift?: number;
  /** Brow length, in eye radii. Default 2.2. */
  length?: number;
  /** Stroke width in viewBox units. Default: from the eye size, 1.6-2.6. */
  thickness?: number;
  /** Default: `face.ink`. Hair colour suits people. */
  color?: string;
}

export interface MouthDef extends Point {
  /** Mouth width at its widest expression (a big smile). People 11-14, objects up to 22. */
  w: number;
  /** Line colour. Default: `face.ink`. */
  ink?: string;
  /** Inside of an open mouth. Default: palette FACE.mouth. */
  inner?: string;
  /** Default: palette FACE.tongue. */
  tongue?: string;
}

export interface CheeksDef {
  color: string;
  /** Horizontal offset from each eye centre, outward, in eye radii. Default 0.9. */
  dx?: number;
  /** Vertical offset below the eye centre, in eye radii. Default 1.5. */
  dy?: number;
  /** Cheek radius, in eye radii. Default 0.95. */
  size?: number;
}

export interface FaceDef {
  /** The colour of the face's lines: dots, brows, mouth. Must contrast with the skin, fur or object. */
  ink: string;
  eyes: EyesDef;
  /** `false`: no brows (some animals). */
  brows: BrowsDef | false;
  mouth: MouthDef;
  cheeks?: CheeksDef;
  /** Where dizzy stars circle: just above the head. Default: above the eyes. */
  halo?: Point;
}

export interface AvatarLayers {
  /** SVG markup behind the face: body, neck, head, ears, hair, depth shapes. No ids, no scripts. */
  back: string;
  /** SVG markup over the face: glasses, a hat brim, steam. Optional. */
  front?: string;
}

export interface AvatarDef {
  /** Unique and stable: lowercase letters, digits and dashes. Stored with the user, so never rename one. */
  id: string;
  kind: AvatarKind;
  name: Localized;
  /** Tile colour: one of palette TILE. */
  tile: string;
  layers: AvatarLayers;
  face: FaceDef;
  /** Rotation centre for spin, tilt and nod: the middle of the head (people) or of the object. */
  pivot: Point;
  /**
   * A square around the head, for tiny sizes (render option `crop: 'head'`, e.g. the 22 px avatar in a locked
   * cell). People and animals; objects usually leave it out and always show whole.
   */
  headBox?: Box;
  /** Where the character stands: the y that stays put when it squashes or wobbles. Default 100. */
  base?: number;
  /** True if the whole character may squash and stretch (objects and round animals). Default false. */
  squash?: boolean;
  /** Motions that suit this character best, first = favourite. The app picks reactions from these. */
  motionBias?: readonly MotionId[];
}

// ---------------------------------------------------------------------------------------------------------
// Motions (src/motion.ts)

export const MOTION_IDS = [
  'blink',
  'bounce',
  'nod',
  'tilt',
  'shake',
  'spin',
  'flip',
  'squash',
  'wobble',
] as const;
export type MotionId = (typeof MOTION_IDS)[number];

/** Curves from docs/design/motion.md section 3. */
export type EasingName = 'standard' | 'emphasized' | 'exit' | 'loop' | 'linear';

/** Which group a track moves (render.ts names them). */
export type MotionTarget = 'body' | 'face' | 'eyes';

/** The fixed point of a track's rotate and scale: the avatar's pivot, its base, or the eye line. */
export type MotionOrigin = 'pivot' | 'base' | 'eyes';

/** A transform in viewBox units and degrees, around the track's origin. */
export interface Pose {
  x: number;
  y: number;
  rotate: number;
  sx: number;
  sy: number;
}

export interface MotionKeyframe extends Partial<Pose> {
  /** Time, 0-1 of the motion's duration. */
  t: number;
  /** Curve from this keyframe to the next one. Default: the motion's `ease`. */
  ease?: EasingName;
  /** Switch the face at this time. `base` = back to the face shown before the motion. */
  expression?: Expression | 'base';
}

export interface MotionTrack {
  target: MotionTarget;
  origin: MotionOrigin;
  /** Sorted by t, from t = 0 to t = 1. A missing pose field is the identity (0, or 1 for scale). */
  keyframes: readonly MotionKeyframe[];
}

export interface MotionDef {
  id: MotionId;
  name: Localized;
  durationMs: number;
  /** Default curve between keyframes. */
  ease: EasingName;
  tracks: readonly MotionTrack[];
  /** The face this motion shows; with reduced motion this face is all that is shown. */
  expression?: Expression;
  /** Only for avatars with `squash: true`; others play `fallback`. */
  needsSquash?: boolean;
  fallback?: MotionId;
  /** An idle loop (blink): the app repeats it every few seconds while nothing else plays. */
  idle?: boolean;
}
