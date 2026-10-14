// Reads glyph outlines from a TrueType font (a .ttf with a glyf table), for gen-icons.mjs: the icon's digits are
// drawn from the app's own font as plain paths, so the SVG and PNG files never need the font installed.
// Only what that takes: the table directory, head, maxp, cmap (formats 4 and 12), loca and glyf, simple and
// composite glyphs. No hinting, no variations. https://learn.microsoft.com/typography/opentype/spec/
import { readFileSync } from 'node:fs';

/**
 * A font's outlines. `glyph(char)` returns the character's path in font units (y grows UP, as in the font):
 * commands ['M', x, y], ['L', x, y], ['Q', cx, cy, x, y] and ['Z'], every contour closed.
 */
export function loadFont(path) {
  const buf = readFileSync(path);
  const tables = {};
  const count = buf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i;
    tables[buf.toString('ascii', at, at + 4)] = {
      offset: buf.readUInt32BE(at + 8),
      length: buf.readUInt32BE(at + 12),
    };
  }
  for (const name of ['head', 'maxp', 'cmap', 'loca', 'glyf']) {
    if (!tables[name]) throw new Error(`${path}: no ${name} table (a TrueType font is needed, not CFF)`);
  }
  const head = tables.head.offset;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const longLoca = buf.readInt16BE(head + 50) === 1;
  const numGlyphs = buf.readUInt16BE(tables.maxp.offset + 4);

  const locate = (index) => {
    const loca = tables.loca.offset;
    const start = longLoca ? buf.readUInt32BE(loca + index * 4) : buf.readUInt16BE(loca + index * 2) * 2;
    const end = longLoca
      ? buf.readUInt32BE(loca + index * 4 + 4)
      : buf.readUInt16BE(loca + index * 2 + 2) * 2;
    return { start: tables.glyf.offset + start, length: end - start };
  };

  const glyphIndex = cmapLookup(buf, tables.cmap.offset);

  /** The glyph's contours: arrays of { x, y, on } points, composites resolved. */
  function contours(index, depth = 0) {
    if (index >= numGlyphs) throw new Error(`glyph ${index} out of range`);
    const { start, length } = locate(index);
    if (length === 0) return [];
    const n = buf.readInt16BE(start);
    if (n >= 0) return simple(buf, start, n);
    if (depth > 8) throw new Error('composite glyphs nested too deep');
    return composite(buf, start, (i) => contours(i, depth + 1));
  }

  return {
    unitsPerEm,
    glyph(char) {
      const index = glyphIndex(char.codePointAt(0));
      if (!index) throw new Error(`${path}: no glyph for "${char}"`);
      return toPath(contours(index));
    },
  };
}

/** A code point → glyph index function, from the best Unicode subtable (format 12, else format 4). */
function cmapLookup(buf, cmap) {
  const subtables = buf.readUInt16BE(cmap + 2);
  let format4 = -1;
  let format12 = -1;
  for (let i = 0; i < subtables; i++) {
    const platform = buf.readUInt16BE(cmap + 4 + i * 8);
    const encoding = buf.readUInt16BE(cmap + 6 + i * 8);
    const offset = cmap + buf.readUInt32BE(cmap + 8 + i * 8);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = buf.readUInt16BE(offset);
    if (format === 12 && format12 < 0) format12 = offset;
    if (format === 4 && format4 < 0) format4 = offset;
  }
  if (format12 >= 0) {
    const groups = buf.readUInt32BE(format12 + 12);
    return (code) => {
      for (let g = 0; g < groups; g++) {
        const at = format12 + 16 + g * 12;
        const first = buf.readUInt32BE(at);
        const last = buf.readUInt32BE(at + 4);
        if (code >= first && code <= last) return buf.readUInt32BE(at + 8) + (code - first);
      }
      return 0;
    };
  }
  if (format4 < 0) throw new Error('no Unicode cmap subtable (format 4 or 12)');
  const segments = buf.readUInt16BE(format4 + 6) / 2;
  const ends = format4 + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  return (code) => {
    for (let s = 0; s < segments; s++) {
      if (code > buf.readUInt16BE(ends + s * 2)) continue;
      const first = buf.readUInt16BE(starts + s * 2);
      if (code < first) return 0;
      const delta = buf.readInt16BE(deltas + s * 2);
      const range = buf.readUInt16BE(ranges + s * 2);
      if (range === 0) return (code + delta) & 0xffff;
      const glyph = buf.readUInt16BE(ranges + s * 2 + range + (code - first) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

/** A simple glyph: end points, instructions (skipped), flags, then x and y deltas. */
function simple(buf, start, contourCount) {
  let at = start + 10;
  const ends = [];
  for (let i = 0; i < contourCount; i++, at += 2) ends.push(buf.readUInt16BE(at));
  const points = contourCount ? ends[contourCount - 1] + 1 : 0;
  at += 2 + buf.readUInt16BE(at);
  const flags = [];
  while (flags.length < points) {
    const flag = buf[at++];
    flags.push(flag);
    if (flag & 8) for (let r = buf[at++]; r > 0; r--) flags.push(flag);
  }
  const read = (short, same) => {
    const values = [];
    let v = 0;
    for (const flag of flags) {
      if (flag & short) {
        const d = buf[at++];
        v += flag & same ? d : -d;
      } else if (!(flag & same)) {
        v += buf.readInt16BE(at);
        at += 2;
      }
      values.push(v);
    }
    return values;
  };
  const xs = read(2, 16);
  const ys = read(4, 32);
  const out = [];
  let first = 0;
  for (const end of ends) {
    const contour = [];
    for (let p = first; p <= end; p++) contour.push({ x: xs[p], y: ys[p], on: (flags[p] & 1) === 1 });
    out.push(contour);
    first = end + 1;
  }
  return out;
}

/** A composite glyph: its components' contours, each moved (and scaled, when it says so). */
function composite(buf, start, resolve) {
  let at = start + 10;
  const out = [];
  for (;;) {
    const flags = buf.readUInt16BE(at);
    const index = buf.readUInt16BE(at + 2);
    at += 4;
    let dx;
    let dy;
    if (flags & 1) {
      dx = buf.readInt16BE(at);
      dy = buf.readInt16BE(at + 2);
      at += 4;
    } else {
      dx = buf.readInt8(at);
      dy = buf.readInt8(at + 1);
      at += 2;
    }
    if (!(flags & 2)) throw new Error('composite glyphs placed by point numbers are not supported');
    const f2dot14 = (o) => buf.readInt16BE(o) / 16384;
    let [a, b, c, d] = [1, 0, 0, 1];
    if (flags & 8) {
      a = d = f2dot14(at);
      at += 2;
    } else if (flags & 0x40) {
      a = f2dot14(at);
      d = f2dot14(at + 2);
      at += 4;
    } else if (flags & 0x80) {
      [a, b, c, d] = [f2dot14(at), f2dot14(at + 2), f2dot14(at + 4), f2dot14(at + 6)];
      at += 8;
    }
    for (const contour of resolve(index)) {
      out.push(contour.map((p) => ({ x: p.x * a + p.y * c + dx, y: p.x * b + p.y * d + dy, on: p.on })));
    }
    if (!(flags & 0x20)) return out;
  }
}

/** Contours of on- and off-curve points → path commands (two off-curve points imply an on-curve midpoint). */
function toPath(contours) {
  const cmds = [];
  for (const contour of contours) {
    if (contour.length === 0) continue;
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, on: true });
    // Start on an on-curve point (or the midpoint of the first two, when every point is off the curve).
    const firstOn = contour.findIndex((p) => p.on);
    const pts =
      firstOn >= 0
        ? [...contour.slice(firstOn), ...contour.slice(0, firstOn)]
        : [mid(contour[contour.length - 1], contour[0]), ...contour];
    cmds.push(['M', pts[0].x, pts[0].y]);
    let control = null;
    for (let i = 1; i <= pts.length; i++) {
      const p = pts[i % pts.length];
      if (p.on) {
        cmds.push(control ? ['Q', control.x, control.y, p.x, p.y] : ['L', p.x, p.y]);
        control = null;
      } else if (control) {
        const m = mid(control, p);
        cmds.push(['Q', control.x, control.y, m.x, m.y]);
        control = p;
      } else {
        control = p;
      }
    }
    // The closing L back to the start is redundant: Z draws it.
    const last = cmds[cmds.length - 1];
    if (last[0] === 'L' && last[1] === pts[0].x && last[2] === pts[0].y) cmds.pop();
    cmds.push(['Z']);
  }
  return cmds;
}
