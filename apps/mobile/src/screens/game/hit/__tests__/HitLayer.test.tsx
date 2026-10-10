import { type InterferenceKind, ManualClock } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';

import { INTERFERENCE_SCOPE } from '../../../../components/interference';
import i18n from '../../../../i18n';
import { useSettings } from '../../../../state/settings';
import { identityOf } from '../../identity';
import { duel } from '../../testing/duel';
import { HitLayer, type HitLayerProps } from '../HitLayer';
import { type HitInfo, hitOf, isolateName, rumbleOf } from '../hitModel';

// Skia draws natively; under Jest a canvas is a plain view.
jest.mock(
  '@shopify/react-native-skia',
  () => jest.requireActual('../../../../components/interference/testing/skiaMock').skiaModule,
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../../services/feedback');
const cues = (): string[] => feedback.cue.mock.calls.map((c: unknown[]) => String(c[0]));

const hidden = { includeHiddenElements: true };
const KINDS: InterferenceKind[] = ['fireworks', 'cats', 'warp'];
const START = 10_000;
const NINA = isolateName('NinaVolt');
const BOARD = { x: 16, y: 288, width: 358, height: 358 };

let clock: ManualClock;
let spoken: jest.SpyInstance;

/** NinaVolt (P2) hits me now, for 5 s. */
const hitOn = (over: Partial<HitInfo> = {}): HitInfo => ({
  kind: 'fireworks',
  fromId: 'p2',
  fromName: 'NinaVolt',
  fromColorIndex: 1,
  endsAt: START + 5000,
  totalMs: 5000,
  ...over,
});

const layer = (hit: HitInfo | null, props: Partial<HitLayerProps> = {}) => (
  <HitLayer hit={hit} now={clock.now()} clock={clock} topInset={0} {...props} />
);

/** The game clock and the phone's timers move on together, in frames, as on a phone. */
async function together(ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    clock.advance(frame);
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}

const region = () => screen.getByTestId('hit-layer-region', hidden);
const banner = () => screen.getByTestId('hit-layer-banner');

beforeEach(async () => {
  clock = new ManualClock(START);
  feedback.cue.mockClear();
  spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  useSettings.setState({ reduceMotion: 'off' });
  await i18n.changeLanguage('he');
});
afterEach(() => {
  spoken.mockRestore();
  jest.useRealTimers();
});

describe('HitLayer: nothing to show', () => {
  it('renders nothing, plays nothing and says nothing without a hit', async () => {
    const { toJSON } = await render(layer(null));
    expect(toJSON()).toBeNull();
    expect(cues()).toEqual([]);
    expect(spoken).not.toHaveBeenCalled();
  });

  it('renders nothing for a hit that is already over', async () => {
    const { toJSON } = await render(layer(hitOn({ endsAt: START })));
    expect(toJSON()).toBeNull();
  });
});

describe('HitLayer: the effect', () => {
  it.each(KINDS)('%s: plays live, with the banner over it', async (kind) => {
    await render(layer(hitOn({ kind })));
    expect(screen.getByTestId(`hit-${kind}`, hidden)).toBeTruthy();
    expect(screen.queryByTestId(`hit-${kind}-still`, hidden)).toBeNull();
    expect(banner()).toBeTruthy();
  });

  it.each(KINDS)('%s: with reduced motion, a static cover instead (spec §22)', async (kind) => {
    await render(layer(hitOn({ kind }), { reduceMotion: true }));
    expect(screen.getByTestId(`hit-${kind}-still`, hidden)).toBeTruthy();
    expect(screen.queryByTestId(`hit-${kind}`, hidden)).toBeNull();
  });

  it('follows the player’s reduced-motion setting by default', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(layer(hitOn({ kind: 'cats' })));
    expect(screen.getByTestId('hit-cats-still', hidden)).toBeTruthy();
  });

  it.each(KINDS)(
    '%s: reduced motion turned on mid-hit swaps to the static cover, same area, same deadline, no new start',
    async (kind) => {
      const hit = hitOn({ kind });
      const { rerender } = await render(layer(hit));
      const area = StyleSheet.flatten(region().props.style);
      clock.advance(2_000);
      await act(async () => useSettings.setState({ reduceMotion: 'on' }));
      await rerender(layer(hit));
      expect(screen.getByTestId(`hit-${kind}-still`, hidden)).toBeTruthy();
      expect(screen.queryByTestId(`hit-${kind}`, hidden)).toBeNull();
      expect(StyleSheet.flatten(region().props.style)).toEqual(area);
      expect(screen.getByTestId('hit-layer-banner-ring-seconds')).toHaveTextContent('3');
      // And back: live again for what is left, still ending at endsAt.
      clock.advance(1_000);
      await act(async () => useSettings.setState({ reduceMotion: 'off' }));
      await rerender(layer(hit));
      expect(screen.getByTestId(`hit-${kind}`, hidden)).toBeTruthy();
      clock.advance(2_000);
      await rerender(layer(hit));
      expect(screen.queryByTestId('hit-layer', hidden)).toBeNull();
      expect(cues().filter((c) => c.startsWith('hit') && c !== 'hitBurst' && c !== 'hitPulse')).toHaveLength(
        1,
      );
      expect(spoken).toHaveBeenCalledTimes(2); // the start and the end, once each
    },
  );

  it.each([false, true])(
    'lasts exactly until endsAt on the game clock (reduced motion: %s)',
    async (reduceMotion) => {
      const hit = hitOn();
      const { rerender } = await render(layer(hit, { reduceMotion }));
      clock.advance(4_999);
      await rerender(layer(hit, { reduceMotion }));
      expect(region()).toBeTruthy();
      expect(screen.getByTestId('hit-layer-banner-ring-seconds')).toHaveTextContent('1');
      clock.advance(1);
      await rerender(layer(hit, { reduceMotion }));
      expect(screen.queryByTestId('hit-layer', hidden)).toBeNull();
    },
  );

  it('stands still while the game is frozen (endsAt null)', async () => {
    const hit = hitOn({ endsAt: null, remainingMs: 3_000 });
    const { rerender } = await render(layer(hit));
    expect(screen.getByTestId('hit-layer-banner-ring-seconds')).toHaveTextContent('3');
    clock.advance(60_000);
    await rerender(layer(hit));
    expect(screen.getByTestId('hit-layer-banner-ring-seconds')).toHaveTextContent('3');
  });

  it('covers the whole screen by default [D35]', async () => {
    expect(INTERFERENCE_SCOPE).toBe('screen');
    const { width, height } = Dimensions.get('window');
    await render(layer(hitOn(), { boardRect: BOARD }));
    expect(region()).toHaveStyle({ left: 0, top: 0, width, height });
    // Once the layer knows its own size, the effect fills it.
    await fireEvent(screen.getByTestId('hit-layer', hidden), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
    });
    expect(region()).toHaveStyle({ left: 0, top: 0, width: 390, height: 844 });
    expect(screen.getByTestId('hit-fireworks', hidden)).toHaveStyle({ width: 390, height: 844 });
  });

  it('covers only the board with the board scope, and the screen while the board is not measured', async () => {
    const { rerender } = await render(layer(hitOn(), { scope: 'board', boardRect: BOARD }));
    expect(region()).toHaveStyle({ left: 16, top: 288, width: 358, height: 358 });
    expect(screen.getByTestId('hit-fireworks', hidden)).toHaveStyle({ width: 358, height: 358 });
    await rerender(layer(hitOn(), { scope: 'board', boardRect: null }));
    const { width, height } = Dimensions.get('window');
    expect(region()).toHaveStyle({ left: 0, top: 0, width, height });
  });
});

describe('HitLayer: the banner (spec §7.4, components.md §15.2)', () => {
  it('says who sent what, with the 5 s ring, under the safe area', async () => {
    await render(layer(hitOn(), { topInset: 47 }));
    expect(screen.getByTestId('hit-layer-banner-title')).toHaveTextContent(`${NINA} שלח/ה לך זיקוקים!`);
    expect(screen.getByTestId('hit-layer-banner-subtitle')).toHaveTextContent(
      'המשחק ממשיך · הטיימר שלך עצור',
    );
    expect(screen.getByTestId('hit-layer-banner-ring-seconds')).toHaveTextContent('5');
    expect(banner()).toHaveStyle({ top: 55 });
  });

  it('names each kind, and the cost when the screen knows it', async () => {
    const { rerender } = await render(layer(hitOn({ kind: 'cats', cost: 4 })));
    expect(screen.getByTestId('hit-layer-banner-title')).toHaveTextContent(`${NINA} שלח/ה לך חתולים!`);
    expect(screen.getByTestId('hit-layer-banner-subtitle')).toHaveTextContent('זה עלה 4 נק׳ · המשחק ממשיך');
    await rerender(layer(hitOn({ kind: 'warp', cost: 4 })));
    expect(screen.getByTestId('hit-layer-banner-title')).toHaveTextContent(`${NINA} שלח/ה לך עיוות!`);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    const { rerender } = await render(layer(hitOn()));
    expect(screen.getByTestId('hit-layer-banner-title')).toHaveTextContent(`${NINA} sent you fireworks!`);
    expect(screen.getByTestId('hit-layer-banner-subtitle')).toHaveTextContent(
      'The game goes on · your timer is paused',
    );
    await rerender(layer(hitOn({ kind: 'cats', cost: 8 })));
    expect(screen.getByTestId('hit-layer-banner-title')).toHaveTextContent(`${NINA} sent you cats!`);
    expect(screen.getByTestId('hit-layer-banner-subtitle')).toHaveTextContent(
      'It cost 8 pts · the game goes on',
    );
    await rerender(layer(hitOn({ kind: 'warp' })));
    expect(screen.getByTestId('hit-layer-banner-title')).toHaveTextContent(`${NINA} warped your screen!`);
    expect(spoken).toHaveBeenCalledWith(`${NINA} sent you fireworks! 5 seconds left, your timer is paused`);
  });
});

describe('HitLayer: screen readers', () => {
  it('hide the effect, and reach the banner as an alert with the time left', async () => {
    const hit = hitOn();
    const { rerender } = await render(layer(hit));
    expect(screen.queryByTestId('hit-fireworks')).toBeNull(); // hidden from them…
    expect(screen.getByTestId('hit-fireworks', hidden)).toBeTruthy(); // …but on screen
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAccessibleName(
      `${NINA} שלח/ה לך זיקוקים! המשחק ממשיך · הטיימר שלך עצור, נותרו 5 שניות`,
    );
    clock.advance(4_000);
    await rerender(layer(hit));
    expect(screen.getByRole('alert')).toHaveAccessibleName(
      `${NINA} שלח/ה לך זיקוקים! המשחק ממשיך · הטיימר שלך עצור, נותרה שנייה אחת`,
    );
  });

  it('hear the start once and the end once', async () => {
    const hit = hitOn();
    const { rerender } = await render(layer(hit));
    expect(spoken.mock.calls).toEqual([[`${NINA} שלח/ה לך זיקוקים! נותרו 5 שניות, הטיימר שלך עצור`]]);
    clock.advance(2_000);
    await rerender(layer(hit));
    expect(spoken).toHaveBeenCalledTimes(1);
    clock.advance(3_000);
    await rerender(layer(hit));
    expect(spoken).toHaveBeenCalledTimes(2);
    expect(spoken).toHaveBeenLastCalledWith('ההפרעה נגמרה, הטיימר שלך ממשיך');
    await rerender(layer(null));
    expect(spoken).toHaveBeenCalledTimes(2);
  });

  it('go through the screen’s announcer when it gives one, or not at all', async () => {
    const announce = jest.fn();
    const hit = hitOn({ kind: 'cats' });
    const { rerender } = await render(layer(hit, { announce }));
    await rerender(layer(null, { announce }));
    expect(announce.mock.calls).toEqual([
      [`${NINA} שלח/ה לך חתולים! נותרו 5 שניות, הטיימר שלך עצור`],
      ['ההפרעה נגמרה, הטיימר שלך ממשיך'],
    ]);
    expect(spoken).not.toHaveBeenCalled();

    await rerender(layer(hitOn({ kind: 'warp' }), { announce: false }));
    await rerender(layer(null, { announce: false }));
    expect(spoken).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('say nothing when the screen goes away in the middle', async () => {
    const { unmount } = await render(layer(hitOn()));
    await act(async () => unmount());
    expect(spoken).toHaveBeenCalledTimes(1);
  });
});

describe('HitLayer: sound and haptics (motion.md §7)', () => {
  it.each([
    ['fireworks', 'hitFireworks', 'hitBurst'],
    ['cats', 'hitCats', 'hitPulse'],
    ['warp', 'hitWarp', 'hitPulse'],
  ] as const)('%s: its cue once at the start, then its rumble while it lasts', async (kind, start, knock) => {
    jest.useFakeTimers();
    const hit = hitOn({ kind });
    const { rerender } = await render(layer(hit));
    await together(1_000);
    await rerender(layer(hit));
    expect(cues().filter((c) => c === start)).toHaveLength(1);
    await together(4_000);
    expect(cues()[0]).toBe(start);
    expect(cues().slice(1)).toEqual(rumbleOf(kind, 5000).times.map(() => knock));
    expect(cues().length).toBeGreaterThan(3);
  });

  it('drops the knocks that come after the end or too late (back from the background): no burst of them', async () => {
    jest.useFakeTimers();
    await render(layer(hitOn({ kind: 'fireworks' })));
    // The app is away: the game clock runs on, the phone's timers don't; then they all come due at once.
    clock.advance(6_000);
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(cues()).toEqual(['hitFireworks']);

    // Back in the middle of a hit: the knocks it missed are dropped, the ones still ahead play on time.
    feedback.cue.mockClear();
    const warp = hitOn({ kind: 'warp', endsAt: clock.now() + 5000 });
    const { rerender } = await render(layer(warp));
    clock.advance(2_500); // away through the knocks at 1100 and 2200
    await act(async () => {
      jest.advanceTimersByTime(2_500);
    });
    await rerender(layer(warp));
    expect(cues()).toEqual(['hitWarp']);
    await together(2_500);
    expect(cues()).toEqual(['hitWarp', 'hitPulse', 'hitPulse']); // 3300 and 4400
  });

  it('stops the rumble once reduced motion is turned on mid-hit, and none while the game is frozen', async () => {
    jest.useFakeTimers();
    const hit = hitOn({ kind: 'warp' });
    const { rerender } = await render(layer(hit));
    await together(1_200);
    expect(cues()).toEqual(['hitWarp', 'hitPulse']);
    await act(async () => useSettings.setState({ reduceMotion: 'on' }));
    await rerender(layer(hit));
    await together(3_800);
    expect(cues()).toEqual(['hitWarp', 'hitPulse']);

    await rerender(layer(hit)); // over
    await act(async () => useSettings.setState({ reduceMotion: 'off' }));
    feedback.cue.mockClear();
    const frozen = hitOn({ kind: 'warp', id: 2, endsAt: null, remainingMs: 5_000 });
    await rerender(layer(frozen));
    await together(5_000);
    expect(cues()).toEqual(['hitWarp']);
  });

  it('with reduced motion only the start (no rumble)', async () => {
    jest.useFakeTimers();
    await render(layer(hitOn({ kind: 'warp' }), { reduceMotion: true }));
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(cues()).toEqual(['hitWarp']);
  });

  it('none at all when the screen plays them itself', async () => {
    jest.useFakeTimers();
    await render(layer(hitOn(), { feedback: false }));
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(cues()).toEqual([]);
  });

  it('two hits of one kind from one sender with no frame between them: the first ends, the next starts', async () => {
    jest.useFakeTimers();
    const announce = jest.fn();
    const { rerender } = await render(layer(hitOn({ kind: 'cats', id: 7 }), { announce }));
    // Back from the background: the first ended, its second of immunity passed, the second came.
    clock.advance(6_100);
    await rerender(layer(hitOn({ kind: 'cats', id: 9, endsAt: clock.now() + 5000 }), { announce }));
    expect(cues()).toEqual(['hitCats', 'hitCats']);
    expect(announce.mock.calls).toEqual([
      [`${NINA} שלח/ה לך חתולים! נותרו 5 שניות, הטיימר שלך עצור`],
      ['ההפרעה נגמרה, הטיימר שלך ממשיך'],
      [`${NINA} שלח/ה לך חתולים! נותרו 5 שניות, הטיימר שלך עצור`],
    ]);
  });

  it('stops the rumble when the hit ends early, and starts over for the next hit', async () => {
    jest.useFakeTimers();
    const { rerender } = await render(layer(hitOn()));
    await rerender(layer(null));
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(cues()).toEqual(['hitFireworks']);
    clock.advance(6_000);
    await rerender(layer(hitOn({ kind: 'cats', endsAt: clock.now() + 5000 })));
    expect(cues()).toEqual(['hitFireworks', 'hitCats']);
  });
});

describe('HitLayer from a real game (LocalGameHost against the bot)', () => {
  it('shows the bot’s cats from the view, and goes when the engine ends them', async () => {
    const g = duel();
    g.bot.solve(g.cells[0]!); // the bot needs the points for it (D10)
    const nameOf = (id: string) => identityOf(g.host.getView(), id).name ?? '';
    expect(hitOf(g.host.getView(), { nameOf })).toBeNull();

    g.bot.interfere('cats');
    const view = g.host.getView();
    const hit = hitOf(view, { nameOf });
    expect(hit).toEqual({
      kind: 'cats',
      fromId: 'bot-3',
      fromName: 'Mr. Hoot',
      fromAvatar: null,
      fromColorIndex: 1,
      endsAt: g.clock.now() + 5000,
      remainingMs: 5000,
      totalMs: 5000,
    });

    const show = () => {
      const v = g.host.getView();
      return <HitLayer hit={hitOf(v, { nameOf })} now={g.clock.now()} clock={g.clock} topInset={0} />;
    };
    const { rerender } = await render(show());
    expect(screen.getByTestId('hit-cats', hidden)).toBeTruthy();
    expect(screen.getByTestId('hit-layer-banner-title')).toHaveTextContent(
      `${isolateName('Mr. Hoot')} שלח/ה לך חתולים!`,
    );

    g.scheduler.advance(5_000);
    await rerender(show());
    expect(screen.queryByTestId('hit-layer', hidden)).toBeNull();
    expect(spoken).toHaveBeenLastCalledWith('ההפרעה נגמרה, הטיימר שלך ממשיך');
    g.session.close();
  });
});
