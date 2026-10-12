import { TILE } from '../palette';
import { CANVAS } from '../render';
import { checkXml } from '../testing/xml';
import { AVATAR_KINDS, MOTION_IDS } from '../types';
import { ANIMALS, AVATARS, avatarById, avatarsOfKind, OBJECTS, PEOPLE } from './index';

const TILES = new Set<string>(Object.values(TILE));
const inCanvas = (v: number, margin = 0) => v - margin >= 0 && v + margin <= CANVAS;

describe('the catalog', () => {
  it('lists people, then animals, then objects', () => {
    expect(AVATARS).toEqual([...PEOPLE, ...ANIMALS, ...OBJECTS]);
    expect(PEOPLE.every((a) => a.kind === 'person')).toBe(true);
    expect(ANIMALS.every((a) => a.kind === 'animal')).toBe(true);
    expect(OBJECTS.every((a) => a.kind === 'object')).toBe(true);
    expect(AVATARS.length).toBeGreaterThan(0);
  });

  it('has unique, stable-looking ids', () => {
    const ids = AVATARS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  });

  it('finds avatars by id and kind', () => {
    for (const a of AVATARS) expect(avatarById(a.id)).toBe(a);
    expect(avatarById('no-such-avatar')).toBeUndefined();
    for (const kind of AVATAR_KINDS) expect(avatarsOfKind(kind).every((a) => a.kind === kind)).toBe(true);
  });
});

describe.each(AVATARS.map((a) => [a.id, a] as const))('avatar %s', (_, a) => {
  it('has a Hebrew and an English name', () => {
    expect(a.name.he.trim()).not.toBe('');
    expect(a.name.en.trim()).not.toBe('');
    expect(a.name.he).toMatch(/[֐-׿]/);
  });

  it('uses a palette tile', () => {
    expect(TILES.has(a.tile)).toBe(true);
  });

  it('has layers that are clean SVG fragments: well-formed, no ids, no scripts, no links', () => {
    for (const layer of [a.layers.back, a.layers.front ?? '']) {
      expect(() => checkXml(`<g>${layer}</g>`)).not.toThrow();
      expect(layer).not.toMatch(/\sid=/);
      expect(layer).not.toMatch(/<script|<style|\son[a-z]+=|href|url\(|<image|<text/i);
    }
  });

  it('keeps its anchors inside the canvas', () => {
    const { eyes, mouth } = a.face;
    for (const e of [eyes.left, eyes.right]) {
      expect(inCanvas(e.x, eyes.r)).toBe(true);
      expect(inCanvas(e.y, eyes.r)).toBe(true);
    }
    expect(eyes.right.x - eyes.left.x).toBeGreaterThanOrEqual(2.7 * eyes.r); // surprised eyes must not touch
    expect(eyes.r).toBeGreaterThan(0);
    expect(inCanvas(mouth.x, mouth.w / 2)).toBe(true);
    expect(inCanvas(mouth.y)).toBe(true);
    expect(mouth.y).toBeGreaterThan(Math.max(eyes.left.y, eyes.right.y));
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
});
