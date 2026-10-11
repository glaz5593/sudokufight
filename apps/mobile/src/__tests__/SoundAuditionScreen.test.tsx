import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '../i18n';
import { hapticOf, SoundAuditionScreen } from '../screens/SoundAuditionScreen';
import { haptics } from '../services/haptics';
import { GAME_AUDIO_MODE, SOUND_IDS, SOUND_SOURCES, volumeOf, type SoundId } from '../services/sfx';
import { useSettings } from '../state/settings';

/** /dev/sounds (work plan "צלילים סופיים וכיול עוצמות"): the CC0 candidates next to the current sounds. */

interface MockPlayer {
  source: unknown;
  volume: number;
  play: jest.Mock;
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
        play: jest.fn(),
        pause: jest.fn(),
        seekTo: jest.fn(() => Promise.resolve()),
        remove: jest.fn(),
      };
      players.push(player);
      return player;
    }),
  };
});
// The screen tests use a fixed list (the real one shrinks as candidates are promoted); the file tests below
// read the real one.
jest.mock('../components/dev/soundCandidates', () => ({
  SOUND_CANDIDATES: {
    correct: { source: 9001, origin: 'Kenney · Interface Sounds', file: 'confirmation_002.ogg', ms: 500 },
    count_tick: { source: 9002, origin: 'Kenney · Interface Sounds', file: 'tick_002.ogg', ms: 20 },
    ui_tap: { source: 9003, origin: 'Kenney · UI Audio', file: 'click2.ogg', ms: 53 },
    win: { source: 9004, origin: 'Kenney · Music Jingles (Steel)', file: 'jingles_STEEL10.ogg', ms: 909 },
    go: { source: 9005, origin: 'Kenney · Impact Sounds', file: 'impactBell_heavy_000.ogg', ms: 1480 },
  },
}));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const audio = jest.requireMock<{
  __players: MockPlayer[];
  setAudioModeAsync: jest.Mock;
  createAudioPlayer: jest.Mock;
}>('expo-audio');
const expoHaptics = jest.requireMock<{ notificationAsync: jest.Mock }>('expo-haptics');

const REPO = resolve(__dirname, '..', '..', '..', '..');
const CANDIDATES_DIR = join(REPO, 'assets', 'sounds', 'candidates');
const LRI = '⁦';
const PDI = '⁩';

beforeEach(async () => {
  audio.__players.length = 0;
  audio.createAudioPlayer.mockClear();
  audio.setAudioModeAsync.mockClear();
  expoHaptics.notificationAsync.mockClear();
  haptics.reset();
  useSettings.setState({ sound: true, haptics: true });
  await i18n.changeLanguage('he');
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};
const show = (el: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{el}</SafeAreaProvider>);
const lastPlayer = () => audio.__players[audio.__players.length - 1]!;

describe('SoundAuditionScreen', () => {
  it('lists every sound of motion.md §8 with its game volume, and its candidate if it has one', async () => {
    await show(<SoundAuditionScreen />);
    expect(screen.getByRole('header', { name: 'צלילים' })).toBeTruthy();
    for (const id of SOUND_IDS) expect(screen.getByTestId(`dev-sound-${id}`)).toBeTruthy();
    expect(screen.getByText('ספרה נכונה · "דינג" עולה')).toBeTruthy();
    expect(screen.getByTestId('dev-sound-correct')).toHaveTextContent('עוצמה 0.8', { exact: false });
    expect(screen.getByTestId('dev-sound-correct-origin')).toHaveTextContent(
      `מועמד: ${LRI}Kenney · Interface Sounds${PDI} · ${LRI}confirmation_002.ogg${PDI} · 500 ms`,
    );
    // No candidate (yet, or promoted already): that button is off, the current sound still plays.
    expect(screen.getByTestId('dev-sound-wrong-origin')).toHaveTextContent('עוד אין מועמד');
    expect(screen.getByTestId('dev-sound-wrong-candidate')).toBeDisabled();
    expect(screen.getByTestId('dev-sound-wrong-current')).toBeEnabled();
  });

  it('plays the current sound and the candidate, each from the start at its game volume', async () => {
    await show(<SoundAuditionScreen />);
    await fireEvent.press(screen.getByTestId('dev-sound-correct-current'));
    expect(audio.createAudioPlayer).toHaveBeenLastCalledWith(SOUND_SOURCES.correct);
    expect(lastPlayer().volume).toBe(volumeOf('correct'));
    expect(lastPlayer().seekTo).toHaveBeenCalledWith(0);
    expect(lastPlayer().play).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('dev-sound-correct-candidate'));
    expect(audio.createAudioPlayer).toHaveBeenLastCalledWith(9001);
    expect(lastPlayer().volume).toBe(volumeOf('correct'));
    expect(lastPlayer().play).toHaveBeenCalledTimes(1);
  });

  it('keeps one player per button', async () => {
    await show(<SoundAuditionScreen />);
    await fireEvent.press(screen.getByTestId('dev-sound-count_tick-candidate'));
    await fireEvent.press(screen.getByTestId('dev-sound-count_tick-candidate'));
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(lastPlayer().seekTo).toHaveBeenCalledTimes(2);
    expect(lastPlayer().play).toHaveBeenCalledTimes(2);
  });

  it('plays at 1.0 with "full volume" on', async () => {
    await show(<SoundAuditionScreen />);
    await fireEvent(screen.getByTestId('dev-sounds-full-volume'), 'valueChange', true);
    expect(screen.getByTestId('dev-sound-ui_tap')).toHaveTextContent('עוצמה 1.0', { exact: false });
    await fireEvent.press(screen.getByTestId('dev-sound-ui_tap-candidate'));
    expect(lastPlayer().volume).toBe(1);
  });

  it('plays even with "צליל" off, and on silent: only the device volume counts', async () => {
    useSettings.setState({ sound: false });
    await show(<SoundAuditionScreen />);
    expect(audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    });
    await fireEvent.press(screen.getByTestId('dev-sound-win-candidate'));
    expect(lastPlayer().play).toHaveBeenCalledTimes(1);
  });

  it('frees its players and puts the game audio mode back when it closes', async () => {
    const { unmount } = await show(<SoundAuditionScreen />);
    await fireEvent.press(screen.getByTestId('dev-sound-go-current'));
    await fireEvent.press(screen.getByTestId('dev-sound-go-candidate'));
    const opened = [...audio.__players];
    expect(opened).toHaveLength(2);
    await act(async () => {
      unmount();
    });
    for (const player of opened) expect(player.remove).toHaveBeenCalledTimes(1);
    expect(audio.setAudioModeAsync).toHaveBeenLastCalledWith(GAME_AUDIO_MODE);
  });

  it('fires the haptic the sound comes with in the game', async () => {
    await show(<SoundAuditionScreen />);
    const button = screen.getByTestId('dev-sound-wrong-haptic');
    expect(button).toHaveTextContent('רטט · שגיאה');
    await fireEvent.press(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(expoHaptics.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('disables the haptic of a sound that has none (losing the lead)', async () => {
    await show(<SoundAuditionScreen />);
    expect(screen.getByTestId('dev-sound-lead_lose-haptic')).toBeDisabled();
    expect(screen.getByTestId('dev-sound-lead_lose-haptic')).toHaveTextContent('בלי רטט');
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await show(<SoundAuditionScreen onClose={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'Sounds' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Candidate sound: Correct digit · rising ding' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('hapticOf', () => {
  it('is the haptic of the first cue that plays the sound (feedback.ts)', () => {
    expect(hapticOf('cell_release')).toBe('selection'); // cellRelease, before lockExpired (none)
    expect(hapticOf('win')).toBe('success');
    expect(hapticOf('interfere_launch')).toBe('launch');
    expect(hapticOf('lead_lose')).toBeNull();
  });
});

/** The length each sound may have (docs/design/motion.md §8, "Length"): the shortest where a range is given. */
const LENGTH_MS: Record<SoundId, [min: number, max: number]> = {
  cell_select: [1, 60],
  cell_denied: [1, 150],
  cell_release: [1, 150],
  correct: [300, 500],
  count_tick: [1, 30],
  wrong: [120, 200],
  lock_tick: [1, 60],
  arsenal_open: [1, 250],
  interfere_whoosh: [300, 500],
  interfere_launch: [300, 600],
  hit_fireworks: [1, 5000],
  hit_cats: [1, 5000],
  hit_warp: [1, 5000],
  react_laugh: [1, 800],
  react_scream: [1, 800],
  react_cool: [1, 800],
  react_facepalm: [1, 800],
  react_fire: [1, 800],
  react_eyes: [1, 800],
  react_pop: [1, 200],
  match_found: [1, 700],
  countdown_beat: [1, 400],
  go: [1, 1500],
  win: [1, 2000],
  lose: [1, 1500],
  lead_take: [1, 400],
  lead_lose: [1, 400],
  disconnect: [1, 600],
  reconnect: [1, 600],
  ui_tap: [1, 80],
};

describe('the candidate files (assets/sounds/candidates)', () => {
  const { SOUND_CANDIDATES } = jest.requireActual<typeof import('../components/dev/soundCandidates')>(
    '../components/dev/soundCandidates',
  );
  // Promoting a candidate moves its file and deletes its line (assets/sounds/README.md): the list only shrinks.
  const candidates = Object.keys(SOUND_CANDIDATES) as SoundId[];
  const source = readFileSync(join(__dirname, '..', 'components', 'dev', 'soundCandidates.ts'), 'utf8');
  const listed = new Map(
    [...source.matchAll(/^ {2}(\w+): \{\n\s+source: require\('([^']+)'\)/gm)].map((m) => [m[1]!, m[2]!]),
  );
  const wavs = existsSync(CANDIDATES_DIR)
    ? readdirSync(CANDIDATES_DIR).filter((f) => f.endsWith('.wav'))
    : [];

  it('each candidate is a sound of motion.md §8, in a file named after it, and no file is left over', () => {
    const known = new Set<string>(SOUND_IDS);
    expect(candidates.filter((id) => !known.has(id))).toEqual([]);
    expect([...listed.keys()].sort()).toEqual([...candidates].sort());
    for (const [id, path] of listed) expect(path).toBe(`../../../../../assets/sounds/candidates/${id}.wav`);
    expect([...wavs].sort()).toEqual(candidates.map((id) => `${id}.wav`).sort());
  });

  it('each is a 16-bit mono 44.1 kHz WAV of the length motion.md §8 allows, peak at most −1 dBFS', () => {
    const ceiling = Math.round(32767 * 10 ** (-1 / 20)) + 1;
    for (const id of candidates) {
      const bytes = readFileSync(join(CANDIDATES_DIR, `${id}.wav`));
      expect({
        id,
        riff: bytes.toString('ascii', 0, 4),
        wave: bytes.toString('ascii', 8, 12),
        pcm: bytes.readUInt16LE(20),
        channels: bytes.readUInt16LE(22),
        rate: bytes.readUInt32LE(24),
        bits: bytes.readUInt16LE(34),
        data: bytes.toString('ascii', 36, 40),
      }).toEqual({
        id,
        riff: 'RIFF',
        wave: 'WAVE',
        pcm: 1,
        channels: 1,
        rate: 44100,
        bits: 16,
        data: 'data',
      });
      const ms = (bytes.readUInt32LE(40) / 2 / 44100) * 1000;
      const [min, max] = LENGTH_MS[id];
      let peak = 0;
      for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
      expect({
        id,
        lengthAllowed: ms >= min && ms <= max + 0.5,
        lengthAsListed: Math.abs(ms - SOUND_CANDIDATES[id]!.ms) < 1,
        underCeiling: peak <= ceiling,
        notSilent: peak > 8000,
      }).toEqual({ id, lengthAllowed: true, lengthAsListed: true, underCeiling: true, notSilent: true });
    }
  });

  it('stays small: under 2 MB together', () => {
    const total = wavs.reduce((sum, f) => sum + statSync(join(CANDIDATES_DIR, f)).size, 0);
    expect(total).toBeLessThan(2 * 1024 * 1024);
  });

  it('comes with its license and a sources table that names every candidate', () => {
    if (candidates.length === 0) return;
    expect(readFileSync(join(CANDIDATES_DIR, 'LICENSE.txt'), 'utf8')).toMatch(/CC0 1\.0/);
    const sources = readFileSync(join(CANDIDATES_DIR, 'SOURCES.md'), 'utf8');
    for (const id of candidates)
      expect({ id, listed: sources.includes(`\`${id}\``) }).toEqual({ id, listed: true });
  });

  it('only the dev candidate list points at the folder (the app itself never plays a candidate)', () => {
    const mobile = join(REPO, 'apps', 'mobile');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(path);
        } else if (/\.[jt]sx?$/.test(name) && readFileSync(path, 'utf8').includes('sounds/candidates/')) {
          hits.push(path.slice(mobile.length + 1).replaceAll('\\', '/'));
        }
      }
    };
    walk(join(mobile, 'src'));
    walk(join(mobile, 'app'));
    expect(hits.filter((file) => file !== 'src/components/dev/soundCandidates.ts')).toEqual([]);
  });
});
