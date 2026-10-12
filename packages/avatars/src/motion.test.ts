import { AVATARS } from './catalog';
import {
  cubicBezier,
  EASINGS,
  faceChanges,
  IDENTITY,
  motionCss,
  motionOrigin,
  MOTIONS,
  poseMatrix,
  resolveMotion,
  sampleTrack,
  TARGET_CLASS,
} from './motion';
import { eyeLineOf } from './render';
import { type AvatarDef, EXPRESSIONS, MOTION_IDS, type Pose } from './types';

const apply = (m: readonly number[], p: { x: number; y: number }) => ({
  x: (m[0] ?? 0) * p.x + (m[2] ?? 0) * p.y + (m[4] ?? 0),
  y: (m[1] ?? 0) * p.x + (m[3] ?? 0) * p.y + (m[5] ?? 0),
});

const someAvatar = (): AvatarDef => {
  const a = AVATARS[0];
  if (!a) throw new Error('empty catalog');
  return a;
};

describe('MOTIONS', () => {
  it('defines every motion id under its own key', () => {
    expect(Object.keys(MOTIONS).sort()).toEqual([...MOTION_IDS].sort());
    for (const id of MOTION_IDS) expect(MOTIONS[id].id).toBe(id);
  });

  it.each(MOTION_IDS)('%s: tracks run from t = 0 to t = 1 in order, with known faces', (id) => {
    const m = MOTIONS[id];
    expect(m.durationMs).toBeGreaterThan(0);
    expect(m.name.he.trim()).not.toBe('');
    expect(m.name.en.trim()).not.toBe('');
    expect(m.tracks.length).toBeGreaterThan(0);
    for (const tr of m.tracks) {
      const ts = tr.keyframes.map((k) => k.t);
      expect(ts[0]).toBe(0);
      expect(ts[ts.length - 1]).toBe(1);
      for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1] ?? 1);
      for (const k of tr.keyframes)
        if (k.expression && k.expression !== 'base') expect(EXPRESSIONS).toContain(k.expression);
    }
    if (m.expression) expect(EXPRESSIONS).toContain(m.expression);
  });

  it.each(MOTION_IDS)('%s: ends where it started, with the face back to before', (id) => {
    const m = MOTIONS[id];
    for (const tr of m.tracks) {
      const end = sampleTrack(tr, 1, m.ease);
      expect(end.x).toBeCloseTo(0);
      expect(end.y).toBeCloseTo(0);
      expect(end.rotate % 360).toBeCloseTo(0);
      expect(end.sx).toBeCloseTo(1);
      expect(end.sy).toBeCloseTo(1);
    }
    const changes = faceChanges(m);
    if (changes.length) expect(changes[changes.length - 1]?.expression).toBe('base');
    if (m.expression) expect(changes.map((c) => c.expression)).toContain(m.expression);
  });

  it('falls back for avatars that may not squash', () => {
    const a = someAvatar();
    expect(resolveMotion({ ...a, squash: false }, 'squash').id).toBe('bounce');
    expect(resolveMotion({ ...a, squash: true }, 'squash').id).toBe('squash');
    expect(resolveMotion({ ...a, squash: false }, 'spin').id).toBe('spin');
    for (const id of MOTION_IDS) {
      const m = MOTIONS[id];
      if (m.needsSquash) expect(m.fallback && !MOTIONS[m.fallback].needsSquash).toBeTruthy();
    }
  });

  it('only blink is idle', () => {
    expect(MOTION_IDS.filter((id) => MOTIONS[id].idle)).toEqual(['blink']);
  });
});

describe('sampling', () => {
  it('evaluates the easing curves', () => {
    for (const x of [0, 0.25, 0.5, 0.9, 1]) expect(cubicBezier(EASINGS.linear, x)).toBeCloseTo(x, 4);
    expect(cubicBezier(EASINGS.standard, 0.5)).toBeGreaterThan(0.5); // decelerates
    expect(cubicBezier(EASINGS.exit, 0.5)).toBeLessThan(0.5); // accelerates
    expect(cubicBezier(EASINGS.loop, 0.5)).toBeCloseTo(0.5, 3); // symmetric
    expect(cubicBezier(EASINGS.emphasized, 0.6)).toBeGreaterThan(1); // overshoots
  });

  it('hits every keyframe exactly', () => {
    for (const id of MOTION_IDS) {
      const m = MOTIONS[id];
      for (const tr of m.tracks)
        for (const k of tr.keyframes) {
          const p = sampleTrack(tr, k.t, m.ease);
          expect(p.x).toBeCloseTo(k.x ?? 0);
          expect(p.y).toBeCloseTo(k.y ?? 0);
          expect(p.rotate).toBeCloseTo(k.rotate ?? 0);
          expect(p.sx).toBeCloseTo(k.sx ?? 1);
          expect(p.sy).toBeCloseTo(k.sy ?? 1);
        }
    }
  });

  it('interpolates between keyframes with the segment’s curve', () => {
    const tr = { target: 'body', origin: 'pivot', keyframes: [{ t: 0 }, { t: 1, x: 10 }] } as const;
    expect(sampleTrack(tr, 0.5, 'linear').x).toBeCloseTo(5);
    expect(sampleTrack(tr, 0.5, 'standard').x).toBeGreaterThan(5);
    expect(sampleTrack({ ...tr, keyframes: [] }, 0.5)).toEqual(IDENTITY);
    expect(sampleTrack(tr, -1).x).toBe(0);
    expect(sampleTrack(tr, 2).x).toBe(10);
  });

  it('builds a matrix that keeps the origin fixed under rotate and scale', () => {
    expect(poseMatrix(IDENTITY, { x: 50, y: 50 })).toEqual([1, 0, 0, 1, 0, 0]);
    const origin = { x: 50, y: 60 };
    const pose: Pose = { x: 0, y: 0, rotate: 37, sx: 0.8, sy: 1.2 };
    const o = apply(poseMatrix(pose, origin), origin);
    expect(o.x).toBeCloseTo(50);
    expect(o.y).toBeCloseTo(60);
    // a quarter turn takes the point to the right of the origin below it (y grows down)
    const q = apply(poseMatrix({ ...IDENTITY, rotate: 90 }, origin), { x: 60, y: 60 });
    expect(q.x).toBeCloseTo(50);
    expect(q.y).toBeCloseTo(70);
    const moved = apply(poseMatrix({ ...IDENTITY, x: 3, y: -4 }, origin), origin);
    expect(moved).toEqual({ x: 53, y: 56 });
  });

  it('finds each track’s origin on the avatar', () => {
    const a = someAvatar();
    expect(motionOrigin(a, 'pivot')).toEqual(a.pivot);
    expect(motionOrigin(a, 'base')).toEqual({ x: a.pivot.x, y: a.base ?? 100 });
    expect(motionOrigin(a, 'eyes')).toEqual(eyeLineOf(a));
  });

  it('lists face changes in time order, in ms', () => {
    const changes = faceChanges(MOTIONS.spin);
    expect(changes.map((c) => c.atMs)).toEqual([...changes.map((c) => c.atMs)].sort((x, y) => x - y));
    expect(changes[0]).toEqual({ atMs: 0, expression: 'surprised' });
    expect(changes[changes.length - 1]).toEqual({ atMs: MOTIONS.spin.durationMs, expression: 'base' });
  });
});

describe('motionCss', () => {
  const css = motionCss();

  it('has a keyframes rule and a play rule for every track', () => {
    for (const id of MOTION_IDS)
      for (const tr of MOTIONS[id].tracks) {
        expect(css).toContain(`@keyframes sfa-${id}-${tr.target}{`);
        expect(css).toContain(
          `.sfa.sfa-m-${id} .${TARGET_CLASS[tr.target]}{animation:sfa-${id}-${tr.target} `,
        );
        expect(css).toContain(`transform-origin:var(--sfa-${tr.origin})`);
      }
  });

  it('blinks every eye on its own, around its own centre', () => {
    expect(TARGET_CLASS.eyes).toBe('sfa-eye');
    expect(css).toContain('.sfa.sfa-m-blink .sfa-eye{animation:sfa-blink-eyes ');
    expect(css).toContain('transform-origin:var(--sfa-eyes)');
  });

  it('turns motion off for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^{}]*\{animation:none!important\}\}/);
  });

  it('is balanced and scoped on request', () => {
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
    const scoped = motionCss('.page');
    expect(scoped).toContain('.page .sfa.sfa-m-spin .sfa-body{');
    expect(scoped).not.toMatch(/(^|[},])\.sfa/m);
  });
});
