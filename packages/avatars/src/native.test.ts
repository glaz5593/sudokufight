import { AVATARS } from './catalog';
import { gimmickAnims, type GimmickState, playingGimmicks, sampleGimmick } from './gimmick';
import { cubicBezier, motionOrigin, poseMatrix, resolveMotion, sampleTrack } from './motion';
import {
  blinkPlan,
  eyeNodeKey,
  gimmickAnimPlan,
  gimmickNodeKey,
  gimmickPlans,
  gimmickUpdates,
  grayOf,
  grayscaleSvg,
  IDLE_BLINK_MS,
  idleBlinkDelayMs,
  LAYER_FALLBACK_OVERSCAN,
  layerSvg,
  motionPlan,
  NATIVE_IDENTITY,
  type NativeLayers,
  type NativeRect,
  nativeFrame,
  nativeLayers,
  type NativeValues,
  nativeTransform,
  NO_AVATAR,
  NO_AVATAR_PREFIX,
  NODE,
  type NodePlan,
  nodeRest,
  originFromCentrePx,
  originPx,
  placePx,
  type PropertyPlan,
  renderStatic,
} from './native';
import { type Extents, markupBounds } from './bounds';
import { contrast, GROUND, luminance, TILE_CONTRAST } from './palette';
import { CANVAS, GIMMICK_MIN_SIZE, renderAvatar, TILE_RADIUS } from './render';
import { eyeCentres } from './rig';
import { FIXTURES } from './testing/fixtures';
import { checkXml, duplicates, xmlTree, type XmlNode } from './testing/xml';
import {
  type AvatarDef,
  EXPRESSIONS,
  type GimmickDef,
  type GimmickPose,
  MOTION_IDS,
  type MotionTrack,
  type Point,
  type Pose,
} from './types';

const ALL = [...AVATARS, ...FIXTURES];
const EACH = ALL.map((a) => [a.id, a] as const);

const fixture = (id: string): AvatarDef => {
  const a = FIXTURES.find((x) => x.id === id);
  if (!a) throw new Error(`no fixture ${id}`);
  return a;
};

// ---------------------------------------------------------------------------------------------------------
// A reference player: what Reanimated does with a plan. The value is set to `from`, then
// withDelay(delayMs, withRepeat(withSequence(...withTiming(to, { duration, easing: bezier })), loop ? -1 : 1)).

function played(p: PropertyPlan, ms: number): number {
  let t = ms - p.delayMs;
  if (t <= 0) return p.from;
  const total = p.segments.reduce((s, x) => s + x.durationMs, 0);
  if (p.loop && total > 0) t %= total;
  let value = p.from;
  let start = 0;
  for (const s of p.segments) {
    const end = start + s.durationMs;
    if (t < end) return value + (s.to - value) * cubicBezier(s.bezier, (t - start) / s.durationMs);
    value = s.to;
    start = end;
  }
  return value;
}

function valuesAt(plan: NodePlan, ms: number): NativeValues {
  const v = { ...plan.rest };
  for (const p of plan.properties) v[p.property] = played(p, ms);
  return v;
}

const asPose = (v: NativeValues): GimmickPose => ({
  x: v.translateX,
  y: v.translateY,
  rotate: v.rotate,
  sx: v.scaleX,
  sy: v.scaleY,
  opacity: v.opacity,
});

/** The worst difference so far: in canvas units and degrees, and in scale and opacity. */
interface Worst {
  units: number;
  ratio: number;
}

function compare(got: GimmickPose, want: GimmickPose, w: Worst): void {
  w.units = Math.max(w.units, Math.abs(got.x - want.x), Math.abs(got.y - want.y));
  w.units = Math.max(w.units, Math.abs(got.rotate - want.rotate));
  w.ratio = Math.max(w.ratio, Math.abs(got.sx - want.sx), Math.abs(got.sy - want.sy));
  w.ratio = Math.max(w.ratio, Math.abs(got.opacity - want.opacity));
}

const segmentsMs = (p: PropertyPlan) => p.segments.reduce((s, x) => s + x.durationMs, 0);

// ---------------------------------------------------------------------------------------------------------
// What a picture paints: every drawing element in order, with its own attributes and those of the groups
// around it. Classes, styles, ids, roles, aria and data attributes are left out (they paint nothing).

const SILENT = /^(class|style|id|role|aria-.*|data-.*|xmlns)$/;
const FORBIDDEN = /^(class|style|role|aria-.*|data-.*)$/;

function attrText(attrs: Record<string, string>, dropClip: boolean): string {
  return Object.entries(attrs)
    .filter(([k]) => !SILENT.test(k) && !(dropClip && k === 'clip-path'))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
}

function paints(node: XmlNode, opts: { chain?: string[]; dropClip?: boolean } = {}, out: string[] = []) {
  const chain = opts.chain ?? [];
  if (node.name === 'defs') return out;
  const own = attrText(node.attrs, opts.dropClip ?? false);
  if (node.name === 'svg' || node.name === 'g') {
    const next = node.name === 'g' && own ? [...chain, own] : chain;
    for (const c of node.children) paints(c, { ...opts, chain: next }, out);
    return out;
  }
  out.push(`<${node.name} ${own}>${chain.length ? ` in ${chain.join(' / ')}` : ''}`);
  return out;
}

/** What the layers paint, stacked: each node's own picture, inside its ancestors' rest opacity. */
function stackPaints(layers: NativeLayers): string[] {
  const byKey = new Map(layers.nodes.map((n) => [n.key, n]));
  const out: string[] = [];
  for (const n of layers.nodes) {
    if (!n.svg) continue;
    const chain: string[] = [];
    for (let at: typeof n | undefined = n; at; at = at.parent ? byKey.get(at.parent) : undefined)
      if (at.restOpacity !== 1) chain.unshift(`opacity="${at.restOpacity}"`);
    paints(xmlTree(n.svg), { chain }, out);
  }
  return out;
}

const badAttrs = (svg: string): string[] =>
  checkXml(svg).elements.flatMap((e) =>
    Object.keys(e.attrs)
      .filter((k) => FORBIDDEN.test(k))
      .map((k) => `${e.name}.${k}`),
  );

/** The avatar without the gimmicks that are hidden at rest (the one holding the face stays). */
const withoutHidden = (a: AvatarDef): AvatarDef => ({
  ...a,
  gimmicks: a.gimmicks?.filter((g) => g.rest !== 'hidden' || g.z === 'face'),
});

const SIZES = [
  [96, 'tile'],
  [48, 'tile'],
  [24, 'tile'],
  [24, 'head'],
] as const;

const extentsOf = (r: NativeRect): Extents => ({ x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height });
/** `e` inside `r` (a hair of float noise allowed). */
const inside = (e: Extents, r: NativeRect): boolean => {
  const o = extentsOf(r);
  const eps = 1e-9;
  return e.x0 >= o.x0 - eps && e.y0 >= o.y0 - eps && e.x1 <= o.x1 + eps && e.y1 <= o.y1 + eps;
};

// ---------------------------------------------------------------------------------------------------------

describe('renderStatic', () => {
  describe.each(EACH)('%s', (_, a) => {
    it('paints what renderAvatar paints, as plain SVG with one prefixed id', () => {
      const plain = withoutHidden(a);
      for (const expression of EXPRESSIONS)
        for (const [size, crop] of SIZES) {
          const svg = renderStatic(a, { expression, size, crop, idPrefix: 'x' });
          const r = checkXml(svg);
          expect(r.root).toBe('svg');
          expect(r.ids).toEqual(['x-clip']);
          expect(badAttrs(svg)).toEqual([]);
          expect(svg).toContain('clip-path="url(#x-clip)"');
          expect(svg).toContain(`width="${size}" height="${size}"`);
          const web = renderAvatar(plain, { expression, size, crop, idPrefix: 'x' });
          expect(paints(xmlTree(svg))).toEqual(paints(xmlTree(web)));
        }
    });

    it('draws its gimmicks at rest, and leaves out the ones hidden until they play', () => {
      const svg = renderStatic(a, { size: 96 });
      expect(svg).toBe(renderStatic(withoutHidden(a), { size: 96 }));
      for (const g of a.gimmicks ?? []) if (g.rest !== 'hidden') expect(svg).toContain(g.markup);
    });

    it('uses only hex colours and none, so grayscale reaches every one', () => {
      const svg = renderStatic(a, { expression: 'angry', size: 96 });
      for (const e of checkXml(svg).elements)
        for (const k of ['fill', 'stroke'])
          if (e.attrs[k] !== undefined) expect(e.attrs[k]).toMatch(/^(#[0-9a-f]{6}|none)$/i);
      const gray = renderStatic(a, { expression: 'angry', size: 96, grayscale: true });
      expect(gray).toBe(grayscaleSvg(svg));
      for (const e of checkXml(gray).elements)
        for (const k of ['fill', 'stroke'])
          if (e.attrs[k] !== undefined) expect(e.attrs[k]).toMatch(/^(#([0-9a-f]{2})\2\2|none)$/);
      expect(paints(xmlTree(gray)).length).toBe(paints(xmlTree(svg)).length);
    });
  });

  it('hides the cloud’s drops and zap, which renderAvatar draws transparent', () => {
    const cloud = fixture('demo-cloud');
    const drop = cloud.gimmicks?.find((g) => g.id === 'drop-0');
    if (!drop) throw new Error('no drop');
    expect(renderAvatar(cloud)).toContain(drop.markup);
    expect(renderStatic(cloud)).not.toContain(drop.markup);
    expect(renderStatic(fixture('demo-balloon'))).toContain(fixture('demo-balloon').gimmicks?.[0]?.markup);
  });

  it('defaults to the size and prefix renderAvatar uses', () => {
    const a = fixture('demo-kettle');
    expect(renderStatic(a)).toContain(`width="${CANVAS}" height="${CANVAS}"`);
    expect(checkXml(renderStatic(a)).ids).toEqual(['sfa-demo-kettle-clip']);
    expect(renderStatic(a, { crop: 'head' })).toContain('viewBox="0 0 100 100"'); // no head box: the whole tile
  });

  it('lets two copies share a screen', () => {
    const a = fixture('demo-alien');
    const page = `<div>${renderStatic(a, { idPrefix: 'one' })}${renderStatic(a, { idPrefix: 'two' })}${renderStatic(null)}${renderStatic(null, { idPrefix: 'n2' })}</div>`;
    const r = checkXml(page);
    expect(r.ids).toHaveLength(4);
    expect(duplicates(r.ids)).toEqual([]);
  });

  it('draws the "no avatar" placeholder for null', () => {
    const svg = renderStatic(null, { size: 48 });
    const r = checkXml(svg);
    expect(r.root).toBe('svg');
    expect(r.ids).toEqual([`${NO_AVATAR_PREFIX}-clip`]);
    expect(badAttrs(svg)).toEqual([]);
    expect(svg).toContain(`fill="${NO_AVATAR.tile}"`);
    expect(svg).toContain(NO_AVATAR.markup);
    const hb = NO_AVATAR.headBox;
    expect(renderStatic(null, { crop: 'head' })).toContain(`viewBox="${hb.x} ${hb.y} ${hb.size} ${hb.size}"`);
    // a tile like the others: it reads on the dark app and on white
    expect(contrast(NO_AVATAR.tile, GROUND.dark)).toBeGreaterThanOrEqual(TILE_CONTRAST.dark);
    expect(contrast(NO_AVATAR.tile, GROUND.light)).toBeGreaterThanOrEqual(TILE_CONTRAST.light);
    const gray = renderStatic(null, { grayscale: true });
    expect(checkXml(gray).root).toBe('svg');
    expect(gray).toBe(grayscaleSvg(renderStatic(null)));
  });
});

describe('grayscale', () => {
  it('keeps each colour’s luminance', () => {
    const colours = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#3fa59b', '#2b2230', '#ffcf3f'];
    for (const c of [...colours, ...ALL.map((a) => a.tile)]) {
      const g = grayOf(c);
      expect(g).toMatch(/^#([0-9a-f]{2})\1\1$/);
      expect(Math.abs(luminance(g) - luminance(c))).toBeLessThan(0.005);
    }
    expect(grayOf('#000')).toBe('#000000');
    expect(grayOf('#FFF')).toBe('#ffffff');
  });

  it('turns fills and strokes, and nothing else', () => {
    expect(
      grayscaleSvg('<g fill="#ff0000" stroke="#00f" stroke-width="2"><path fill="none" d="M0 0"/></g>'),
    ).toBe(
      `<g fill="${grayOf('#ff0000')}" stroke="${grayOf('#0000ff')}" stroke-width="2"><path fill="none" d="M0 0"/></g>`,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('nativeLayers', () => {
  describe.each(EACH)('%s', (_, a) => {
    it('stacks into what renderAvatar paints', () => {
      for (const expression of EXPRESSIONS)
        for (const [size, crop] of [SIZES[0], SIZES[3]]) {
          const layers = nativeLayers(a, { expression, size, crop });
          const web = renderAvatar(a, { expression, size, crop });
          expect(stackPaints(layers)).toEqual(paints(xmlTree(web), { dropClip: true }));
        }
    });

    it('is a tree in drawing order, of plain layers, each over its own rect', () => {
      const layers = nativeLayers(a, { size: 96 });
      const { frame, nodes } = layers;
      const keys = nodes.map((n) => n.key);
      expect(duplicates(keys)).toEqual([]);
      nodes.forEach((n, i) => {
        if (n.parent !== null) expect(keys.slice(0, i)).toContain(n.parent);
        if (!n.svg) {
          expect(n.markup).toBe('');
          return;
        }
        const r = checkXml(n.svg);
        expect(r.root).toBe('svg');
        expect(r.ids).toEqual([]);
        expect(badAttrs(n.svg)).toEqual([]);
        expect(n.drawRect).not.toBeNull();
        if (n.drawRect) expect(n.svg).toBe(layerSvg(frame, n.drawRect, n.markup));
      });
      // A parent's children follow it, before anything outside it: a pre-order walk.
      const depth = (k: string | null): number => {
        const n = nodes.find((x) => x.key === k);
        return n ? 1 + depth(n.parent) : 0;
      };
      nodes.forEach((n, i) => {
        if (i === 0 || !n.parent) return;
        const prev = nodes[i - 1];
        expect(prev && (prev.key === n.parent || depth(prev.key) >= depth(n.key))).toBe(true);
      });
      expect(nodes[0]?.key).toBe(NODE.tile);
      expect(nodes[1]?.key).toBe(NODE.body);
      expect(layers.tile).toEqual({
        color: a.tile,
        radius: TILE_RADIUS,
        radiusPx: (TILE_RADIUS * 96) / CANVAS,
      });
    });

    it('has a node for every gimmick, every eye and every motion target', () => {
      const { nodes } = nativeLayers(a, { size: 160 });
      const key = (k: string) => nodes.find((n) => n.key === k);
      for (const g of a.gimmicks ?? []) {
        const n = key(gimmickNodeKey(g.id));
        expect(n?.kind).toBe('gimmick');
        expect(n?.gimmick).toBe(g.id);
        expect(n?.parent).toBe(NODE.body);
        expect(n?.restOpacity).toBe(g.rest === 'hidden' ? 0 : 1);
      }
      const holder = a.gimmicks?.find((g) => g.z === 'face');
      expect(key(NODE.face)?.parent).toBe(holder ? gimmickNodeKey(holder.id) : NODE.body);
      eyeCentres(a.face).forEach((c, i) => {
        expect(key(eyeNodeKey(i))).toMatchObject({ kind: 'eye', parent: NODE.face, origin: c });
      });
      expect(nodes.filter((n) => n.kind === 'eye')).toHaveLength(eyeCentres(a.face).length);
      for (const id of MOTION_IDS) for (const p of motionPlan(a, id).nodes) expect(key(p.node)).toBeDefined();
    });

    it('gives each layer a rect on whole device pixels that holds what it draws and its children', () => {
      for (const expression of ['neutral', 'surprised', 'sleepy'] as const)
        for (const [size, crop, pixelRatio] of [
          [96, 'tile', 3],
          [43, 'tile', 2.625],
          [22, 'head', 2],
        ] as const) {
          const { frame, nodes } = nativeLayers(a, { expression, size, crop, pixelRatio });
          const byKey = new Map(nodes.map((n) => [n.key, n]));
          const device = (v: number) => v * frame.scale * pixelRatio;
          for (const n of nodes) {
            // Measurable: nothing falls back to the big square.
            const own = markupBounds(n.markup);
            expect(own.known).toBe(true);
            if (own.extents) {
              expect(n.drawRect && inside(own.extents, n.drawRect)).toBe(true);
              expect(n.drawRect && inside(extentsOf(n.drawRect), n.rect)).toBe(true);
            }
            const parent = n.parent === null ? undefined : byKey.get(n.parent);
            if (parent) expect(inside(extentsOf(n.rect), parent.rect)).toBe(true);
            // Its edges and size are whole device pixels from the visible square's corner.
            for (const r of [n.rect, n.drawRect ?? n.rect])
              for (const v of [r.x - frame.box.x, r.y - frame.box.y, r.width, r.height])
                expect(Math.abs(device(v) - Math.round(device(v)))).toBeLessThan(1e-6);
          }
        }
    });

    it('changes only the face layers with the expression', () => {
      const base = nativeLayers(a, { size: 96 });
      const face = new Set(['cheeks', 'eye', 'features']);
      for (const expression of EXPRESSIONS) {
        const other = nativeLayers(a, { size: 96, expression });
        expect(other.nodes.map((n) => n.key)).toEqual(base.nodes.map((n) => n.key));
        other.nodes.forEach((n, i) => {
          if (!face.has(n.kind)) expect(n.svg).toBe(base.nodes[i]?.svg);
        });
      }
    });
  });

  it('turns grey on request, the tile too', () => {
    const a = fixture('demo-kettle');
    const gray = nativeLayers(a, { grayscale: true });
    const colour = nativeLayers(a);
    gray.nodes.forEach((n, i) => {
      const c = colour.nodes[i]?.svg ?? null;
      expect(n.svg).toBe(c === null ? null : grayscaleSvg(c));
    });
    expect(gray.tile.color).toBe(grayOf(a.tile));
  });

  it('gives the placeholder a tile, a body and its art', () => {
    const layers = nativeLayers(null, { size: 48 });
    expect(layers.nodes.map((n) => [n.key, n.parent])).toEqual([
      [NODE.tile, null],
      [NODE.body, null],
      [NODE.back, NODE.body],
    ]);
    expect(stackPaints(layers)).toEqual(
      paints(xmlTree(renderStatic(null, { size: 48 })), { dropClip: true }),
    );
    expect(layers.tile.color).toBe(NO_AVATAR.tile);
  });
});

describe('the frame and px', () => {
  it('maps canvas units to px around the visible square', () => {
    const a = AVATARS.find((x) => x.headBox);
    if (!a?.headBox) throw new Error('no avatar with a head box');
    const tile = nativeFrame(a, 96, 'tile', 3);
    expect(tile.box).toEqual({ x: 0, y: 0, size: 100 });
    expect(tile.rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(tile.scale).toBeCloseTo(0.96);
    expect(tile.pixelRatio).toBe(3);
    expect(nativeFrame(a, 96).pixelRatio).toBe(1);
    const layer = { x: -10, y: 20, width: 50, height: 25 };
    const corner = originPx(tile, layer, { x: 0, y: 0 }); // the tile's corner, from the layer's
    expect([corner.x, corner.y]).toEqual([expect.closeTo(9.6, 9), expect.closeTo(-19.2, 9)]);
    const middle = originFromCentrePx(tile, layer, { x: 15, y: 32.5 });
    expect([middle.x, middle.y]).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9)]);
    expect(placePx(tile, layer)).toEqual({
      left: expect.closeTo(-9.6, 9),
      top: expect.closeTo(19.2, 9),
      width: expect.closeTo(48, 9),
      height: expect.closeTo(24, 9),
    });
    // Nested: inside its parent's rect.
    expect(placePx(tile, layer, { x: -20, y: 0, width: 100, height: 100 })).toMatchObject({
      left: expect.closeTo(9.6, 9),
      top: expect.closeTo(19.2, 9),
    });
    expect(layerSvg(tile, layer, '<circle r="1"/>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 20 50 25" width="48" height="24"><circle r="1"/></svg>',
    );
    const head = nativeFrame(a, 24, 'head');
    const hb = a.headBox;
    expect(head.box).toEqual(hb);
    expect(head.scale).toBeCloseTo(24 / hb.size);
    // the head box's corner lands on the visible square's corner
    expect(placePx(head, { x: hb.x, y: hb.y, width: 1, height: 1 })).toMatchObject({ left: 0, top: 0 });
    expect(nativeFrame(null, 24, 'head').box).toEqual(NO_AVATAR.headBox);
  });

  it('keeps a layer whose markup it cannot measure in the big square, as before', () => {
    const odd: AvatarDef = {
      ...fixture('demo-kettle'),
      layers: { back: '<text x="50" y="50">?</text>' },
      gimmicks: [],
    };
    const { frame, nodes } = nativeLayers(odd, { size: 100 });
    const back = nodes.find((n) => n.key === NODE.back)!;
    const m = frame.box.size * LAYER_FALLBACK_OVERSCAN;
    expect(back.drawRect).toEqual({ x: -m - 1, y: -m - 1, width: 100 + 2 * m + 2, height: 100 + 2 * m + 2 });
  });

  it('builds React Native’s transform as poseMatrix’s matrix', () => {
    const poses: Pose[] = [
      { x: 0, y: 0, rotate: 0, sx: 1, sy: 1 },
      { x: 3, y: -7, rotate: 0, sx: 1, sy: 1 },
      { x: -2, y: 1.5, rotate: 37, sx: 0.8, sy: 1.2 },
      { x: 0, y: -3, rotate: 180, sx: -1, sy: 1 },
      { x: 1, y: 2, rotate: -368, sx: 1.16, sy: 0.84 },
    ];
    const a = fixture('demo-alien');
    for (const [size, crop] of [
      [96, 'tile'],
      [22, 'head'],
    ] as const) {
      const frame = nativeFrame(a, size, crop);
      // Any layer's rect: a view turns around its own centre.
      for (const layer of [
        { x: -50, y: -50, width: 200, height: 200 },
        { x: 31, y: 40, width: 12, height: 9 },
      ])
        for (const pose of poses)
          for (const origin of [a.pivot, { x: 12, y: 88 }]) {
            const list = nativeTransform(pose, originFromCentrePx(frame, layer, origin), frame.scale);
            const m = poseMatrix(pose, origin);
            const [cx, cy] = [(layer.width * frame.scale) / 2, (layer.height * frame.scale) / 2];
            for (const q of [
              { x: 0, y: 0 },
              { x: 50, y: 50 },
              { x: 91, y: 7 },
              { x: 30, y: 140 },
            ]) {
              // React Native: around the view's centre, the list's last transform first.
              let p: Point = {
                x: (q.x - layer.x) * frame.scale - cx,
                y: (q.y - layer.y) * frame.scale - cy,
              };
              for (const t of [...list].reverse()) {
                if ('translateX' in t) p = { x: p.x + t.translateX, y: p.y };
                else if ('translateY' in t) p = { x: p.x, y: p.y + t.translateY };
                else if ('scaleX' in t) p = { x: p.x * t.scaleX, y: p.y };
                else if ('scaleY' in t) p = { x: p.x, y: p.y * t.scaleY };
                else {
                  const r = (parseFloat(t.rotate) * Math.PI) / 180;
                  p = { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
                }
              }
              const got = {
                x: (p.x + cx) / frame.scale + layer.x,
                y: (p.y + cy) / frame.scale + layer.y,
              };
              const want = { x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5] };
              expect(got.x).toBeCloseTo(want.x, 9);
              expect(got.y).toBeCloseTo(want.y, 9);
            }
          }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('motion plans', () => {
  /** The nodes a track moves, with the origin CSS gives them (an eye's own centre for `eyes`). */
  const expected = (a: AvatarDef, tr: MotionTrack): [string, Point][] =>
    tr.target === 'eyes'
      ? eyeCentres(a.face).map((c, i) => [
          eyeNodeKey(i),
          tr.origin === 'eyes' ? c : motionOrigin(a, tr.origin),
        ])
      : [[tr.target, motionOrigin(a, tr.origin)]];

  it.each(EACH)('%s: every motion plays as sampleTrack says, on every node it moves', (_, a) => {
    const N = 64;
    for (const id of MOTION_IDS) {
      const m = resolveMotion(a, id);
      const plan = motionPlan(a, id);
      expect(plan).toMatchObject({ requested: id, id: m.id, durationMs: m.durationMs });
      expect(plan.expression).toBe(m.expression);
      const want = new Map<string, { tr: MotionTrack; origin: Point }>();
      for (const tr of m.tracks) for (const [node, origin] of expected(a, tr)) want.set(node, { tr, origin });
      expect(plan.nodes.map((n) => n.node).sort()).toEqual([...want.keys()].sort());
      const worst: Worst = { units: 0, ratio: 0 };
      for (const np of plan.nodes) {
        const w = want.get(np.node);
        if (!w) throw new Error(`unexpected node ${np.node}`);
        expect(np.origin).toEqual(w.origin);
        expect(np.rest).toEqual(NATIVE_IDENTITY);
        for (const p of np.properties) {
          expect(p.property).not.toBe('opacity');
          expect(p).toMatchObject({ delayMs: 0, loop: false });
          expect(segmentsMs(p)).toBeCloseTo(m.durationMs, 6);
        }
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          compare(
            asPose(valuesAt(np, t * m.durationMs)),
            { ...sampleTrack(w.tr, t, m.ease), opacity: 1 },
            worst,
          );
        }
        // after the end it holds the last pose (the app then puts the node back to rest)
        compare(
          asPose(valuesAt(np, m.durationMs * 1.5)),
          { ...sampleTrack(w.tr, 1, m.ease), opacity: 1 },
          worst,
        );
      }
      expect(worst.units).toBeLessThan(1e-2);
      expect(worst.ratio).toBeLessThan(1e-3);
    }
  });

  it('plays a keyframe’s own curve, else the motion’s, and only the properties that move', () => {
    const a = fixture('demo-kettle');
    const bounce = motionPlan(a, 'bounce').nodes[0];
    expect(bounce?.node).toBe(NODE.body);
    expect(bounce?.properties.map((p) => p.property)).toEqual(['translateY']);
    const eases = bounce?.properties[0]?.segments.map((s) => s.ease);
    expect(eases).toEqual(['standard', 'exit', 'standard', 'exit', 'standard']);
    expect(bounce?.properties[0]?.segments.map((s) => Math.round(s.durationMs))).toEqual([
      280, 240, 160, 140, 180,
    ]);
    const spin = motionPlan(a, 'spin').nodes[0]?.properties.map((p) => p.property);
    expect(spin).toEqual(['rotate', 'scaleX', 'scaleY']);
  });

  it('falls back from squash as the avatar plays it, and keeps only the faces with reduced motion', () => {
    const person = AVATARS.find((a) => !a.squash);
    if (!person) throw new Error('every avatar squashes');
    expect(motionPlan(person, 'squash')).toMatchObject({ requested: 'squash', id: 'bounce' });
    expect(motionPlan(fixture('demo-kettle'), 'squash').id).toBe('squash');
    const reduced = motionPlan(person, 'spin', { reducedMotion: true });
    expect(reduced.nodes).toEqual([]);
    expect(reduced.faceChanges).toEqual(motionPlan(person, 'spin').faceChanges);
    expect(reduced.faceChanges.map((c) => c.expression)).toEqual(['surprised', 'laugh', 'base']);
    expect(reduced.faceChanges.map((c) => c.atMs)).toEqual([0, 546, 1300]);
  });

  it('blinks every eye around its own centre, now and then', () => {
    const alien = fixture('demo-alien');
    const blink = blinkPlan(alien);
    expect(blink.id).toBe('blink');
    expect(blink.faceChanges).toEqual([]);
    expect(blink.nodes.map((n) => [n.node, n.origin])).toEqual(
      eyeCentres(alien.face).map((c, i) => [eyeNodeKey(i), c]),
    );
    for (const n of blink.nodes) expect(n.properties.map((p) => p.property)).toEqual(['scaleY']);
    expect(idleBlinkDelayMs(0)).toBe(IDLE_BLINK_MS.min);
    expect(idleBlinkDelayMs(1)).toBe(IDLE_BLINK_MS.max);
    expect(idleBlinkDelayMs(0.5)).toBe((IDLE_BLINK_MS.min + IDLE_BLINK_MS.max) / 2);
    expect(idleBlinkDelayMs(7)).toBe(IDLE_BLINK_MS.max);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('gimmick plans', () => {
  const withGimmicks = ALL.filter((a) => a.gimmicks?.length).map((a) => [a.id, a] as const);

  it.each(withGimmicks)('%s: every anim plays as sampleGimmick says, with its delay and loop', (_, a) => {
    const N = 96;
    const worst: Worst = { units: 0, ratio: 0 };
    for (const g of a.gimmicks ?? [])
      gimmickAnims(g).forEach((anim, i) => {
        const plan = gimmickAnimPlan(g, i);
        if (!plan) throw new Error(`no plan for ${g.id}#${i}`);
        expect(plan).toMatchObject({
          node: gimmickNodeKey(g.id),
          gimmick: g.id,
          index: i,
          origin: anim.origin,
        });
        expect(plan.rest).toEqual(nodeRest({ restOpacity: g.rest === 'hidden' ? 0 : 1 }));
        const delay = anim.delayMs ?? 0;
        const D = anim.durationMs;
        for (const p of plan.properties) {
          expect(p).toMatchObject({ delayMs: delay, loop: anim.loop ?? false });
          expect(segmentsMs(p)).toBeCloseTo(D, 6);
        }
        const span = delay + (anim.loop ? 2.5 : 1.25) * D;
        for (let k = 0; k < N; k++) {
          const ms = ((k + 0.5) / N) * span;
          const local = (ms - delay) / D;
          const u = local <= 0 ? 0 : anim.loop ? local % 1 : Math.min(local, 1);
          if (anim.loop && local > 0 && (u < 1e-6 || u > 1 - 1e-6)) continue; // a seam
          compare(asPose(valuesAt(plan, ms)), sampleGimmick(anim, u), worst);
        }
      });
    expect(worst.units).toBeLessThan(1e-2);
    expect(worst.ratio).toBeLessThan(1e-3);
  });

  it('fades a hidden gimmick in from its rest, and leaves a shown one’s opacity alone', () => {
    const steam = fixture('demo-kettle').gimmicks?.find((g) => g.id === 'steam-2');
    const drum = fixture('demo-washer').gimmicks?.find((g) => g.id === 'drum');
    if (!steam || !drum) throw new Error('fixtures changed');
    const puff = gimmickAnimPlan(steam, 0);
    expect(puff?.rest.opacity).toBe(0);
    expect(puff?.properties.map((p) => p.property)).toEqual(['translateY', 'scaleX', 'scaleY', 'opacity']);
    expect(puff?.properties[0]).toMatchObject({ from: 0, delayMs: 1334, loop: true });
    const spin = gimmickAnimPlan(drum, 1);
    expect(spin?.properties.map((p) => p.property)).toEqual(['rotate']);
    expect(spin?.properties[0]?.segments).toEqual([
      { to: 360, durationMs: 9000, ease: 'linear', bezier: [0, 0, 1, 1] },
    ]);
    expect(gimmickAnimPlan(drum, 2)).toBeUndefined();
  });

  it('plays what playingGimmicks says, with the motion resolved for the avatar', () => {
    const states: GimmickState[] = [
      { expression: 'neutral', size: 160, idle: true },
      { expression: 'laugh', size: 160 },
      { expression: 'surprised', size: 96, motion: 'spin' },
      { expression: 'angry', size: 96, idle: true },
      { expression: 'sad', size: 48 },
      { expression: 'laugh', size: GIMMICK_MIN_SIZE - 1, idle: true },
      { expression: 'laugh', size: 160, idle: true, reducedMotion: true },
    ];
    for (const a of ALL)
      for (const st of states) {
        const want = playingGimmicks(a, st).map((p) => `${p.gimmick.id}#${p.index}`);
        expect(gimmickPlans(a, st).map((p) => `${p.gimmick}#${p.index}`)).toEqual(want);
      }
    const washer = fixture('demo-washer');
    expect(
      gimmickPlans(washer, { expression: 'neutral', size: 160, motion: 'spin' }).map((p) => p.gimmick),
    ).toEqual(['drum']);
    // an avatar that may not squash plays bounce for squash, and so do its gimmicks
    const hop: GimmickDef = {
      id: 'hop',
      markup: '',
      anim: {
        trigger: ['bounce'],
        keyframes: [{ t: 0 }, { t: 1, y: -3 }],
        durationMs: 500,
        origin: { x: 50, y: 50 },
      },
    };
    const squashing = { ...washer, squash: true, gimmicks: [hop] };
    const st: GimmickState = { expression: 'neutral', size: 160, motion: 'squash' };
    expect(gimmickPlans({ ...squashing, squash: false }, st).map((p) => p.gimmick)).toEqual(['hop']);
    expect(gimmickPlans(squashing, st)).toEqual([]);
    expect(gimmickPlans(washer, { expression: 'laugh', size: GIMMICK_MIN_SIZE - 1 })).toEqual([]);
    expect(gimmickPlans(washer, { expression: 'laugh', size: 160, reducedMotion: true })).toEqual([]);
  });

  it('starts, keeps and stops gimmicks between states', () => {
    const washer = fixture('demo-washer');
    const idle: GimmickState = { expression: 'neutral', size: 160, idle: true };
    const laugh: GimmickState = { ...idle, expression: 'laugh' };
    const spin: GimmickState = { ...laugh, motion: 'spin' };
    const brief = (prev: GimmickState | null, next: GimmickState) =>
      gimmickUpdates(washer, prev, next).map((u) => `${u.gimmick}:${u.plan ? u.plan.index : 'rest'}`);
    expect(brief(null, idle)).toEqual(['drum:1']);
    expect(brief(idle, idle)).toEqual([]);
    expect(brief(idle, laugh)).toEqual(['drum:0', 'bubble-0:0', 'bubble-1:0', 'bubble-2:0']);
    expect(brief(laugh, spin)).toEqual([]); // the drum keeps turning: the same anim
    expect(brief(laugh, idle)).toEqual(['drum:1', 'bubble-0:rest', 'bubble-1:rest', 'bubble-2:rest']);
    expect(brief(laugh, { ...laugh, size: 40 })).toEqual([
      'drum:rest',
      'bubble-0:rest',
      'bubble-1:rest',
      'bubble-2:rest',
    ]);
    const stop = gimmickUpdates(washer, laugh, { ...laugh, reducedMotion: true });
    expect(stop.find((u) => u.gimmick === 'bubble-0')?.rest).toEqual({ ...NATIVE_IDENTITY, opacity: 0 });
    expect(stop.find((u) => u.gimmick === 'drum')?.rest).toEqual(NATIVE_IDENTITY);
    // applying the updates to what played before gives what plays now, for every fixture
    const states: GimmickState[] = [
      idle,
      laugh,
      spin,
      { ...idle, expression: 'sad' },
      { ...idle, expression: 'angry' },
    ];
    for (const a of FIXTURES)
      for (const prev of states)
        for (const next of states) {
          const now = new Map(gimmickPlans(a, prev).map((p) => [p.gimmick, p.index]));
          for (const u of gimmickUpdates(a, prev, next))
            if (u.plan) now.set(u.gimmick, u.plan.index);
            else now.delete(u.gimmick);
          expect([...now].sort()).toEqual(
            gimmickPlans(a, next)
              .map((p) => [p.gimmick, p.index])
              .sort(),
          );
        }
  });
});
