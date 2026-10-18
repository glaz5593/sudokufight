import { CAT_RUNS, catField, catPose, catsRumble, captionAt, CAT_ART, pawPrints } from '../catsModel';
import { DEFAULT_HIT_MS, INTERFERENCE_SCOPE } from '../config';
import {
  BURST_MAX_MS,
  BURST_MIN_MS,
  drawFireworks,
  type FireworksInk,
  fireworksPlan,
  fireworksRumble,
  MAX_PARTICLES,
  MIN_BURST_GAP_MS,
  STILL_AT_MS,
} from '../fireworksModel';
import { elapsedOf, hitAlpha, remainingOf } from '../hitClock';
import { CAT_PALETTES, effectColors } from '../palette';
import { recordingCanvas } from '../testing/skiaMock';
import {
  NO_WARP,
  stepOf,
  waveLength,
  waveLines,
  wavePath,
  warpPose,
  warpRumble,
  warpStill,
  warpTransform,
} from '../warpModel';
import { color, tokens } from '../../../theme';

const TOTAL = 5000;
/** Dir-C-Game's screen and board. */
const SCREEN = { width: 390, height: 844 };
const BOARD = { width: 358, height: 358 };

describe('the scope of an interference [D35]', () => {
  it('is the whole screen until the proposal is approved, and lasts 5 s', () => {
    expect(INTERFERENCE_SCOPE).toBe('screen');
    expect(DEFAULT_HIT_MS).toBe(5000);
  });
});

describe('the hit clock', () => {
  it('counts from the game clock: time left and time in, never past the ends', () => {
    const hit = { endsAt: 6000, totalMs: TOTAL };
    expect(remainingOf(hit, 1000)).toBe(5000);
    expect(elapsedOf(hit, 1000)).toBe(0);
    expect(elapsedOf(hit, 3500)).toBe(2500);
    expect(remainingOf(hit, 6000)).toBe(0);
    expect(elapsedOf(hit, 9000)).toBe(TOTAL);
    expect(elapsedOf(hit, 0)).toBe(0);
  });

  it('stands still while the game is frozen (endsAt null, remainingMs)', () => {
    const frozen = { endsAt: null, remainingMs: 3000, totalMs: TOTAL };
    expect(remainingOf(frozen, 1)).toBe(3000);
    expect(remainingOf(frozen, 99_999)).toBe(3000);
    expect(elapsedOf(frozen, 99_999)).toBe(2000);
  });

  it('fades in from the start and is fully out at the end, exactly', () => {
    expect(hitAlpha(0, TOTAL, 240, 240)).toBe(0);
    expect(hitAlpha(120, TOTAL, 240, 240)).toBeCloseTo(0.5);
    expect(hitAlpha(2500, TOTAL, 240, 240)).toBe(1);
    expect(hitAlpha(TOTAL - 120, TOTAL, 240, 240)).toBeCloseTo(0.5);
    expect(hitAlpha(TOTAL, TOTAL, 240, 240)).toBe(0);
    expect(hitAlpha(TOTAL + 50, TOTAL, 240, 240)).toBe(0);
  });
});

describe('fireworks', () => {
  const plan = fireworksPlan(TOTAL, SCREEN.width, SCREEN.height);
  const ink = { colors: ['s', 'a', 'w'], stroke: {}, fill: {} } as unknown as FireworksInk;
  const noop = () => {};
  Object.assign(ink.stroke, { setColor: noop, setAlphaf: noop, setStrokeWidth: noop });
  Object.assign(ink.fill, { setColor: noop, setAlphaf: noop });

  it('plans the same bursts every time (the static picture shows the same ones)', () => {
    expect(fireworksPlan(TOTAL, SCREEN.width, SCREEN.height)).toEqual(plan);
    expect(plan.bursts.length).toBeGreaterThanOrEqual(12);
  });

  it('is already blooming at the start and keeps bursting until the end', () => {
    expect(plan.bursts[0]!.at).toBeLessThan(0);
    expect(plan.bursts.at(-1)!.at).toBeGreaterThan(TOTAL - 500);
    for (const b of plan.bursts) {
      expect(b.dur).toBeGreaterThanOrEqual(BURST_MIN_MS);
      expect(b.dur).toBeLessThanOrEqual(BURST_MAX_MS);
    }
  });

  it('never blooms more than 3 times a second (photosensitivity, motion.md §4.4)', () => {
    const starts = plan.bursts.map((b) => b.at);
    starts.slice(1).forEach((at, i) => expect(at - starts[i]!).toBeGreaterThanOrEqual(MIN_BURST_GAP_MS));
    for (let from = -1000; from < TOTAL; from += 10) {
      expect(starts.filter((at) => at >= from && at < from + 1000).length).toBeLessThanOrEqual(3);
    }
  });

  it('draws a few hundred particles at most, and never an empty screen, on any frame', () => {
    let fewest = Infinity;
    for (let t = 0; t < TOTAL; t += 16) {
      const canvas = recordingCanvas();
      const drawn = drawFireworks(canvas, ink, plan, t, 1);
      expect(drawn).toBeLessThanOrEqual(MAX_PARTICLES);
      expect(canvas.calls.length).toBeLessThanOrEqual(MAX_PARTICLES * 2);
      fewest = Math.min(fewest, drawn);
    }
    expect(fewest).toBeGreaterThan(40);
  });

  it('keeps its bursts inside the region, and its white core small (no white flash)', () => {
    for (const b of plan.bursts) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.x).toBeLessThan(SCREEN.width);
      expect(b.y).toBeGreaterThan(0);
      expect(b.y).toBeLessThan(SCREEN.height);
      expect(b.r * 0.08 + 1).toBeLessThan(SCREEN.width * 0.05);
    }
  });

  it('scales to the board when it is the region', () => {
    const onBoard = fireworksPlan(TOTAL, BOARD.width, BOARD.height);
    expect(onBoard.bursts.length).toBe(plan.bursts.length);
    for (const b of onBoard.bursts) expect(b.y).toBeLessThan(BOARD.height);
  });

  it('draws nothing once faded out, and the frozen frame is a full one', () => {
    expect(drawFireworks(recordingCanvas(), ink, plan, 2000, 0)).toBe(0);
    expect(drawFireworks(recordingCanvas(), ink, plan, STILL_AT_MS, 1)).toBeGreaterThan(150);
  });

  it('knocks once per burst, at least 700 ms apart, inside the hit', () => {
    const times = fireworksRumble(plan, TOTAL);
    expect(times.length).toBeGreaterThanOrEqual(5);
    times.forEach((at, i) => {
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(TOTAL);
      if (i) expect(at - times[i - 1]!).toBeGreaterThanOrEqual(700);
    });
  });
});

describe('cats', () => {
  const screen = catField(SCREEN.width, SCREEN.height, 'screen');
  const board = catField(BOARD.width, BOARD.height, 'board');

  it('are five, of different sizes and speeds', () => {
    expect(CAT_RUNS).toHaveLength(5);
    expect(new Set(CAT_RUNS.map((c) => c.w)).size).toBe(5);
    expect(new Set(CAT_RUNS.map((c) => c.runMs)).size).toBe(5);
    expect(CAT_RUNS.filter((c) => c.caption)).toHaveLength(2);
  });

  it('start halfway across, where round 1 drew them', () => {
    for (const run of CAT_RUNS) {
      const pose = catPose(run, screen, 0);
      expect(pose.cx).toBeCloseTo(run.x + run.w / 2);
      expect(pose.w).toBeCloseTo(run.w);
      expect(pose.h).toBeCloseTo((run.w * CAT_ART.height) / CAT_ART.width);
      expect(pose.cy).toBeCloseTo(190 + run.y + pose.h / 2);
    }
  });

  it('run across the screen, from the top end to the bottom start, over and over', () => {
    for (const run of CAT_RUNS) {
      const enter = catPose(run, screen, -run.runMs / 2 + 1);
      const leave = catPose(run, screen, run.runMs / 2 - 1);
      expect(enter.cx - enter.w / 2).toBeGreaterThan(SCREEN.width - 120);
      expect(leave.cx + leave.w / 2).toBeLessThan(120);
      expect(leave.cy).toBeGreaterThan(enter.cy);
      // One crossing later it is back where it was.
      expect(catPose(run, screen, 1234 + run.runMs).cx).toBeCloseTo(catPose(run, screen, 1234).cx);
    }
  });

  it('cross the board itself when the board is the region', () => {
    const run = CAT_RUNS[0]!;
    const pose = catPose(run, board, 0);
    expect(pose.cy).toBeGreaterThan(0);
    expect(pose.cy).toBeLessThan(BOARD.height);
    expect(pose.w).toBeCloseTo((run.w * BOARD.width) / 390);
  });

  it('bob and swing their legs, standing still when frozen at the start', () => {
    const run = CAT_RUNS[1]!;
    expect(catPose(run, screen, 0).bob).toBeCloseTo(0);
    expect(catPose(run, screen, 0).swing).toBeCloseTo(0);
    expect(catPose(run, screen, run.bobMs / 2).bob).toBeCloseTo(-4);
    expect(Math.abs(catPose(run, screen, run.bobMs / 2).swing)).toBeGreaterThan(0.2);
  });

  it('carry their speech bubble above the box', () => {
    const pose = catPose(CAT_RUNS[0]!, screen, 0);
    expect(captionAt(pose)).toEqual({ x: pose.cx - pose.w / 2 - 6, y: pose.cy - pose.h / 2 - 30 });
  });

  it('leave faint paw prints in the region', () => {
    const prints = pawPrints(screen);
    expect(prints.length).toBeGreaterThan(10);
    for (const p of prints) {
      expect(p.opacity).toBeGreaterThanOrEqual(0.2);
      expect(p.opacity).toBeLessThanOrEqual(0.38);
    }
  });

  it('knock once as each cat comes in, at least 250 ms apart', () => {
    const times = catsRumble(TOTAL);
    expect(times.length).toBeGreaterThanOrEqual(6);
    times.forEach((at, i) => {
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(TOTAL);
      if (i) expect(at - times[i - 1]!).toBeGreaterThanOrEqual(250);
    });
  });

  it('are coloured from the tokens only', () => {
    const tokenColors = new Set<string>(JSON.stringify(tokens.color).match(/#[0-9a-f]{6}/gi) ?? []);
    for (const palette of Object.values(CAT_PALETTES)) {
      for (const value of Object.values(palette)) expect(tokenColors.has(value)).toBe(true);
    }
  });
});

describe('effect colours', () => {
  it('are the sender’s seat colour, gold and C’s white, never my P1, and C’s ground for ink', () => {
    const colors = effectColors(1);
    expect(colors).toEqual({
      sender: tokens.color.players[1]!.ring,
      accent: color.accent,
      light: color.text,
      ink: color.bg,
    });
    expect(effectColors(3).sender).toBe(tokens.color.players[3]!.ring);
    expect(Object.values(effectColors(2))).not.toContain(tokens.color.players[0]!.ring);
  });
});

describe('warp', () => {
  it('is straight at strength 0 (before it fades in and after it ends)', () => {
    const pose = warpPose(700, 0, 'board');
    expect([pose.rotateX, pose.rotateY, pose.rotateZ].map(Math.abs)).toEqual([0, 0, 0]);
    expect([pose.scaleX, pose.scaleY]).toEqual([1, 1]);
  });

  it('swings the board as round 1 did: rotateX 16° → −10°, rotateY −12° → 12° in 1300 ms', () => {
    const start = warpPose(0, 1, 'board');
    expect(start.perspective).toBe(700);
    expect(start.rotateX).toBeCloseTo(16);
    expect(start.rotateY).toBeCloseTo(-12);
    expect(start.rotateZ).toBeCloseTo(-3);
    const turn = warpPose(1300, 1, 'board');
    expect(turn.rotateX).toBeCloseTo(-10);
    expect(turn.rotateY).toBeCloseTo(12);
    expect(warpPose(2600, 1, 'board').rotateX).toBeCloseTo(16);
  });

  it('tilts the whole screen 60 % as much, with a longer perspective', () => {
    const pose = warpPose(0, 1, 'screen');
    expect(pose.perspective).toBe(1000);
    expect(pose.rotateX).toBeCloseTo(16 * 0.6);
  });

  it('wobbles with the wave: stretches across while it squeezes down', () => {
    const pose = warpPose(275, 1, 'board'); // a quarter wave
    expect(pose.scaleX).toBeGreaterThan(pose.scaleY);
  });

  it('with reduced motion: one fixed tilt while it lasts, then straight', () => {
    const on = warpStill(true, 'board');
    expect(on).toMatchObject({ rotateY: -6, rotateZ: -2, scaleX: 1.04, scaleY: 1.04 });
    const off = warpStill(false, 'board');
    expect([off.rotateX, off.rotateY, off.rotateZ].map(Math.abs)).toEqual([0, 0, 0]);
    expect([off.scaleX, off.scaleY]).toEqual([1, 1]);
  });

  it('becomes a React Native transform, perspective first', () => {
    expect(warpTransform(NO_WARP)).toEqual([
      { perspective: 1000 },
      { rotateX: '0deg' },
      { rotateY: '0deg' },
      { rotateZ: '0deg' },
      { scaleX: 1 },
      { scaleY: 1 },
    ]);
  });

  it('jumps its offset copy in 4 steps', () => {
    expect([0, 400, 800, 1200, 1600].map((t) => stepOf(t, 1600))).toEqual([0, 1, 2, 3, 0]);
    expect(stepOf(-100, 1600)).toBe(3);
  });

  it('draws wave lines across the whole region, one wavelength more', () => {
    const d = wavePath(358, 40, 6, 80);
    expect(d.startsWith('M0 40 q20 -6 40 0')).toBe(true);
    expect((d.match(/t40 0/g) ?? []).length * 40 + 40).toBeGreaterThanOrEqual(358 + 80);
    expect(waveLines(358, 358)).toHaveLength(6);
    expect(waveLines(390, 844).length).toBe(12);
    expect(waveLength(390)).toBeCloseTo(83, 0);
  });

  it('knocks every 1100 ms', () => {
    expect(warpRumble(TOTAL)).toEqual([1100, 2200, 3300, 4400]);
  });
});
