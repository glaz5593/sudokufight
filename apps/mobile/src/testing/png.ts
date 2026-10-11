import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** A decoded PNG, for tests that check image files (appIcons.test.ts). */
export interface Png {
  width: number;
  height: number;
  /** PNG colour type: 0 grey, 2 RGB, 3 palette, 4 grey + alpha, 6 RGBA. */
  colorType: number;
  /** Whether the file can hold transparency at all: an alpha channel, or a tRNS chunk. */
  hasAlpha: boolean;
  /** [r, g, b, a] at (x, y), 0..255. */
  pixel(x: number, y: number): [number, number, number, number];
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Reads an 8-bit, non-interlaced PNG of any colour type (what image tools and gen-icons.mjs write). Anything
 * else throws, saying so: a store icon has no reason to be 16-bit or interlaced.
 */
export function readPng(path: string): Png {
  const file = readFileSync(path);
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${path}: not a PNG file`);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString('ascii', at + 4, at + 8);
    const data = file.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels = CHANNELS[colorType];
  if (bitDepth !== 8 || interlace !== 0 || channels === undefined) {
    throw new Error(
      `${path}: only 8-bit, non-interlaced PNGs (bit depth ${bitDepth}, interlace ${interlace})`,
    );
  }

  // Undo each row's filter (PNG spec, section 9).
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) throw new Error(`${path}: unknown filter ${filter} on row ${y}`);
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= channels ? data[row + i - channels]! : 0;
      const b = y > 0 ? data[row - stride + i]! : 0;
      const c = i >= channels && y > 0 ? data[row - stride + i - channels]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) predicted = paeth(a, b, c);
      data[row + i] = (x + predicted) & 255;
    }
  }

  /** A grey or RGB pixel whose samples are tRNS's key colour is transparent. */
  const keyed = (offset: number, count: number) => {
    if (trns === null || trns.length < count * 2) return false;
    for (let k = 0; k < count; k++) if (trns.readUInt16BE(k * 2) !== data[offset + k]) return false;
    return true;
  };
  const pixel = (x: number, y: number): [number, number, number, number] => {
    const o = (y * width + x) * channels;
    switch (colorType) {
      case 0:
        return [data[o]!, data[o]!, data[o]!, keyed(o, 1) ? 0 : 255];
      case 2:
        return [data[o]!, data[o + 1]!, data[o + 2]!, keyed(o, 3) ? 0 : 255];
      case 3: {
        const index = data[o]!;
        const p = palette ?? Buffer.alloc(0);
        return [p[index * 3] ?? 0, p[index * 3 + 1] ?? 0, p[index * 3 + 2] ?? 0, trns?.[index] ?? 255];
      }
      case 4:
        return [data[o]!, data[o]!, data[o]!, data[o + 1]!];
      default:
        return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
    }
  };
  return { width, height, colorType, hasAlpha: colorType === 4 || colorType === 6 || trns !== null, pixel };
}
