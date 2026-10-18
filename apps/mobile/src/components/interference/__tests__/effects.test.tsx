import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type InterferenceKind, ManualClock } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { getAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import i18n from '../../../i18n';
import type { InterferenceScope } from '../config';
import { HitEffect } from '../HitEffect';
import { effectColors } from '../palette';
import { Scramble } from '../Scramble';
import { scrambleDraws, scramblePlan } from '../scrambleModel';
import { WarpFrame } from '../Warp';
import { NO_WARP, warpPose, warpStill, warpTransform } from '../warpModel';

// Skia draws natively; under Jest a canvas is a plain view (testing/skiaMock.ts).
jest.mock('@shopify/react-native-skia', () => jest.requireActual('../testing/skiaMock').skiaModule);

/** The kinds that draw in the hit layer's region (the scramble and the keypad draw on the board and the keypad). */
const KINDS: InterferenceKind[] = ['fireworks', 'cats', 'warp', 'ink'];
const hidden = { includeHiddenElements: true };

function Effect({
  kind,
  reduce,
  scope = 'screen',
  at = 1000,
}: {
  kind: InterferenceKind;
  reduce: boolean;
  scope?: InterferenceScope;
  at?: number;
}) {
  const elapsed = useSharedValue(at);
  return (
    <HitEffect
      kind={kind}
      width={390}
      height={844}
      elapsed={elapsed}
      totalMs={5000}
      colors={effectColors(1)}
      reduce={reduce}
      fadeInMs={240}
      fadeOutMs={240}
      scope={scope}
      board={{ x: 16, y: 288, width: 358, height: 358 }}
    />
  );
}

describe('the 5 s effects', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it.each(KINDS)('%s: plays live', async (kind) => {
    await render(<Effect kind={kind} reduce={false} />);
    expect(screen.getByTestId(`hit-${kind}`, hidden)).toHaveStyle({ width: 390, height: 844 });
    expect(screen.queryByTestId(`hit-${kind}-still`, hidden)).toBeNull();
  });

  it.each(KINDS)('%s: with reduced motion, a static cover of the same area (spec §22)', async (kind) => {
    await render(<Effect kind={kind} reduce />);
    expect(screen.getByTestId(`hit-${kind}-still`, hidden)).toHaveStyle({ width: 390, height: 844 });
    expect(screen.queryByTestId(`hit-${kind}`, hidden)).toBeNull();
  });

  it('cats shout in the player’s language, in bubbles that run with them', async () => {
    await render(<Effect kind="cats" reduce={false} />);
    expect(screen.getByText('מיאו!', hidden)).toBeTruthy();
    expect(screen.getByText('מיו!', hidden)).toBeTruthy();
  });

  it('cats shout in English too, standing still with reduced motion', async () => {
    await i18n.changeLanguage('en');
    await render(<Effect kind="cats" reduce />);
    expect(screen.getByText('Meow!', hidden)).toBeTruthy();
    expect(screen.getByText('Mew!', hidden)).toBeTruthy();
  });

  it.each(['scramble', 'keypad', 'dragons'] as InterferenceKind[])(
    '%s draws nothing in the region (the board and the keypad play it; an unknown kind: nothing, no crash) [D47]',
    async (kind) => {
      const { toJSON } = await render(<Effect kind={kind} reduce={false} />);
      expect(toJSON()).toBeNull();
    },
  );

  it('fireworks draw no night wash of their own any more: the board’s dim replaces it [D46]', () => {
    // A wash would be a full-region rect under the bursts; together with the dim the board would be ~75 % dark.
    const code = readFileSync(join(__dirname, '..', 'Fireworks.tsx'), 'utf8');
    expect(code).not.toMatch(/<Rect|NIGHT_OPACITY|colors.night/);
  });
});

describe('Scramble (the board’s tiles) [D47]', () => {
  const tiles = scrambleDraws(
    scramblePlan(
      [
        { cell: 0, digit: 5, background: 0 },
        { cell: 40, digit: 9, background: 2 },
      ],
      3,
      5000,
    ),
    (cell) => ({ x: (cell % 9) * 40, y: Math.floor(cell / 9) * 40, width: 38 }),
  );

  function Tiles({ reduce }: { reduce: boolean }) {
    const elapsed = useSharedValue(1000);
    return (
      <Scramble
        tiles={tiles}
        backgrounds={['#f7f8fa', '#eceff4', '#d6f4fc']}
        ink="#ff9440"
        cell={38}
        width={358}
        height={358}
        elapsed={elapsed}
        totalMs={5000}
        fadeInMs={240}
        fadeOutMs={240}
        reduce={reduce}
      />
    );
  }

  it('rolls live over the board, untouchable', async () => {
    await render(<Tiles reduce={false} />);
    const canvas = screen.getByTestId('hit-scramble', hidden);
    expect(canvas).toHaveStyle({ width: 358, height: 358 });
    expect(canvas).toHaveProp('pointerEvents', 'none');
    expect(screen.queryByTestId('hit-scramble-still', hidden)).toBeNull();
  });

  it('with reduced motion: a still "?" on every filled cell instead', async () => {
    await render(<Tiles reduce />);
    expect(screen.getByTestId('hit-scramble-still', hidden)).toHaveStyle({ width: 358, height: 358 });
    expect(screen.queryByTestId('hit-scramble', hidden)).toBeNull();
  });
});

describe('WarpFrame', () => {
  const clock = new ManualClock(10_000);
  let mounts = 0;
  function Content() {
    useEffect(() => {
      mounts += 1;
    }, []);
    return <Text>the game</Text>;
  }
  /** A warp that started 1 s ago (fully faded in). */
  const warp = { kind: 'warp' as const, endsAt: 14_000, totalMs: 5000 };
  /** The frame's transform once the UI thread has had a frame to apply the new values. */
  const transform = async () => {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    return (getAnimatedStyle(screen.getByTestId('frame')) as { transform: unknown[] }).transform;
  };

  /** The frame's tilt (rotateX, rotateY, rotateZ in degrees) and perspective, from a transform. */
  const tilt = (transform: unknown[]) => ({
    perspective: (transform[0] as { perspective: number }).perspective,
    angles: transform.slice(1, 4).map((o) => parseFloat(String(Object.values(o as object)[0]))),
  });
  /** The frame is tilted as `warpPose` at about `t` (the UI thread's frame clock moved on a frame or two). */
  async function expectPose(t: number, scope: InterferenceScope) {
    const got = tilt(await transform());
    const want = warpPose(t, 1, scope);
    expect(got.perspective).toBe(want.perspective);
    [want.rotateX, want.rotateY, want.rotateZ].forEach((a, i) => expect(got.angles[i]).toBeCloseTo(a, 0));
    expect(got.angles.some((a) => Math.abs(a) > 1)).toBe(true);
  }

  function frame(props: {
    hit: typeof warp | { kind: 'cats'; endsAt: number; totalMs: number } | null;
    region?: InterferenceScope;
    scope?: InterferenceScope;
    reduce?: boolean;
    now?: number;
  }) {
    return (
      <WarpFrame
        hit={props.hit}
        now={props.now ?? clock.now()}
        clock={clock}
        region={props.region ?? 'screen'}
        scope={props.scope}
        reduceMotion={props.reduce ?? false}
        testID="frame"
      >
        <Content />
      </WarpFrame>
    );
  }

  beforeEach(() => {
    mounts = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is a plain view without a warp, and never re-mounts the game when one starts and ends', async () => {
    const { rerender } = await render(frame({ hit: null }));
    expect(await transform()).toEqual(warpTransform(NO_WARP));

    await rerender(frame({ hit: warp }));
    await expectPose(1000, 'screen');

    // At endsAt it is straight again.
    await rerender(frame({ hit: warp, now: 14_000 }));
    expect(await transform()).toEqual(warpTransform(NO_WARP));
    expect(screen.getByText('the game')).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it('moves only for a warp, and only where the scope is [D35]', async () => {
    const { rerender } = await render(frame({ hit: { ...warp, kind: 'cats' } }));
    expect(await transform()).toEqual(warpTransform(NO_WARP));
    await rerender(frame({ hit: warp, region: 'board' }));
    expect(await transform()).toEqual(warpTransform(NO_WARP));
    await rerender(frame({ hit: warp, region: 'board', scope: 'board' }));
    await expectPose(1000, 'board');
  });

  it('with reduced motion holds one still tilt for the whole hit', async () => {
    await render(frame({ hit: warp, reduce: true }));
    expect(await transform()).toEqual(warpTransform(warpStill(true, 'screen')));
  });
});
