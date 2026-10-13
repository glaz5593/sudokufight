import {
  type AvatarDef,
  blinkPlan,
  CANVAS,
  type Crop,
  type EasingName,
  EASINGS,
  type Expression,
  type FaceChange,
  gimmickAnims,
  gimmickPlans,
  type GimmickState,
  grayOf,
  idleBlinkDelayMs,
  type MotionPlan,
  motionPlan,
  MOTIONS,
  NATIVE_PROPERTIES,
  type NativeFrame,
  nativeLayers,
  type NativeNode,
  type NativeProperty,
  type NativeRect,
  nativeTransform,
  type NodePlan,
  nodeRest,
  originFromCentrePx,
  type PlacePx,
  placePx,
  type PropertyPlan,
  TILE_RADIUS,
  triggeredBy,
} from '@sudoku-fight/avatars';
import { memo, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';

import { NEVER_REDUCE } from '../components/player/anim';
import { useReduceMotion } from '../theme/motion';
import { avatarDef } from './catalog';
import { idleMovers, layerStack, type StackItem, staticXml } from './layerStack';
import { type AvatarReaction, reactionSpanMs } from './reactions';
import { useScreenFocused } from './useScreenFocused';

export { type AvatarReaction, REACTION_FACE_MS } from './reactions';

/**
 * One of our avatars (packages/avatars, spec §3.4), drawn and moved in the app. A plain picture: no frame, no
 * badges, no label (Avatar in components/player puts it in its frame; it is decorative, hidden from screen
 * readers, and a caller that stands it alone labels its own container).
 *
 * Still (most of the time): ONE SvgXml of renderStatic(), remembered per avatar, size, crop, face and grey.
 * That is every list, every card at rest and the 22 px avatar in a locked cell.
 *
 * Moving: the layers of nativeLayers(), stacked in a view of `size` that clips them to the rounded tile; each
 * layer that moves now is an Animated.View that Reanimated 4 turns, scales and fades on the UI thread with the
 * package's plans (motionPlan, gimmickPlans, blinkPlan), and the layers between them stand still, merged into
 * as few SvgXml as their order allows (layerStack.ts). Each SvgXml is a bitmap as big as its layer's own
 * rectangle (an eye's is an eye's size). The clip renders to one texture on Android while it moves, so a parent
 * that fades (a section entering) or dims (a reconnecting player) fades the avatar as one picture, not each layer
 * over the tile's colour. An avatar moves only:
 * - during a `reaction` with a motion (then it goes back to one SvgXml);
 * - while one of its gimmicks plays (its expression or motion starts one; only at 48 px and up, packages/avatars
 *   GIMMICK_MIN_SIZE: the kettle's steam, the rain cloud's drops);
 * - on a stage view (`idle`), while its screen is the one shown (useScreenFocused: Home under the game does not
 *   idle): its idle gimmicks loop and it blinks every few seconds (idleBlinkDelayMs). Where avatars idle:
 *   AVATAR_STAGES (./reactions.ts).
 *
 * Reduced motion (the app's own decision, useReduceMotion): nothing moves, no gimmick, no blink. Faces still
 * change, at once: a reaction shows its face for as long as it would have played, then the base face again.
 *
 * Expressions and reactions (for the screens that react to the game):
 * - `expression` is the base face, shown until it changes (the default `neutral`). A new one swaps at once, and
 *   starts the gimmicks it triggers (the rain cloud rains while `sad`).
 * - `reaction` plays once each time its `key` changes (never the one present on the first render): its
 *   `expression`, if given, for the whole reaction (otherwise the motion's own faces: bounce laughs, nod
 *   smiles), and its `motion`, if given (squash falls back to bounce for an avatar that can't squash). Without
 *   a motion it lasts REACTION_FACE_MS; with `faceMs` the face stays on, still, after the motion, that long in
 *   all. Then the base face shows again. A new key mid-reaction starts over. A reaction that goes away (null:
 *   the replay between two steps) stops at once, and the next one plays even with a key that played before
 *   (the replay back on a step it showed).
 *   Which reaction plays when, in the game, the results and the replay: ./reactions.ts (AVATAR_REACTIONS).
 *
 * The face shown now is the root view's accessibilityValue text (an expression id): the view is hidden from
 * screen readers, so nobody hears it, and tests read it (testing/avatarTesting.ts shownFace).
 */

export interface AvatarArtProps {
  /**
   * One of ours (AvatarId). av00, null or anything else draws the "no avatar" placeholder; an id of the old
   * pack draws its replacement.
   */
  avatarId: string | null | undefined;
  /** Width and height, px. */
  size: number;
  /** `head`: the head only, for tiny sizes (the 22 px avatar in a locked cell); objects show whole. */
  crop?: Crop;
  /** The base face. Default `neutral`. */
  expression?: Expression;
  reaction?: AvatarReaction | null;
  /** A stage view (AVATAR_STAGES: the picker's stage, the winner): idle gimmicks and the blink. */
  idle?: boolean;
  /** Grey (a player who reconnects, left or surrendered): colour math on every colour, contrasts kept. */
  inactive?: boolean;
  /** Corner radius of the clip, px. Default the tile's own (18 % of the side). */
  radius?: number;
  /**
   * Overrides the app's reduced-motion decision (useReduceMotion), for this avatar only: the dev avatar lab's own
   * switch. Leave it out everywhere else.
   */
  reduceMotion?: boolean;
  testID?: string;
}

/** An avatar of ours, still or moving (see the top of this file). */
export const AvatarArt = memo(function AvatarArt({
  avatarId,
  size,
  crop = 'tile',
  expression = 'neutral',
  reaction = null,
  idle = false,
  inactive = false,
  radius,
  reduceMotion,
  testID,
}: AvatarArtProps) {
  const appReduce = useReduceMotion();
  const reduce = reduceMotion ?? appReduce;
  const focused = useScreenFocused();
  const def = avatarDef(avatarId);
  const playing = useReaction(def, reaction, reduce);
  const face = playing === null || playing.face === 'base' ? expression : playing.face;
  // A covered screen (Home under the game) stays mounted: it idles only while it is the one shown.
  const stage = idle && focused && !reduce && def !== null;
  const blink = useIdleBlink(stage && playing === null);

  const state: GimmickState = {
    expression: face,
    motion: playing?.plan?.id ?? null,
    idle: stage,
    size,
    reducedMotion: reduce,
  };
  const plans = def && !reduce ? nodePlans(def, state, playing, blink) : NO_PLANS;
  // The character, when it moves now (else one still picture).
  const moving = def !== null && (stage || plans.size > 0) ? def : null;

  return (
    <View
      style={[
        styles.clip,
        { width: size, height: size, borderRadius: radius ?? (TILE_RADIUS * size) / CANVAS },
        moving ? [styles.moving, { backgroundColor: inactive ? grayOf(moving.tile) : moving.tile }] : null,
      ]}
      // Moving, the tile and the layers are separate draws: as one texture, a fading parent fades them as one
      // picture (Android only; iOS composites a group's opacity already).
      renderToHardwareTextureAndroid={moving !== null}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // Never read (hidden above): the face shown now, for tests.
      accessibilityValue={{ text: face }}
      testID={testID}
    >
      {moving ? (
        <LayeredArt
          // A new avatar, size or crop is a new stack: its layers have other keys and another frame.
          key={`${moving.id}:${size}:${crop}`}
          def={moving}
          size={size}
          crop={crop}
          face={face}
          grayscale={inactive}
          stage={stage}
          plans={plans}
        />
      ) : (
        <StaticArt def={def} size={size} crop={crop} face={face} grayscale={inactive} />
      )}
    </View>
  );
});

// ---------------------------------------------------------------------------------------------------------
// Reactions and the idle blink: what plays now, in React state (the movement itself runs on the UI thread)

interface Playing {
  key: string | number;
  /** Its motion (no nodes with reduced motion), or null for a face only. */
  plan: MotionPlan | null;
  face: Expression | 'base';
}

/** The reaction playing now (see AvatarReaction), or null. */
function useReaction(
  def: AvatarDef | null,
  reaction: AvatarReaction | null,
  reduce: boolean,
): Playing | null {
  const [playing, setPlaying] = useState<Playing | null>(null);
  // The reaction of the first render has played already, as far as this avatar knows.
  const played = useRef(reaction?.key);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const key = reaction?.key;
  const expression = reaction?.expression;
  const motionId = reaction?.motion;
  const faceMs = reaction?.faceMs;

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const list = timers.current;
    if (key === undefined) {
      // No reaction now (the replay between two steps): what plays stops, and any key may play next, even one
      // that played before (the replay back on a step it showed).
      played.current = undefined;
      list.forEach(clearTimeout);
      list.length = 0;
      list.push(setTimeout(() => setPlaying(null), 0));
      return;
    }
    if (key === played.current) return;
    played.current = key;
    list.forEach(clearTimeout);
    list.length = 0;
    const plan = def && motionId ? motionPlan(def, motionId, { reducedMotion: reduce }) : null;
    const motionMs = plan?.durationMs ?? 0;
    const total = reactionSpanMs(motionMs, faceMs);
    const faces: FaceChange[] = expression ? [{ atMs: 0, expression }] : (plan?.faceChanges ?? []);
    const first = faces[0]?.atMs === 0 ? faces[0].expression : 'base';
    const at = (ms: number, run: () => void) => list.push(setTimeout(run, ms));
    const mine = (change: (p: Playing) => Playing | null) =>
      setPlaying((p) => (p !== null && p.key === key ? change(p) : p));
    at(0, () => setPlaying({ key, plan, face: first }));
    for (const c of faces)
      if (c.atMs > 0 && c.atMs < total) at(c.atMs, () => mine((p) => ({ ...p, face: c.expression })));
    // The face stays on after the motion: one still picture again meanwhile.
    if (plan && total > motionMs) at(motionMs, () => mine((p) => ({ ...p, plan: null })));
    at(total, () => mine(() => null));
  }, [key, def, expression, motionId, faceMs, reduce]);

  return playing;
}

/** One idle blink (motion `blink`). */
const BLINK_MS = MOTIONS.blink.durationMs;

/** While `active`: a counter that is set for one blink every few seconds (IDLE_BLINK_MS), else null. */
function useIdleBlink(active: boolean): number | null {
  const [blink, setBlink] = useState<number | null>(null);
  const count = useRef(0);
  useEffect(() => {
    if (!active) return;
    // A blink cut short when the avatar stopped idling is over.
    const reset = setTimeout(() => setBlink(null), 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => {
      timer = setTimeout(() => {
        count.current += 1;
        setBlink(count.current);
        timer = setTimeout(() => {
          setBlink(null);
          wait();
        }, BLINK_MS);
      }, idleBlinkDelayMs(Math.random()));
    };
    wait();
    return () => {
      clearTimeout(reset);
      clearTimeout(timer);
    };
  }, [active]);
  return active ? blink : null;
}

// ---------------------------------------------------------------------------------------------------------
// Which plan each layer plays

interface Planned {
  plan: NodePlan;
  /** A new key starts the plan over; the same key leaves it running. */
  key: string;
}

const NO_PLANS: ReadonlyMap<string, Planned> = new Map();

const blinks = new WeakMap<AvatarDef, MotionPlan>();
const blinkOf = (def: AvatarDef): MotionPlan => {
  let plan = blinks.get(def);
  if (!plan) blinks.set(def, (plan = blinkPlan(def)));
  return plan;
};

/**
 * Every layer's plan now: the gimmicks this state plays (one that keeps its anim keeps running, as in CSS; one a
 * motion plays starts over with each reaction), then the reaction's motion, else the idle blink.
 */
function nodePlans(
  def: AvatarDef,
  state: GimmickState,
  playing: Playing | null,
  blink: number | null,
): ReadonlyMap<string, Planned> {
  const out = new Map<string, Planned>();
  for (const p of gimmickPlans(def, state)) {
    const g = def.gimmicks?.find((x) => x.id === p.gimmick);
    const anim = g ? gimmickAnims(g)[p.index] : undefined;
    const run =
      playing !== null && state.motion && anim && triggeredBy(anim, state.motion) ? playing.key : '';
    out.set(p.node, { plan: p, key: `g${p.index}:${run}` });
  }
  if (playing?.plan) for (const n of playing.plan.nodes) out.set(n.node, { plan: n, key: `m${playing.key}` });
  else if (blink !== null) for (const n of blinkOf(def).nodes) out.set(n.node, { plan: n, key: `b${blink}` });
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Drawing

/** One SvgXml, remembered (layerStack.ts staticXml). */
const StaticArt = memo(function StaticArt({
  def,
  size,
  crop,
  face,
  grayscale,
}: {
  def: AvatarDef | null;
  size: number;
  crop: Crop;
  face: Expression;
  grayscale: boolean;
}) {
  const xml = useMemo(
    () => staticXml(def, { size, crop, expression: face, grayscale }),
    [def, size, crop, face, grayscale],
  );
  return <SvgXml xml={xml} width={size} height={size} />;
});

function LayeredArt({
  def,
  size,
  crop,
  face,
  grayscale,
  stage,
  plans,
}: {
  def: AvatarDef;
  size: number;
  crop: Crop;
  face: Expression;
  grayscale: boolean;
  stage: boolean;
  plans: ReadonlyMap<string, Planned>;
}) {
  const layers = useMemo(
    () => nativeLayers(def, { expression: face, size, crop, grayscale, pixelRatio: PixelRatio.get() }),
    [def, face, size, crop, grayscale],
  );
  // On a stage every layer that may move has its own view, so the stack stays put while it idles; elsewhere
  // only the layers that move now do.
  const movers = stage ? 'idle' : [...plans.keys()].sort().join(' ');
  const stack = useMemo(
    () => layerStack(layers, movers === 'idle' ? idleMovers(layers) : new Set(movers.split(' '))),
    [layers, movers],
  );
  return <>{layerItems(stack, layers.frame, plans, layers.frame.rect)}</>;
}

/** The items of one level, each placed by its rect inside `outer` (the moving layer that holds them, or the tile). */
function layerItems(
  items: readonly StackItem[],
  frame: NativeFrame,
  plans: ReadonlyMap<string, Planned>,
  outer: NativeRect,
): ReactNode[] {
  return items.map((it) =>
    it.kind === 'svg' ? (
      <LayerSvg key={it.key} xml={it.xml} {...placePx(frame, it.rect, outer)} />
    ) : (
      <LayerNode
        key={it.key}
        node={it.node}
        frame={frame}
        place={placePx(frame, it.node.rect, outer)}
        plan={plans.get(it.key)?.plan ?? null}
        planKey={plans.get(it.key)?.key ?? null}
      >
        {layerItems(it.items, frame, plans, it.node.rect)}
      </LayerNode>
    ),
  );
}

const LayerSvg = memo(function LayerSvg({ xml, left, top, width, height }: PlacePx & { xml: string }) {
  return <SvgXml xml={xml} width={width} height={height} style={[styles.layer, { left, top }]} />;
});

/** The curves of motion.md §3, built once. */
const EASE = Object.fromEntries(
  (Object.keys(EASINGS) as EasingName[]).map((name) => [name, Easing.bezier(...EASINGS[name])]),
) as Record<EasingName, ReturnType<typeof Easing.bezier>>;

/** One property of a plan, for Reanimated: each loop jumps to `from`, then runs its segments. */
function propertyAnimation(p: PropertyPlan): number {
  const timing = (to: number, duration: number, ease: EasingName) =>
    withTiming(to, { duration, easing: EASE[ease], reduceMotion: NEVER_REDUCE });
  const loop = withSequence(
    NEVER_REDUCE,
    timing(p.from, 0, 'linear'),
    ...p.segments.map((s) => timing(s.to, s.durationMs, s.ease)),
  );
  return withDelay(
    p.delayMs,
    withRepeat(loop, p.loop ? -1 : 1, false, undefined, NEVER_REDUCE),
    NEVER_REDUCE,
  );
}

/**
 * A layer that moves: an Animated.View over the layer's rect, its transform built around the plan's origin
 * (nativeTransform), with the layers it holds inside it. A new `planKey` starts its plan over (from rest when
 * there is none); the same key leaves it running.
 */
function LayerNode({
  node,
  frame,
  place,
  plan,
  planKey,
  children,
}: {
  node: NativeNode;
  frame: NativeFrame;
  /** Where its rect sits in its parent's (placePx). */
  place: PlacePx;
  plan: NodePlan | null;
  planKey: string | null;
  children: ReactNode;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const opacity = useSharedValue(node.restOpacity);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  // The plan of the latest render, for the effect below (which runs only when the key changes).
  const latest = useRef({ node, plan });
  useLayoutEffect(() => {
    latest.current = { node, plan };
  });

  // Where it turns, from its rect's centre: set whenever it changes, also while a plan plays on (a new face
  // can change the rect, which holds the face's parts).
  const origin = originFromCentrePx(frame, node.rect, plan?.origin ?? node.origin);
  useEffect(() => {
    originX.set(origin.x);
    originY.set(origin.y);
  }, [origin.x, origin.y, originX, originY]);

  useEffect(() => {
    const values: Record<NativeProperty, SharedValue<number>> = {
      translateX,
      translateY,
      rotate,
      scaleX,
      scaleY,
      opacity,
    };
    const { node: n, plan: p } = latest.current;
    const rest = p?.rest ?? nodeRest(n);
    for (const property of NATIVE_PROPERTIES) {
      cancelAnimation(values[property]);
      values[property].set(rest[property]);
    }
    for (const pp of p?.properties ?? []) {
      // During a delay the first keyframe shows (CSS's `both`).
      values[pp.property].set(pp.from);
      values[pp.property].set(propertyAnimation(pp));
    }
    return () => {
      for (const property of NATIVE_PROPERTIES) cancelAnimation(values[property]);
    };
  }, [planKey, translateX, translateY, rotate, scaleX, scaleY, opacity]);

  const scale = frame.scale;
  const style = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: nativeTransform(
      { x: translateX.get(), y: translateY.get(), rotate: rotate.get(), sx: scaleX.get(), sy: scaleY.get() },
      { x: originX.get(), y: originY.get() },
      scale,
    ),
  }));

  return <Animated.View style={[styles.layer, place, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  // The layers, left to right in either language: React Native turns a `left` into a `start` in an RTL app, and
  // `start` is the left again in an LTR view, so every layer keeps its place in the picture (as the board does).
  moving: { direction: 'ltr' },
  layer: { position: 'absolute' },
});
