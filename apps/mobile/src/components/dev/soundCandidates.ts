import type { SoundId } from '../../services/sfx';

/**
 * Development builds only: the candidates for the final sounds (work plan, "צלילים סופיים וכיול עוצמות"), one per
 * sound of docs/design/motion.md §8, for the audition screen (/dev/sounds). The app never plays them: Moshe picks,
 * then promotes a file (assets/sounds/README.md) and deletes its line here.
 *
 * Only SoundAuditionScreen imports this file, and app/dev/sounds.tsx requires that screen behind __DEV__, so a
 * release bundle drops the screen, this file and the WAV files (startupGraph.test.ts). Sources, licenses and
 * measures: assets/sounds/candidates/SOURCES.md.
 */
export interface SoundCandidate {
  /** The WAV file (16-bit mono 44.1 kHz), for expo-audio. */
  source: number;
  /** Where it comes from: the pack, or OpenGameArt and its author. */
  origin: string;
  /** The original file in that pack. */
  file: string;
  /** Length in milliseconds. */
  ms: number;
}

export const SOUND_CANDIDATES: Partial<Record<SoundId, SoundCandidate>> = {
  cell_select: {
    source: require('../../../../../assets/sounds/candidates/cell_select.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'select_002.ogg',
    ms: 40,
  },
  cell_denied: {
    source: require('../../../../../assets/sounds/candidates/cell_denied.wav') as number,
    origin: 'Kenney · Impact Sounds',
    file: 'impactGeneric_light_000.ogg',
    ms: 138,
  },
  cell_release: {
    source: require('../../../../../assets/sounds/candidates/cell_release.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'back_002.ogg',
    ms: 68,
  },
  correct: {
    source: require('../../../../../assets/sounds/candidates/correct.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'confirmation_002.ogg',
    ms: 500,
  },
  count_tick: {
    source: require('../../../../../assets/sounds/candidates/count_tick.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'tick_002.ogg',
    ms: 20,
  },
  wrong: {
    source: require('../../../../../assets/sounds/candidates/wrong.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'error_007.ogg',
    ms: 192,
  },
  lock_tick: {
    source: require('../../../../../assets/sounds/candidates/lock_tick.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'tick_004.ogg',
    ms: 52,
  },
  arsenal_open: {
    source: require('../../../../../assets/sounds/candidates/arsenal_open.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'maximize_008.ogg',
    ms: 224,
  },
  interfere_whoosh: {
    source: require('../../../../../assets/sounds/candidates/interfere_whoosh.wav') as number,
    origin: 'Kenney · RPG Audio',
    file: 'knifeSlice.ogg',
    ms: 408,
  },
  interfere_launch: {
    source: require('../../../../../assets/sounds/candidates/interfere_launch.wav') as number,
    origin: 'Kenney · Sci-fi Sounds',
    file: 'explosionCrunch_002.ogg',
    ms: 600,
  },
  hit_fireworks: {
    source: require('../../../../../assets/sounds/candidates/hit_fireworks.wav') as number,
    origin: 'OpenGameArt · rubberduck',
    file: 'fw_04.ogg',
    ms: 2244,
  },
  hit_cats: {
    source: require('../../../../../assets/sounds/candidates/hit_cats.wav') as number,
    origin: 'OpenGameArt · Kerzoven',
    file: 'cat_mewfood.wav',
    ms: 1125,
  },
  hit_warp: {
    source: require('../../../../../assets/sounds/candidates/hit_warp.wav') as number,
    origin: 'Kenney · Sci-fi Sounds',
    file: 'engineCircular_002.ogg',
    ms: 2500,
  },
  react_laugh: {
    source: require('../../../../../assets/sounds/candidates/react_laugh.wav') as number,
    origin: 'OpenGameArt · AuraVoice',
    file: 'group_giggling.ogg',
    ms: 640,
  },
  react_scream: {
    source: require('../../../../../assets/sounds/candidates/react_scream.wav') as number,
    origin: 'Kenney · Digital Audio',
    file: 'highDown.ogg',
    ms: 426,
  },
  react_cool: {
    source: require('../../../../../assets/sounds/candidates/react_cool.wav') as number,
    origin: 'OpenGameArt · Vinrax',
    file: 'snap_of_the_fingers3.wav',
    ms: 104,
  },
  react_facepalm: {
    source: require('../../../../../assets/sounds/candidates/react_facepalm.wav') as number,
    origin: 'Kenney · RPG Audio',
    file: 'bookClose.ogg',
    ms: 231,
  },
  react_fire: {
    source: require('../../../../../assets/sounds/candidates/react_fire.wav') as number,
    origin: 'Kenney · Sci-fi Sounds',
    file: 'thrusterFire_004.ogg',
    ms: 700,
  },
  react_eyes: {
    source: require('../../../../../assets/sounds/candidates/react_eyes.wav') as number,
    origin: 'Kenney · Digital Audio',
    file: 'phaseJump1.ogg',
    ms: 373,
  },
  react_pop: {
    source: require('../../../../../assets/sounds/candidates/react_pop.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'drop_002.ogg',
    ms: 188,
  },
  match_found: {
    source: require('../../../../../assets/sounds/candidates/match_found.wav') as number,
    origin: 'Kenney · Music Jingles (Steel)',
    file: 'jingles_STEEL08.ogg',
    ms: 700,
  },
  countdown_beat: {
    source: require('../../../../../assets/sounds/candidates/countdown_beat.wav') as number,
    origin: 'Kenney · Music Jingles (Hit)',
    file: 'jingles_HIT07.ogg',
    ms: 252,
  },
  go: {
    source: require('../../../../../assets/sounds/candidates/go.wav') as number,
    origin: 'Kenney · Impact Sounds',
    file: 'impactBell_heavy_000.ogg',
    ms: 1480,
  },
  win: {
    source: require('../../../../../assets/sounds/candidates/win.wav') as number,
    origin: 'Kenney · Music Jingles (Steel)',
    file: 'jingles_STEEL10.ogg',
    ms: 909,
  },
  lose: {
    source: require('../../../../../assets/sounds/candidates/lose.wav') as number,
    origin: 'Kenney · Music Jingles (Steel)',
    file: 'jingles_STEEL11.ogg',
    ms: 825,
  },
  lead_take: {
    source: require('../../../../../assets/sounds/candidates/lead_take.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'maximize_009.ogg',
    ms: 222,
  },
  lead_lose: {
    source: require('../../../../../assets/sounds/candidates/lead_lose.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'minimize_009.ogg',
    ms: 206,
  },
  disconnect: {
    source: require('../../../../../assets/sounds/candidates/disconnect.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'minimize_006.ogg',
    ms: 370,
  },
  reconnect: {
    source: require('../../../../../assets/sounds/candidates/reconnect.wav') as number,
    origin: 'Kenney · Interface Sounds',
    file: 'maximize_006.ogg',
    ms: 380,
  },
  ui_tap: {
    source: require('../../../../../assets/sounds/candidates/ui_tap.wav') as number,
    origin: 'Kenney · UI Audio',
    file: 'click2.ogg',
    ms: 53,
  },
};
