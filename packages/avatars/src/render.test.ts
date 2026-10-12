import { AVATARS } from './catalog';
import { CANVAS, defaultIdPrefix, GIMMICK_MIN_SIZE, renderAvatar, renderFace, viewBoxOf } from './render';
import { FIXTURES } from './testing/fixtures';
import { checkXml, duplicates } from './testing/xml';
import { type AvatarDef, EXPRESSIONS } from './types';

const SIZES = [24, 48, 160];
const PARTS = ['body', 'face', 'cheeks', 'eyes', 'brows', 'mouth', 'extras'];

const fixture = (id: string): AvatarDef => {
  const a = FIXTURES.find((x) => x.id === id);
  if (!a) throw new Error(`no fixture ${id}`);
  return a;
};

describe('renderAvatar', () => {
  describe.each([...AVATARS, ...FIXTURES].map((a) => [a.id, a] as const))('%s', (_, a) => {
    it.each(EXPRESSIONS)('renders well-formed SVG for %s at every size and crop', (expression) => {
      for (const size of SIZES)
        for (const crop of ['tile', 'head'] as const) {
          const svg = renderAvatar(a, { expression, size, crop, idle: true });
          const r = checkXml(svg);
          expect(r.root).toBe('svg');
          expect(duplicates(r.ids)).toEqual([]);
          const p = defaultIdPrefix(a);
          for (const part of PARTS) expect(r.ids).toContain(`${p}-${part}`);
          expect(svg).toContain(`clip-path="url(#${p}-clip)"`);
          expect(svg).toContain(`width="${size}" height="${size}"`);
          expect(svg).toContain(`data-expression="${expression}"`);
          for (const g of a.gimmicks ?? []) expect(svg).toContain(`class="sfa-gimmick sfa-g-${g.id}"`);
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
    const page = `<div>${[...AVATARS, ...FIXTURES].map((a) => renderAvatar(a, { expression: 'smile' })).join('')}</div>`;
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
    for (const a of [...AVATARS, ...FIXTURES]) {
      const svg = renderAvatar(a);
      expect(svg).toMatch(
        /--sfa-pivot:[\d.]+px [\d.]+px;--sfa-base:[\d.]+px [\d.]+px;--sfa-eyes:[\d.]+px [\d.]+px/,
      );
    }
  });

  it('marks small renders (no gimmicks play) and big idle ones', () => {
    const a = fixture('demo-washer');
    const cls = (svg: string) => /class="([^"]*)"/.exec(svg)?.[1];
    expect(cls(renderAvatar(a, { size: GIMMICK_MIN_SIZE - 1, idle: true }))).toBe('sfa sfa-small');
    expect(cls(renderAvatar(a, { size: GIMMICK_MIN_SIZE }))).toBe('sfa');
    expect(cls(renderAvatar(a, { size: 160, idle: true }))).toBe('sfa sfa-idle');
  });
});

describe('face art', () => {
  it('draws the art of the expression, or the default, over the rig and under the extras', () => {
    const a = fixture('demo-calculator');
    const art = a.face.art;
    if (!art) throw new Error('no art');
    for (const e of EXPRESSIONS) {
      const svg = renderFace(a, e);
      const want = art[e] ?? art.default;
      expect(svg).toContain(`<g id="sfa-demo-calculator-art" class="sfa-art">${want}</g>`);
      expect(svg.indexOf('-mouth"')).toBeLessThan(svg.indexOf('-art"'));
      expect(svg.indexOf('-art"')).toBeLessThan(svg.indexOf('-extras"'));
    }
    const noArt = AVATARS[0];
    if (!noArt) throw new Error('empty catalog');
    expect(renderFace(noArt, 'smile')).not.toContain('-art"');
  });
});

describe('gimmicks in the render', () => {
  const order = (svg: string, ...needles: string[]) => {
    const at = needles.map((n) => svg.indexOf(n));
    for (const i of at) expect(i).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1] ?? 0);
  };

  it('draws each at its depth: behind the art, over it, holding the face, or in front', () => {
    order(renderAvatar(fixture('demo-toaster')), 'sfa-g-toast', 'class="sfa-back"', 'class="sfa-face"');
    order(
      renderAvatar(fixture('demo-washer')),
      'class="sfa-back"',
      'sfa-g-drum',
      'class="sfa-face"',
      'sfa-g-bubble-0',
    );
    order(renderAvatar(fixture('demo-alien')), 'sfa-g-antennae', 'class="sfa-back"');
    order(
      renderAvatar(fixture('demo-kettle')),
      'class="sfa-back"',
      'sfa-g-lid',
      'class="sfa-face"',
      'sfa-g-steam-0',
    );
    order(renderAvatar(fixture('demo-pirate-egg')), 'class="sfa-face"', 'class="sfa-front"');
  });

  it('wraps the face in the gimmick that holds it, after its markup', () => {
    const svg = renderAvatar(fixture('demo-balloon'));
    expect(svg).toMatch(
      /<g class="sfa-gimmick sfa-g-skin">(?:<(?:path|ellipse)[^>]*\/>)+<g id="sfa-demo-balloon-face"/,
    );
    expect(checkXml(svg).root).toBe('svg');
  });

  it('hides a gimmick at rest when it says so', () => {
    const svg = renderAvatar(fixture('demo-cloud'));
    expect(svg).toContain('<g class="sfa-gimmick sfa-g-drop-0" opacity="0">');
    expect(svg).toContain('<g class="sfa-gimmick sfa-g-zap" opacity="0">');
    expect(renderAvatar(fixture('demo-toaster'))).toContain('<g class="sfa-gimmick sfa-g-toast">');
  });
});
