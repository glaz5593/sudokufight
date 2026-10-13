/**
 * Where a piece of our markup paints, in canvas units: native.ts gives each layer of a moving avatar a bitmap
 * just this big, not one twice the tile's side.
 *
 * Never too small, sometimes a little too big:
 * - a Bézier curve counts its control points (the curve stays inside their hull);
 * - an arc counts its whole ellipse;
 * - a stroke reaches out on every side as far as a miter join can (twice its width, at the default limit 4),
 *   or half its width with round joins and caps;
 * - a transformed shape counts the four corners of its own box.
 *
 * It reads what the avatars are drawn with: <g>, <path>, <circle>, <ellipse>, <rect>, <line>, <polyline> and
 * <polygon>, the `transform` functions of SVG, and `stroke`, `stroke-width`, `stroke-linejoin` and
 * `stroke-linecap` on a shape or a group around it. Anything else (a <text>, an <image>, a nested <svg>) makes
 * the result `known: false`: the caller then keeps a box big enough for anything.
 */

/** Left, top, right and bottom, in canvas units. */
export interface Extents {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MarkupBounds {
  /** Where it paints; null if it paints nothing. */
  extents: Extents | null;
  /** False if it holds something this can't measure (then `extents` covers only the rest). */
  known: boolean;
}

/** An affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (as SVG's matrix()). */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m · n: n first, then m. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const numbers = (s: string): number[] => (s.match(NUMBER) ?? []).map(Number);

/** An SVG `transform` list as one matrix. Null if it holds a function this does not know. */
export function parseTransform(list: string): Matrix | null {
  let m: Matrix = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let rest = list;
  for (const [all, name, args] of list.matchAll(re)) {
    rest = rest.replace(all, '');
    const v = numbers(args ?? '');
    const deg = (i: number) => ((v[i] ?? 0) * Math.PI) / 180;
    let t: Matrix;
    switch (name) {
      case 'matrix':
        if (v.length !== 6) return null;
        t = [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!];
        break;
      case 'translate':
        t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case 'scale':
        t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const [cos, sin] = [Math.cos(deg(0)), Math.sin(deg(0))];
        const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
        // translate(cx cy) rotate(a) translate(−cx −cy)
        t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(deg(0)), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(deg(0)), 0, 1, 0, 0];
        break;
      default:
        return null;
    }
    m = multiply(m, t);
  }
  return rest.replace(/[\s,]/g, '') === '' ? m : null;
}

/** A box that grows to hold every point added to it. */
class Box {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;

  add(x: number, y: number): void {
    if (x < this.x0) this.x0 = x;
    if (y < this.y0) this.y0 = y;
    if (x > this.x1) this.x1 = x;
    if (y > this.y1) this.y1 = y;
  }

  get empty(): boolean {
    return this.x0 > this.x1;
  }
}

/**
 * The extents of a path's `d` in its own units: every point it passes, every control point, every arc's whole
 * ellipse. Null if `d` can't be read.
 */
export function pathExtents(d: string): Extents | null {
  const box = new Box();
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  if (tokens.join('').length !== d.replace(/[\s,]/g, '').length) return null;
  let i = 0;
  let cmd = '';
  let [x, y] = [0, 0];
  let [sx, sy] = [0, 0];
  // The last control point, for S and T (null: none to reflect).
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  const isNumber = (t: string | undefined) => t !== undefined && !/^[a-zA-Z]$/.test(t);
  const num = (): number => {
    const t = tokens[i++];
    if (!isNumber(t)) throw new Error('number expected');
    return Number(t);
  };
  /** An arc flag: 0 or 1, possibly run into the next number ("a5 5 0 0110 0"). */
  const flag = (): number => {
    const t = tokens[i];
    if (t === undefined || !/^[01]/.test(t)) throw new Error('flag expected');
    if (t.length === 1) {
      i++;
      return Number(t);
    }
    tokens[i] = t.slice(1);
    return Number(t[0]);
  };
  try {
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (/^[a-zA-Z]$/.test(t)) {
        cmd = t;
        i++;
        if (cmd === 'Z' || cmd === 'z') {
          [x, y] = [sx, sy];
          lastC = lastQ = null;
          continue;
        }
      } else if (cmd === '' || cmd === 'Z' || cmd === 'z') return null;
      const rel = cmd === cmd.toLowerCase();
      const [ox, oy] = rel ? [x, y] : [0, 0];
      switch (cmd.toUpperCase()) {
        case 'M': {
          [x, y] = [ox + num(), oy + num()];
          [sx, sy] = [x, y];
          box.add(x, y);
          // More pairs after a moveto are linetos.
          cmd = rel ? 'l' : 'L';
          lastC = lastQ = null;
          break;
        }
        case 'L':
          [x, y] = [ox + num(), oy + num()];
          box.add(x, y);
          lastC = lastQ = null;
          break;
        case 'H':
          x = (rel ? x : 0) + num();
          box.add(x, y);
          lastC = lastQ = null;
          break;
        case 'V':
          y = (rel ? y : 0) + num();
          box.add(x, y);
          lastC = lastQ = null;
          break;
        case 'C': {
          const c1: [number, number] = [ox + num(), oy + num()];
          const c2: [number, number] = [ox + num(), oy + num()];
          [x, y] = [ox + num(), oy + num()];
          box.add(...c1);
          box.add(...c2);
          box.add(x, y);
          lastC = c2;
          lastQ = null;
          break;
        }
        case 'S': {
          const c1: [number, number] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
          const c2: [number, number] = [ox + num(), oy + num()];
          [x, y] = [ox + num(), oy + num()];
          box.add(...c1);
          box.add(...c2);
          box.add(x, y);
          lastC = c2;
          lastQ = null;
          break;
        }
        case 'Q': {
          const c: [number, number] = [ox + num(), oy + num()];
          [x, y] = [ox + num(), oy + num()];
          box.add(...c);
          box.add(x, y);
          lastQ = c;
          lastC = null;
          break;
        }
        case 'T': {
          const c: [number, number] = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
          [x, y] = [ox + num(), oy + num()];
          box.add(...c);
          box.add(x, y);
          lastQ = c;
          lastC = null;
          break;
        }
        case 'A': {
          const [rx, ry, phi] = [num(), num(), num()];
          const [large, sweep] = [flag(), flag()];
          const [x2, y2] = [ox + num(), oy + num()];
          arcExtents(box, x, y, rx, ry, phi, large !== sweep, x2, y2);
          [x, y] = [x2, y2];
          lastC = lastQ = null;
          break;
        }
        default:
          return null;
      }
    }
  } catch {
    return null;
  }
  return box.empty ? null : { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
}

/**
 * An arc's whole ellipse (SVG's endpoint-to-centre conversion, radii grown when they are too small), or the
 * straight line it is with a radius of 0. `plusCentre`: the large-arc and sweep flags differ.
 */
function arcExtents(
  box: Box,
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  plusCentre: boolean,
  x2: number,
  y2: number,
): void {
  // The same point: nothing is drawn.
  if (x1 === x2 && y1 === y2) return;
  box.add(x1, y1);
  box.add(x2, y2);
  let [rx, ry] = [Math.abs(rxIn), Math.abs(ryIn)];
  if (rx === 0 || ry === 0) return;
  const phi = (phiDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const [dx, dy] = [(x1 - x2) / 2, (y1 - y2) / 2];
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den)) * (plusCentre ? 1 : -1);
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const hw = Math.hypot(rx * cos, ry * sin);
  const hh = Math.hypot(rx * sin, ry * cos);
  box.add(cx - hw, cy - hh);
  box.add(cx + hw, cy + hh);
}

/** The points of a <polyline> or <polygon>. */
function pointsExtents(points: string): Extents | null {
  const v = numbers(points);
  if (v.length < 2 || v.length % 2) return null;
  const box = new Box();
  for (let i = 0; i < v.length; i += 2) box.add(v[i]!, v[i + 1]!);
  return { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
}

/** What a group passes down to what it holds. */
interface Inherited {
  matrix: Matrix;
  stroke: string | undefined;
  width: number;
  join: string;
  cap: string;
}

const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
/** Elements that paint nothing themselves, and whose content paints only through what refers to it. */
const SILENT = new Set(['title', 'desc', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient']);

/** How far a stroke reaches past the outline (see the top of this file). */
function strokeReach(s: Inherited): number {
  if (!s.stroke || s.stroke === 'none' || !(s.width > 0)) return 0;
  if (s.join === 'round' || s.join === 'bevel') return (s.cap === 'square' ? Math.SQRT1_2 : 0.5) * s.width;
  return 2 * s.width;
}

/** A shape's extents in its own units, before its stroke and its transform. Null: none, or can't tell. */
function shapeExtents(name: string, a: Record<string, string>): Extents | null {
  const n = (k: string, fallback = 0) => {
    const v = a[k];
    return v === undefined ? fallback : Number(v);
  };
  switch (name) {
    case 'path':
      return pathExtents(a.d ?? '');
    case 'circle': {
      const r = n('r');
      return r > 0 ? { x0: n('cx') - r, y0: n('cy') - r, x1: n('cx') + r, y1: n('cy') + r } : null;
    }
    case 'ellipse': {
      const [rx, ry] = [n('rx'), n('ry')];
      return rx > 0 && ry > 0
        ? { x0: n('cx') - rx, y0: n('cy') - ry, x1: n('cx') + rx, y1: n('cy') + ry }
        : null;
    }
    case 'rect': {
      const [w, h] = [n('width'), n('height')];
      return w > 0 && h > 0 ? { x0: n('x'), y0: n('y'), x1: n('x') + w, y1: n('y') + h } : null;
    }
    case 'line':
      return {
        x0: Math.min(n('x1'), n('x2')),
        y0: Math.min(n('y1'), n('y2')),
        x1: Math.max(n('x1'), n('x2')),
        y1: Math.max(n('y1'), n('y2')),
      };
    default:
      return pointsExtents(a.points ?? '');
  }
}

/** Where `markup` (one or more elements, no <svg> around them) paints, in its own units. */
export function markupBounds(markup: string): MarkupBounds {
  const box = new Box();
  let known = true;
  const stack: Inherited[] = [{ matrix: IDENTITY, stroke: undefined, width: 1, join: 'miter', cap: 'butt' }];
  /** Depth inside an element whose content is not measured (a <text>, a <defs>…): its content is skipped. */
  let skip = 0;
  const tag =
    /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->/g;
  let tags = 0;
  for (const m of markup.matchAll(tag)) {
    tags++;
    const [, close, name, attrText, self] = m;
    if (name === undefined) continue; // a comment
    if (close) {
      if (skip > 0) skip--;
      else if (name === 'g') stack.pop();
      continue;
    }
    const open = !self;
    if (skip > 0) {
      if (open) skip++;
      continue;
    }
    const a: Record<string, string> = {};
    for (const [, k, v1, v2] of (attrText ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      if (k) a[k] = v1 ?? v2 ?? '';
    const parent = stack[stack.length - 1]!;
    const own = a.transform === undefined ? IDENTITY : parseTransform(a.transform);
    // A style may set a stroke's width (and our markup never has one).
    if (own === null || a.style !== undefined) {
      known = false;
      if (open) skip = 1;
      continue;
    }
    const here: Inherited = {
      matrix: multiply(parent.matrix, own),
      stroke: a.stroke ?? parent.stroke,
      width: a['stroke-width'] === undefined ? parent.width : Number(a['stroke-width']),
      join: a['stroke-linejoin'] ?? parent.join,
      cap: a['stroke-linecap'] ?? parent.cap,
    };
    if (name === 'g') {
      if (open) stack.push(here);
      continue;
    }
    if (SILENT.has(name)) {
      if (open) skip = 1;
      continue;
    }
    if (!SHAPES.has(name)) {
      known = false;
      if (open) skip = 1;
      continue;
    }
    if (open) skip = 1; // a shape's content (an <animate>, a <title>) paints nothing of its own here
    const e = shapeExtents(name, a);
    if (e === null) {
      // A path we can't read paints somewhere we can't see; a shape of size 0 paints nothing.
      if (name === 'path' && (a.d ?? '').trim() !== '') known = false;
      continue;
    }
    const r = strokeReach(here);
    const t = here.matrix;
    for (const [x, y] of [
      [e.x0 - r, e.y0 - r],
      [e.x1 + r, e.y0 - r],
      [e.x0 - r, e.y1 + r],
      [e.x1 + r, e.y1 + r],
    ] as const)
      box.add(t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]);
  }
  // A tag this did not read (malformed) may paint anywhere.
  if (tags !== (markup.match(/</g) ?? []).length) known = false;
  return { extents: box.empty ? null : { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }, known };
}
