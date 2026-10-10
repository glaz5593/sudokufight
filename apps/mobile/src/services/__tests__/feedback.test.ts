import { useSettings } from '../../state/settings';
import { tokens } from '../../theme/tokens.generated';
import { CUES, cue, cueCountUp, FEEDBACK_CUES, GAME_CUES, preloadCues, type FeedbackCue } from '../feedback';
import { HAPTIC_PATTERNS, haptics } from '../haptics';
import { sfx, SOUND_IDS, voicesOf } from '../sfx';

interface MockPlayer {
  play: jest.Mock;
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

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const audio = jest.requireMock<{ __players: MockPlayer[]; createAudioPlayer: jest.Mock }>('expo-audio');
const H = jest.requireMock<{
  selectionAsync: jest.Mock;
  impactAsync: jest.Mock;
  notificationAsync: jest.Mock;
}>('expo-haptics');

const buzzes = () =>
  H.selectionAsync.mock.calls.length +
  H.impactAsync.mock.calls.length +
  H.notificationAsync.mock.calls.length;
const plays = () => audio.__players.reduce((n, p) => n + p.play.mock.calls.length, 0);
const turn = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  audio.__players.length = 0;
  sfx.release();
  haptics.reset();
  useSettings.setState({ sound: true, haptics: true });
});

afterEach(() => jest.useRealTimers());

describe('the cue table (motion.md §7 and §8)', () => {
  it('maps every cue to a known sound (or none) and a known haptic (or none)', () => {
    const sounds = new Set<string>(SOUND_IDS);
    const patterns = new Set<string>(HAPTIC_PATTERNS);
    for (const name of FEEDBACK_CUES) {
      const { sound, haptic } = CUES[name];
      expect({ name, sound: sound === null || sounds.has(sound) }).toEqual({ name, sound: true });
      expect({ name, haptic: haptic === null || patterns.has(haptic) }).toEqual({ name, haptic: true });
    }
  });

  it('gives every cue some feedback, except the digit key (its result follows within 150 ms)', () => {
    const silent = FEEDBACK_CUES.filter((n) => CUES[n].sound === null && CUES[n].haptic === null);
    expect(silent).toEqual(['keyPress']);
  });

  it('uses every sound file', () => {
    const used = new Set(FEEDBACK_CUES.map((n) => CUES[n].sound));
    expect(SOUND_IDS.filter((id) => !used.has(id))).toEqual([]);
  });

  it.each<[FeedbackCue, string | null, string | null]>([
    ['cellSelect', 'cell_select', 'selection'],
    ['cellDenied', 'cell_denied', 'medium'],
    ['cellRelease', 'cell_release', 'selection'],
    ['lockExpired', 'cell_release', null],
    ['lockTick', 'lock_tick', 'light'],
    ['keyPress', null, null],
    ['correct', 'correct', 'success'],
    ['wrong', 'wrong', 'error'],
    ['countTick', 'count_tick', 'selection'],
    ['primaryPress', 'ui_tap', 'light'],
    ['win', 'win', 'success'],
    ['lose', 'lose', 'light'],
    ['practiceDone', 'win', 'success'],
    ['go', 'go', 'heavy'],
  ])('%s → sound %s, haptic %s', (name, sound, haptic) => {
    expect(CUES[name]).toEqual({ sound, haptic });
  });
});

describe('cue()', () => {
  it('plays the sound and the haptic of the cue', async () => {
    const play = jest.spyOn(sfx, 'play');
    cue('correct');
    await turn();
    expect(play).toHaveBeenCalledWith('correct');
    expect(audio.__players).toHaveLength(1);
    expect(audio.__players[0]!.play).toHaveBeenCalledTimes(1);
    expect(H.notificationAsync).toHaveBeenCalledWith('success');
    play.mockRestore();
  });

  it('practice done plays the win sound with a success haptic', async () => {
    const play = jest.spyOn(sfx, 'play');
    cue('practiceDone');
    await turn();
    expect(play).toHaveBeenCalledWith('win');
    expect(H.notificationAsync).toHaveBeenCalledWith('success');
    play.mockRestore();
  });

  it('a silent cue touches neither service', async () => {
    const play = jest.spyOn(sfx, 'play');
    const fire = jest.spyOn(haptics, 'fire');
    cue('keyPress');
    await turn();
    expect(play).not.toHaveBeenCalled();
    expect(fire).not.toHaveBeenCalled();
    play.mockRestore();
    fire.mockRestore();
  });

  it('with sound off: the haptic only', async () => {
    useSettings.setState({ sound: false });
    cue('wrong');
    await turn();
    expect(plays()).toBe(0);
    expect(H.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('with haptics off: the sound only', async () => {
    useSettings.setState({ haptics: false });
    cue('wrong');
    await turn();
    expect(plays()).toBe(1);
    expect(buzzes()).toBe(0);
  });

  it('with both off, no cue does anything', async () => {
    useSettings.setState({ sound: false, haptics: false });
    FEEDBACK_CUES.forEach(cue);
    await turn();
    expect(audio.createAudioPlayer).not.toHaveBeenCalled();
    expect(buzzes()).toBe(0);
  });

  it('creates each player once, however often its cue plays', async () => {
    FEEDBACK_CUES.forEach(cue);
    await turn();
    const created = audio.createAudioPlayer.mock.calls.length;
    expect(created).toBe(SOUND_IDS.reduce((n, id) => n + voicesOf(id), 0));
    for (let i = 0; i < 3; i++) {
      FEEDBACK_CUES.forEach(cue);
      await turn();
    }
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(created);
  });
});

describe('preloadCues()', () => {
  it('loads the sounds of the game cues once, without playing them', () => {
    preloadCues();
    const sounds = new Set(GAME_CUES.flatMap((n) => CUES[n].sound ?? []));
    const players = [...sounds].reduce((n, id) => n + voicesOf(id), 0);
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(players);
    expect(plays()).toBe(0);
    preloadCues();
    expect(audio.createAudioPlayer).toHaveBeenCalledTimes(players);
  });
});

describe('cueCountUp()', () => {
  it('plays five ticks at the DS-Motion offsets', async () => {
    jest.useFakeTimers();
    cueCountUp();
    const offsets = tokens.motion.limits.countTicks;
    expect(offsets).toEqual([0, 60, 140, 250, 420]);
    let elapsed = 0;
    for (const [i, at] of offsets.entries()) {
      jest.advanceTimersByTime(at - elapsed);
      elapsed = at;
      expect(plays()).toBe(i + 1);
    }
    await turn();
  });

  it('stops when cancelled', () => {
    jest.useFakeTimers();
    const cancel = cueCountUp();
    jest.advanceTimersByTime(100);
    cancel();
    jest.advanceTimersByTime(1000);
    expect(plays()).toBe(2);
  });
});
