import {
  Canvas,
  createPicture,
  Group,
  PaintStyle,
  Picture,
  Skia,
  type SkPicture,
  StrokeCap,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { type SharedValue, useDerivedValue } from 'react-native-reanimated';

import { SCRAMBLE } from './config';
import { hitAlpha } from './hitClock';
import {
  drawSegments,
  QUESTION,
  QUESTION_DOT,
  type ScrambleDraw,
  scrambleFrame,
  SEGMENTS,
} from './scrambleModel';

export interface ScrambleProps {
  /** The tiles, where the board draws them (scrambleDraws). */
  tiles: readonly ScrambleDraw[];
  /** The cells' own colours, by each tile's `background`: the tile hides the real digit on its cell. */
  backgrounds: readonly string[];
  /** The fake digits' colour: the sender's seat colour. */
  ink: string;
  /** A cell's side, dp (the glyph's size and stroke follow it). */
  cell: number;
  /** The board's side: the canvas. */
  width: number;
  height: number;
  elapsed: SharedValue<number>;
  totalMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Reduced motion: a still "?" on every filled cell, for the same 5 s. */
  reduce: boolean;
  testID?: string;
}

interface Look {
  backgrounds: readonly string[];
  ink: string;
  glyphW: number;
  glyphH: number;
  stroke: number;
}

/**
 * Records the tiles at `t` (or, `still`, the reduced-motion "?") into a picture. A worklet: the live version
 * calls it on every frame, from the hit's clock.
 */
function recordScramble(
  tiles: readonly ScrambleDraw[],
  look: Look,
  t: number,
  alpha: number,
  still: boolean,
  width: number,
  height: number,
): SkPicture {
  'worklet';
  return createPicture(
    (canvas) => {
      const fill = Skia.Paint();
      fill.setAntiAlias(true);
      const pen = Skia.Paint();
      pen.setAntiAlias(true);
      pen.setStyle(PaintStyle.Stroke);
      pen.setStrokeCap(StrokeCap.Round);
      pen.setStrokeWidth(look.stroke);
      pen.setColor(Skia.Color(look.ink));
      pen.setAlphaf(alpha);
      const colors = look.backgrounds.map((c) => Skia.Color(c));
      const dot = Skia.Paint();
      dot.setAntiAlias(true);
      dot.setColor(Skia.Color(look.ink));
      dot.setAlphaf(alpha);
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i]!;
        fill.setColor(colors[tile.background] ?? colors[0]!);
        fill.setAlphaf(alpha);
        canvas.drawRect(Skia.XYWHRect(tile.x, tile.y, tile.width, tile.height), fill);
        const gx = tile.x + (tile.width - look.glyphW) / 2;
        const gy = tile.y + (tile.height - look.glyphH) / 2;
        // The roll stays inside the tile.
        const top = tile.y + look.stroke / 2;
        const bottom = tile.y + tile.height - look.stroke / 2;
        if (still) {
          drawSegments(canvas, pen, QUESTION, gx, gy, look.glyphW, look.glyphH, top, bottom);
          canvas.drawCircle(
            gx + QUESTION_DOT.x * look.glyphW,
            gy + QUESTION_DOT.y * look.glyphH,
            look.stroke * 0.7,
            dot,
          );
          continue;
        }
        const f = scrambleFrame(tile, t, SCRAMBLE.stepMs, SCRAMBLE.rollMs);
        // The old digit leaves upward while the new one comes up from below (a slot machine's roll).
        const shift = (1 - f.p) * tile.height;
        if (f.from !== null) {
          const segs = SEGMENTS[f.from];
          drawSegments(canvas, pen, segs, gx, gy - f.p * tile.height, look.glyphW, look.glyphH, top, bottom);
        }
        drawSegments(canvas, pen, SEGMENTS[f.digit], gx, gy + shift, look.glyphW, look.glyphH, top, bottom);
      }
    },
    { width, height },
  );
}

/**
 * [D47] "מספרים מתערבלים" on the board (Moshe 2026-10-17): a tile over each filled cell's digit, rolling
 * through digits drawn as a segment display in the sender's colour (only some of them true at any moment).
 * One Skia picture over the board, recorded on the UI thread from the hit's clock; nothing re-renders per
 * frame. Never touchable: taps reach the board under it, and the board itself never changes.
 *
 * Reduced motion (spec §22): a still "?" on every filled cell, for the same 5 s (only the hit's fade).
 */
export function Scramble(props: ScrambleProps) {
  return props.reduce ? <ScrambleStill {...props} /> : <ScrambleLive {...props} />;
}

function useLook({ backgrounds, ink, cell }: ScrambleProps): Look {
  return useMemo<Look>(
    () => ({
      backgrounds,
      ink,
      glyphW: cell * SCRAMBLE.glyph.width,
      glyphH: cell * SCRAMBLE.glyph.height,
      stroke: Math.max(1.5, cell * SCRAMBLE.glyph.stroke),
    }),
    [backgrounds, ink, cell],
  );
}

function ScrambleLive(props: ScrambleProps) {
  const { tiles, width, height, elapsed, totalMs, fadeInMs, fadeOutMs, testID } = props;
  const look = useLook(props);
  const picture = useDerivedValue(() => {
    const t = elapsed.get();
    return recordScramble(tiles, look, t, hitAlpha(t, totalMs, fadeInMs, fadeOutMs), false, width, height);
  });
  return (
    <Canvas style={[styles.canvas, { width, height }]} pointerEvents="none" testID={testID ?? 'hit-scramble'}>
      <Picture picture={picture} />
    </Canvas>
  );
}

function ScrambleStill(props: ScrambleProps) {
  const { tiles, width, height, elapsed, totalMs, fadeInMs, fadeOutMs, testID } = props;
  const look = useLook(props);
  const picture = useMemo(
    () => recordScramble(tiles, look, 0, 1, true, width, height),
    [tiles, look, width, height],
  );
  // Only the fade moves: in over 200 ms, out over the last 240 ms before the end.
  const alpha = useDerivedValue(() => hitAlpha(elapsed.get(), totalMs, fadeInMs, fadeOutMs));
  return (
    <Canvas
      style={[styles.canvas, { width, height }]}
      pointerEvents="none"
      testID={testID ?? 'hit-scramble-still'}
    >
      <Group opacity={alpha}>
        <Picture picture={picture} />
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0 },
});
