import { AVATARS } from './catalog';
import { FACE } from './palette';
import { drawBrows, drawCheeks, drawExtras, drawEyes, drawMouth, haloOf, SMALL_SIZE } from './rig';
import { cutEllipse, ellipsePath, f, sideOf } from './svg';
import { checkXml } from './testing/xml';
import { EXPRESSIONS, EYE_STYLES, type EyeStyle, type FaceDef } from './types';

const DRAW = [drawEyes, drawBrows, drawMouth, drawCheeks, drawExtras];

/** A plain face for each eye style: the rig must not depend on any one avatar. */
const face = (style: EyeStyle, r = 5): FaceDef => ({
  ink: FACE.ink,
  eyes: { left: { x: 40, y: 50 }, right: { x: 60, y: 50 }, r, style },
  brows: {},
  mouth: { x: 50, y: 68, w: 14 },
  cheeks: { color: FACE.blush },
});

const strokeWidths = (svg: string) => [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));

describe('the face rig', () => {
  it.each(EYE_STYLES)('draws every expression for %s eyes as well-formed SVG', (style) => {
    for (const r of [3.5, 8])
      for (const expression of EXPRESSIONS)
        for (const size of [24, 160]) {
          const out = DRAW.map((d) => d(face(style, r), expression, { size })).join('');
          expect(() => checkXml(`<g>${out}</g>`)).not.toThrow();
          expect(out).not.toMatch(/NaN|Infinity|undefined/);
        }
  });

  it('draws different eyes for every expression except where only the brows and mouth change', () => {
    for (const style of EYE_STYLES) {
      const eyes = new Set(EXPRESSIONS.map((e) => drawEyes(face(style), e)));
      // neutral and surprised differ by size, smile and wink by a closed eye, sad and confused by lids
      expect(eyes.size).toBe(EXPRESSIONS.length);
    }
  });

  it('closes exactly one eye for a wink', () => {
    const out = drawEyes(face('round'), 'wink');
    expect(out.match(/fill="none"/g)).toHaveLength(1); // the closed eye is a stroke
  });

  it('simplifies small sizes: no brows, cheeks or extras, and lines no thinner than about a pixel', () => {
    for (const a of AVATARS)
      for (const expression of EXPRESSIONS) {
        const size = 24;
        expect(drawBrows(a.face, expression, { size })).toBe('');
        expect(drawCheeks(a.face, expression, { size })).toBe('');
        expect(drawExtras(a.face, expression, { size })).toBe('');
        const lines = strokeWidths(
          drawEyes(a.face, expression, { size }) + drawMouth(a.face, expression, { size }),
        );
        for (const w of lines) expect(w).toBeGreaterThanOrEqual((0.6 * 100) / size);
      }
    expect(SMALL_SIZE).toBeGreaterThan(24);
    expect(SMALL_SIZE).toBeLessThan(48);
  });

  it('keeps brows and extras at full size', () => {
    for (const a of AVATARS) {
      if (a.face.brows) expect(drawBrows(a.face, 'surprised', { size: 160 })).not.toBe('');
      expect(drawExtras(a.face, 'dizzy', { size: 160 })).not.toBe('');
      expect(drawExtras(a.face, 'sad', { size: 160 })).toContain(FACE.tear);
      expect(drawExtras(a.face, 'neutral', { size: 160 })).toBe('');
    }
  });

  it('places dizzy stars at the halo, or above the eyes', () => {
    const plain = face('dot', 4);
    expect(haloOf(plain)).toEqual({ x: 50, y: 50 - 4.2 * 4 });
    expect(haloOf({ ...plain, halo: { x: 30, y: 9 } })).toEqual({ x: 30, y: 9 });
    expect(
      haloOf({ ...plain, eyes: { ...plain.eyes, left: { x: 40, y: 10 }, right: { x: 60, y: 10 } } }).y,
    ).toBe(7);
  });

  it('draws no brows for a face without them', () => {
    expect(drawBrows({ ...face('dot'), brows: false }, 'surprised')).toBe('');
  });
});

describe('svg helpers', () => {
  it('formats numbers short, without -0', () => {
    expect(f(1.23456)).toBe('1.23');
    expect(f(-0.001)).toBe('0');
    expect(f(10)).toBe('10');
  });

  it('cuts an ellipse with a half-plane', () => {
    const e = { cx: 50, cy: 50, rx: 4, ry: 5 };
    const below = (y: number) => sideOf({ x: 0, y }, { x: 100, y }, 'below');
    expect(cutEllipse(e, below(40))).toBe(ellipsePath(e)); // the line is above the ellipse: all kept
    expect(cutEllipse(e, below(60))).toBe(''); // the line is below it: nothing kept
    // through the centre: the lower half, from the left point down round the bottom (sweep 0) to the right
    expect(cutEllipse(e, below(50))).toBe('M46 50A4 5 0 0 0 54 50Z');
    // and the upper half the other way round, over the top
    expect(cutEllipse(e, sideOf({ x: 0, y: 50 }, { x: 100, y: 50 }, 'above'))).toBe(
      'M54 50A4 5 0 0 0 46 50Z',
    );
    // a low cut keeps a small cap (small arc); a high cut keeps most of it (large arc)
    expect(cutEllipse(e, below(53))).toBe('M46.8 53A4 5 0 0 0 53.2 53Z');
    expect(cutEllipse(e, below(47))).toBe('M46.8 47A4 5 0 1 0 53.2 47Z');
    // a slanted lid (a sad eye): a large arc between two points on the ellipse
    const lid = cutEllipse(e, sideOf({ x: 46, y: 49 }, { x: 54, y: 46 }, 'below'));
    expect(lid).toMatch(/^M[\d.]+ [\d.]+A4 5 0 1 0 [\d.]+ [\d.]+Z$/);
    for (const m of lid.matchAll(/([\d.]+) ([\d.]+)(?=A|Z)/g)) {
      const [x, y] = [Number(m[1]), Number(m[2])];
      expect(((x - 50) / 4) ** 2 + ((y - 50) / 5) ** 2).toBeCloseTo(1, 1);
    }
  });
});
