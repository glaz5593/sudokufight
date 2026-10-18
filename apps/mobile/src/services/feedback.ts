import { tokens } from '../theme/tokens.generated';
import { haptics, type HapticPattern } from './haptics';
import { sfx, type SoundId } from './sfx';

/**
 * Sound and haptic feedback for every action (spec §22 "צליל ורטט", DS-Motion "רטט וסאונד", docs/design/motion.md
 * §7 and §8). Screens call `cue('correct')` and get both, each one subject to its own setting ("צליל", "רטט").
 *
 * Only events that happen to me, or that I cause, get a cue: an opponent's board move never does (motion.md §7).
 * The caller also decides the timing rules that need game state: lock ticks only for my lock and not while it is
 * frozen, no reaction cue for a muted player, and no `hitBurst` / `hitPulse` rumble under Reduced Motion.
 */
export type FeedbackCue =
  // Board and lock (spec §6.2–6.5)
  | 'cellSelect'
  | 'cellDenied'
  | 'cellRelease'
  | 'lockExpired'
  | 'lockTick'
  | 'keyPress'
  | 'nudge'
  | 'correct'
  | 'wrong'
  | 'countTick'
  | 'leadTake'
  | 'leadLose'
  // Game end (spec §6.6, §12)
  | 'win'
  | 'lose'
  | 'practiceDone'
  | 'surrender'
  // Interferences (spec §7)
  | 'arsenalOpen'
  | 'launch'
  | 'hitFireworks'
  | 'hitCats'
  | 'hitWarp'
  | 'hitScramble'
  | 'hitInk'
  | 'hitKeypad'
  | 'hitBurst'
  | 'hitPulse'
  // Reactions (spec §9)
  | 'reactSend'
  | 'reactLaugh'
  | 'reactScream'
  | 'reactCool'
  | 'reactFacepalm'
  | 'reactFire'
  | 'reactEyes'
  | 'reactPop'
  // Match and connection
  | 'matchFound'
  | 'countdownBeat'
  | 'go'
  | 'disconnect'
  | 'reconnect'
  // General UI
  | 'primaryPress'
  | 'toggle'
  | 'formError';

/** What a cue plays. `null` means "nothing", on purpose (see the note on that cue). */
export interface CueSpec {
  sound: SoundId | null;
  haptic: HapticPattern | null;
}

const c = (sound: SoundId | null, haptic: HapticPattern | null): CueSpec => ({ sound, haptic });

/** The table of motion.md §7 (haptics) and §8 (sounds), per event. */
export const CUES: Readonly<Record<FeedbackCue, CueSpec>> = {
  /** Tap an empty cell (lock request), on tap (optimistic). */
  cellSelect: c('cell_select', 'selection'),
  /** Tap a cell locked by someone else, or mine in the 1 s cooldown: "רטט קצר, בלי קנס" (§6.2.3). */
  cellDenied: c('cell_denied', 'medium'),
  /** "ביטול בחירה": I release my lock. */
  cellRelease: c('cell_release', 'selection'),
  /** My lock ran out (D2: no penalty). No haptic: the three ticks were the warning. */
  lockExpired: c('cell_release', null),
  /** My lock: 3, 2 and 1 seconds left. Not while the timer is frozen. */
  lockTick: c('lock_tick', 'light'),
  /** A digit key. Silent on purpose: the result (correct / wrong) follows within about 150 ms. */
  keyPress: c(null, null),
  /** A blocked action: a keypad key with no cell selected, a blocked "הפרעה", or a kind that can't go now. */
  nudge: c(null, 'light'),
  /** My digit is correct (at `placedCorrect`). */
  correct: c('correct', 'success'),
  /** My digit is wrong (at `placedWrong`). */
  wrong: c('wrong', 'error'),
  /** One tick of my score count-up; `cueCountUp()` plays the five. */
  countTick: c('count_tick', 'selection'),
  /** I take the lead, when the count lands. */
  leadTake: c('lead_take', 'light'),
  /** I lose the lead: sound only (motion.md §7). */
  leadLose: c('lead_lose', null),

  /** Results: place 1. */
  win: c('win', 'success'),
  /** Results: a loss, or place 2–4. */
  lose: c('lose', 'light'),
  /** Results of a solo practice (spec §6.6): the win fanfare until a sound of its own exists. */
  practiceDone: c('win', 'success'),
  /** "כן, להיכנע", and "כן, לסיים" in practice. */
  surrender: c(null, 'heavy'),

  /** Open the interference picker ("הפרעה" on an opponent's card, the first of two taps, D45). */
  arsenalOpen: c('arsenal_open', 'selection'),
  /** A kind tapped in the picker, launched (the second tap): two medium knocks. */
  launch: c('interfere_launch', 'launch'),
  /** An interference hits me, at its start. */
  hitFireworks: c('hit_fireworks', 'warning'),
  hitCats: c('hit_cats', 'warning'),
  hitWarp: c('hit_warp', 'warning'),
  /** [D47] The three kinds of 2026-10-17: the digits scramble, ink splashes, the keys trade places. */
  hitScramble: c('hit_scramble', 'warning'),
  hitInk: c('hit_ink', 'warning'),
  hitKeypad: c('hit_keypad', 'warning'),
  /** The rumble while it lasts: a fireworks burst (≥ 700 ms apart). */
  hitBurst: c(null, 'medium'),
  /** The rumble while it lasts: a cat enters, or a warp beat every 1100 ms. */
  hitPulse: c(null, 'light'),

  /** I tap an emoji. */
  reactSend: c(null, 'selection'),
  /** A reaction from an opponent arrives (never from a muted one). */
  reactLaugh: c('react_laugh', 'light'),
  reactScream: c('react_scream', 'light'),
  reactCool: c('react_cool', 'light'),
  reactFacepalm: c('react_facepalm', 'light'),
  reactFire: c('react_fire', 'light'),
  reactEyes: c('react_eyes', 'light'),
  /** A reaction without a sound of its own (a future emoji). */
  reactPop: c('react_pop', 'light'),

  matchFound: c('match_found', 'success'),
  /** 3 · 2 · 1. */
  countdownBeat: c('countdown_beat', 'medium'),
  go: c('go', 'heavy'),
  /** An opponent disconnects, or my connection is lost. */
  disconnect: c('disconnect', 'warning'),
  /** I'm back in the game. */
  reconnect: c('reconnect', 'success'),

  /** A primary button ("שחק"): soft click and a light haptic (components.md, Button "pressed"). */
  primaryPress: c('ui_tap', 'light'),
  /** A settings toggle or a segmented choice. */
  toggle: c(null, 'selection'),
  /** A form field fails validation. */
  formError: c(null, 'error'),
};

export const FEEDBACK_CUES = Object.keys(CUES) as FeedbackCue[];

/** Plays a cue: its sound if "צליל" is on, its haptic if "רטט" is on. Never throws. */
export function cue(name: FeedbackCue): void {
  const { sound, haptic } = CUES[name];
  if (sound) sfx.play(sound);
  if (haptic) haptics.fire(haptic);
}

/** The cues of a game screen: their sounds are loaded when it mounts (motion.md §8). */
export const GAME_CUES: readonly FeedbackCue[] = [
  'cellSelect',
  'cellDenied',
  'cellRelease',
  'lockExpired',
  'lockTick',
  'correct',
  'wrong',
  'countTick',
  'leadTake',
  'leadLose',
  'win',
  'lose',
  'practiceDone',
];

/** Loads the sounds of these cues now, so their first play isn't late. */
export function preloadCues(cues: readonly FeedbackCue[] = GAME_CUES): void {
  const sounds = new Set<SoundId>();
  for (const name of cues) {
    const { sound } = CUES[name];
    if (sound) sounds.add(sound);
  }
  sfx.preload([...sounds]);
}

/**
 * The five ticks of my score count-up (DS-Motion "MICRO TICKS"), at `motion.limits.countTicks` ms from now.
 * Returns a cancel, for an unmount mid-count. All five ticks sound; the 80 ms haptic gap drops the buzz of the
 * second one (60 ms after the first).
 */
export function cueCountUp(): () => void {
  const timers = tokens.motion.limits.countTicks.map((ms) => setTimeout(() => cue('countTick'), ms));
  return () => timers.forEach(clearTimeout);
}
