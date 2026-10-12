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

export interface Localized {
  he: string;
  en: string;
}

/**
 * What a character is, for the picker's filters. In this order the picker groups them.
 * - `object`: things from the house, the office and the toy box (a kettle, a stapler, a cassette).
 * - `food`: things you eat or drink (a toast, an egg, a lemon).
 * - `nature`: weather, sky and earth (a rain cloud, the moon, a volcano, a rock).
 * - `creature`: made-up beings (a cyclops, an alien, a ghost, a slime).
 * - `symbol`: letters, digits, math signs and sudoku things (the 8, the letter A, a question mark).
 */
export const AVATAR_KINDS = ['person', 'animal', 'object', 'food', 'nature', 'creature', 'symbol'] as const;
export type AvatarKind = (typeof AVATAR_KINDS)[number];

/** Kind names for the UI: one character (a badge) and the filter (a group). */
export const KIND_NAMES: Record<AvatarKind, { one: Localized; many: Localized }> = {
  person: { one: { he: 'אדם', en: 'Person' }, many: { he: 'אנשים', en: 'People' } },
  animal: { one: { he: 'חיה', en: 'Animal' }, many: { he: 'חיות', en: 'Animals' } },
  object: { one: { he: 'חפץ', en: 'Object' }, many: { he: 'חפצים', en: 'Objects' } },
  food: { one: { he: 'מאכל', en: 'Food' }, many: { he: 'אוכל', en: 'Food' } },
  nature: { one: { he: 'טבע', en: 'Nature' }, many: { he: 'טבע', en: 'Nature' } },
  creature: { one: { he: 'יצור', en: 'Creature' }, many: { he: 'יצורים', en: 'Creatures' } },
  symbol: { one: { he: 'סימן', en: 'Symbol' }, many: { he: 'סימנים', en: 'Symbols' } },
};

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
  'angry',
  'sleepy',
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
  angry: { he: 'כעס', en: 'Angry' },
  sleepy: { he: 'עייפות', en: 'Sleepy' },
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

/** What every eye shares, however many there are. */
export interface EyeLook {
  /** Eye radius: half the eye's height. People 3.4-4.2, animals and objects up to 8, one big eye up to 14. */
  r: number;
  style: EyeStyle;
  /** Pupil / dot colour. Default: `face.ink`. */
  ink?: string;
  /** Eyeball colour for `round` and `oval`. Default: white. */
  white?: string;
}

/** Two eyes: the default (`count` may be left out). */
export interface TwoEyes extends EyeLook {
  count?: 2;
  /** Eye centres (the viewer's left and right eye). */
  left: Point;
  right: Point;
  /**
   * An eye the art covers (a pirate's patch): the rig does not draw it, and the other eye carries every
   * expression alone (its wink is a sly half-closed squint). Brows, cheeks and extras still use both places.
   */
  covered?: 'left' | 'right';
}

/**
 * One eye in the middle: a cyclops, the eye with legs, a porthole. A lid on it is shaped from both sides (a
 * V when angry, a peak when sad), and its one brow is a unibrow that bends the same way.
 */
export interface OneEye extends EyeLook {
  count: 1;
  middle: Point;
}

/**
 * Three eyes: `left` and `right` as for two, plus `middle` (an alien), usually a little higher. The middle
 * eye has no brow; it stays open when the outer two close for a wink.
 */
export interface ThreeEyes extends EyeLook {
  count: 3;
  left: Point;
  right: Point;
  middle: Point;
  /** The middle eye's radius, as a factor of `r`. Default 1. */
  middleScale?: number;
}

export type EyesDef = TwoEyes | OneEye | ThreeEyes;

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

/**
 * Art that changes with the expression, drawn by you instead of the rig: a calculator's display that shows
 * its own mouth, a lid over a giant eyeball, lava on a volcano only when it is angry. `default` serves every
 * expression without its own entry. It is drawn in the face group, over the rig's eyes, brows and mouth and
 * under its extras, and it changes whenever the face changes. Same rules as `layers` (no ids, no scripts).
 */
export type FaceArt = { default: string } & Partial<Record<Expression, string>>;

export interface FaceDef {
  /** The colour of the face's lines: dots, brows, mouth. Must contrast with the skin, fur or object. */
  ink: string;
  eyes: EyesDef;
  /** `false`: no brows (some animals, a robot, the eye with legs). */
  brows: BrowsDef | false;
  /**
   * `false`: the rig draws no mouth; your art draws it (`art`), or the character has none. The expression
   * then reads from the eyes, brows and extras only: check every one of them.
   */
  mouth: MouthDef | false;
  cheeks?: CheeksDef;
  /** Where dizzy stars circle: just above the head. Default: above the eyes. */
  halo?: Point;
  /** Your own per-expression art in the face (see FaceArt). */
  art?: FaceArt;
}

export interface AvatarLayers {
  /** SVG markup behind the face: body, neck, head, ears, hair, depth shapes. No ids, no scripts. */
  back: string;
  /** SVG markup over the face: glasses, a hat brim, steam. Optional. */
  front?: string;
}

// ---------------------------------------------------------------------------------------------------------
// Gimmicks (src/gimmick.ts): a character's own moving part

/**
 * What starts a gimmick: an expression (while it shows), a motion (while it plays), or `idle`. Not `neutral`
 * and not `blink`: those show everywhere, grids included. A quiet loop for the big stage view is `idle`.
 */
export type GimmickTrigger = Exclude<Expression, 'neutral'> | Exclude<MotionId, 'blink'> | 'idle';

/** A gimmick's pose: a transform around the anim's `origin`, and an opacity. */
export interface GimmickPose extends Pose {
  opacity: number;
}

export interface GimmickKeyframe extends Partial<GimmickPose> {
  /** Time, 0-1 of the anim's duration. */
  t: number;
  /** Curve from this keyframe to the next one. Default: the anim's `ease`. */
  ease?: EasingName;
}

export interface GimmickAnim {
  /**
   * When it plays. An expression: while that face shows (also when a motion shows it). A motion: with that
   * motion (the one actually played, after squash falls back). `idle`: a subtle loop, only on a big stage
   * view (never in a grid, never under 48 px).
   */
  trigger: readonly GimmickTrigger[];
  /** Sorted by t, from t = 0 to t = 1. A missing field is the identity (0; 1 for scale and opacity). */
  keyframes: readonly GimmickKeyframe[];
  durationMs: number;
  /** Repeat while the trigger lasts. Otherwise it plays once and holds its last pose until the trigger ends. */
  loop?: boolean;
  /** Wait this long after the trigger before starting (stagger three steam puffs). Default 0. */
  delayMs?: number;
  /** Default curve between keyframes. Default 'loop' (ease in and out). */
  ease?: EasingName;
  /** The fixed point of rotate and scale, in canvas units: a lid's hinge, a drum's axle, a balloon's knot. */
  origin: Point;
}

/** A gimmick's depth (GimmickDef.z), from the back to the front. */
export const GIMMICK_DEPTHS = ['behind', 'back', 'face', 'front'] as const;
export type GimmickZ = (typeof GIMMICK_DEPTHS)[number];

/**
 * A moving part of one character, declared as data: the cuckoo's door, the kettle's steam, the washing
 * machine's drum. Rendered as `<g class="sfa-gimmick sfa-g-{id}">` inside the body (so motions carry it), and
 * played by CSS in the preview (gimmickCss) and by Reanimated in the app (gimmick.ts explains the contract).
 * With reduced motion, and under 48 px, a gimmick stays in its rest pose.
 */
export interface GimmickDef {
  /** Unique within the avatar: lowercase letters, digits and dashes. */
  id: string;
  /** SVG markup in the 100 x 100 canvas, drawn in its rest pose. Same rules as `layers`. */
  markup: string;
  /**
   * Where the group sits, inside the body:
   * - `behind`: under `layers.back`, so it comes out of the object (a toast from the toaster, a cuckoo);
   * - `back`: over `layers.back`, under the face (a drum behind a porthole face);
   * - `face`: it holds the face: its markup is drawn under the face, and the face moves with it (a balloon
   *   that inflates, a head that pops out of a box). At most one per avatar;
   * - `front` (default): over the face and `layers.front` (steam, drops, sparks, a lid).
   */
  z?: GimmickZ;
  /** `hidden`: invisible until it plays (a drop, a spark); its keyframes fade it in. Default `shown`. */
  rest?: 'shown' | 'hidden';
  /** One anim, or several with different triggers (a balloon inflates when surprised and sags when sad). */
  anim: GimmickAnim | readonly GimmickAnim[];
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
  /** The character's own moving parts (see GimmickDef). */
  gimmicks?: readonly GimmickDef[];
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

/**
 * Which group a track moves (render.ts names them): the body, the face, or the eyes. An `eyes` track moves
 * each eye around its own centre (rig.ts eyeCentres), so three eyes at different heights blink in place.
 */
export type MotionTarget = 'body' | 'face' | 'eyes';

/**
 * The fixed point of a track's rotate and scale: the avatar's pivot, its base, or the eyes (each eye's own
 * centre; the eye line for two eyes on one line).
 */
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
