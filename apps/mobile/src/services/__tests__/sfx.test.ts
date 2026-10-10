import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppState } from 'react-native';

import { useSettings } from '../../state/settings';
import { createSfx, MAX_CONCURRENT_SOUNDS, SOUND_IDS, volumeOf, voicesOf, type Sfx } from '../sfx';

interface MockPlayer {
  source: unknown;
  volume: number;
  playing: boolean;
  play: jest.Mock;
  pause: jest.Mock;
  seekTo: jest.Mock;
  remove: jest.Mock;
}

jest.mock('expo-audio', () => {
  const players: unknown[] = [];
  return {
    __players: players,
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    createAudioPlayer: jest.fn((source: unknown) => {
      const player = {
        source,
        volume: 1,
        playing: false,
        play: jest.fn(() => {
          player.playing = true;
        }),
        pause: jest.fn(() => {
          player.playing = false;
        }),
        seekTo: jest.fn(() => Promise.resolve()),
        remove: jest.fn(),
      };
      players.push(player);
      return player;
    }),
  };
});

const audio = jest.requireMock<{
  __players: MockPlayer[];
  setAudioModeAsync: jest.Mock;
  createAudioPlayer: jest.Mock;
}>('expo-audio');

const REPO = resolve(__dirname, '..', '..', '..', '..', '..');
const SERVICES = resolve(__dirname, '..');

let sfx: Sfx;

beforeEach(() => {
  audio.__players.length = 0;
  audio.createAudioPlayer.mockClear();
  audio.setAudioModeAsync.mockClear();
  useSettings.setState({ sound: true });
  sfx = createSfx();
});

afterEach(() => {
  sfx.release();
  jest.restoreAllMocks();
});

describe('sfx: playing', () => {
  it('creates one player per sound on first play and reuses it, always from the start', () => {
    sfx.play('correct');
    sfx.play('correct');
    sfx.play('correct');
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(1);
    const [player] = audio.__players;
    expect(player!.seekTo).toHaveBeenCalledTimes(3);
    expect(player!.seekTo).toHaveBeenCalledWith(0);
    expect(player!.play).toHaveBeenCalledTimes(3);
    // seek first, then play
    expect(player!.seekTo.mock.invocationCallOrder[0]).toBeLessThan(
      player!.play.mock.invocationCallOrder[0]!,
    );
  });

  it('creates players lazily: nothing before the first play', () => {
    expect(audio.createAudioPlayer).not.toHaveBeenCalled();
    expect(audio.setAudioModeAsync).not.toHaveBeenCalled();
  });

  it('sets the audio mode once: mix with others, silent in silent mode', () => {
    sfx.play('correct');
    sfx.play('wrong');
    expect(audio.setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: false,
      interruptionMode: 'mixWithOthers',
    });
  });

  it('sets the starting volume of each sound (motion.md §8)', () => {
    sfx.play('count_tick');
    sfx.play('correct');
    sfx.play('win');
    sfx.play('arsenal_open');
    const volumes = audio.__players.map((p) => p.volume);
    expect(volumes).toEqual([0.3, 0.3, 0.8, 0.9, 0.7]);
    expect(volumeOf('cell_select')).toBe(0.5);
    expect(volumeOf('hit_cats')).toBe(0.6);
  });

  it('keeps two players for the fast ticks and alternates between them', () => {
    expect(voicesOf('count_tick')).toBe(2);
    expect(voicesOf('lock_tick')).toBe(2);
    expect(voicesOf('correct')).toBe(1);
    sfx.play('count_tick');
    sfx.play('count_tick');
    sfx.play('count_tick');
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(2);
    const [a, b] = audio.__players;
    expect(a!.play).toHaveBeenCalledTimes(2);
    expect(b!.play).toHaveBeenCalledTimes(1);
  });

  it('preload creates the players without playing; a later play creates nothing new', () => {
    sfx.preload(['correct', 'wrong', 'count_tick']);
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(4);
    expect(audio.__players.every((p) => p.play.mock.calls.length === 0)).toBe(true);
    sfx.play('correct');
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(4);
  });

  it('preload with no list loads every sound', () => {
    sfx.preload();
    const expected = SOUND_IDS.reduce((n, id) => n + voicesOf(id), 0);
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(expected);
  });

  it('release frees every player; the next play starts over', () => {
    sfx.play('correct');
    sfx.release();
    expect(audio.__players[0]!.remove).toHaveBeenCalledTimes(1);
    sfx.play('correct');
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(2);
  });
});

describe('sfx: settings and app state', () => {
  it('plays nothing while sound is off', () => {
    useSettings.setState({ sound: false });
    sfx.play('correct');
    sfx.play('count_tick');
    expect(audio.createAudioPlayer).not.toHaveBeenCalled();
    expect(audio.__players).toHaveLength(0);
  });

  it('follows the setting live: off, then on again', () => {
    sfx.play('correct');
    useSettings.setState({ sound: false });
    sfx.play('correct');
    useSettings.setState({ sound: true });
    sfx.play('correct');
    expect(audio.__players[0]!.play).toHaveBeenCalledTimes(2);
  });

  it('stops what is playing when sound is turned off', () => {
    sfx.play('win');
    const [player] = audio.__players;
    expect(player!.playing).toBe(true);
    useSettings.setState({ sound: false });
    expect(player!.pause).toHaveBeenCalledTimes(1);
  });

  it('plays nothing while the app is in the background', () => {
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    try {
      sfx.play('correct');
      expect(audio.__players).toHaveLength(0);
    } finally {
      Object.defineProperty(AppState, 'currentState', original);
    }
  });

  it('stopAll pauses only the players that are playing', () => {
    sfx.preload(['wrong']);
    sfx.play('correct');
    sfx.stopAll();
    const [wrong, correct] = audio.__players;
    expect(wrong!.pause).not.toHaveBeenCalled();
    expect(correct!.pause).toHaveBeenCalledTimes(1);
  });
});

describe('sfx: limits and errors', () => {
  it(`drops a UI tick when ${MAX_CONCURRENT_SOUNDS} sounds are already playing, but not a game sound`, () => {
    (['win', 'go', 'hit_cats', 'react_fire'] as const).forEach((id) => sfx.play(id));
    sfx.play('count_tick');
    sfx.play('cell_select');
    sfx.play('correct');
    const played = audio.__players.filter((p) => p.play.mock.calls.length > 0).length;
    expect(played).toBe(5); // the four, plus `correct`
  });

  it('swallows a failing player and logs it in development', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    audio.createAudioPlayer.mockImplementationOnce(() => {
      throw new Error('no audio device');
    });
    expect(() => sfx.play('correct')).not.toThrow();
    expect(warn).toHaveBeenCalledWith('[sfx]', expect.any(Error));
  });

  it('swallows a failing seek and a failing audio mode', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    audio.setAudioModeAsync.mockImplementationOnce(() => Promise.reject(new Error('session')));
    sfx.preload(['correct']);
    audio.__players[0]!.seekTo.mockImplementationOnce(() => Promise.reject(new Error('seek')));
    expect(() => sfx.play('correct')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(audio.__players[0]!.play).toHaveBeenCalledTimes(1);
  });

  it('swallows a player that throws on play', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    sfx.preload(['wrong']);
    audio.__players[0]!.play.mockImplementationOnce(() => {
      throw new Error('released');
    });
    expect(() => sfx.play('wrong')).not.toThrow();
  });
});

describe('sfx: the files', () => {
  const source = readFileSync(join(SERVICES, 'sfx.ts'), 'utf8');
  const requires = new Map(
    [...source.matchAll(/^\s+(\w+): require\('([^']+)'\)/gm)].map((m) => [m[1]!, resolve(SERVICES, m[2]!)]),
  );

  it('every sound has exactly one file, and it exists on disk', () => {
    expect([...requires.keys()].sort()).toEqual([...SOUND_IDS].sort());
    for (const [id, file] of requires) {
      expect({ id, exists: statSync(file, { throwIfNoEntry: false })?.isFile() ?? false }).toEqual({
        id,
        exists: true,
      });
    }
  });

  const placeholderDir = join(REPO, 'assets', 'sounds', 'placeholder');
  const placeholders = readdirSync(placeholderDir).filter((f) => f.endsWith('.wav'));

  it('has no placeholder that no sound uses', () => {
    const known = new Set<string>(SOUND_IDS);
    expect(placeholders.filter((f) => !known.has(f.replace(/\.wav$/, '')))).toEqual([]);
  });

  it.each(placeholders)('placeholder %s is a short mono 16-bit 22.05 kHz WAV under 20 KB', (file) => {
    const bytes = readFileSync(join(placeholderDir, file));
    expect(bytes.length).toBeLessThan(20 * 1024);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect(bytes.readUInt16LE(20)).toBe(1); // PCM
    expect(bytes.readUInt16LE(22)).toBe(1); // mono
    expect(bytes.readUInt32LE(24)).toBe(22050);
    expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.toString('ascii', 36, 40)).toBe('data');
    const seconds = bytes.readUInt32LE(40) / 2 / 22050;
    expect(seconds).toBeGreaterThan(0.02);
    expect(seconds).toBeLessThan(0.4);
    // not silent
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
    expect(peak).toBeGreaterThan(16000);
  });
});
