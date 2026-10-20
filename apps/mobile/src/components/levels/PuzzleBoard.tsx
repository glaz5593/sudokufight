import type { CellIndex, PuzzleSlotView } from '@sudoku-fight/engine';
import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { type AccessibilityActionEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { LEVEL_UI, PUZZLE_UI } from '../../config/levels';
import { cue } from '../../services/feedback';
import { color, radius, size, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { shake } from '../board/animation';
import { Icon } from '../Icon';
import { timing } from '../ui/motion';
import { GoldFrame, MeFrame, puzzleMarkStyles } from './PuzzleMarks';
import {
  boxCellsAt,
  boxRows,
  placeAt,
  PUZZLE_PLACE_COUNT,
  type PuzzleGeometry,
  puzzleGeometry,
  slotOrigin,
} from './puzzleGeometry';

/**
 * The puzzle's board (levels-ui.md §4; D78): the nine boxes of a solved sudoku as tiles, always LTR (box 1 at
 * the top-left, in Hebrew too). A box is moved by dragging it onto another one, or (LEVEL_UI.puzzleTapSwap, and
 * always with a screen reader's activate) by choosing it and then another; either way the board only asks
 * (onSwap → session.swap → GameHost.swapBoxes) and draws what the engine's view says. It never decides whether
 * a swap is allowed or the puzzle solved: a fixed box dropped on is still asked about, and the engine's refusal
 * (`refusal`, 'boxFixed') sends the box home.
 *
 * - A box that moves: the warm region tone (board.focusCell) with a 2 dp edge under it, a tile's thickness.
 * - A fixed box: the grey out tone (board.outCell), flat, a 16 dp lock in its top corner (a shape, not colour
 *   alone); its digits stay dark (board.given), they are the logic's anchors.
 * - Held: follows the finger, grows to PUZZLE_UI.liftScale with a shadow, a 3 dp P1 frame ("me" is P1) with its
 *   dark keyline; where it was lifted from, a dashed hole. Over another moving box: the gold region frame with
 *   its dark keylines; over a fixed one: no frame, its lock in board.wrongDigit.
 * - Chosen (tap): the P1 frame, and `selected` for a screen reader. A box at its home is never marked (D71).
 * - Repeated digits only as the engine lists them (view.level.puzzle.conflicts, empty by default, D78b).
 *
 * Motion (motion.md 4.11): lift `level.puzzle.lift`, the swap `level.puzzle.swap` (the moved box 200 ms, the
 * other 240 ms, each animated by its own id, so a box slides rather than jumps), home `level.puzzle.home`
 * (200 ms), a fixed box's lock shakes (`level.puzzle.denied`), and solved: every box's gold frame flashes once
 * (`level.puzzle.solved`, 550 ms). Reduced Motion: no growth and no shadow (the P1 frame stays), the box still
 * follows the finger (the user's own motion), the swap and the way home are instant, the denied lock's frame
 * lights for 300 ms instead of the shake, and solved is a still gold frame for 300 ms. Haptics and sounds are
 * the existing cues only: lift cellSelect, a fixed box cellDenied (the screen plays the swap and the end).
 */

export interface PuzzleRefusal {
  /** Changes with every refusal, so the same one twice still plays. */
  key: number;
  from: number;
  to: number;
}

export interface PuzzleBoardProps {
  /** The 81 digits as the boxes stand (GameView.grid). */
  grid: readonly number[];
  /** Which box stands at each place, and whether it moves (GameView.level.puzzle.slots). */
  slots: readonly PuzzleSlotView[];
  /** Repeated digits, only as the engine lists them (empty by default, D78b). */
  conflicts?: readonly CellIndex[];
  /** The board's side. */
  width: number;
  /** Moves are taken: the puzzle runs, not frozen, not over. */
  enabled: boolean;
  /** Ask the host to swap the boxes at two places (session.swap). */
  onSwap: (from: number, to: number) => void;
  /** The engine refused the last swap: the box goes home, a fixed lock shakes. */
  refusal?: PuzzleRefusal | null;
  /** A fixed box was touched where no swap was asked (lifted, or chosen first): the screen says so. */
  onFixed?: (place: number) => void;
  /** Solved (the engine's end): every box's gold frame flashes once. */
  solved?: boolean;
  /** "Tap a box, then another" for everyone (D78a); a screen reader's activate works either way. */
  tapSwap?: boolean;
  /** The board's label for a screen reader. */
  label: string;
  testID?: string;
}

/** A drop that was asked about: the held box's last spot, until its swap or its refusal comes back. */
interface Dropped {
  id: number;
  from: number;
  x: number;
  y: number;
}

/** What the tiles read when their place changes: where the held box was dropped, and which box moved first. */
interface SwapMotion {
  dropped: RefObject<Dropped | null>;
  mover: RefObject<number | null>;
}

interface DragValues {
  /** The id of the box being dragged, or −1. */
  held: SharedValue<number>;
  dx: SharedValue<number>;
  dy: SharedValue<number>;
  /** 0 → 1 as the held box lifts (full motion only). */
  lift: SharedValue<number>;
  /** The solved frame's opacity (full motion). */
  glow: SharedValue<number>;
}

/** A refused or unanswered drop waits this long past the slower swap before its box goes home anyway. */
const SETTLE_SLACK_MS = 200;
/** How long the held box takes to lift (motion.md `level.puzzle.lift`). */
const LIFT_MS = motion.duration.tapFeedbackMax;

const NONE = -1;

export function PuzzleBoard({
  grid,
  slots,
  conflicts,
  width,
  enabled,
  onSwap,
  refusal = null,
  onFixed,
  solved = false,
  tapSwap = LEVEL_UI.puzzleTapSwap,
  label,
  testID = 'puzzle-board',
}: PuzzleBoardProps) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const geom = useMemo(() => puzzleGeometry(width), [width]);

  // ---- what the board shows of the player's hand (never of the game) ----
  const [selected, setSelected] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [heldId, setHeldId] = useState<number | null>(null);
  const [topId, setTopId] = useState<number | null>(null);
  /** By place: how many times its fixed box was touched in vain (each one shakes its lock again). */
  const [deniedAt, setDeniedAt] = useState<readonly number[]>(() =>
    Array<number>(PUZZLE_PLACE_COUNT).fill(0),
  );
  /** Counts the lifts, so a box put down late never drops one lifted since. */
  const lifts = useRef(0);

  const held = useSharedValue(NONE);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lift = useSharedValue(0);
  const glow = useSharedValue(0);
  const hoverAt = useSharedValue(NONE);
  /** By place: the box there does not move (fixed, or locked home), and its id. Read by the drag's worklets. */
  const lockedAt = useSharedValue<boolean[]>(slots.map((s) => s.state !== 'movable'));
  const idAt = useSharedValue<number[]>(slots.map((s) => s.id));
  const drag = useMemo<DragValues>(() => ({ held, dx, dy, lift, glow }), [held, dx, dy, lift, glow]);

  const dropped = useRef<Dropped | null>(null);
  const mover = useRef<number | null>(null);
  const swapMotion = useMemo<SwapMotion>(() => ({ dropped, mover }), []);

  // ---- this board's timers, cancelled when it goes ----
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  /** The held box goes home: its offset back to nothing (instant with Reduced Motion), then it is put down. */
  const goHome = useCallback(() => {
    dropped.current = null;
    setDragFrom(null);
    setHover(null);
    // Put down only if no box was lifted meanwhile.
    const lift0 = lifts.current;
    const putDown = () => {
      if (lifts.current !== lift0) return;
      held.set(NONE);
      setHeldId(null);
    };
    if (reduce) {
      dx.set(0);
      dy.set(0);
      lift.set(0);
      putDown();
      return;
    }
    const home = timing(PUZZLE_UI.homeMs, 'emphasized', false);
    dx.set(withTiming(0, home));
    dy.set(withTiming(0, home));
    lift.set(withTiming(0, timing(PUZZLE_UI.homeMs, 'exit', false)));
    later(PUZZLE_UI.homeMs, putDown);
  }, [reduce, dx, dy, lift, held, later]);

  /** A fixed box was touched: the cue, its lock shakes (or its frame lights), and the screen may say why. */
  const deny = useCallback((place: number) => {
    cue('cellDenied');
    setDeniedAt((counts) => counts.map((n, p) => (p === place ? n + 1 : n)));
  }, []);

  // The engine's answer to a drop: a swap moves the dropped box's tile (it starts where it was let go, in its
  // own layout effect, before this one), so the drag is over; the worklets read the places afresh.
  useLayoutEffect(() => {
    lockedAt.set(slots.map((s) => s.state !== 'movable'));
    idAt.set(slots.map((s) => s.id));
    const d = dropped.current;
    if (d && slots[d.from]?.id !== d.id) {
      dropped.current = null;
      held.set(NONE);
      dx.set(0);
      dy.set(0);
      lift.set(0);
      setHeldId(null);
    }
  }, [slots, lockedAt, idAt, held, dx, dy, lift]);

  // A refused swap: the box goes home, and a fixed box among the two shakes its lock.
  const seenRefusal = useRef(refusal?.key ?? null);
  const latestSlots = useRef(slots);
  useLayoutEffect(() => {
    latestSlots.current = slots;
  });
  useEffect(() => {
    if (!refusal || refusal.key === seenRefusal.current) return;
    seenRefusal.current = refusal.key;
    const fixed = [refusal.to, refusal.from].find(
      (p) => latestSlots.current[p] !== undefined && latestSlots.current[p]!.state !== 'movable',
    );
    if (fixed !== undefined) deny(fixed);
    else cue('cellDenied');
    if (dropped.current) goHome();
  }, [refusal, deny, goHome]);

  // Solved: the gold frames flash once (full motion), or hold still for a moment (Reduced Motion).
  const [stillGold, setStillGold] = useState(false);
  useEffect(() => {
    if (!solved) return;
    if (reduce) {
      const on = setTimeout(() => setStillGold(true), 0);
      const off = setTimeout(() => setStillGold(false), PUZZLE_UI.solvedReducedMs);
      return () => {
        clearTimeout(on);
        clearTimeout(off);
      };
    }
    const half = PUZZLE_UI.solvedFlashMs / 2;
    glow.set(
      withSequence(
        withTiming(1, timing(half, 'standard', false)),
        withTiming(0, timing(half, 'exit', false)),
      ),
    );
  }, [solved, reduce, glow]);

  // ---- the moves (on the JS thread; the drag's worklets call them) ----
  const latest = useRef({ slots, enabled, selected, reduce, geom, onSwap, onFixed });
  useLayoutEffect(() => {
    latest.current = { slots, enabled, selected, reduce, geom, onSwap, onFixed };
  });

  /** Ask for a swap; an answer that never comes (a host that is gone) still lets the box go home. */
  const ask = useCallback(
    (from: number, to: number) => {
      try {
        latest.current.onSwap(from, to);
      } finally {
        later(Math.max(PUZZLE_UI.swapMs, PUZZLE_UI.swapOtherMs) + SETTLE_SLACK_MS, () => {
          const d = dropped.current;
          if (d && latest.current.slots[d.from]?.id === d.id) goHome();
        });
      }
    },
    [later, goHome],
  );

  const onLift = useCallback(
    (place: number, id: number) => {
      lifts.current += 1;
      setSelected(null);
      setDragFrom(place);
      setHeldId(id);
      setTopId(id);
      if (!latest.current.reduce) lift.set(withTiming(1, timing(LIFT_MS, 'emphasized', false)));
      cue('cellSelect');
    },
    [lift],
  );

  const onTouchFixed = useCallback(
    (place: number) => {
      deny(place);
      latest.current.onFixed?.(place);
    },
    [deny],
  );

  const onHover = useCallback((place: number) => setHover(place === NONE ? null : place), []);

  const onDrop = useCallback(
    (from: number, to: number, offX: number, offY: number) => {
      const { slots: now, enabled: on, geom: g } = latest.current;
      const id = now[from]?.id;
      setDragFrom(null);
      setHover(null);
      if (id === undefined || to === NONE || to === from || !on) {
        goHome();
        return;
      }
      const o = slotOrigin(g, from);
      dropped.current = { id, from, x: o.x + offX, y: o.y + offY };
      mover.current = id;
      ask(from, to);
    },
    [goHome, ask],
  );

  /** A tap or a screen reader's activate on a place: choose it, swap with the chosen one, or let it go. */
  const press = useCallback(
    (place: number) => {
      const { slots: now, enabled: on, selected: chosen } = latest.current;
      const slot = now[place];
      if (!on || !slot) return;
      const movable = slot.state === 'movable';
      if (chosen === null) {
        if (!movable) {
          onTouchFixed(place);
          return;
        }
        setSelected(place);
        setTopId(slot.id);
        cue('cellSelect');
        return;
      }
      if (chosen === place) {
        setSelected(null);
        return;
      }
      // The engine judges a fixed box too ('boxFixed'): the choice stays, so another box can be tried.
      if (movable) setSelected(null);
      mover.current = now[chosen]?.id ?? null;
      dropped.current = null;
      ask(chosen, place);
    },
    [onTouchFixed, ask],
  );

  const onTapAt = useCallback(
    (x: number, y: number) => {
      const place = placeAt(latest.current.geom, x, y);
      if (place !== null) press(place);
    },
    [press],
  );

  const conflictSet = useMemo(() => new Set(conflicts ?? []), [conflicts]);

  return (
    <PuzzleGestures
      geom={geom}
      enabled={enabled}
      tapSwap={tapSwap}
      lockedAt={lockedAt}
      idAt={idAt}
      drag={drag}
      hoverAt={hoverAt}
      onTouchFixed={onTouchFixed}
      onLift={onLift}
      onHover={onHover}
      onDrop={onDrop}
      onTapAt={onTapAt}
    >
      <View
        style={[styles.board, { width, height: width, borderRadius: radius.board }]}
        role="grid"
        accessibilityLabel={label}
        testID={testID}
      >
        {/* The wells: under each place, a hole while its box is lifted from it. */}
        {Array.from({ length: PUZZLE_PLACE_COUNT }, (_, place) => {
          const o = slotOrigin(geom, place);
          const hole = dragFrom === place;
          return (
            <View
              key={`well-${place}`}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.well,
                { left: o.x, top: o.y, width: geom.slot, height: geom.slot },
                hole ? styles.hole : null,
              ]}
              testID={hole ? 'puzzle-hole' : undefined}
            />
          );
        })}
        {slots.map((slot, place) => {
          const movable = slot.state === 'movable';
          const chosen = selected === place;
          const state = chosen ? 'selected' : movable ? 'movable' : 'fixed';
          const rows = boxRows(grid, place).join(t('board:separator.list'));
          return (
            <PuzzleTile
              key={slot.id}
              id={slot.id}
              place={place}
              movable={movable}
              digits={boxCellsAt(place).map((c) => grid[c] ?? 0)}
              conflicts={boxCellsAt(place).map((c) => conflictSet.has(c))}
              geom={geom}
              drag={drag}
              swapMotion={swapMotion}
              reduce={reduce}
              held={heldId === slot.id}
              top={topId === slot.id || heldId === slot.id}
              chosen={chosen}
              target={hover === place && movable && heldId !== null && heldId !== slot.id}
              lockHot={hover === place && !movable && heldId !== null}
              deniedKey={deniedAt[place] ?? 0}
              stillGold={stillGold}
              label={t('hud.puzzle.slotLabel', {
                n: place + 1,
                state: t(`hud.puzzle.state.${state}`),
                rows,
              })}
              hint={movable ? t('hud.puzzle.slotHint') : undefined}
              enabled={enabled}
              onActivate={press}
            />
          );
        })}
      </View>
    </PuzzleGestures>
  );
}

interface PuzzleGesturesProps {
  geom: PuzzleGeometry;
  enabled: boolean;
  tapSwap: boolean;
  /** By place: the box there does not move, and its id. */
  lockedAt: SharedValue<boolean[]>;
  idAt: SharedValue<number[]>;
  drag: DragValues;
  /** The place under the held box's finger, or −1. */
  hoverAt: SharedValue<number>;
  onTouchFixed: (place: number) => void;
  onLift: (place: number, id: number) => void;
  onHover: (place: number) => void;
  onDrop: (from: number, to: number, dx: number, dy: number) => void;
  onTapAt: (x: number, y: number) => void;
  children: ReactNode;
}

/**
 * One gesture detector on the whole board (levels-ui.md §4.3): a drag (Pan, after PUZZLE_UI.dragMinDistance)
 * before a tap, exclusive. The held box follows the finger on the UI thread; which place is under it comes from
 * the board's geometry alone (LTR), and the board hears of a lift, a new place under the finger and the drop.
 */
function PuzzleGestures({
  geom,
  enabled,
  tapSwap,
  lockedAt,
  idAt,
  drag,
  hoverAt,
  onTouchFixed,
  onLift,
  onHover,
  onDrop,
  onTapAt,
  children,
}: PuzzleGesturesProps) {
  const { held, dx, dy } = drag;
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(PUZZLE_UI.dragMinDistance)
      // One finger only: with a second one, Android's x/y is the fingers' average while the translation follows
      // the last finger, so the target (and the drop) would not be the box under the tile. A second finger
      // cancels the drag instead (onEnd without success): the box goes home, and no swap is asked.
      .maxPointers(1)
      .enabled(enabled)
      .withTestId('puzzle-drag')
      .onStart((e) => {
        'worklet';
        // Where the finger went down (the drag starts a few dp later).
        const place = placeAt(geom, e.x - e.translationX, e.y - e.translationY);
        if (place === null) return;
        if (lockedAt.get()[place]) {
          scheduleOnRN(onTouchFixed, place);
          return;
        }
        const id = idAt.get()[place] ?? NONE;
        held.set(id);
        dx.set(e.translationX);
        dy.set(e.translationY);
        hoverAt.set(NONE);
        scheduleOnRN(onLift, place, id);
      })
      .onUpdate((e) => {
        'worklet';
        if (held.get() === NONE) return;
        dx.set(e.translationX);
        dy.set(e.translationY);
        const over = placeAt(geom, e.x, e.y) ?? NONE;
        if (over !== hoverAt.get()) {
          hoverAt.set(over);
          scheduleOnRN(onHover, over);
        }
      })
      .onEnd((e, success) => {
        'worklet';
        const id = held.get();
        if (id === NONE) return;
        const from = idAt.get().indexOf(id);
        const to = success ? (placeAt(geom, e.x, e.y) ?? NONE) : NONE;
        hoverAt.set(NONE);
        scheduleOnRN(onDrop, from, to, e.translationX, e.translationY);
      });
    const tap = Gesture.Tap()
      .enabled(enabled && tapSwap)
      .withTestId('puzzle-tap')
      .onEnd((e, success) => {
        'worklet';
        if (success) scheduleOnRN(onTapAt, e.x, e.y);
      });
    return Gesture.Exclusive(pan, tap);
  }, [
    enabled,
    tapSwap,
    geom,
    lockedAt,
    idAt,
    held,
    dx,
    dy,
    hoverAt,
    onTouchFixed,
    onLift,
    onHover,
    onDrop,
    onTapAt,
  ]);
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

interface PuzzleTileProps {
  id: number;
  place: number;
  movable: boolean;
  /** The box's nine digits, row by row. */
  digits: readonly number[];
  conflicts: readonly boolean[];
  geom: PuzzleGeometry;
  drag: DragValues;
  swapMotion: SwapMotion;
  reduce: boolean;
  held: boolean;
  /** Drawn over the others (held, or the last to move). */
  top: boolean;
  chosen: boolean;
  /** The held box is over this one: the gold frame. */
  target: boolean;
  /** The held box is over this fixed one: its lock turns red. */
  lockHot: boolean;
  /** Bumped on each denied touch of this (fixed) box. */
  deniedKey: number;
  stillGold: boolean;
  label: string;
  hint?: string;
  enabled: boolean;
  onActivate: (place: number) => void;
}

const ACTIONS = [{ name: 'activate' as const }];

/** One box, by its id: it slides from place to place rather than jumping (motion.md `level.puzzle.swap`). */
const PuzzleTile = memo(function PuzzleTile({
  id,
  place,
  movable,
  digits,
  conflicts,
  geom,
  drag,
  swapMotion,
  reduce,
  held,
  top,
  chosen,
  target,
  lockHot,
  deniedKey,
  stillGold,
  label,
  hint,
  enabled,
  onActivate,
}: PuzzleTileProps) {
  const start = slotOrigin(geom, place);
  const x = useSharedValue(start.x);
  const y = useSharedValue(start.y);
  const was = useRef(place);
  useLayoutEffect(() => {
    const to = slotOrigin(geom, place);
    const moved = was.current !== place;
    was.current = place;
    // The held box starts where it was let go (the board ends the drag right after this).
    const d = swapMotion.dropped.current;
    if (moved && d?.id === id) {
      x.set(d.x);
      y.set(d.y);
    }
    if (!moved || reduce) {
      x.set(to.x);
      y.set(to.y);
      return;
    }
    const ms = swapMotion.mover.current === id ? PUZZLE_UI.swapMs : PUZZLE_UI.swapOtherMs;
    const slide = timing(ms, 'emphasized', false);
    x.set(withTiming(to.x, slide));
    y.set(withTiming(to.y, slide));
  }, [place, geom, reduce, id, swapMotion, x, y]);

  const { held: heldId, dx, dy, lift, glow } = drag;
  const liftScale = PUZZLE_UI.liftScale;
  const moveStyle = useAnimatedStyle(() => {
    const mine = heldId.get() === id;
    const scale = mine && !reduce ? 1 + (liftScale - 1) * lift.get() : 1;
    return {
      transform: [
        { translateX: x.get() + (mine ? dx.get() : 0) },
        { translateY: y.get() + (mine ? dy.get() : 0) },
        { scale },
      ],
    };
  }, [id, reduce]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.get() }));

  // A denied touch: the lock shakes (full motion) or its frame lights for a moment (Reduced Motion).
  const lockX = useSharedValue(0);
  const [litKey, setLitKey] = useState(deniedKey);
  const lockLit = reduce && deniedKey !== litKey;
  const seenDenied = useRef(deniedKey);
  useEffect(() => {
    if (deniedKey === seenDenied.current) return;
    seenDenied.current = deniedKey;
    if (!reduce) {
      lockX.set(0);
      lockX.set(shake());
    }
    // The lit frame (Reduced Motion) goes out after a moment; with full motion it is never lit.
    const timer = setTimeout(() => setLitKey(deniedKey), reduce ? PUZZLE_UI.deniedReducedMs : 0);
    return () => clearTimeout(timer);
  }, [deniedKey, reduce, lockX]);
  const lockStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lockX.get() }] }));

  const cell = geom.slot / 3;
  const fontSize = (text('digitCell').fontSize ?? 22) * (cell / size.boardCell);
  const lockSize = Math.round(16 * Math.min(1, cell / size.boardCell));
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'activate') onActivate(place);
  };

  return (
    <Animated.View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: chosen, disabled: !enabled }}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={onAction}
      style={[
        styles.tile,
        { width: geom.slot, height: geom.slot, zIndex: top ? 2 : 1 },
        held && !reduce ? styles.lifted : null,
        moveStyle,
      ]}
      testID={`puzzle-slot-${place}`}
    >
      {movable ? <View style={[StyleSheet.absoluteFill, styles.edge]} /> : null}
      <View
        style={[styles.face, movable ? styles.raised : null]}
        testID={`puzzle-box-${id}-${movable ? 'movable' : 'fixed'}`}
      >
        {[0, 1, 2].map((r) => (
          <View key={r} style={styles.row}>
            {[0, 1, 2].map((c) => {
              const k = r * 3 + c;
              const d = digits[k] ?? 0;
              return (
                <View
                  key={c}
                  style={[styles.cell, movable ? styles.cellMovable : styles.cellFixed]}
                  testID={`puzzle-cell-${place}-${k}`}
                >
                  <Text
                    style={[
                      styles.digit,
                      { fontSize, lineHeight: fontSize },
                      conflicts[k] ? styles.conflict : null,
                    ]}
                    testID={conflicts[k] ? `puzzle-conflict-${place}-${k}` : undefined}
                  >
                    {d > 0 ? d : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {movable ? null : (
        <Animated.View
          style={[puzzleMarkStyles.lock, lockLit ? styles.lockLit : null, lockStyle]}
          testID={`puzzle-lock-${place}${lockHot ? '-hot' : ''}${lockLit ? '-lit' : ''}`}
        >
          <Icon
            name="lock"
            size={lockSize}
            color={lockHot || lockLit ? color.board.wrongDigit : color.board.given}
          />
        </Animated.View>
      )}
      {target ? <GoldFrame testID={`puzzle-target-${place}`} /> : null}
      {held || chosen ? <MeFrame testID={held ? 'puzzle-held' : `puzzle-selected-${place}`} /> : null}
      {stillGold ? (
        <GoldFrame testID={`puzzle-solved-${place}`} />
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, glowStyle]} pointerEvents="none">
          <GoldFrame />
        </Animated.View>
      )}
    </Animated.View>
  );
});

const TILE_RADIUS = radius.xs;

const styles = StyleSheet.create({
  // The board is LTR whatever the app's direction (CLAUDE.md): place 0 at the top-left.
  board: { direction: 'ltr', backgroundColor: color.board.boxGap },
  well: { position: 'absolute', borderRadius: TILE_RADIUS },
  hole: {
    borderWidth: tokens.border.focus,
    borderStyle: 'dashed',
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  tile: { position: 'absolute', left: 0, top: 0, borderRadius: TILE_RADIUS },
  lifted: { shadowColor: color.board.frame, shadowOpacity: 0.5, shadowRadius: 8, elevation: 8 },
  edge: { backgroundColor: color.board.grid, borderRadius: TILE_RADIUS },
  face: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: TILE_RADIUS,
    overflow: 'hidden',
    gap: tokens.border.grid,
    backgroundColor: color.board.grid,
  },
  // A moving box stands on its 2 dp edge (a tile's thickness); a fixed one lies flat.
  raised: { bottom: tokens.border.focus },
  row: { flex: 1, flexDirection: 'row', gap: tokens.border.grid },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cellMovable: { backgroundColor: color.board.focusCell },
  cellFixed: { backgroundColor: color.board.outCell },
  digit: { ...text('digitCell'), color: color.board.given, writingDirection: 'ltr' },
  conflict: { color: color.board.wrongDigit },
  lockLit: { borderColor: color.board.wrongDigit },
});
