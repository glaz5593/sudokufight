import type { Clock } from '@sudoku-fight/engine';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import type { CellModel } from '../../../components/board';
import { boardGeometry, cellRect, px } from '../../../components/board/geometry';
import {
  effectColors,
  HIT_DIM,
  HIT_DIM_COLOR,
  hitAlpha,
  Scramble,
  type ScrambleCell,
  scrambleDraws,
  scramblePlan,
  useHitClock,
} from '../../../components/interference';
import { color, tokens } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import { type HitInfo, hitSeedOf, isHitOn } from './hitModel';

export interface BoardHitLayerProps {
  /** The interference on me (hitOf(view, …)), or null. */
  hit: HitInfo | null;
  /** The game clock's time, as the screen last rendered it: the layer is gone once it reaches `endsAt`. */
  now: number;
  clock: Clock;
  /** The board's cells as the board draws them (boardModel): the scramble covers the filled ones. */
  cells: readonly CellModel[];
  /** The board's side, dp (the Board's `width`). */
  width: number;
  /** Defaults to the player's setting (useReduceMotion). */
  reduceMotion?: boolean;
  testID?: string;
}

/** The colours a tile can hide a digit on: the two cell colours, then the seats' tints (P1–P4). */
const BACKGROUNDS: readonly string[] = [
  color.board.cell,
  color.board.cellAlt,
  ...tokens.color.players.map((p) => p.tint),
];

/** The filled cells (given or solved; never a lock, a wait or a queued digit) as the scramble covers them. */
export function scrambleCellsOf(cells: readonly CellModel[]): ScrambleCell[] {
  return cells.flatMap((c) =>
    (c.kind === 'given' || c.kind === 'solved') && c.digit !== null
      ? [
          {
            cell: c.index,
            digit: c.digit,
            // The cell's own colour: a solver's tint (Cell.tsx), else the checkerboard's.
            background: c.kind === 'solved' && c.player ? 2 + c.player.colorIndex : c.alt ? 1 : 0,
          },
        ]
      : [],
  );
}

/**
 * The filled cells as one string, and back: the screen makes a new board model 4 times a second (the
 * countdown), and the scramble's plan is made again only when this string changes.
 */
export const cellsKey = (cells: readonly ScrambleCell[]): string =>
  cells.map((c) => `${c.cell}:${c.digit}:${c.background}`).join(',');

export const cellsOfKey = (key: string): ScrambleCell[] =>
  key
    ? key.split(',').map((part) => {
        const [cell, digit, background] = part.split(':').map(Number);
        return { cell: cell!, digit: digit as ScrambleCell['digit'], background: background! };
      })
    : [];

/**
 * What an interference does to the board itself, inside the board's slot (under the hit layer's effect and
 * banner; a warp tilts it with the board):
 *
 * - [D46] Every kind darkens the board (Moshe 2026-10-17): the solid scrim colour at HIT_DIM.opacity (0.6)
 *   over the board only, rounded like it, for the whole hit: in over 240 ms, out exactly at `endsAt`, from the
 *   hit's own clock (frozen with the game). Reduced motion: the same dim, only faded. Never a pulse.
 * - [D47] The scramble rolls the digits of the filled cells, under the dim (components/interference/Scramble).
 *
 * Only on the phone of the player who was hit. Never touchable (taps reach the board under it) and hidden from
 * screen readers: the hit layer says that the board is dimmed. A kind this app doesn't know still dims.
 */
export function BoardHitLayer({
  hit,
  now,
  clock,
  cells,
  width,
  reduceMotion,
  testID = 'board-hit',
}: BoardHitLayerProps) {
  const reducedSetting = useReduceMotion();
  const reduce = reduceMotion ?? reducedSetting;
  const shown = isHitOn(hit, now) ? hit : null;
  const elapsed = useHitClock(shown, clock);
  const totalMs = shown?.totalMs ?? 0;
  const fadeIn = reduce ? HIT_DIM.fadeInReducedMs : HIT_DIM.fadeInMs;
  const dimStyle = useAnimatedStyle(() => ({
    opacity: HIT_DIM.opacity * hitAlpha(elapsed.get(), totalMs, fadeIn, HIT_DIM.fadeOutMs),
  }));

  const g = useMemo(() => boardGeometry(width), [width]);
  const scrambling = shown?.kind === 'scramble';
  const key = scrambling ? cellsKey(scrambleCellsOf(cells)) : null;
  const seed = shown ? hitSeedOf(shown) : 0;
  // Made once per hit and board, not on every countdown tick.
  const tiles = useMemo(
    () =>
      key === null
        ? null
        : scrambleDraws(scramblePlan(cellsOfKey(key), seed, totalMs), (cell) => cellRect(g, cell)),
    [key, seed, totalMs, g],
  );
  const sender = effectColors(shown?.fromColorIndex ?? 1).sender;

  if (!shown) return null;

  return (
    <View
      style={styles.layer}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {tiles ? (
        <Scramble
          tiles={tiles}
          backgrounds={BACKGROUNDS}
          ink={sender}
          cell={g.cell}
          width={width}
          height={width}
          elapsed={elapsed}
          totalMs={totalMs}
          fadeInMs={fadeIn}
          fadeOutMs={HIT_DIM.fadeOutMs}
          reduce={reduce}
        />
      ) : null}
      <Animated.View
        style={[
          styles.dim,
          { backgroundColor: HIT_DIM_COLOR, borderRadius: px(g, tokens.radius.board) },
          dimStyle,
        ]}
        pointerEvents="none"
        testID="hit-dim"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Physical coordinates, like the board (always LTR).
  layer: { ...StyleSheet.absoluteFill, direction: 'ltr' },
  dim: StyleSheet.absoluteFill,
});
