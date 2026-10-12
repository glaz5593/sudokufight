import {
  GIMMICK_IDENTITY,
  GIMMICK_RECIPES,
  gimmickAnimName,
  gimmickAnims,
  gimmickCss,
  playingGimmicks,
  sampleGimmick,
  triggeredBy,
} from './gimmick';
import { GIMMICK_MIN_SIZE } from './render';
import { FIXTURES } from './testing/fixtures';
import type { AvatarDef, GimmickAnim, GimmickDef } from './types';

const fixture = (id: string): AvatarDef => {
  const a = FIXTURES.find((x) => x.id === id);
  if (!a) throw new Error(`no fixture ${id}`);
  return a;
};

const anim = (over: Partial<GimmickAnim> = {}): GimmickAnim => ({
  trigger: ['laugh'],
  keyframes: [{ t: 0 }, { t: 1, x: 10, opacity: 0 }],
  durationMs: 1000,
  origin: { x: 50, y: 50 },
  ...over,
});

/** An avatar with only these gimmicks. */
const withGimmicks = (...gimmicks: GimmickDef[]): AvatarDef => ({ ...fixture('demo-kettle'), gimmicks });

const playing = (def: AvatarDef, st: Parameters<typeof playingGimmicks>[1]) =>
  playingGimmicks(def, st).map((p) => `${p.gimmick.id}#${p.index}`);

describe('sampling a gimmick', () => {
  it('hits every keyframe, defaults missing fields to the identity, and holds the ends', () => {
    const a = anim({
      ease: 'linear',
      keyframes: [
        { t: 0, opacity: 0 },
        { t: 0.5, y: -6, sx: 1.2, opacity: 1 },
        { t: 1, rotate: 90 },
      ],
    });
    expect(sampleGimmick(a, 0)).toEqual({ ...GIMMICK_IDENTITY, opacity: 0 });
    expect(sampleGimmick(a, 0.5)).toEqual({ ...GIMMICK_IDENTITY, y: -6, sx: 1.2 });
    expect(sampleGimmick(a, 1)).toEqual({ ...GIMMICK_IDENTITY, rotate: 90 });
    expect(sampleGimmick(a, 0.25).y).toBeCloseTo(-3);
    expect(sampleGimmick(a, 0.25).opacity).toBeCloseTo(0.5);
    expect(sampleGimmick(a, -1).opacity).toBe(0);
    expect(sampleGimmick(a, 2).rotate).toBe(90);
    expect(sampleGimmick(anim({ keyframes: [] }), 0.5)).toEqual(GIMMICK_IDENTITY);
  });

  it('uses a keyframe’s own curve, else the anim’s, else ease in and out', () => {
    const lin = anim({ ease: 'linear' });
    expect(sampleGimmick(lin, 0.25).x).toBeCloseTo(2.5);
    expect(sampleGimmick(anim(), 0.25).x).toBeLessThan(2.5); // 'loop' starts slow
    const own = anim({
      ease: 'linear',
      keyframes: [
        { t: 0, ease: 'standard' },
        { t: 1, x: 10 },
      ],
    });
    expect(sampleGimmick(own, 0.25).x).toBeGreaterThan(2.5); // 'standard' starts fast
  });

  it('lists one anim or several', () => {
    const one: GimmickDef = { id: 'a', markup: '', anim: anim() };
    const two: GimmickDef = { id: 'b', markup: '', anim: [anim(), anim({ trigger: ['sad'] })] };
    expect(gimmickAnims(one)).toHaveLength(1);
    expect(gimmickAnims(two)).toHaveLength(2);
    expect(triggeredBy(anim({ trigger: ['sad', 'spin'] }), 'spin')).toBe(true);
    expect(triggeredBy(anim({ trigger: ['sad', 'spin'] }), 'neutral')).toBe(false);
  });
});

describe('which gimmick plays', () => {
  const lid: GimmickDef = {
    id: 'lid',
    markup: '',
    anim: [anim({ trigger: ['surprised', 'spin'] }), anim({ trigger: ['surprised', 'idle'] })],
  };
  const steam: GimmickDef = { id: 'steam', markup: '', anim: anim({ trigger: ['idle', 'laugh'] }) };
  const def = withGimmicks(lid, steam);
  const big = { size: 160 };

  it('plays the motion’s anim first, then the expression’s, then idle', () => {
    expect(playing(def, { ...big, expression: 'surprised', motion: 'spin' })).toEqual(['lid#0']);
    expect(playing(def, { ...big, expression: 'laugh', motion: 'spin' })).toEqual(['lid#0', 'steam#0']);
    expect(playing(def, { ...big, expression: 'surprised' })).toEqual(['lid#0']); // the first that matches
    expect(playing(def, { ...big, expression: 'neutral', idle: true })).toEqual(['lid#1', 'steam#0']);
  });

  it('idles only where the player allows it', () => {
    expect(playing(def, { ...big, expression: 'neutral' })).toEqual([]);
    expect(playing(def, { ...big, expression: 'sad', idle: false })).toEqual([]);
  });

  it('plays nothing under 48 px or with reduced motion', () => {
    expect(GIMMICK_MIN_SIZE).toBe(48);
    expect(playing(def, { size: 47, expression: 'laugh', idle: true })).toEqual([]);
    expect(playing(def, { size: 48, expression: 'laugh' })).toEqual(['steam#0']);
    expect(playing(def, { ...big, expression: 'laugh', idle: true, reducedMotion: true })).toEqual([]);
  });
});

describe('gimmickCss', () => {
  const css = gimmickCss(FIXTURES);

  it('has a keyframes rule per anim and a play rule per trigger', () => {
    for (const a of FIXTURES)
      for (const g of a.gimmicks ?? [])
        gimmickAnims(g).forEach((an, i) => {
          const name = gimmickAnimName(a.id, g.id, i);
          expect(css).toContain(`@keyframes ${name}{`);
          const svg = `.sfa[data-avatar="${a.id}"]:not(.sfa-small)`;
          for (const t of an.trigger) {
            const sel =
              t === 'idle'
                ? `${svg}.sfa-idle .sfa-g-${g.id}{`
                : t === 'spin' || t === 'shake' || t === 'bounce'
                  ? `${svg}.sfa-m-${t} .sfa-g-${g.id}{`
                  : `${svg}[data-expression="${t}"] .sfa-g-${g.id}{`;
            expect(css).toContain(`${sel}animation:${name} ${an.durationMs}ms ${an.delayMs ?? 0}ms`);
          }
        });
  });

  it('loops what loops, plays the rest once and holds it, and turns around the origin', () => {
    expect(css).toMatch(/sfa-g-demo-washer-drum-0 1100ms 0ms infinite both;transform-origin:50px 60px/);
    expect(css).toMatch(/sfa-g-demo-toaster-toast-0 1300ms 0ms 1 both;transform-origin:49px 62px/);
    expect(css).toMatch(/sfa-g-demo-kettle-steam-2-0 2000ms 1334ms infinite both/);
  });

  it('orders rules as playingGimmicks does: idle, then faces, then motions; the first anim last', () => {
    const at = (s: string) => css.indexOf(s);
    const washer = '.sfa[data-avatar="demo-washer"]:not(.sfa-small)';
    expect(at(`${washer}.sfa-idle .sfa-g-drum`)).toBeLessThan(
      at(`${washer}[data-expression="laugh"] .sfa-g-drum`),
    );
    expect(at(`${washer}[data-expression="laugh"] .sfa-g-drum`)).toBeLessThan(
      at(`${washer}.sfa-m-spin .sfa-g-drum`),
    );
    const lid = gimmickCss([withGimmicks({ id: 'lid', markup: '', anim: [anim(), anim()] })]);
    expect(lid.indexOf('lid-1 ')).toBeLessThan(lid.indexOf('lid-0 '));
  });

  it('never plays in small renders or with reduced motion, and scopes on request', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:reduce\)\{[^{}]*\.sfa-gimmick\{animation:none!important\}\}/,
    );
    for (const rule of css.split('\n').filter((r) => r.includes('animation:sfa-g-')))
      expect(rule).toContain(':not(.sfa-small)');
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
    const scoped = gimmickCss(FIXTURES, '.page');
    expect(scoped).toContain('.page .sfa[data-avatar="demo-washer"]');
    expect(scoped).not.toMatch(/(^|[},])\.sfa/m);
    expect(gimmickCss([])).not.toContain('@keyframes');
  });
});

describe('recipes', () => {
  const ONCE = ['popUp', 'inflate', 'lid'] as const;

  it.each(Object.keys(GIMMICK_RECIPES))('%s: keyframes from t = 0 to t = 1, in order', (name) => {
    const r = GIMMICK_RECIPES[name as keyof typeof GIMMICK_RECIPES]();
    const ts = r.keyframes.map((k) => k.t);
    expect(ts[0]).toBe(0);
    expect(ts[ts.length - 1]).toBe(1);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1] ?? 1);
    expect(r.durationMs).toBeGreaterThan(0);
  });

  it('loops seamlessly: back where it started, or invisible at the seam', () => {
    for (const [name, make] of Object.entries(GIMMICK_RECIPES)) {
      const r = make();
      if (!r.loop) continue;
      const a = { ...r, trigger: [], origin: { x: 0, y: 0 } } satisfies GimmickAnim;
      const start = sampleGimmick(a, 0);
      const end = sampleGimmick(a, 1);
      const hidden = start.opacity === 0 && end.opacity === 0;
      const same =
        end.x === start.x &&
        end.y === start.y &&
        (end.rotate - start.rotate) % 360 === 0 &&
        end.sx === start.sx &&
        end.sy === start.sy &&
        end.opacity === start.opacity;
      expect({ name, seamless: hidden || same }).toEqual({ name, seamless: true });
    }
  });

  it.each(ONCE)('%s plays once and comes back to rest', (name) => {
    const r = GIMMICK_RECIPES[name]();
    expect(r.loop).toBeFalsy();
    expect(sampleGimmick({ ...r, trigger: [], origin: { x: 0, y: 0 } }, 1)).toEqual(GIMMICK_IDENTITY);
  });

  it('takes options', () => {
    expect(GIMMICK_RECIPES.spin({ reverse: true, turns: 2 }).keyframes[1]?.rotate).toBe(-720);
    expect(GIMMICK_RECIPES.popUp({ height: 10 }).keyframes[1]?.y).toBe(-10);
    expect(GIMMICK_RECIPES.steam({ ms: 900 }).durationMs).toBe(900);
  });
});
