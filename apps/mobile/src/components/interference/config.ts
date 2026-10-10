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
