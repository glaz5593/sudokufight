import { AVATARS } from './catalog';
import { CANVAS, defaultIdPrefix, renderAvatar, renderFace, viewBoxOf } from './render';
import { checkXml, duplicates } from './testing/xml';
import { EXPRESSIONS } from './types';

const SIZES = [24, 48, 160];
const PARTS = ['body', 'face', 'cheeks', 'eyes', 'brows', 'mouth', 'extras'];

describe('renderAvatar', () => {
  describe.each(AVATARS.map((a) => [a.id, a] as const))('%s', (_, a) => {
    it.each(EXPRESSIONS)('renders well-formed SVG for %s at every size and crop', (expression) => {
      for (const size of SIZES)
        for (const crop of ['tile', 'head'] as const) {
          const svg = renderAvatar(a, { expression, size, crop });
          const r = checkXml(svg);
          expect(r.root).toBe('svg');
          expect(duplicates(r.ids)).toEqual([]);
          const p = defaultIdPrefix(a);
          for (const part of PARTS) expect(r.ids).toContain(`${p}-${part}`);
          expect(svg).toContain(`clip-path="url(#${p}-clip)"`);
          expect(svg).toContain(`width="${size}" height="${size}"`);
          expect(svg).toContain(`data-expression="${expression}"`);
        }
    });

    it('is the same string every time', () => {
      expect(renderAvatar(a, { expression: 'dizzy', size: 48 })).toBe(
        renderAvatar(a, { expression: 'dizzy', size: 48 }),
      );
    });

    it('draws a different face for every expression', () => {
      const faces = EXPRESSIONS.map((e) => renderFace(a, e, { size: 160 }));
      expect(new Set(faces).size).toBe(EXPRESSIONS.length);
    });

    it('zooms to the head box only when asked and when there is one', () => {
      expect(viewBoxOf(a)).toEqual({ x: 0, y: 0, size: CANVAS });
      const head = renderAvatar(a, { crop: 'head' });
      if (a.headBox)
        expect(head).toContain(`viewBox="${a.headBox.x} ${a.headBox.y} ${a.headBox.size} ${a.headBox.size}"`);
      else expect(head).toContain('viewBox="0 0 100 100"');
    });
  });

  it('gives many avatars on one page distinct ids', () => {
    const page = `<div>${AVATARS.map((a) => renderAvatar(a, { expression: 'smile' })).join('')}</div>`;
    const r = checkXml(page);
    expect(r.ids.length).toBeGreaterThan(0);
    expect(duplicates(r.ids)).toEqual([]);
  });

  it('lets the same avatar appear twice with its own prefixes', () => {
    const a = AVATARS[0];
    if (!a) throw new Error('empty catalog');
    const page = `<div>${renderAvatar(a, { idPrefix: 'one' })}${renderAvatar(a, { idPrefix: 'two' })}</div>`;
    expect(duplicates(checkXml(page).ids)).toEqual([]);
  });

  it('labels the avatar for screen readers, or hides it', () => {
    const a = AVATARS[0];
    if (!a) throw new Error('empty catalog');
    expect(renderAvatar(a)).toContain(`role="img" aria-label="${a.name.en}"`);
    expect(renderAvatar(a, { label: 'Me & you' })).toContain('aria-label="Me &amp; you"');
    expect(renderAvatar(a, { label: false })).toContain('aria-hidden="true"');
  });

  it('puts the motion origins on the svg', () => {
    for (const a of AVATARS) {
      const svg = renderAvatar(a);
      expect(svg).toMatch(
        /--sfa-pivot:[\d.]+px [\d.]+px;--sfa-base:[\d.]+px [\d.]+px;--sfa-eyes:[\d.]+px [\d.]+px/,
      );
    }
  });
});
