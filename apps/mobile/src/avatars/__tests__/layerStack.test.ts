import {
  AVATARS,
  avatarById,
  type AvatarDef,
  layerSvg,
  markupBounds,
  nativeLayers,
  renderStatic,
} from '@sudoku-fight/avatars';

import { idleMovers, layerStack, type StackItem, type StackSvg, staticXml, svgCount } from '../layerStack';

/**
 * How AvatarArt stacks a moving avatar (layerStack.ts): a view for each layer that moves now, and the layers that
 * stand still between them merged into as few SvgXml as their order allows.
 */

const def = (id: string): AvatarDef => avatarById(id)!;
const tags = (xml: string): string[] => [...xml.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]!);

/** The stack as a tree of keys: 'svg' for a merged picture, the node's key (with what it holds) for a mover. */
function shape(items: readonly StackItem[]): unknown[] {
  return items.map((it) => (it.kind === 'svg' ? 'svg' : { [it.key]: shape(it.items) }));
}

describe('layerStack', () => {
  it('nothing moving: one picture with everything renderStatic draws, in its order (tile aside)', () => {
    for (const a of AVATARS) {
      // A face held by a gimmick hidden at rest is drawn at opacity 0 by renderStatic; the stack leaves it out.
      if (a.gimmicks?.some((g) => g.z === 'face' && g.rest === 'hidden')) continue;
      const items = layerStack(nativeLayers(a, { size: 96 }), new Set());
      expect(items).toHaveLength(1);
      const [only] = items;
      expect(only?.kind).toBe('svg');
      // renderStatic: <svg><defs><clipPath><rect/></clipPath></defs><rect tile/><g clip>…</g></svg>
      const still = tags(renderStatic(a, { size: 96 })).slice(6);
      expect(tags(only?.kind === 'svg' ? only.xml : '').slice(1)).toEqual(still);
    }
  });

  it('the body moving (a bounce): one view for it, the whole character in one picture inside', () => {
    const items = layerStack(nativeLayers(def('noam'), { size: 44 }), new Set(['body']));
    expect(shape(items)).toEqual([{ body: ['svg'] }]);
    expect(svgCount(items)).toBe(1);
  });

  it('only the eyes moving (a blink): the body and the face dissolve around them', () => {
    const items = layerStack(nativeLayers(def('noam'), { size: 96 }), new Set(['eye-0', 'eye-1']));
    // back and cheeks · eye · eye · features and the front art
    expect(shape(items)).toEqual(['svg', { 'eye-0': ['svg'] }, { 'eye-1': ['svg'] }, 'svg']);
  });

  it('a stage view: the body, the face, each eye and each gimmick have a view; hidden gimmicks too', () => {
    const layers = nativeLayers(def('kettle'), { size: 96 });
    const items = layerStack(layers, idleMovers(layers));
    expect(shape(items)).toEqual([
      {
        body: [
          'svg',
          { 'gimmick:lid': ['svg'] },
          { face: ['svg', { 'eye-0': ['svg'] }, { 'eye-1': ['svg'] }, 'svg'] },
          { 'gimmick:whistle': ['svg'] },
          { 'gimmick:steam-0': ['svg'] },
          { 'gimmick:steam-1': ['svg'] },
          { 'gimmick:steam-2': ['svg'] },
        ],
      },
    ]);
    const steam = (items[0] as Extract<StackItem, { kind: 'node' }>).items.find(
      (i) => i.key === 'gimmick:steam-0',
    );
    expect(steam?.kind === 'node' && steam.node.restOpacity).toBe(0);
  });

  it('a small stage view (no gimmick plays under 48 px): the gimmicks stay merged in their rest pose', () => {
    const layers = nativeLayers(def('kettle'), { size: 28 });
    expect(shape(layerStack(layers, idleMovers(layers)))).toEqual([
      // (No cheeks this small: the rig leaves them out.)
      { body: ['svg', { face: [{ 'eye-0': ['svg'] }, { 'eye-1': ['svg'] }, 'svg'] }, 'svg'] },
    ]);
  });

  it('a gimmick hidden at rest that does not move is left out, as renderStatic leaves it out', () => {
    const layers = nativeLayers(def('kettle'), { size: 96 });
    const [all] = layerStack(layers, new Set());
    const steam = layers.nodes.find((n) => n.key === 'gimmick:steam-0')!;
    const inner = steam.svg!.slice(steam.svg!.indexOf('>') + 1, -'</svg>'.length);
    expect(all?.kind === 'svg' && all.xml.includes(inner)).toBe(false);
    // Moving, it has its own view (from opacity 0); the two puffs after it still rest, hidden.
    expect(shape(layerStack(layers, new Set(['gimmick:steam-0'])))).toEqual([
      'svg',
      { 'gimmick:steam-0': ['svg'] },
    ]);
  });

  it('a gimmick that holds the face carries it (the slipper hops with its face)', () => {
    const layers = nativeLayers(def('slipper'), { size: 96 });
    const items = layerStack(layers, new Set(['gimmick:hop']));
    // The art behind it, then the gimmick with its own markup and the whole face in one picture inside it.
    expect(shape(items).slice(0, 2)).toEqual(['svg', { 'gimmick:hop': ['svg'] }]);
    const hop = items[1];
    const face = layers.nodes.find((n) => n.key === 'features')!.svg!;
    const inner = face.slice(face.indexOf('>') + 1, -'</svg>'.length);
    expect(hop?.kind === 'node' && hop.items[0]?.kind === 'svg' && hop.items[0].xml.includes(inner)).toBe(
      true,
    );
  });

  it('three eyes: one view each', () => {
    const items = layerStack(nativeLayers(def('alien'), { size: 96 }), new Set(['eye-0', 'eye-1', 'eye-2']));
    expect(items.filter((i) => i.kind === 'node').map((i) => i.key)).toEqual(['eye-0', 'eye-1', 'eye-2']);
  });

  it('every picture is a whole <svg> over its own rect, which holds all it draws', () => {
    for (const a of [def('kettle'), def('noam'), def('alien')]) {
      const layers = nativeLayers(a, { size: 72, pixelRatio: 3 });
      for (const moving of [idleMovers(layers), new Set(['eye-0']), new Set<string>()])
        for (const it of svgsIn(layerStack(layers, moving))) {
          expect(it.xml.match(/<svg/g)).toHaveLength(1);
          const inner = it.xml.slice(it.xml.indexOf('>') + 1, -'</svg>'.length);
          expect(it.xml).toBe(layerSvg(layers.frame, it.rect, inner));
          const drawn = markupBounds(inner).extents!;
          expect(drawn.x0).toBeGreaterThanOrEqual(it.rect.x);
          expect(drawn.y0).toBeGreaterThanOrEqual(it.rect.y);
          expect(drawn.x1).toBeLessThanOrEqual(it.rect.x + it.rect.width);
          expect(drawn.y1).toBeLessThanOrEqual(it.rect.y + it.rect.height);
        }
    }
  });

  it("a stage's bitmaps add up to a few tiles, not a square twice the tile's side for each", () => {
    // react-native-svg draws each SvgXml into a bitmap as big as its view. Before each layer had its own rect,
    // every one was (2 × size)², 7 of them for an average stage.
    const size = 86;
    for (const a of AVATARS) {
      const layers = nativeLayers(a, { size, pixelRatio: 3 });
      const px = (it: StackSvg) => it.rect.width * it.rect.height * layers.frame.scale ** 2;
      const area = svgsIn(layerStack(layers, idleMovers(layers))).reduce((s, it) => s + px(it), 0);
      expect(area).toBeLessThan(3.5 * size * size);
    }
  });
});

const svgsIn = (items: readonly StackItem[]): StackSvg[] =>
  items.flatMap((i) => (i.kind === 'svg' ? [i] : svgsIn(i.items)));

describe('staticXml', () => {
  it('is renderStatic, remembered', () => {
    const fox = def('fox');
    const opts = { size: 36, crop: 'tile', expression: 'neutral', grayscale: false } as const;
    expect(staticXml(fox, opts)).toBe(renderStatic(fox, opts));
    expect(staticXml(fox, opts)).toBe(staticXml(fox, opts));
    expect(staticXml(fox, { ...opts, grayscale: true })).toBe(
      renderStatic(fox, { ...opts, grayscale: true }),
    );
    expect(staticXml(null, opts)).toBe(renderStatic(null, opts));
    // Different sizes, faces and crops are different pictures.
    expect(staticXml(fox, { ...opts, size: 22, crop: 'head' })).not.toBe(staticXml(fox, opts));
    expect(staticXml(fox, { ...opts, expression: 'sad' })).not.toBe(staticXml(fox, opts));
  });
});
