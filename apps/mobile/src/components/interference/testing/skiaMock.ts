/* Test-only: a stand-in for @shopify/react-native-skia under Jest. */
import { createElement, Fragment, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

/**
 * Skia draws natively and its ESM build doesn't load under Jest, so tests replace it with this module:
 *
 *   jest.mock('@shopify/react-native-skia', () =>
 *     jest.requireActual('<path>/components/interference/testing/skiaMock').skiaModule);
 *
 * A Canvas becomes a plain View (with its testID and style), groups pass their children through, drawings
 * render nothing, and `createPicture` draws into a canvas that records the calls. A screen that mounts the
 * hit layer in its tests needs the same mock (or one line in jest.setup.ts).
 */

export interface DrawCall {
  op: string;
  args: unknown[];
}

/** A canvas that records every call made on it. */
export function recordingCanvas() {
  const calls: DrawCall[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  return {
    calls,
    drawLine: record('drawLine'),
    drawCircle: record('drawCircle'),
    drawPath: record('drawPath'),
    drawRect: record('drawRect'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
  };
}

/** A paint that remembers nothing. */
export function fakePaint() {
  const noop = () => {};
  return {
    setColor: noop,
    setAlphaf: noop,
    setStrokeWidth: noop,
    setStyle: noop,
    setStrokeCap: noop,
    setAntiAlias: noop,
  };
}

type Children = { children?: ReactNode };

function Canvas({ children, style, testID, pointerEvents }: ViewProps & Children) {
  return createElement(View, { style, testID, pointerEvents }, children);
}
function Through({ children }: Children) {
  return createElement(Fragment, null, children);
}
function Leaf() {
  return null;
}

export const skiaModule = {
  __esModule: true,
  Canvas,
  Group: Through,
  Path: Through,
  Circle: Leaf,
  Oval: Leaf,
  Rect: Leaf,
  RoundedRect: Leaf,
  Line: Leaf,
  Picture: Leaf,
  DashPathEffect: Leaf,
  vec: (x: number, y: number) => ({ x, y }),
  createPicture: (draw: (canvas: ReturnType<typeof recordingCanvas>) => void) => {
    const canvas = recordingCanvas();
    draw(canvas);
    return { calls: canvas.calls };
  },
  Skia: {
    Paint: fakePaint,
    Color: (c: string) => c,
    XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
  },
  PaintStyle: { Fill: 0, Stroke: 1 },
  StrokeCap: { Butt: 0, Round: 1, Square: 2 },
};
