import { type Extents, markupBounds, parseTransform, pathExtents } from './bounds';

/**
 * Where markup paints (bounds.ts): never too small, for everything the avatars are drawn with. The whole
 * catalog is measured in native.test.ts (every layer holds its drawing); here, each piece on its own.
 */

const box = (x0: number, y0: number, x1: number, y1: number): Extents => ({ x0, y0, x1, y1 });

function expectBox(got: Extents | null | undefined, want: Extents, digits = 6) {
  expect(got).toBeTruthy();
  if (!got) return;
  expect(got.x0).toBeCloseTo(want.x0, digits);
  expect(got.y0).toBeCloseTo(want.y0, digits);
  expect(got.x1).toBeCloseTo(want.x1, digits);
  expect(got.y1).toBeCloseTo(want.y1, digits);
}

/** `inner` inside `outer`. */
const holds = (outer: Extents, inner: Extents) =>
  outer.x0 <= inner.x0 + 1e-9 &&
  outer.y0 <= inner.y0 + 1e-9 &&
  outer.x1 >= inner.x1 - 1e-9 &&
  outer.y1 >= inner.y1 - 1e-9;

describe('shapes', () => {
  it('circle, ellipse, rect, line, polyline and polygon', () => {
    expectBox(markupBounds('<circle cx="50" cy="40" r="10"/>').extents, box(40, 30, 60, 50));
    expectBox(markupBounds('<ellipse cx="50" cy="40" rx="10" ry="4"/>').extents, box(40, 36, 60, 44));
    expectBox(markupBounds('<rect x="5" y="6" width="10" height="20" rx="3"/>').extents, box(5, 6, 15, 26));
    expectBox(markupBounds('<line x1="9" y1="2" x2="3" y2="8"/>').extents, box(3, 2, 9, 8));
    expectBox(markupBounds('<polygon points="1,2 9,4 5,12"/>').extents, box(1, 2, 9, 12));
    expectBox(markupBounds('<polyline points="1 2 9 4"/>').extents, box(1, 2, 9, 4));
  });

  it('nothing for shapes of size 0, and for no markup', () => {
    expect(markupBounds('')).toEqual({ extents: null, known: true });
    expect(markupBounds('<circle cx="5" cy="5" r="0"/><rect width="0" height="4"/>')).toEqual({
      extents: null,
      known: true,
    });
  });

  it('unions everything, at any depth of groups', () => {
    expectBox(
      markupBounds('<g><circle cx="0" cy="0" r="1"/><g><rect x="10" y="10" width="2" height="2"/></g></g>')
        .extents,
      box(-1, -1, 12, 12),
    );
  });
});

describe('strokes', () => {
  it('reach twice their width past the outline with miter joins (the default), half with round ones', () => {
    expectBox(
      markupBounds('<rect x="0" y="0" width="10" height="10" stroke="#000" stroke-width="2"/>').extents,
      box(-4, -4, 14, 14),
    );
    expectBox(
      markupBounds('<path d="M0 0L10 0" stroke="#000" stroke-width="2" stroke-linejoin="round"/>').extents,
      box(-1, -1, 11, 1),
    );
    expectBox(
      markupBounds(
        '<path d="M0 0L10 0" stroke="#000" stroke-width="2" stroke-linejoin="round" stroke-linecap="square"/>',
      ).extents,
      box(-Math.SQRT2, -Math.SQRT2, 10 + Math.SQRT2, Math.SQRT2),
    );
  });

  it('come from the groups around a shape; none and a width of 0 add nothing', () => {
    expectBox(
      markupBounds(
        '<g stroke="#000" stroke-width="1" stroke-linejoin="round"><circle cx="0" cy="0" r="2"/></g>',
      ).extents,
      box(-2.5, -2.5, 2.5, 2.5),
    );
    expectBox(
      markupBounds('<circle cx="0" cy="0" r="2" stroke="none" stroke-width="9"/>').extents,
      box(-2, -2, 2, 2),
    );
    expectBox(
      markupBounds('<g stroke="#000" stroke-width="0"><circle r="2"/></g>').extents,
      box(-2, -2, 2, 2),
    );
    // A width without a stroke paints nothing.
    expectBox(markupBounds('<circle r="2" stroke-width="9"/>').extents, box(-2, -2, 2, 2));
  });
});

describe('transforms', () => {
  it('reads every SVG transform function, in order', () => {
    const at = (t: string, x: number, y: number) => {
      const m = parseTransform(t)!;
      return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    };
    const near = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 9));
    near(at('translate(3 4)', 1, 1), [4, 5]);
    near(at('translate(3)', 1, 1), [4, 1]);
    near(at('scale(2)', 1, 3), [2, 6]);
    near(at('scale(2, -1)', 1, 3), [2, -3]);
    near(at('rotate(90)', 1, 0), [0, 1]);
    near(at('rotate(90 10 10)', 11, 10), [10, 11]);
    near(at('matrix(1 0 0 1 5 6)', 1, 1), [6, 7]);
    near(at('skewX(45)', 0, 2), [2, 2]);
    near(at('skewY(45)', 2, 0), [2, 2]);
    // translate, then rotate: the rotate applies first to the point
    near(at('translate(10 0) rotate(90)', 1, 0), [10, 1]);
    expect(parseTransform('wobble(3)')).toBeNull();
    expect(parseTransform('translate(1 2) junk')).toBeNull();
  });

  it("moves a shape's box: on the shape, on its groups, both", () => {
    expectBox(
      markupBounds('<circle cx="0" cy="0" r="1" transform="translate(5 5)"/>').extents,
      box(4, 4, 6, 6),
    );
    expectBox(
      markupBounds('<g transform="scale(2)"><circle cx="1" cy="1" r="1" transform="translate(1 0)"/></g>')
        .extents,
      box(2, 0, 6, 4),
    );
    // A turned box counts its corners (never too small).
    const turned = markupBounds('<rect x="-1" y="-1" width="2" height="2" transform="rotate(45)"/>').extents!;
    expectBox(turned, box(-Math.SQRT2, -Math.SQRT2, Math.SQRT2, Math.SQRT2));
    // A stroke turns and scales with its shape.
    expectBox(
      markupBounds(
        '<g transform="scale(3)"><path d="M0 0L1 0" stroke="#000" stroke-width="1" stroke-linejoin="round"/></g>',
      ).extents,
      box(-1.5, -1.5, 4.5, 1.5),
    );
  });
});

describe('paths', () => {
  it('lines, in absolute and relative commands, with implicit linetos after a moveto', () => {
    expectBox(pathExtents('M1 2L5 7H-3V10Z'), box(-3, 2, 5, 10));
    expectBox(pathExtents('m1 2l4 5h-8v3z'), box(-3, 2, 5, 10));
    expectBox(pathExtents('M0 0 10 0 10 10'), box(0, 0, 10, 10));
    expectBox(pathExtents('m0 0 10 0 0 10'), box(0, 0, 10, 10));
    // after a close, relative commands start again from the subpath's start
    expectBox(pathExtents('M5 5l10 0z l0 -20'), box(5, -15, 15, 5));
    expectBox(pathExtents('M1-2-3.5.5'), box(-3.5, -2, 1, 0.5));
  });

  it('curves count their control points (C, S, Q, T; relative too)', () => {
    expectBox(pathExtents('M0 0C0 -10 10 -10 10 0'), box(0, -10, 10, 0));
    expectBox(pathExtents('M0 0c0 -10 10 -10 10 0'), box(0, -10, 10, 0));
    // S reflects the last C's second control point
    expectBox(pathExtents('M0 0C0 -10 10 -10 10 0S20 10 20 0'), box(0, -10, 20, 10));
    expectBox(pathExtents('M0 0c0 -10 10 -10 10 0s10 10 10 0'), box(0, -10, 20, 10));
    expectBox(pathExtents('M0 0Q5 -10 10 0'), box(0, -10, 10, 0));
    // T reflects the last Q's control point
    expectBox(pathExtents('M0 0Q5 -10 10 0T20 0'), box(0, -10, 20, 10));
    expectBox(pathExtents('M0 0q5 -10 10 0t10 0'), box(0, -10, 20, 10));
  });

  it('arcs count their whole ellipse, centred by the flags, radii grown when too small', () => {
    // a half circle from (0, 0) to (10, 0), radius 5: the whole circle around (5, 0)
    expectBox(pathExtents('M0 0A5 5 0 0 1 10 0'), box(0, -5, 10, 5));
    expectBox(pathExtents('M0 0a5 5 0 0 1 10 0'), box(0, -5, 10, 5));
    // radius 1 is too small for a chord of 10: it grows to 5
    expectBox(pathExtents('M0 0A1 1 0 0 1 10 0'), box(0, -5, 10, 5));
    // a big radius on a short chord: the centre lies below or above it, by the flags (SVG's sign rule)
    const c = 10 * Math.cos(Math.PI / 6);
    expectBox(pathExtents('M0 0A10 10 0 0 1 10 0'), box(-5, c - 10, 15, c + 10));
    expectBox(pathExtents('M0 0A10 10 0 1 1 10 0'), box(-5, -c - 10, 15, -c + 10));
    // flags run together, as SVG allows
    expectBox(pathExtents('M0 0a5 5 0 0110 0'), box(0, -5, 10, 5));
    // a radius of 0 is a line; the same point draws nothing more
    expectBox(pathExtents('M0 0A0 5 0 0 1 10 2'), box(0, 0, 10, 2));
    expectBox(pathExtents('M3 3A5 5 0 0 1 3 3'), box(3, 3, 3, 3));
    // a turned ellipse
    expectBox(pathExtents('M0 0A10 2 90 0 1 0 20'), box(-2, 0, 2, 20));
  });

  it("can't read nonsense", () => {
    expect(pathExtents('M0 0L5')).toBeNull();
    expect(pathExtents('10 10')).toBeNull();
    expect(pathExtents('M0 0X5 5')).toBeNull();
    expect(pathExtents('M0 0A5 5 0 2 1 10 0')).toBeNull();
  });

  it('every point of a curve lies inside (sampled)', () => {
    const cubic = (p: number[][], t: number) =>
      [0, 1].map(
        (k) =>
          (1 - t) ** 3 * p[0]![k]! +
          3 * (1 - t) ** 2 * t * p[1]![k]! +
          3 * (1 - t) * t ** 2 * p[2]![k]! +
          t ** 3 * p[3]![k]!,
      );
    const p = [
      [3, 7],
      [-20, 40],
      [45, -12],
      [9, 2],
    ];
    const e = pathExtents(`M${p[0]!.join(' ')}C${p.slice(1).flat().join(' ')}`)!;
    for (let i = 0; i <= 100; i++) {
      const [x, y] = cubic(p, i / 100);
      expect(holds(e, box(x!, y!, x!, y!))).toBe(true);
    }
  });
});

describe('what it does not know', () => {
  it('says so, and measures the rest', () => {
    const r = markupBounds('<circle cx="0" cy="0" r="1"/><text x="9" y="9">A</text>');
    expect(r.known).toBe(false);
    expectBox(r.extents, box(-1, -1, 1, 1));
    expect(markupBounds('<image href="x.png" width="9" height="9"/>').known).toBe(false);
    expect(markupBounds('<circle r="1" transform="perspective(3)"/>').known).toBe(false);
    expect(markupBounds('<circle r="1" style="stroke-width:9"/>').known).toBe(false);
    expect(markupBounds('<path d="M0 0L5"/>').known).toBe(false);
    expect(markupBounds('<circle r="1"').known).toBe(false);
  });

  it('skips what paints nothing by itself', () => {
    const r = markupBounds(
      '<defs><clipPath id="c"><rect width="500" height="500"/></clipPath></defs><!-- a note --><circle r="1"/>',
    );
    expect(r.known).toBe(true);
    expectBox(r.extents, box(-1, -1, 1, 1));
  });
});
