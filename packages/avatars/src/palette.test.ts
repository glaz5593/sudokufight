import {
  CLOTH,
  contrast,
  FACE,
  FUR,
  GROUND,
  HAIR,
  luminance,
  mix,
  OBJECT,
  type Ramp,
  shade,
  SKIN,
  TILE,
  TILE_CONTRAST,
} from './palette';

const HEX = /^#[0-9a-f]{6}$/;
const RAMPS: Record<string, Record<string, Ramp>> = { SKIN, HAIR, FUR, OBJECT, CLOTH };

describe('the palette', () => {
  it.each(Object.entries(TILE))('tile %s reads on the dark app and on white', (_, tile) => {
    expect(contrast(tile, GROUND.dark)).toBeGreaterThanOrEqual(TILE_CONTRAST.dark);
    expect(contrast(tile, GROUND.light)).toBeGreaterThanOrEqual(TILE_CONTRAST.light);
  });

  it('has no duplicate tiles', () => {
    const tiles = Object.values(TILE);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('uses lowercase #rrggbb everywhere', () => {
    for (const c of [...Object.values(TILE), ...Object.values(FACE)]) expect(c).toMatch(HEX);
    for (const group of Object.values(RAMPS))
      for (const r of Object.values(group))
        for (const c of [r.base, r.shade, r.light]) expect(c).toMatch(HEX);
  });

  it.each(Object.keys(RAMPS))('%s ramps go shade < base < light', (name) => {
    for (const r of Object.values(RAMPS[name] ?? {})) {
      expect(luminance(r.shade)).toBeLessThan(luminance(r.base));
      expect(luminance(r.light)).toBeGreaterThan(luminance(r.base));
    }
  });

  it('keeps the face ink readable on the four lighter skins (darker skins use round eyes)', () => {
    for (const s of Object.values(SKIN).slice(0, 4))
      expect(contrast(FACE.ink, s.base)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('colour helpers', () => {
  it('mixes and shades', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#336699', 0)).toBe('#336699');
  });

  it('computes WCAG luminance and contrast', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#777777', '#777777')).toBe(1);
  });

  it('rejects colours that are not #rrggbb', () => {
    expect(() => luminance('red')).toThrow();
    expect(() => mix('#fff', '#000000', 0.5)).toThrow();
  });
});
