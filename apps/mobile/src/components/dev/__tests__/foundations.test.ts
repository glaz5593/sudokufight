import { contrast, tokens } from '../../../theme';
import {
  contrastGrade,
  formatRatio,
  PALETTES,
  RADII,
  SWATCH_GROUPS,
  swatchRatio,
  TYPE_SCALE,
  typeSpecLine,
} from '../foundations';

describe('design-system foundations', () => {
  it('grades a ratio by what it may carry (WCAG 2.2)', () => {
    expect(contrastGrade(16.56)).toBe('text');
    expect(contrastGrade(4.5)).toBe('text');
    expect(contrastGrade(4.49)).toBe('large');
    expect(contrastGrade(3)).toBe('large');
    expect(contrastGrade(2.99)).toBe('decorative');
  });

  it('writes a ratio rounded down, so it never reads better than it is', () => {
    expect(formatRatio(4.499)).toBe('4.49:1');
    expect(formatRatio(16.5612)).toBe('16.56:1');
    expect(formatRatio(3)).toBe('3.00:1');
  });

  it('lists every colour group with opaque token values', () => {
    expect(SWATCH_GROUPS.map((g) => g.key)).toEqual(['ground', 'text', 'brand', 'status', 'board', 'league']);
    for (const s of SWATCH_GROUPS.flatMap((g) => g.swatches)) {
      expect(s.value).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.against.value).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const text = SWATCH_GROUPS.find((g) => g.key === 'text')!.swatches;
    expect(text.map((s) => s.token)).toEqual([
      'color.text',
      'color.textMuted',
      'color.textFaint',
      'color.iconFaint',
    ]);
  });

  it('measures each swatch against its pair: text colours pass, the decorative gray does not', () => {
    const byToken = new Map(SWATCH_GROUPS.flatMap((g) => g.swatches).map((s) => [s.token, s]));
    expect(swatchRatio(byToken.get('color.text')!)).toBeCloseTo(16.56, 1);
    expect(contrastGrade(swatchRatio(byToken.get('color.textFaint')!))).toBe('text');
    expect(contrastGrade(swatchRatio(byToken.get('color.iconFaint')!))).toBe('large');
    expect(contrastGrade(swatchRatio(byToken.get('color.board.grid')!))).toBe('decorative');
  });

  it('gives the four player palettes, me first, with readable digits and pills', () => {
    expect(PALETTES.map((p) => p.palette.shape)).toEqual(['●', '▲', '■', '◆']);
    for (const p of PALETTES) {
      expect(p.digitOnTint).toBeGreaterThanOrEqual(4.5);
      expect(p.onRingOnRing).toBeGreaterThanOrEqual(4.5);
      expect(p.ringOnBg).toBeGreaterThanOrEqual(4.5);
      expect(p.edgeOnCell).toBeGreaterThanOrEqual(3);
      expect(p.digitOnTint).toBe(contrast(p.palette.digit, p.palette.tint));
    }
  });

  it('lists the type scale with numeric samples for Teko and LTR styles', () => {
    expect(TYPE_SCALE.map((s) => s.name)).toEqual(Object.keys(tokens.type));
    const by = new Map(TYPE_SCALE.map((s) => [s.name, s]));
    expect(by.get('scoreXL')?.numeric).toBe(true);
    expect(by.get('digitCell')?.numeric).toBe(true);
    expect(by.get('body')?.numeric).toBe(false);
    expect(typeSpecLine(by.get('h1')!)).toBe('Rubik 700 · 22/25');
  });

  it('lists the radii without zero or the pill', () => {
    const names = RADII.map(([n]) => n);
    expect(names).not.toContain('none');
    expect(names).not.toContain('pill');
    expect(names).toContain('sheet');
  });
});
