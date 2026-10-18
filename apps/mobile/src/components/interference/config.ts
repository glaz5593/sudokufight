import { tokens } from '../../theme';
import { motion } from '../../theme/motion';

/**
 * Where an interference plays [D35] (spec §7.2, §24). The original spec (§15) says the screen: "חתולים שרצים
 * על המסך", "עיוות של המסך". The proposal to limit it to the board is still waiting for approval, so the
 * default is the whole screen (CLAUDE.md: an unapproved proposal that contradicts the original is built as
 * the original, as a setting that is easy to change).
 */
export type InterferenceScope = 'screen' | 'board';

export const INTERFERENCE_SCOPE: InterferenceScope = 'screen';

/**
 * How long an interference lasts when the game's rules don't say (spec §7.2: exactly 5 s). The screens pass
 * the rules' `interferenceMs`; this is only the fallback.
 */
export const DEFAULT_HIT_MS = motion.duration.interference;

/**
 * The effect comes in over this long (motion.md `hit.banner` / `hit.effect`): 240 ms, or the 200 ms fade of
 * reduced motion. It goes out over the last 240 ms before `endsAt` in both cases (motion.md `hit.end`), so
 * it is gone exactly when the interference ends.
 */
export const HIT_FADE_IN_MS = motion.duration.stateChange;
export const HIT_FADE_IN_REDUCED_MS = motion.duration.reducedFade;
export const HIT_FADE_OUT_MS = motion.duration.stateChange;

/**
 * [D46] Every interference darkens the BOARD of the player it hits (Moshe 2026-10-17, "להחשיך את הלוח"): a
 * dark layer of the solid scrim colour over the board only, under the kind's own effect, for the whole 5 s.
 * The keypad and the cards stay bright, so the game goes on. The same strength for every kind.
 *
 * - `opacity` 0.6 (tokens.json `opacity.hitDim`): the digits stay readable with effort, every digit colour at
 *   least 2:1 and the given digit at most 4.5:1 (contrast.test.ts holds both).
 * - It fades in over 240 ms (200 ms with reduced motion, an opacity change only: the same cover, D46) and is
 *   fully out exactly at `endsAt`, from the hit's own clock; it stands still while the game is frozen.
 * - It never pulses (photosensitivity).
 */
export const HIT_DIM = {
  opacity: tokens.opacity.hitDim,
  fadeInMs: HIT_FADE_IN_MS,
  fadeInReducedMs: HIT_FADE_IN_REDUCED_MS,
  fadeOutMs: HIT_FADE_OUT_MS,
} as const;

/**
 * [D47] "מספרים מתערבלים" (`scramble`): the digits of the filled cells roll, as digits that are clearly not the
 * board's (a segment display in the sender's colour), and only some of them are true at any moment. Visual
 * only: the board, its taps and the keypad are untouched.
 */
export const SCRAMBLE = {
  /** Each cell changes at most once per step: 2.5 changes a second (under the 3 flashes a second limit). */
  stepMs: 400,
  /** The share of the steps in which a cell shows its true digit (still in the sender's colour). */
  trueShare: 0.3,
  /** The roll from one digit to the next, at the start of a step. */
  rollMs: 160,
  /**
   * The tile that hides the real digit, as fractions of the cell: in from the left and right, the top and the
   * bottom. The solver's glyph (top start corner) and the wrong digits (bottom end) stay visible.
   */
  tile: { side: 0.24, top: 0.2, bottom: 0.31 },
  /**
   * The fake digit, as fractions of the cell: 0.9 of the board digit's height (Rubik 22 at a 38 dp cell), a
   * narrower width, and its stroke.
   */
  glyph: { height: 0.36, width: 0.2, stroke: 0.065 },
} as const;

/**
 * [D47] "דיו" (`ink`): blots of ink splash over the board one after another, cover about 40 % of it, and fade
 * away over the last 1.5 s ("נמחקים בהדרגה", spec §7.1).
 */
export const INK = {
  blots: 5,
  /** A blot's radius, as a fraction of the board's side: 5 blots of 0.13–0.19 cover about 40 % of it. */
  radius: [0.13, 0.19] as readonly [number, number],
  /** The first blot lands this long into the hit, and each next one this long after it. */
  firstMs: 80,
  staggerMs: 140,
  /** One splat: from a quarter of its size, a little past full, and back to full. */
  splatMs: 300,
  /** They fade (and shrink a little) over the last 1.5 s. */
  fadeMs: 1500,
  /** Small drops around each blot. */
  droplets: 3,
  /** Points around a blot's edge. */
  points: 10,
  /** Reduced motion: one frame, every blot already landed. */
  stillAtMs: 1200,
  /** The rim in the sender's colour, dp. */
  rim: 3,
} as const;

/**
 * [D47] "מקלדת מתערבלת" (`keypad`): the nine digit keys trade places every 1.5 s, sliding in 200 ms. Every key
 * always enters the digit printed on it and keeps its own count and state; only where it stands changes (the
 * row stays LTR). Fairness guards: no key moves while a finger is on the keypad, nor right after a press, and a
 * press that starts while the keys are still moving does not count.
 */
export const KEYPAD = {
  everyMs: 1500,
  moveMs: 200,
  /** After the keys settle, a press needs this long more before it counts. */
  guardMs: 150,
  /** After a finger lifts, the keys wait this long before they move again. */
  freezeMs: 300,
  /** Reduced motion: one order for the whole 5 s, in and out with a fade of this long, no sliding. */
  fadeMs: motion.duration.reducedFade,
} as const;
