import { INTERFERENCE_KINDS, type InterferenceKind } from '@sudoku-fight/engine';
import { render, screen } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';

import { effectColors, HitEffect } from '../components/interference';
import i18n from '../i18n';
import { INTERFERENCE_UNLOCK_LEVELS } from '../screens/game/arsenal/config';
import { TokenArt } from '../screens/game/arsenal/TokenArt';
import { rumbleOf } from '../screens/game/hit';
import { HIT_CUES, hitCue } from '../screens/game/model';
import { CUES } from '../services/feedback';
import { SOUND_IDS } from '../services/sfx';

jest.mock(
  '@shopify/react-native-skia',
  () => jest.requireActual('../components/interference/testing/skiaMock').skiaModule,
);
// The cues' table only: nothing plays here.
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  createAudioPlayer: jest.fn(),
}));

/**
 * [D47] Every kind of the engine (INTERFERENCE_KINDS) is a whole kind in the app: an effect (or, for the
 * scramble and the keypad, the board's and the keypad's own), a start cue with its sound, a rumble, a preview,
 * an unlock level [D17] and its words in Hebrew and English. A kind added to the engine fails here until it is.
 */

const hidden = { includeHiddenElements: true };
/** The kinds that play on the board or the keypad, not in the hit layer's region. */
const ON_THE_BOARD: readonly InterferenceKind[] = ['scramble', 'keypad'];

function Effect({ kind }: { kind: InterferenceKind }) {
  const elapsed = useSharedValue(1000);
  return (
    <HitEffect
      kind={kind}
      width={390}
      height={844}
      elapsed={elapsed}
      totalMs={5000}
      colors={effectColors(1)}
      reduce={false}
      fadeInMs={240}
      fadeOutMs={240}
      scope="screen"
      board={{ x: 16, y: 288, width: 358, height: 358 }}
      seed={1}
    />
  );
}

describe.each(INTERFERENCE_KINDS.map((kind) => [kind]))('the kind %s', (kind) => {
  it('has its effect: in the region, or on the board / the keypad', async () => {
    const { toJSON } = await render(<Effect kind={kind} />);
    if (ON_THE_BOARD.includes(kind)) expect(toJSON()).toBeNull();
    else expect(screen.getByTestId(`hit-${kind}`, hidden)).toBeTruthy();
  });

  it('has a start cue of its own, with a sound and the Warning haptic, and a rumble inside the 5 s', () => {
    const cue = HIT_CUES[kind];
    expect(hitCue(kind)).toBe(cue);
    expect(CUES[cue].haptic).toBe('warning');
    expect(SOUND_IDS).toContain(CUES[cue].sound);
    const { times } = rumbleOf(kind, 5000);
    expect(times.length).toBeGreaterThan(0);
    expect(times.every((t) => t > 0 && t < 5000)).toBe(true);
  });

  it.each([false, true])(
    'has a preview of its own (not the unknown kind’s bolt), still: %s',
    async (still) => {
      jest.useFakeTimers();
      try {
        await render(<TokenArt kind={kind} size={56} still={still} />);
        expect(screen.getByTestId('token-art-motion', hidden)).toBeTruthy();
        expect(screen.queryByTestId('token-art-unknown', hidden)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('opens at a level [D17]', () => {
    expect(Number.isInteger(INTERFERENCE_UNLOCK_LEVELS[kind])).toBe(true);
  });

  it.each(['he', 'en'])('has its words in %s', async (lng) => {
    await i18n.changeLanguage(lng);
    const keys = [
      `game:hit.title.${kind}`,
      `game:arsenal.kind.${kind}`,
      `game:interference.${kind}`,
      `progress:interferences.description.${kind}`,
      `dev:sounds.cues.${CUES[HIT_CUES[kind]].sound}`,
    ];
    for (const key of keys) expect({ key, exists: i18n.exists(key) }).toEqual({ key, exists: true });
  });
});

describe('a kind this app does not know (a newer player’s app) [D47]', () => {
  const dragons = 'dragons' as InterferenceKind;

  it('draws no effect, plays the warp’s cue and no rumble, and previews as a still bolt, without throwing', async () => {
    const { toJSON } = await render(<Effect kind={dragons} />);
    expect(toJSON()).toBeNull();
    expect(hitCue(dragons)).toBe('hitWarp');
    expect(rumbleOf(dragons, 5000).times).toEqual([]);
    await render(<TokenArt kind={dragons} size={56} />);
    expect(screen.getByTestId('token-art-unknown', hidden)).toBeTruthy();
  });
});
