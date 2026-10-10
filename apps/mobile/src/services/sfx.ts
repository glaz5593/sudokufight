import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { AppState } from 'react-native';

import { useSettings } from '../state/settings';

/**
 * Sound effects (docs/design/motion.md §8, spec §22 "צליל ורטט"), on expo-audio.
 *
 * - Off while the "צליל" setting is off (persisted in `useSettings`); turning it off stops what is playing.
 * - The iOS silent switch mutes the game, and the player's own music keeps playing (mix with others).
 * - A sound always plays from its start. Each sound gets its own player, created once on first use
 *   (or by `preload`); `count_tick` and `lock_tick` get two, so fast repeats don't cut each other off.
 * - At most 4 sounds at once: a UI tick that would be the fifth is dropped.
 * - Errors never reach the caller: feedback is optional. They are logged in development.
 *
 * Screens don't call this directly: they call `cue()` from ./feedback, which plays the sound and the haptic.
 */

/** Every sound of motion.md §8, by its file name. */
export const SOUND_IDS = [
  'cell_select',
  'cell_denied',
  'cell_release',
  'correct',
  'count_tick',
  'wrong',
  'lock_tick',
  'lead_take',
  'lead_lose',
  'arsenal_open',
  'interfere_whoosh',
  'interfere_launch',
  'hit_fireworks',
  'hit_cats',
  'hit_warp',
  'react_laugh',
  'react_scream',
  'react_cool',
  'react_facepalm',
  'react_fire',
  'react_eyes',
  'react_pop',
  'match_found',
  'countdown_beat',
  'go',
  'win',
  'lose',
  'disconnect',
  'reconnect',
  'ui_tap',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

/**
 * The files. Until the final CC0 sounds arrive (motion.md §8), each one is a generated placeholder
 * (scripts/gen-placeholder-sounds.mjs, assets/sounds/README.md). Replacing one is a change of path here.
 * Requires stay static so Metro bundles them.
 */
export const SOUND_SOURCES: Record<SoundId, number> = {
  cell_select: require('../../../../assets/sounds/placeholder/cell_select.wav') as number,
  cell_denied: require('../../../../assets/sounds/placeholder/cell_denied.wav') as number,
  cell_release: require('../../../../assets/sounds/placeholder/cell_release.wav') as number,
  correct: require('../../../../assets/sounds/placeholder/correct.wav') as number,
  count_tick: require('../../../../assets/sounds/placeholder/count_tick.wav') as number,
  wrong: require('../../../../assets/sounds/placeholder/wrong.wav') as number,
  lock_tick: require('../../../../assets/sounds/placeholder/lock_tick.wav') as number,
  lead_take: require('../../../../assets/sounds/placeholder/lead_take.wav') as number,
  lead_lose: require('../../../../assets/sounds/placeholder/lead_lose.wav') as number,
  arsenal_open: require('../../../../assets/sounds/placeholder/arsenal_open.wav') as number,
  interfere_whoosh: require('../../../../assets/sounds/placeholder/interfere_whoosh.wav') as number,
  interfere_launch: require('../../../../assets/sounds/placeholder/interfere_launch.wav') as number,
  hit_fireworks: require('../../../../assets/sounds/placeholder/hit_fireworks.wav') as number,
  hit_cats: require('../../../../assets/sounds/placeholder/hit_cats.wav') as number,
  hit_warp: require('../../../../assets/sounds/placeholder/hit_warp.wav') as number,
  react_laugh: require('../../../../assets/sounds/placeholder/react_laugh.wav') as number,
  react_scream: require('../../../../assets/sounds/placeholder/react_scream.wav') as number,
  react_cool: require('../../../../assets/sounds/placeholder/react_cool.wav') as number,
  react_facepalm: require('../../../../assets/sounds/placeholder/react_facepalm.wav') as number,
  react_fire: require('../../../../assets/sounds/placeholder/react_fire.wav') as number,
  react_eyes: require('../../../../assets/sounds/placeholder/react_eyes.wav') as number,
  react_pop: require('../../../../assets/sounds/placeholder/react_pop.wav') as number,
  match_found: require('../../../../assets/sounds/placeholder/match_found.wav') as number,
  countdown_beat: require('../../../../assets/sounds/placeholder/countdown_beat.wav') as number,
  go: require('../../../../assets/sounds/placeholder/go.wav') as number,
  win: require('../../../../assets/sounds/placeholder/win.wav') as number,
  lose: require('../../../../assets/sounds/placeholder/lose.wav') as number,
  disconnect: require('../../../../assets/sounds/placeholder/disconnect.wav') as number,
  reconnect: require('../../../../assets/sounds/placeholder/reconnect.wav') as number,
  ui_tap: require('../../../../assets/sounds/placeholder/ui_tap.wav') as number,
};

/** Starting volumes (motion.md §8); the final tuning is stage 14. Unlisted sounds play at DEFAULT_VOLUME. */
const DEFAULT_VOLUME = 0.7;
const VOLUME: Partial<Record<SoundId, number>> = {
  count_tick: 0.3,
  lock_tick: 0.3,
  ui_tap: 0.3,
  cell_select: 0.5,
  correct: 0.8,
  wrong: 0.8,
  react_laugh: 0.6,
  react_scream: 0.6,
  react_cool: 0.6,
  react_facepalm: 0.6,
  react_fire: 0.6,
  react_eyes: 0.6,
  react_pop: 0.6,
  hit_fireworks: 0.6,
  hit_cats: 0.6,
  hit_warp: 0.6,
  win: 0.9,
  go: 0.9,
};

export const volumeOf = (id: SoundId): number => VOLUME[id] ?? DEFAULT_VOLUME;

/** Players per sound: two for the ticks that repeat fast (motion.md §8). */
export const voicesOf = (id: SoundId): number => (id === 'count_tick' || id === 'lock_tick' ? 2 : 1);

/** Sounds that are dropped first when 4 are already playing. */
const UI_TICKS: ReadonlySet<SoundId> = new Set<SoundId>(['count_tick', 'lock_tick', 'cell_select', 'ui_tap']);
export const MAX_CONCURRENT_SOUNDS = 4;

export interface Sfx {
  /** Plays a sound from its start, if sound is on and the app is in the foreground. */
  play(id: SoundId): void;
  /** Creates the players ahead of time (the game screen, on mount), so the first play isn't late. */
  preload(ids?: readonly SoundId[]): void;
  /** Stops everything that is playing (sound turned off, the game screen unmounts). */
  stopAll(): void;
  /** Frees every player. The next play or preload starts over. */
  release(): void;
}

function report(error: unknown): void {
  if (__DEV__) console.warn('[sfx]', error);
}

/** Background or inactive: nothing plays (motion.md §7, same rule as haptics). */
function inForeground(): boolean {
  const state: unknown = AppState.currentState;
  return state !== 'background' && state !== 'inactive';
}

/** A fresh sound service. The app uses the `sfx` singleton below; tests make their own. */
export function createSfx(): Sfx {
  const players = new Map<SoundId, AudioPlayer[]>();
  const nextVoice = new Map<SoundId, number>();
  let ready = false;
  let unsubscribe: (() => void) | null = null;

  function setUp(): void {
    if (ready) return;
    ready = true;
    unsubscribe = useSettings.subscribe((now, before) => {
      if (before.sound && !now.sound) stopAll();
    });
    try {
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(report);
    } catch (error) {
      report(error);
    }
  }

  function voices(id: SoundId): AudioPlayer[] {
    const existing = players.get(id);
    if (existing) return existing;
    setUp();
    const created = Array.from({ length: voicesOf(id) }, () => {
      const player = createAudioPlayer(SOUND_SOURCES[id], { keepAudioSessionActive: true });
      player.volume = volumeOf(id);
      return player;
    });
    players.set(id, created);
    return created;
  }

  function playingCount(): number {
    let n = 0;
    for (const list of players.values()) for (const p of list) if (p.playing) n++;
    return n;
  }

  function play(id: SoundId): void {
    if (!useSettings.getState().sound || !inForeground()) return;
    try {
      const list = voices(id);
      if (UI_TICKS.has(id) && playingCount() >= MAX_CONCURRENT_SOUNDS) return;
      const i = nextVoice.get(id) ?? 0;
      nextVoice.set(id, (i + 1) % list.length);
      const player = list[i]!;
      player.seekTo(0).catch(report);
      player.play();
    } catch (error) {
      report(error);
    }
  }

  function preload(ids: readonly SoundId[] = SOUND_IDS): void {
    try {
      ids.forEach(voices);
    } catch (error) {
      report(error);
    }
  }

  function stopAll(): void {
    for (const list of players.values())
      for (const p of list) {
        try {
          if (p.playing) p.pause();
        } catch (error) {
          report(error);
        }
      }
  }

  function release(): void {
    for (const list of players.values())
      for (const p of list) {
        try {
          p.remove();
        } catch (error) {
          report(error);
        }
      }
    players.clear();
    nextVoice.clear();
    unsubscribe?.();
    unsubscribe = null;
    ready = false;
  }

  return { play, preload, stopAll, release };
}

/** The app's sound service. */
export const sfx: Sfx = createSfx();
