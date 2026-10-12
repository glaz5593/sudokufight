import { gimmickAnims } from '../gimmick';
import { TILE } from '../palette';
import { CANVAS } from '../render';
import { eyeSlots } from '../rig';
import { FIXTURES } from '../testing/fixtures';
import { checkXml } from '../testing/xml';
import { AVATAR_KINDS, EXPRESSIONS, GIMMICK_DEPTHS, KIND_NAMES, MOTION_IDS } from '../types';
import { AVATARS, avatarById, avatarsOfKind, CATALOG_FILES } from './index';

const TILES = new Set<string>(Object.values(TILE));
const inCanvas = (v: number, margin = 0) => v - margin >= 0 && v + margin <= CANVAS;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The first characters: users store these ids, so they stay. */
const SHIPPED = [
  'noam',
  'maya',
  'ruthie',
  'omer',
  'dana',
  'ido',
  'fox',
  'cat',
  'panda',
  'frog',
  'rabbit',
  'owl',
  'eight',
  'letter-a',
  'coffee-cup',
  'pencil',
  'lightbulb',
  'alarm-clock',
];

/** CIE76 colour difference (ΔE) of two #rrggbb colours, through CIELAB (D65). About 25 and up reads as "different". */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
    });
    const fn = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = fn((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047);
    const y = fn(0.2126 * r + 0.7152 * g + 0.0722 * bl);
    const z = fn((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const;
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** A clean SVG fragment: well-formed, no ids, no scripts, no links, no text or images. */
const expectClean = (markup: string) => {
  expect(() => checkXml(`<g>${markup}</g>`)).not.toThrow();
  expect(markup).not.toMatch(/\sid=/);
  expect(markup).not.toMatch(/<script|<style|\son[a-z]+=|href|url\(|<image|<text/i);
};

describe('the catalog', () => {
  it('joins every catalog file, grouped by kind in AVATAR_KINDS order', () => {
    const files = Object.values(CATALOG_FILES);
    expect(Object.keys(CATALOG_FILES)).toEqual([
      'people',
      'people2',
      'animals',
      'objects',
      'home',
      'office',
      'play',
      'food',
      'nature',
      'creatures',
      'digits',
      'symbols',
    ]);
    const all = files.flat();
    expect(AVATARS).toHaveLength(all.length);
    expect(new Set(AVATARS)).toEqual(new Set(all));
    const rank = AVATARS.map((a) => AVATAR_KINDS.indexOf(a.kind));
    expect(rank).toEqual([...rank].sort((x, y) => x - y));
    // within a kind, in file order
    for (const kind of AVATAR_KINDS) expect(avatarsOfKind(kind)).toEqual(all.filter((a) => a.kind === kind));
  });

  it('has unique, stable-looking ids across every file, and keeps the shipped ones', () => {
    const ids = AVATARS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ID);
    for (const id of SHIPPED) expect(ids).toContain(id);
    for (const f of FIXTURES) expect(ids).not.toContain(f.id);
  });

  it('gives every character its own name, in both languages', () => {
    for (const lang of ['he', 'en'] as const) {
      const names = AVATARS.map((a) => a.name[lang].toLocaleLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('spreads the tiles: neighbours in the picker are clearly different colours', () => {
    // rose/berry, iris/violet/orchid, cobalt/iris/violet, teal/jade and sky/slate look alike side by side
    const close = AVATARS.slice(1).flatMap((b, i) => {
      const a = AVATARS[i];
      const d = a ? deltaE(a.tile, b.tile) : Infinity;
      return d < 25 ? [`${a?.id} → ${b.id}: ΔE ${d.toFixed(0)}`] : [];
    });
    expect(close).toEqual([]);
  });

  it('finds avatars by id and kind', () => {
    for (const a of AVATARS) expect(avatarById(a.id)).toBe(a);
    expect(avatarById('no-such-avatar')).toBeUndefined();
    for (const kind of AVATAR_KINDS) expect(avatarsOfKind(kind).every((a) => a.kind === kind)).toBe(true);
  });

  it('names every kind in Hebrew and English', () => {
    expect(Object.keys(KIND_NAMES).sort()).toEqual([...AVATAR_KINDS].sort());
    for (const k of AVATAR_KINDS)
      for (const n of [KIND_NAMES[k].one, KIND_NAMES[k].many]) {
        expect(n.he).toMatch(/[֐-׿]/);
        expect(n.en.trim()).not.toBe('');
      }
  });
});

describe.each([...AVATARS, ...FIXTURES].map((a) => [a.id, a] as const))('avatar %s', (_, a) => {
  it('has a Hebrew and an English name', () => {
    expect(a.name.he.trim()).not.toBe('');
    expect(a.name.en.trim()).not.toBe('');
    expect(a.name.he).toMatch(/[֐-׿]/);
  });

  it('uses a palette tile', () => {
    expect(TILES.has(a.tile)).toBe(true);
  });

  it('has layers and face art that are clean SVG fragments', () => {
    for (const layer of [a.layers.back, a.layers.front ?? '']) expectClean(layer);
    const art = a.face.art;
    if (art) for (const e of ['default', ...EXPRESSIONS] as const) expectClean(art[e] ?? '');
  });

  it('keeps its anchors inside the canvas', () => {
    const { eyes, mouth } = a.face;
    const slots = eyeSlots(a.face);
    expect(eyes.r).toBeGreaterThan(0);
    for (const s of slots) {
      expect(inCanvas(s.c.x, s.r)).toBe(true);
      expect(inCanvas(s.c.y, s.r)).toBe(true);
    }
    // surprised eyes grow by 22%: they must not touch
    slots.forEach((p, i) => {
      for (const q of slots.slice(i + 1))
        expect(Math.hypot(q.c.x - p.c.x, q.c.y - p.c.y)).toBeGreaterThanOrEqual(1.35 * (p.r + q.r));
    });
    if (mouth) {
      expect(inCanvas(mouth.x, mouth.w / 2)).toBe(true);
      expect(inCanvas(mouth.y)).toBe(true);
      expect(mouth.y).toBeGreaterThan(Math.max(...slots.map((s) => s.c.y)));
    }
    expect(inCanvas(a.pivot.x) && inCanvas(a.pivot.y)).toBe(true);
    if (a.base !== undefined) expect(inCanvas(a.base)).toBe(true);
    if (a.face.halo) expect(inCanvas(a.face.halo.x) && inCanvas(a.face.halo.y)).toBe(true);
    if (a.headBox) {
      const b = a.headBox;
      expect(b.size).toBeGreaterThan(20);
      expect(inCanvas(b.x) && inCanvas(b.y) && inCanvas(b.x + b.size) && inCanvas(b.y + b.size)).toBe(true);
    }
  });

  it('prefers real motions, each once', () => {
    const bias = a.motionBias ?? [];
    expect(new Set(bias).size).toBe(bias.length);
    for (const m of bias) expect(MOTION_IDS).toContain(m);
  });

  it('declares well-formed gimmicks', () => {
    const gimmicks = a.gimmicks ?? [];
    const ids = gimmicks.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(gimmicks.filter((g) => g.z === 'face').length).toBeLessThanOrEqual(1);
    for (const g of gimmicks) {
      expect(g.id).toMatch(ID);
      expectClean(g.markup);
      expect(g.markup.trim()).not.toBe('');
      expect(GIMMICK_DEPTHS).toContain(g.z ?? 'front');
      const anims = gimmickAnims(g);
      expect(anims.length).toBeGreaterThan(0);
      for (const an of anims) {
        expect(an.trigger.length).toBeGreaterThan(0);
        for (const t of an.trigger) expect([...EXPRESSIONS, ...MOTION_IDS, 'idle']).toContain(t);
        expect(an.trigger).not.toContain('neutral');
        expect(an.trigger).not.toContain('blink');
        expect(an.durationMs).toBeGreaterThan(0);
        expect(an.delayMs ?? 0).toBeGreaterThanOrEqual(0);
        expect(inCanvas(an.origin.x) && inCanvas(an.origin.y)).toBe(true);
        const ts = an.keyframes.map((k) => k.t);
        expect(ts[0]).toBe(0);
        expect(ts[ts.length - 1]).toBe(1);
        for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1] ?? 1);
        // a hidden gimmick must show at some point
        if (g.rest === 'hidden') expect(an.keyframes.some((k) => (k.opacity ?? 1) > 0)).toBe(true);
      }
    }
  });
});
