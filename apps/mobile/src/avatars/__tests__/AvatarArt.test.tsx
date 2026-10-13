import { avatarById, type AvatarDef, MOTIONS, nativeLayers, renderStatic } from '@sudoku-fight/avatars';
import { act, render, screen } from '@testing-library/react-native';
import { NavigationContext } from 'expo-router/react-navigation';
import { PixelRatio, StyleSheet, type ViewStyle } from 'react-native';

import { Avatar } from '../../components/player/Avatar';
import { AVATAR_SIZES } from '../../components/player/metrics';
import { useSettings } from '../../state/settings';
import { AvatarArt, type AvatarReaction, REACTION_FACE_MS } from '../AvatarArt';
import { idleMovers, layerStack, svgCount } from '../layerStack';
import { avatarIdsIn, drawnAvatarId, shownFace, svgXmlsIn } from '../testing/avatarTesting';

/**
 * AvatarArt (spec §3.4): one still SvgXml for an avatar that does not move; the package's layers, moved by
 * Reanimated, while it reacts, plays a gimmick or idles on a stage (while its screen is shown); with reduced
 * motion only the face changes.
 */

const hidden = { includeHiddenElements: true };
const def = (id: string): AvatarDef => avatarById(id)!;
const art = (testID = 'art') => screen.getByTestId(testID, hidden);
const xmls = (testID = 'art'): string[] => svgXmlsIn(art(testID)).map((x) => x.props.xml as string);
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;
/** Still: one SvgXml of renderStatic, with its clip path's id. */
const isStill = (testID = 'art') => xmls(testID).length === 1 && drawnAvatarId(xmls(testID)[0]) !== null;

async function frames(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('a still avatar', () => {
  it("is one SvgXml of the package's renderStatic, clipped to its rounded tile, hidden from screen readers", async () => {
    await render(<AvatarArt avatarId="fox" size={44} testID="art" />);
    expect(xmls()).toEqual([renderStatic(def('fox'), { size: 44 })]);
    expect(avatarIdsIn(art())).toEqual(['fox']);
    expect(styleOf(art())).toMatchObject({
      width: 44,
      height: 44,
      overflow: 'hidden',
      borderRadius: 44 * 0.18,
    });
    expect(art()).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    // Not found among what a screen reader can reach.
    expect(screen.queryByTestId('art')).toBeNull();
  });

  it('draws the "no avatar" placeholder for av00, null and an unknown id; an old pack\'s id as its replacement', async () => {
    await render(
      <>
        <AvatarArt avatarId="av00" size={36} testID="a" />
        <AvatarArt avatarId={null} size={36} testID="b" />
        <AvatarArt avatarId="av36" size={36} testID="c" />
        <AvatarArt avatarId="av50" size={36} testID="d" />
      </>,
    );
    const none = renderStatic(null, { size: 36 });
    expect([xmls('a'), xmls('b'), xmls('c')]).toEqual([[none], [none], [none]]);
    expect(avatarIdsIn(art('a'))).toEqual(['av00']);
    expect(avatarIdsIn(art('d'))).toEqual(['fox']);
  });

  it('greys an inactive player by colour math, and crops to the head when asked', async () => {
    await render(
      <>
        <AvatarArt avatarId="maya" size={36} inactive testID="grey" />
        <AvatarArt avatarId="maya" size={22} crop="head" testID="head" />
      </>,
    );
    expect(xmls('grey')).toEqual([renderStatic(def('maya'), { size: 36, grayscale: true })]);
    expect(xmls('head')).toEqual([renderStatic(def('maya'), { size: 22, crop: 'head' })]);
  });

  it('shows its base expression; a new one swaps at once', async () => {
    const view = await render(<AvatarArt avatarId="noam" size={44} expression="sad" testID="art" />);
    expect(xmls()).toEqual([renderStatic(def('noam'), { size: 44, expression: 'sad' })]);
    await view.rerender(<AvatarArt avatarId="noam" size={44} expression="angry" testID="art" />);
    expect(xmls()).toEqual([renderStatic(def('noam'), { size: 44, expression: 'angry' })]);
  });
});

describe('Avatar (components.md §2) draws AvatarArt in its frame', () => {
  it('the image size and radius of each frame; the 22 dp one shows the head', async () => {
    await render(
      <>
        <Avatar avatarId="fox" size="card" testID="card" />
        <Avatar avatarId="fox" size="cell" testID="cell" />
        <Avatar avatarId={null} size="home" testID="home" />
      </>,
    );
    const card = AVATAR_SIZES.card;
    expect(styleOf(art('card-image'))).toMatchObject({ width: card.image, borderRadius: card.imageRadius });
    expect(xmls('card-image')).toEqual([renderStatic(def('fox'), { size: card.image })]);
    expect(xmls('cell-image')).toEqual([renderStatic(def('fox'), { size: 22, crop: 'head' })]);
    expect(avatarIdsIn(art('home-image'))).toEqual(['av00']);
  });
});

describe('moving', () => {
  it("a stage view (idle): the layers, each that may move in a view of its own, on the tile's colour", async () => {
    await render(<AvatarArt avatarId="kettle" size={96} idle testID="art" />);
    const layers = nativeLayers(def('kettle'), { size: 96 });
    expect(xmls()).toHaveLength(svgCount(layerStack(layers, idleMovers(layers))));
    expect(xmls().every((x) => drawnAvatarId(x) === null)).toBe(true);
    expect(styleOf(art())).toMatchObject({ backgroundColor: def('kettle').tile });
    // It keeps idling: blinks come and go on their timer (a few in 12 s), and the stack stays put.
    await frames(12_000);
    expect(xmls()).toHaveLength(svgCount(layerStack(layers, idleMovers(layers))));
  });

  it('a reaction with a motion: layers while it plays, then one still picture with the base face again', async () => {
    const view = await render(<AvatarArt avatarId="fox" size={44} reaction={null} testID="art" />);
    expect(isStill()).toBe(true);
    const bounce: AvatarReaction = { expression: 'smile', motion: 'bounce', key: 1 };
    await view.rerender(<AvatarArt avatarId="fox" size={44} reaction={bounce} testID="art" />);
    await frames(0);
    // Only the body moves in a bounce: the whole character in one picture inside its view.
    expect(isStill()).toBe(false);
    expect(xmls()).toHaveLength(1);
    expect(styleOf(art())).toMatchObject({ backgroundColor: def('fox').tile });
    await frames(MOTIONS.bounce.durationMs);
    expect(xmls()).toEqual([renderStatic(def('fox'), { size: 44 })]);
  });

  it('a reaction that goes away stops at once, and the same key plays again when it comes back (the replay)', async () => {
    const shake: AvatarReaction = { expression: 'sad', motion: 'shake', key: 'step5' };
    const view = await render(<AvatarArt avatarId="fox" size={44} reaction={null} testID="art" />);
    await view.rerender(<AvatarArt avatarId="fox" size={44} reaction={shake} testID="art" />);
    await frames(0);
    expect(isStill()).toBe(false);
    expect(shownFace(art())).toBe('sad');
    // Gone mid-reaction (the replay moved to another step): the base face, still, at once.
    await view.rerender(<AvatarArt avatarId="fox" size={44} reaction={null} testID="art" />);
    await frames(0);
    expect(xmls()).toEqual([renderStatic(def('fox'), { size: 44 })]);
    // Back with the same key (the replay back on that step): it plays again.
    await view.rerender(<AvatarArt avatarId="fox" size={44} reaction={{ ...shake }} testID="art" />);
    await frames(0);
    expect(isStill()).toBe(false);
    expect(shownFace(art())).toBe('sad');
  });

  it('a reaction plays when its key changes, never the one on the first render', async () => {
    const shake: AvatarReaction = { motion: 'shake', key: 'a' };
    const view = await render(<AvatarArt avatarId="fox" size={44} reaction={shake} testID="art" />);
    await frames(0);
    expect(isStill()).toBe(true);
    await view.rerender(<AvatarArt avatarId="fox" size={44} reaction={{ ...shake }} testID="art" />);
    await frames(0);
    expect(isStill()).toBe(true);
    await view.rerender(
      <AvatarArt avatarId="fox" size={44} reaction={{ ...shake, key: 'b' }} testID="art" />,
    );
    await frames(0);
    expect(isStill()).toBe(false);
  });

  it('a face without a motion: shown for REACTION_FACE_MS, still', async () => {
    const view = await render(<AvatarArt avatarId="maya" size={44} testID="art" />);
    await view.rerender(
      <AvatarArt avatarId="maya" size={44} reaction={{ expression: 'wink', key: 1 }} testID="art" />,
    );
    await frames(0);
    expect(xmls()).toEqual([renderStatic(def('maya'), { size: 44, expression: 'wink' })]);
    await frames(REACTION_FACE_MS);
    expect(xmls()).toEqual([renderStatic(def('maya'), { size: 44 })]);
  });

  it('faceMs: the face stays on, still, after its motion, then the base face again', async () => {
    const view = await render(<AvatarArt avatarId="fox" size={44} testID="art" />);
    const nod: AvatarReaction = { expression: 'smile', motion: 'nod', faceMs: 1_200, key: 1 };
    await view.rerender(<AvatarArt avatarId="fox" size={44} reaction={nod} testID="art" />);
    await frames(0);
    expect(isStill()).toBe(false);
    expect(shownFace(art())).toBe('smile');
    await frames(MOTIONS.nod.durationMs);
    expect(xmls()).toEqual([renderStatic(def('fox'), { size: 44, expression: 'smile' })]);
    await frames(1_200 - MOTIONS.nod.durationMs);
    expect(xmls()).toEqual([renderStatic(def('fox'), { size: 44 })]);
    expect(shownFace(art())).toBe('neutral');
  });

  it('says the face it shows in its hidden root (for tests: never to a screen reader)', async () => {
    await render(
      <>
        <AvatarArt avatarId="fox" size={44} expression="sleepy" testID="art" />
        <Avatar avatarId="fox" expression="dizzy" testID="framed" />
      </>,
    );
    expect(art()).toHaveProp('accessibilityValue', { text: 'sleepy' });
    expect(art()).toHaveProp('accessible', false);
    expect(shownFace(screen.getByTestId('framed', hidden))).toBe('dizzy');
  });

  it("each layer is a bitmap of its own rect's size, placed left to right in its parent", async () => {
    await render(<AvatarArt avatarId="kettle" size={96} idle testID="art" />);
    const layers = nativeLayers(def('kettle'), { size: 96, pixelRatio: PixelRatio.get() });
    expect(styleOf(art())).toMatchObject({ direction: 'ltr' });
    const svgs = svgXmlsIn(art());
    for (const x of svgs) {
      const { width, height } = x.props as { width: number; height: number };
      // Never the old square twice the tile's side (a whole bitmap per layer, mostly empty).
      expect(width * height).toBeLessThan((96 * 2) ** 2 / 2);
      expect(styleOf(x)).toMatchObject({ position: 'absolute', left: expect.any(Number) });
    }
    // An eye's layer is about an eye's size.
    const eye = layers.nodes.find((n) => n.key === 'eye-0')!;
    const eyeSvg = svgs.find((x) => x.props.xml === eye.svg)!;
    expect((eyeSvg.props as { width: number }).width).toBeLessThan(96 / 3);
  });

  it('moving, the clip renders to one texture on Android (a fading parent fades it as one picture)', async () => {
    const view = await render(<AvatarArt avatarId="fox" size={96} idle testID="art" />);
    expect(art()).toHaveProp('renderToHardwareTextureAndroid', true);
    await view.rerender(<AvatarArt avatarId="fox" size={96} testID="art" />);
    expect(isStill()).toBe(true);
    expect(art()).toHaveProp('renderToHardwareTextureAndroid', false);
  });

  it('a stage idles only while its screen is the one shown (Home under the game stays still)', async () => {
    let focused = false;
    const listeners = new Set<() => void>();
    const navigation = {
      isFocused: () => focused,
      addListener: (_: string, cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
    const covered = (
      <NavigationContext.Provider value={navigation as never}>
        <AvatarArt avatarId="kettle" size={96} idle testID="art" />
      </NavigationContext.Provider>
    );
    await render(covered);
    await frames(10_000);
    expect(xmls()).toEqual([renderStatic(def('kettle'), { size: 96 })]);
    await act(async () => {
      focused = true;
      listeners.forEach((cb) => cb());
    });
    expect(isStill()).toBe(false);
    await act(async () => {
      focused = false;
      listeners.forEach((cb) => cb());
    });
    expect(xmls()).toEqual([renderStatic(def('kettle'), { size: 96 })]);
  });

  it('a gimmick its expression starts plays from 48 px up (the rain cloud rains when sad)', async () => {
    await render(
      <>
        <AvatarArt avatarId="rain-cloud" size={64} expression="sad" testID="big" />
        <AvatarArt avatarId="rain-cloud" size={44} expression="sad" testID="small" />
        <AvatarArt avatarId="rain-cloud" size={64} testID="calm" />
      </>,
    );
    expect(isStill('big')).toBe(false);
    expect(isStill('small')).toBe(true);
    expect(isStill('calm')).toBe(true);
  });
});

describe('reduced motion (useReduceMotion)', () => {
  beforeEach(() => useSettings.setState({ reduceMotion: 'on' }));

  it('nothing moves: a stage view and a gimmick stay one still SvgXml', async () => {
    await render(
      <>
        <AvatarArt avatarId="kettle" size={96} idle testID="stage" />
        <AvatarArt avatarId="rain-cloud" size={64} expression="sad" testID="sad" />
      </>,
    );
    await frames(10_000);
    expect(xmls('stage')).toEqual([renderStatic(def('kettle'), { size: 96 })]);
    expect(xmls('sad')).toEqual([renderStatic(def('rain-cloud'), { size: 64, expression: 'sad' })]);
  });

  it("`reduceMotion` overrides the app's decision for one avatar (the dev lab's switch)", async () => {
    useSettings.setState({ reduceMotion: 'off' });
    await render(
      <>
        <AvatarArt avatarId="kettle" size={96} idle reduceMotion testID="still" />
        <AvatarArt avatarId="kettle" size={96} idle testID="moving" />
      </>,
    );
    expect(xmls('still')).toEqual([renderStatic(def('kettle'), { size: 96 })]);
    expect(isStill('moving')).toBe(false);
  });

  it('a reaction only changes the face, for as long as its motion would play', async () => {
    const view = await render(<AvatarArt avatarId="fox" size={96} idle testID="art" />);
    await view.rerender(
      <AvatarArt avatarId="fox" size={96} idle reaction={{ motion: 'nod', key: 1 }} testID="art" />,
    );
    await frames(0);
    // The nod's own face (a smile), still.
    expect(xmls()).toEqual([renderStatic(def('fox'), { size: 96, expression: 'smile' })]);
    await frames(MOTIONS.nod.durationMs);
    expect(xmls()).toEqual([renderStatic(def('fox'), { size: 96 })]);
  });
});

describe('the placeholder', () => {
  it('never moves, even on a stage', async () => {
    await render(<AvatarArt avatarId={null} size={96} idle testID="art" />);
    expect(xmls()).toEqual([renderStatic(null, { size: 96 })]);
    expect(styleOf(art()).backgroundColor).toBeUndefined();
  });
});
